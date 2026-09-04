import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Inventory } from "./inventory.js";
import { sha256, writeTextAtomic } from "./fs.js";

export type CommandCandidate = {
  argv: string;
  /** Where the command was found. */
  declaredIn: string;
  origin: "validation-table" | "fenced-block" | "ci" | "entry-point";
  /** The repo's stated expectation, when it states one separately from the observation. */
  expected: string | null;
};

export type ExecRecord = CommandCandidate & {
  id: string;
  ran: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipReason: string | null;
};

/** Existence assertions masquerading as verification. */
const PRESENCE_ONLY = /^\s*(test|\[)\s+-[sdfe]\s/;
const SHELL_HINT = /^(python3?|pytest|node|bash|sh|make|npm|cargo|go|java|Rscript|julia|latexmk|find|sha256sum|cd)\b/;

function looksRunnable(argv: string): boolean {
  return SHELL_HINT.test(argv.trim()) && argv.length < 600;
}

/**
 * Extract commands from markdown. Reproduction instructions are frequently
 * backticked shell inside table cells rather than fenced blocks, so cells are
 * parsed too; a table that fuses "expected and observed" into one column gives
 * no independent expectation, which is recorded as `expected: null`.
 */
export function extractFromMarkdown(declaredIn: string, content: string): CommandCandidate[] {
  const out: CommandCandidate[] = [];
  const lines = content.split("\n");
  let header: string[] | null = null;
  let inFence = false;
  let fence: string[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        for (const candidate of fence) {
          const trimmed = candidate.trim();
          if (trimmed && !trimmed.startsWith("#") && looksRunnable(trimmed)) {
            out.push({ argv: trimmed, declaredIn, origin: "fenced-block", expected: null });
          }
        }
        fence = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) { fence.push(line); continue; }

    if (/^\s*\|/.test(line)) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^[-: ]*$/.test(cell))) continue;
      if (!header) { header = cells.map((cell) => cell.toLowerCase()); continue; }
      const expectedIndex = header.findIndex((cell) => /^expected(?!.*observed)/.test(cell));
      const expected = expectedIndex >= 0 ? cells[expectedIndex] ?? null : null;
      for (const cell of cells) {
        for (const match of cell.matchAll(/`([^`]{4,400})`/g)) {
          const argv = match[1]!.trim();
          if (looksRunnable(argv)) out.push({ argv, declaredIn, origin: "validation-table", expected });
        }
      }
      continue;
    }
    header = null;
  }
  return out;
}

/** Pull `script:` entries out of CI and flag presence-only checks. */
export function extractFromCi(declaredIn: string, content: string): CommandCandidate[] {
  const out: CommandCandidate[] = [];
  for (const line of content.split("\n")) {
    const match = /^\s*-\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const argv = match[1]!.replace(/^["']|["']$/g, "");
    if (PRESENCE_ONLY.test(argv) || looksRunnable(argv)) {
      out.push({ argv, declaredIn, origin: "ci", expected: null });
    }
  }
  return out;
}

export function isPresenceOnly(argv: string): boolean {
  return PRESENCE_ONLY.test(argv);
}

/**
 * True when every command a CI file runs only asserts that files exist.
 * "Has CI" is then not evidence of verification.
 */
export function ciIsTheater(commands: CommandCandidate[]): boolean {
  const ci = commands.filter((command) => command.origin === "ci");
  return ci.length > 0 && ci.every((command) => isPresenceOnly(command.argv));
}

export async function collectCommands(
  inventory: Inventory,
  load: (relativePath: string) => Promise<string>,
): Promise<CommandCandidate[]> {
  const out: CommandCandidate[] = [];
  for (const file of inventory.files) {
    if (file.selfVerdict || file.thirdParty || file.bytes > 1_000_000) continue;
    if (/\.md$/i.test(file.path)) {
      out.push(...extractFromMarkdown(file.path, await load(file.path).catch(() => "")));
    } else if (/(^|\/)\.gitlab-ci\.yml$|(^|\/)\.github\/workflows\/.*\.ya?ml$/i.test(file.path)) {
      out.push(...extractFromCi(file.path, await load(file.path).catch(() => "")));
    } else if (/\.py$/i.test(file.path)) {
      const content = await load(file.path).catch(() => "");
      if (/if\s+__name__\s*==\s*["']__main__["']/.test(content)) {
        out.push({ argv: `python3 ${file.path}`, declaredIn: file.path, origin: "entry-point", expected: null });
      }
    }
  }
  // De-duplicate identical argv from the same file.
  const seen = new Set<string>();
  const deduped = out.filter((command) => {
    const key = `${command.declaredIn}|${command.argv}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A bare `python3 script.py` invented from a __main__ guard is a false
  // failure when the repo documents the same script with its required
  // arguments. Prefer the documented invocation and drop the bare one.
  const documented = deduped.filter((command) => command.origin !== "entry-point");
  return deduped.filter((command) => {
    if (command.origin !== "entry-point") return true;
    const script = command.argv.replace(/^python3?\s+/, "").trim();
    return !documented.some((other) => other.argv.includes(script) && other.argv.trim() !== command.argv.trim());
  });
}

export type ExecOptions = {
  cwd: string;
  logDir: string;
  timeoutMs: number;
  policy: "full" | "python-only" | "static";
  maxCommands: number;
};

function allowed(argv: string, policy: ExecOptions["policy"]): string | null {
  if (policy === "static") return "execute policy is static";
  if (isPresenceOnly(argv)) return "presence-only assertion, not verification";
  if (policy === "python-only" && !/^(python3?|pytest)\b/.test(argv.trim())) return "execute policy is python-only";
  return null;
}

/** Run one command with a hard timeout, capturing everything. */
export async function runOne(command: CommandCandidate, options: ExecOptions): Promise<ExecRecord> {
  const id = sha256(`${command.declaredIn}|${command.argv}`).slice(0, 16);
  const base: ExecRecord = {
    ...command, id, ran: false, exitCode: null, timedOut: false,
    stdout: "", stderr: "", durationMs: 0, skipReason: null,
  };
  const skip = allowed(command.argv, options.policy);
  if (skip) return { ...base, skipReason: skip };

  const started = Date.now();
  return await new Promise<ExecRecord>((resolve) => {
    const child = spawn("bash", ["-lc", command.argv], {
      cwd: options.cwd,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);
    child.stdout?.on("data", (chunk) => { if (stdout.length < 200_000) stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { if (stderr.length < 200_000) stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ...base, ran: false, skipReason: `spawn failed: ${error.message}`, durationMs: Date.now() - started });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ ...base, ran: true, exitCode: code, timedOut, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

/** Run the collected commands and write a log per command. */
export async function runAll(commands: CommandCandidate[], options: ExecOptions): Promise<ExecRecord[]> {
  const records: ExecRecord[] = [];
  for (const command of commands.slice(0, options.maxCommands)) {
    const record = await runOne(command, options);
    records.push(record);
    await writeTextAtomic(
      join(options.logDir, `${record.id}.log`),
      [
        `# argv`, record.argv,
        `# declared-in`, record.declaredIn,
        `# origin`, record.origin,
        `# expected`, record.expected ?? "(none stated separately)",
        `# ran`, String(record.ran),
        `# exit`, String(record.exitCode),
        `# timed-out`, String(record.timedOut),
        `# skip-reason`, record.skipReason ?? "(none)",
        `# duration-ms`, String(record.durationMs),
        ``, `## stdout`, record.stdout, ``, `## stderr`, record.stderr, ``,
      ].join("\n"),
    );
  }
  return records;
}
