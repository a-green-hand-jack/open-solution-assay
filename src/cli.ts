#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { AssayController } from "./controller.js";
import { exists, now, readJson, writeJsonAtomic } from "./fs.js";
import { importTask, thaw } from "./input.js";
import { installAssets } from "./assets.js";
import { PHASES } from "./phases.js";
import { RunStateSchema, initialPhases } from "./state.js";
import { exportGate, validatePhase } from "./validation.js";

const run = promisify(execFile);
const VERSION = "0.1.0";

async function which(binary: string, args: string[] = ["--version"]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(binary, args);
    // Some tools (pdftotext) print their version banner to stderr.
    const line = (stdout.trim() || stderr.trim()).split("\n")[0]?.trim();
    return line && line.length > 0 ? line : "present";
  } catch { return null; }
}

type AuditOptions = {
  output: string; headless?: boolean; model?: string; timeout: number;
  execute: "full" | "python-only" | "static"; execTimeout: number;
  maxCommands: number; network?: boolean; prepareOnly?: boolean; quiet?: boolean;
};

type AuditSummary = {
  runId: string; workspace: string; files: number;
  tier: string; ceiling: string; closed: number; total: number; findings: number;
};

/** Shared by `audit` and `batch` so the two cannot drift. */
async function runAudit(task: string, options: AuditOptions): Promise<AuditSummary> {
  const imported = await importTask(task, options.output);
  await installAssets(imported.workspace);
  const state = RunStateSchema.parse({
    schema_version: "osa-run-v1",
    run_id: imported.runId,
    status: "preparing",
    task: resolve(task),
    source_digest: imported.inventory.digest,
    phases: initialPhases(),
    current_phase: null,
    tier_cap: null,
    paper: { located: null, candidates: [], osp_status: "off", osp_output: null },
    coverage: null,
    provenance: { osa_version: VERSION, started_at: now(), execute_policy: options.execute, prepare_only: Boolean(options.prepareOnly) },
    created_at: now(),
    updated_at: now(),
    completed_at: null,
    report: null,
  });
  await writeJsonAtomic(join(imported.workspace, ".osa-run", "run.json"), state);

  if (!options.quiet) {
    console.log(`run       ${imported.runId}`);
    console.log(`workspace ${imported.workspace}`);
    console.log(`files     ${imported.inventory.files.length}  digest ${imported.inventory.digest.slice(0, 16)}`);
  }

  const controller = new AssayController({
    workspace: imported.workspace,
    headless: options.prepareOnly ? true : Boolean(options.headless),
    model: options.model,
    timeoutMs: options.timeout,
    execPolicy: options.execute,
    execTimeoutMs: options.execTimeout,
    maxCommands: options.maxCommands,
    network: Boolean(options.network),
  });

  if (options.prepareOnly) await controller.runPrepareOnly();
  else await controller.run();

  const shortfall = await readJson(join(imported.workspace, ".assay", "graph", "shortfall.json")) as {
    coverage: { closed: number; total: number };
    tier_cap: { tier: string; resolution_ceiling: string };
    findings: unknown[];
  };
  return {
    runId: imported.runId, workspace: imported.workspace, files: imported.inventory.files.length,
    tier: shortfall.tier_cap.tier, ceiling: shortfall.tier_cap.resolution_ceiling,
    closed: shortfall.coverage.closed, total: shortfall.coverage.total, findings: shortfall.findings.length,
  };
}

const program = new Command();
program.name("osa").description("Open SolutionAssay — audit how far a solution repository actually got").version(VERSION);

program
  .command("audit")
  .argument("<task>", "solution repository directory")
  .option("-o, --output <dir>", "parent directory for timestamped runs", "./osa-runs")
  .option("--headless", "run without attaching the OpenCode TUI", false)
  .option("-m, --model <model>", "provider/model reference")
  .option("--timeout <ms>", "per-phase model timeout", (v) => Number(v), 1_800_000)
  .option("--execute <policy>", "full | python-only | static", "python-only")
  .option("--exec-timeout <ms>", "per-command execution timeout", (v) => Number(v), 120_000)
  .option("--max-commands <n>", "cap on executed commands", (v) => Number(v), 40)
  .option("--network", "treat the upstream problem pin as fetchable", false)
  .option("--prepare-only", "run the deterministic phases and stop before any model call", false)
  .action(async (task: string, options) => {
    const summary = await runAudit(task, options as AuditOptions);
    console.log(`\ntier      ${summary.tier} → ceiling ${summary.ceiling}`);
    console.log(`coverage  ${summary.closed}/${summary.total} support edges closed`);
    console.log(`findings  ${summary.findings} mechanically decided`);
    if (!options.prepareOnly) console.log(`report    ${join(summary.workspace, ".assay", "report", "assay.md")}`);
  });

program
  .command("status")
  .argument("<run>", "run workspace")
  .action(async (workspace: string) => {
    const state = RunStateSchema.parse(await readJson(join(workspace, ".osa-run", "run.json")));
    console.log(`${state.run_id}  ${state.status}`);
    console.log(`tier      ${state.tier_cap ? `${state.tier_cap.tier} → ${state.tier_cap.resolution_ceiling}` : "not yet assigned"}`);
    console.log(`coverage  ${state.coverage ? `${state.coverage.closed}/${state.coverage.total}` : "not yet counted"}`);
    for (const phase of PHASES) {
      const info = state.phases[phase];
      console.log(`  ${info?.status === "completed" ? "✓" : info?.status === "failed" ? "✗" : "·"} ${phase.padEnd(11)} ${info?.status ?? "unknown"} (${info?.kind})`);
    }
  });

program
  .command("validate")
  .argument("<run>", "run workspace")
  .action(async (workspace: string) => {
    const state = RunStateSchema.parse(await readJson(join(workspace, ".osa-run", "run.json")));
    let failures = 0;
    for (const phase of PHASES) {
      for (const check of await validatePhase(workspace, phase, state.tier_cap)) {
        if (!check.passed) { failures += 1; console.log(`FAIL ${phase}/${check.name}: ${check.detail}`); }
      }
    }
    console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
    process.exitCode = failures === 0 ? 0 : 1;
  });

program
  .command("gate")
  .description("run only the export gate against a finished report")
  .argument("<run>", "run workspace")
  .action(async (workspace: string) => {
    const state = await readJson(join(workspace, ".osa-run", "run.json")).catch(() => null) as { tier_cap?: never } | null;
    const checks = await exportGate(workspace, (state?.tier_cap ?? null) as never);
    for (const check of checks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
  });

program
  .command("batch")
  .argument("<dir>", "directory of solution repositories")
  .option("-o, --output <dir>", "parent directory for runs", "./osa-runs")
  .option("--prepare-only", "deterministic phases only — offline, no model spend", false)
  .option("--execute <policy>", "full | python-only | static", "python-only")
  .option("--exec-timeout <ms>", "per-command execution timeout", (v) => Number(v), 60_000)
  .option("--max-commands <n>", "cap on executed commands per task", (v) => Number(v), 25)
  .option("--timeout <ms>", "per-phase model timeout", (v) => Number(v), 1_800_000)
  .option("-m, --model <model>", "provider/model reference")
  .option("--summary <path>", "write a corpus summary table here")
  .action(async (dir: string, options) => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    console.log(`${entries.length} task(s) from ${dir}\n`);

    const rows: (AuditSummary & { task: string })[] = [];
    const failures: { task: string; error: string }[] = [];
    for (const [index, entry] of entries.entries()) {
      const label = `[${String(index + 1).padStart(2)}/${entries.length}] ${entry.name}`;
      try {
        const summary = await runAudit(join(dir, entry.name), { ...(options as AuditOptions), quiet: true });
        rows.push({ ...summary, task: entry.name });
        console.log(`${label}\n    ${summary.tier} → ${summary.ceiling}  ·  ${summary.closed}/${summary.total} closed  ·  ${summary.findings} findings  ·  ${summary.files} files`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ task: entry.name, error: message });
        console.log(`${label}\n    FAILED: ${message.slice(0, 160)}`);
      }
    }

    const table = [
      `| Task | Files | Tier | Ceiling | Coverage | Findings |`,
      `|---|---:|---|---|---:|---:|`,
      ...rows.map((row) => `| \`${row.task}\` | ${row.files} | ${row.tier} | ${row.ceiling} | ${row.closed}/${row.total} | ${row.findings} |`),
    ].join("\n");
    console.log(`\n${table}`);
    console.log(`\n${rows.length} succeeded, ${failures.length} failed`);
    for (const failure of failures) console.log(`  ✗ ${failure.task}: ${failure.error.slice(0, 200)}`);
    if (options.summary) {
      const { writeTextAtomic } = await import("./fs.js");
      await writeTextAtomic(options.summary, `${table}\n\n${failures.map((f) => `- FAILED \`${f.task}\`: ${f.error}`).join("\n")}\n`);
      console.log(`\nsummary   ${options.summary}`);
    }
    process.exitCode = failures.length === 0 ? 0 : 1;
  });

program
  .command("clean")
  .description("restore write permission on a run's frozen source so it can be deleted")
  .argument("<run>", "run workspace")
  .action(async (workspace: string) => { await thaw(join(workspace, "source")); console.log("thawed"); });

program
  .command("doctor")
  .action(async () => {
    const rows: [string, string | null][] = [
      ["node", process.version],
      ["osa", VERSION],
      ["opencode", await which("opencode")],
      ["git", await which("git")],
      ["python3", await which("python3", ["-V"])],
      ["pdftotext", await which("pdftotext", ["-v"])],
    ];
    let ok = true;
    for (const [name, value] of rows) {
      if (!value) ok = false;
      console.log(`${value ? "PASS" : "FAIL"} ${name.padEnd(11)} ${value ?? "not found"}`);
    }
    const { promptsDir } = await import("./assets.js");
    const havePrompt = await exists(join(promptsDir(), "osa-audit.md"));
    if (!havePrompt) ok = false;
    console.log(`${havePrompt ? "PASS" : "FAIL"} ${"prompts".padEnd(11)} ${promptsDir()}`);
    process.exitCode = ok ? 0 : 1;
  });

// The user-facing form is `osa <solution-repo>`. Keep `audit` as an explicit
// form for scripts and make the two forms share exactly the same controller.
const userArgs = process.argv.slice(2);
const commands = new Set(["audit", "status", "validate", "gate", "batch", "clean", "doctor", "help"]);
if (userArgs[0] && !userArgs[0].startsWith("-") && !commands.has(userArgs[0])) {
  process.argv.splice(2, userArgs.length, "audit", ...userArgs);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`osa: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
