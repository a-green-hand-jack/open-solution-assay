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

    console.log(`run       ${imported.runId}`);
    console.log(`workspace ${imported.workspace}`);
    console.log(`files     ${imported.inventory.files.length}  digest ${imported.inventory.digest.slice(0, 16)}`);

    if (options.prepareOnly) {
      // Deterministic phases only: no OpenCode server, no model spend.
      const controller = new AssayController({
        workspace: imported.workspace, headless: true, model: options.model,
        timeoutMs: options.timeout, execPolicy: options.execute,
        execTimeoutMs: options.execTimeout, maxCommands: options.maxCommands, network: options.network,
      });
      await (controller as unknown as { runDeterministicOnly?: () => Promise<void> }).runDeterministicOnly?.();
      for (const phase of ["intake", "problem", "graph", "execute", "shortfall"] as const) {
        await (controller as never as { runPhase: (p: string) => Promise<void> }).runPhase(phase);
        console.log(`  ✓ ${phase}`);
      }
      const summary = await readJson(join(imported.workspace, ".assay", "graph", "shortfall.json")) as { coverage: { closed: number; total: number }; tier_cap: { tier: string; resolution_ceiling: string }; findings: unknown[] };
      console.log(`\ntier      ${summary.tier_cap.tier} → ceiling ${summary.tier_cap.resolution_ceiling}`);
      console.log(`coverage  ${summary.coverage.closed}/${summary.coverage.total} support edges closed`);
      console.log(`findings  ${summary.findings.length} mechanically decided`);
      return;
    }

    const controller = new AssayController({
      workspace: imported.workspace, headless: Boolean(options.headless), model: options.model,
      timeoutMs: options.timeout, execPolicy: options.execute,
      execTimeoutMs: options.execTimeout, maxCommands: options.maxCommands, network: options.network,
    });
    await controller.run();
    console.log(`\nreport    ${join(imported.workspace, ".assay", "report", "assay.md")}`);
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
  .option("--prepare-only", "deterministic phases only", false)
  .action(async (dir: string, options) => {
    const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`${entries.length} task(s)`);
    for (const entry of entries) {
      console.log(`\n──── ${entry.name} ────`);
      try {
        await program.parseAsync(["audit", join(dir, entry.name), "--output", options.output, ...(options.prepareOnly ? ["--prepare-only"] : [])], { from: "user" });
      } catch (error) {
        console.log(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
      ["osp", await which("osp")],
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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`osa: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
