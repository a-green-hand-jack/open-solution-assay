import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { now, readJson, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { buildInventory } from "./inventory.js";
import { auditHashAssertions } from "./manifest.js";
import { recoverProblem } from "./problem.js";
import { collectCommands, runAll } from "./exec.js";
import { buildGraph } from "./graph.js";
import { PHASES, isDeterministic, type Phase } from "./phases.js";
import { RunStateSchema, type RunState, type TierCap } from "./state.js";
import { validatePhase, type Check } from "./validation.js";
import { abortSession, attachTui, createSession, prompt, startOpenCode, waitForIdle, type OpenCodeRuntime } from "./opencode.js";

/** Progress is printed to stderr so stdout stays clean for machine consumers. */
function report(line: string): void {
  process.stderr.write(`${line}\n`);
}

export type ControllerOptions = {
  workspace: string;
  headless: boolean;
  model?: string;
  timeoutMs: number;
  execPolicy: "full" | "python-only" | "static";
  execTimeoutMs: number;
  maxCommands: number;
  network: boolean;
};

export class AssayController {
  private runtime?: OpenCodeRuntime;
  private sessionId?: string;
  private interrupted = false;
  private rejectInterruption?: (error: Error) => void;
  private readonly interruption = new Promise<never>((_, reject) => { this.rejectInterruption = reject; });

  constructor(private readonly options: ControllerOptions) {}

  private statePath(): string { return join(this.options.workspace, ".osa-run", "run.json"); }
  private async state(): Promise<RunState> { return RunStateSchema.parse(await readJson(this.statePath())); }
  private async save(state: RunState): Promise<void> { state.updated_at = now(); await writeJsonAtomic(this.statePath(), state); }
  private source(): string { return join(this.options.workspace, "source"); }
  private load = (relative: string): Promise<string> => readFile(join(this.source(), relative), "utf8");

  /**
   * Run only the model-free phases. No OpenCode server is started, so this
   * path costs nothing and is the one used for offline corpus sweeps.
   */
  async runPrepareOnly(): Promise<void> {
    for (const phase of PHASES) {
      if (!isDeterministic(phase)) continue;
      const state = await this.state();
      if (state.phases[phase]?.status === "completed") continue;
      await this.runPhase(phase);
    }
    const state = await this.state();
    state.status = "prepared";
    await this.save(state);
  }

  async run(): Promise<"completed"> {
    const abortController = new AbortController();
    const interrupt = (signal: NodeJS.Signals) => {
      this.interrupted = true;
      abortController.abort();
      this.rejectInterruption?.(new Error(`assay interrupted by ${signal}`));
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);

    let tui: ReturnType<typeof attachTui> | undefined;
    try {
      for (const phase of PHASES) {
        const state = await this.state();
        if (state.phases[phase]?.status === "completed") continue;

        // The OpenCode session is started lazily: the deterministic phases need
        // no model, so a --prepare-only or static run never pays for a server.
        if (!isDeterministic(phase) && !this.runtime) {
          this.runtime = await startOpenCode(this.options.workspace);
          this.sessionId = await createSession(this.runtime, this.options.workspace);
          await writeJsonAtomic(join(this.options.workspace, ".osa-run", "session.json"), {
            server_url: this.runtime.serverUrl, session_id: this.sessionId, created_at: now(), pid: process.pid,
          });
          if (!this.options.headless) tui = attachTui(this.runtime, this.options.workspace, this.sessionId);
        }

        const work = this.runPhase(phase, abortController.signal);
        const race: Promise<unknown>[] = [work, this.interruption];
        if (tui) race.push(tui.exited);
        const outcome = await Promise.race(race);
        if (typeof outcome === "number") {
          this.interrupted = true;
          abortController.abort();
          throw new Error(`OpenCode TUI exited with code ${outcome}`);
        }
      }

      const state = await this.state();
      state.status = "completed";
      state.completed_at = now();
      state.report = join(this.options.workspace, ".assay", "report", "assay.md");
      await this.save(state);
      return "completed";
    } catch (error) {
      if (this.runtime && this.sessionId) await abortSession(this.runtime, this.options.workspace, this.sessionId);
      const state = await this.state().catch(() => null);
      if (state) {
        state.status = this.interrupted ? "interrupted" : "failed";
        state.provenance = { ...state.provenance, error: error instanceof Error ? error.message : String(error), finished_at: now() };
        await this.save(state);
      }
      throw error;
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (tui && tui.process.exitCode === null && tui.process.signalCode === null) {
        tui.process.kill("SIGTERM");
        await tui.exited;
      }
      this.runtime?.close();
    }
  }

  private async runPhase(phase: Phase, signal?: AbortSignal): Promise<void> {
    const state = await this.state();
    state.status = "running";
    state.current_phase = phase;
    state.phases[phase] = {
      ...state.phases[phase]!, status: "running",
      attempts: (state.phases[phase]?.attempts ?? 0) + 1, started_at: now(), error: null,
    };
    await this.save(state);

    const started = Date.now();
    report(`  → ${phase}${isDeterministic(phase) ? "" : " (model)"}`);
    try {
      if (isDeterministic(phase)) await this.runDeterministic(phase);
      else await this.runJudgment(phase, signal);

      const cap = (await this.state()).tier_cap;
      let checks = await validatePhase(this.options.workspace, phase, cap);
      let failed = checks.filter((check) => !check.passed);

      // One remediation round for judgment phases; a deterministic phase that
      // fails its own contract is a bug in this package, not a model error.
      if (failed.length > 0 && !isDeterministic(phase)) {
        report(`    ! ${failed.length} check(s) failed, remediating: ${failed.slice(0, 3).map((c) => c.name).join(", ")}`);
        await this.remediate(phase, failed, signal);
        checks = await validatePhase(this.options.workspace, phase, cap);
        failed = checks.filter((check) => !check.passed);
      }
      if (failed.length > 0) {
        throw new Error(`${phase} failed validation: ${failed.map((c) => `${c.name}: ${c.detail}`).join("; ")}`);
      }

      const current = await this.state();
      current.phases[phase] = {
        ...current.phases[phase]!, status: "completed", completed_at: now(),
        notes: `${checks.length} checks passed`, error: null,
      };
      current.status = "prepared";
      await this.save(current);
      report(`  ✓ ${phase} (${checks.length} checks, ${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      report(`  ✗ ${phase}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      const failedState = await this.state();
      failedState.phases[phase] = {
        ...failedState.phases[phase]!,
        status: this.interrupted ? "interrupted" : "failed",
        completed_at: now(),
        error: error instanceof Error ? error.message : String(error),
      };
      failedState.status = this.interrupted ? "interrupted" : "failed";
      await this.save(failedState);
      throw error;
    }
  }

  private async runDeterministic(phase: Phase): Promise<void> {
    const ws = this.options.workspace;
    const graphDir = join(ws, ".assay", "graph");
    const rawDir = join(ws, ".assay", "raw");

    if (phase === "intake") {
      const inventory = await buildInventory(this.source());
      await writeJsonAtomic(join(graphDir, "inventory.json"), inventory);
      const selfVerdicts = inventory.files.filter((f) => f.selfVerdict);
      await writeTextAtomic(join(rawDir, "00_intake.md"), [
        `# Intake`, ``,
        `Files: ${inventory.files.length}  Bytes: ${inventory.totalBytes}  Digest: \`${inventory.digest}\``,
        `Pruned: ${inventory.prunedPaths.length ? inventory.prunedPaths.join(", ") : "(none)"}`, ``,
        `## Quarantined self-verdicts`, ``,
        selfVerdicts.length
          ? selfVerdicts.map((f) => `- \`${f.path}\` (sha256 \`${f.sha256.slice(0, 16)}\`) — conclusion carries no evidential weight`).join("\n")
          : `(none found)`,
        ``, `## Third-party content`, ``,
        inventory.files.filter((f) => f.thirdParty).map((f) => `- \`${f.path}\``).join("\n") || "(none)",
        ``, `## Shadow copies`, ``,
        inventory.files.filter((f) => f.shadowCopy).map((f) => `- \`${f.path}\``).join("\n") || "(none)",
        ``,
      ].join("\n"));
      return;
    }

    if (phase === "problem") {
      const inventory = await readJson(join(graphDir, "inventory.json")) as Awaited<ReturnType<typeof buildInventory>>;
      const recovery = await recoverProblem(inventory, this.load, { network: this.options.network });
      await writeJsonAtomic(join(graphDir, "problem.json"), recovery);
      const state = await this.state();
      state.tier_cap = recovery.cap;
      await this.save(state);
      await writeTextAtomic(join(rawDir, "01_problem.md"), [
        `# Problem recovery`, ``,
        `Tier: **${recovery.cap.tier}** — ${recovery.cap.rationale}`,
        `Resolution ceiling: **${recovery.cap.resolution_ceiling}**   scope-coverage ceiling: **${recovery.cap.scope_coverage_ceiling}**`, ``,
        `First-party statement: ${recovery.statementPath ? `\`${recovery.statementPath}\`` : "none in the deliverable"}`,
        `Problem candidates: ${recovery.candidates.length ? recovery.candidates.map((c) => `\`${c.file}\` (${c.reason})`).join(", ") : "none detected"}`,
        `Pin: ${recovery.pin ? `project ${recovery.pin.project ?? "?"} @ ${recovery.pin.sha ?? "?"} (declared in \`${recovery.pin.declaredIn}\`)` : "none"}`,
        `Rubric: ${recovery.rubricPath ? `\`${recovery.rubricPath}\`` : "none — criteria must be derived from the problem statement"}`, ``,
        `## Empty declared sections`, ``,
        recovery.emptySections.map((s) => `- \`${s.file}\`: "${s.heading}"`).join("\n") || "(none)", ``,
        `## External references`, ``,
        recovery.references.map((r) => `- ${r}`).join("\n") || "(none)", ``,
      ].join("\n"));
      return;
    }

    if (phase === "graph") {
      const inventory = await readJson(join(graphDir, "inventory.json")) as Awaited<ReturnType<typeof buildInventory>>;
      const problem = await readJson(join(graphDir, "problem.json")) as Awaited<ReturnType<typeof recoverProblem>>;
      const manifest = await auditHashAssertions(inventory, this.load);
      const commands = await collectCommands(inventory, this.load);
      await writeJsonAtomic(join(graphDir, "manifest.json"), manifest);
      await writeJsonAtomic(join(graphDir, "commands.json"), commands);
      const graph = buildGraph({ inventory, manifest, problem, commands, execRecords: [], postExecution: false });
      await writeJsonAtomic(join(graphDir, "graph.json"), graph);
      await writeTextAtomic(join(rawDir, "03_graph.md"), [
        `# Evidence graph (pre-execution)`, ``,
        `Nodes ${graph.nodes.length}  Edges ${graph.edges.length}  Support edges ${graph.coverage.total}`, ``,
        `## Hash assertions`, ``,
        `match ${manifest.matches.length} · relocated ${manifest.relocated.length} · mismatch ${manifest.mismatches.length} · absent ${manifest.absent.length}`, ``,
        `## Mechanically decided findings`, ``,
        graph.findings.map((f) => `- **${f.severity}** [${f.code} → ${f.dimension}] ${f.summary}\n${f.evidence.map((e) => `  - ${e}`).join("\n")}`).join("\n") || "(none)",
        ``,
      ].join("\n"));
      return;
    }

    if (phase === "execute") {
      const commands = await readJson(join(graphDir, "commands.json")) as Awaited<ReturnType<typeof collectCommands>>;
      const records = await runAll(commands, {
        cwd: this.source(),
        logDir: join(ws, ".assay", "exec"),
        timeoutMs: this.options.execTimeoutMs,
        policy: this.options.execPolicy,
        maxCommands: this.options.maxCommands,
      });
      await writeJsonAtomic(join(graphDir, "exec.json"), records);
      await writeTextAtomic(join(rawDir, "04_execute.md"), [
        `# Execution`, ``,
        `Policy: \`${this.options.execPolicy}\`  timeout ${this.options.execTimeoutMs}ms  cap ${this.options.maxCommands}`, ``,
        `| # | exit | origin | argv | note |`, `|---|---|---|---|---|`,
        ...records.map((r, i) => `| ${i + 1} | ${r.ran ? r.exitCode : "skipped"} | ${r.origin} | \`${r.argv.replace(/\|/g, "\\|").slice(0, 100)}\` | ${r.skipReason ?? (r.timedOut ? "timed out" : "")} |`),
        ``, `Per-command logs: \`.assay/exec/<id>.log\``, ``,
      ].join("\n"));
      return;
    }

    if (phase === "shortfall") {
      const inventory = await readJson(join(graphDir, "inventory.json")) as Awaited<ReturnType<typeof buildInventory>>;
      const problem = await readJson(join(graphDir, "problem.json")) as Awaited<ReturnType<typeof recoverProblem>>;
      const manifest = await readJson(join(graphDir, "manifest.json")) as Awaited<ReturnType<typeof auditHashAssertions>>;
      const commands = await readJson(join(graphDir, "commands.json")) as Awaited<ReturnType<typeof collectCommands>>;
      const execRecords = await readJson(join(graphDir, "exec.json")) as Awaited<ReturnType<typeof runAll>>;
      const graph = buildGraph({ inventory, manifest, problem, commands, execRecords, postExecution: true });
      await writeJsonAtomic(join(graphDir, "graph.json"), graph);
      await writeJsonAtomic(join(graphDir, "shortfall.json"), {
        coverage: graph.coverage,
        open_edges: graph.edges.filter((e) => !e.closed && (e.kind === "supports" || e.kind === "hashes"))
          .map((e) => ({ from: e.from, to: e.to, kind: e.kind, detail: e.detail })),
        tier_cap: problem.cap,
        findings: graph.findings,
      });
      const state = await this.state();
      state.coverage = graph.coverage;
      await this.save(state);
      await writeTextAtomic(join(rawDir, "06_shortfall.md"), [
        `# Shortfall`, ``,
        `**Decidable coverage: ${graph.coverage.closed}/${graph.coverage.total} support edges closed.**`,
        `This number is counted from \`.assay/graph/graph.json\`; it is not an estimate.`, ``,
        `Tier cap: **${problem.cap.tier}** → resolution ceiling **${problem.cap.resolution_ceiling}**`, ``,
        `## Open support edges`, ``,
        graph.edges.filter((e) => !e.closed && (e.kind === "supports" || e.kind === "hashes"))
          .map((e) => `- \`${e.from}\` →(${e.kind})→ \`${e.to}\` — ${e.detail}`).join("\n") || "(none)",
        ``,
      ].join("\n"));
      return;
    }

    throw new Error(`phase ${phase} is not a deterministic phase`);
  }

  private async runJudgment(phase: Phase, signal?: AbortSignal): Promise<void> {
    if (!this.runtime || !this.sessionId) throw new Error("OpenCode runtime is not started");
    const state = await this.state();
    const cap = state.tier_cap;
    const coverage = state.coverage;

    const shared = [
      `You are running OSA phase \`${phase}\` in a controller-managed, report-only workspace.`,
      `The deliverable is at \`./source\` and is read-only. Write only under \`./.assay/\`.`,
      ``,
      `The controller has already produced deterministic facts. Read them before anything else:`,
      `- \`.assay/raw/00_intake.md\` — inventory, quarantined self-verdicts, third-party content`,
      `- \`.assay/raw/01_problem.md\` — recovery tier and the ceiling it imposes`,
      `- \`.assay/raw/03_graph.md\` — hash-assertion audit and mechanically decided findings`,
      `- \`.assay/raw/04_execute.md\` — what actually ran, with exit codes`,
      `- \`.assay/raw/06_shortfall.md\` — the counted decidable coverage and every open support edge`,
      ``,
      `These are counted facts. Do not recompute them, do not contradict them, and do not soften them.`,
      cap ? `Recovery tier is **${cap.tier}**: the Resolution may not be stronger than **${cap.resolution_ceiling}**, and scope-coverage may not exceed **${cap.scope_coverage_ceiling}**. ${cap.rationale}` : ``,
      coverage ? `Decidable coverage is **${coverage.closed}/${coverage.total}** and must be reported verbatim.` : ``,
      ``,
      `The controller does not trust a textual completion claim: this phase is complete only when its contracted artifact exists with non-empty \`## Method\`, \`## Output\` and \`## Provenance\` sections.`,
      `Do not ask the user questions; proceed autonomously.`,
      ``,
    ].filter(Boolean).join("\n");

    const perPhase: Record<string, string> = {
      claims: [
        `Extract every claim the deliverable makes and type each one (universal / existential witness / negative / conditional / algorithmic).`,
        `Record where the proof of record actually lives — it is often not the obvious file.`,
        `Write \`.assay/raw/02_claims.md\`.`,
      ].join("\n"),
      crosscheck: [
        `Independently cross-check the evidence. Do not stop at "the author's checker accepted the author's certificate".`,
        `Where feasible: re-derive with your own implementation, generate your own inputs, and probe boundary, degenerate and minimal-counterexample cases plus any finite→universal transition.`,
        `You have bash. Report both directions honestly, and never assert that an inferential step is valid.`,
        `Write \`.assay/raw/05_crosscheck.md\`.`,
      ].join("\n"),
      report: [
        `Synthesise the final report to \`.assay/report/assay.md\`, following your agent instructions exactly.`,
        `Section names and order are fixed and the export gate is enforced by the controller, not by you.`,
        `Every mechanically decided finding in \`.assay/raw/03_graph.md\` must appear with its stated dimension consequence.`,
      ].join("\n"),
    };

    await prompt(this.runtime, this.options.workspace, this.sessionId, `${shared}${perPhase[phase] ?? ""}`, this.options.model);
    await waitForIdle(this.runtime, this.options.workspace, this.sessionId, this.options.timeoutMs, signal);
  }

  private async remediate(phase: Phase, failed: Check[], signal?: AbortSignal): Promise<void> {
    if (!this.runtime || !this.sessionId) return;
    const details = failed.map((check) => `${check.name}: ${check.detail}`).join("; ");
    await prompt(this.runtime, this.options.workspace, this.sessionId,
      `Phase \`${phase}\` failed controller validation: ${details}. Fix exactly these and nothing else. Do not advance to another phase.`,
      this.options.model);
    await waitForIdle(this.runtime, this.options.workspace, this.sessionId, this.options.timeoutMs, signal);
  }
}
