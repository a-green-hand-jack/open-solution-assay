import type { Inventory } from "./inventory.js";
import type { TierCap } from "./state.js";

export type ProblemRecovery = {
  cap: TierCap;
  /** First-party problem statement inside the deliverable, if any. */
  statementPath: string | null;
  /** Machine-readable pin to an upstream problem, if any. */
  pin: { project: string | null; sha: string | null; declaredIn: string } | null;
  /** External problem links found in prose. */
  references: string[];
  /** Shipped acceptance criteria, which are this problem's own bar. */
  rubricPath: string | null;
  rubricHeadings: string[];
  /** Level-two/three sections present but empty — an empty "Open Questions" is a finding. */
  emptySections: { file: string; heading: string }[];
};

const STATEMENT_PATTERNS: readonly RegExp[] = [
  /^problem\/PROBLEM\.md$/i,
  /^problem\/contract\.md$/i,
  /^problem\/.*\.md$/i,
  /^PROBLEM\.md$/i,
];

const CEILINGS: Record<TierCap["tier"], Pick<TierCap, "resolution_ceiling" | "scope_coverage_ceiling">> = {
  T0: { resolution_ceiling: "closed", scope_coverage_ceiling: 5 },
  T1: { resolution_ceiling: "closed", scope_coverage_ceiling: 5 },
  // T2 and T3 forbid only `closed`; they differ in how far scope-coverage may
  // reach, not in which verdicts are sayable.
  T2: { resolution_ceiling: "declared-partial", scope_coverage_ceiling: 3 },
  T3: { resolution_ceiling: "declared-partial", scope_coverage_ceiling: 2 },
  T4: { resolution_ceiling: "unauditable", scope_coverage_ceiling: 0 },
};

/** Headings whose emptiness is itself reportable. */
const MEANINGFUL_HEADINGS = /open questions|limitations|remaining uncertainty|known issues|future work/i;

export function findEmptySections(file: string, content: string): { file: string; heading: string }[] {
  const lines = content.split("\n");
  const out: { file: string; heading: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(lines[i] ?? "");
    if (!match) continue;
    const heading = match[2]!;
    let body = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^#{1,6}\s+/.test(lines[j] ?? "")) break;
      body += (lines[j] ?? "").trim();
    }
    if (body.length === 0 && MEANINGFUL_HEADINGS.test(heading)) out.push({ file, heading });
  }
  return out;
}

function parsePin(content: string, declaredIn: string): ProblemRecovery["pin"] {
  const project = /problem_project_id\s*:\s*([^\s#]+)/i.exec(content)?.[1] ?? null;
  const sha = /problem_sha\s*:\s*([0-9a-f]{7,40})/i.exec(content)?.[1] ?? null;
  return project || sha ? { project, sha, declaredIn } : null;
}

/**
 * Assign the recovery tier and its caps. Without network access an upstream pin
 * can never be verified, so a pinned-but-unreachable problem is T2 — the run may
 * not claim `closed`, and saying so is mandatory rather than advisory.
 */
export async function recoverProblem(
  inventory: Inventory,
  load: (relativePath: string) => Promise<string>,
  options: { network: boolean },
): Promise<ProblemRecovery> {
  let statementPath: string | null = null;
  for (const pattern of STATEMENT_PATTERNS) {
    const hit = inventory.files.find((file) => pattern.test(file.path) && !file.selfVerdict);
    if (hit) { statementPath = hit.path; break; }
  }

  let pin: ProblemRecovery["pin"] = null;
  for (const file of inventory.files.filter((f) => /\.(ya?ml)$/i.test(f.path))) {
    const parsed = parsePin(await load(file.path).catch(() => ""), file.path);
    if (parsed) { pin = parsed; break; }
  }

  const references: string[] = [];
  const emptySections: ProblemRecovery["emptySections"] = [];
  let rubricPath: string | null = null;
  let rubricHeadings: string[] = [];

  for (const file of inventory.files.filter((f) => /\.md$/i.test(f.path) && f.bytes < 1_000_000)) {
    const content = await load(file.path).catch(() => "");
    if (!content) continue;
    if (!file.selfVerdict) emptySections.push(...findEmptySections(file.path, content));
    for (const match of content.matchAll(/https?:\/\/[^\s)<>\]]+/g)) {
      const url = match[0];
      if (/problem|journal|issues?\//i.test(url) && !references.includes(url)) references.push(url);
    }
    if (!rubricPath && (/evaluation-rubric\.md$/i.test(file.path) || /^##\s+Acceptance criteria\s*$/im.test(content))) {
      rubricPath = file.path;
      rubricHeadings = [...content.matchAll(/^(#{1,3})\s+(.+?)\s*$/gm)].map((m) => `${m[1]} ${m[2]}`);
    }
  }

  const tier: TierCap["tier"] = statementPath
    ? "T0"
    : pin
      ? (options.network ? "T1" : "T2")
      : references.length > 0 || inventory.files.some((f) => /readme\.md$/i.test(f.path))
        ? "T3"
        : "T4";

  const rationale = statementPath
    ? `first-party problem statement present at ${statementPath}`
    : pin
      ? options.network
        ? `pin ${pin.project ?? "?"}@${pin.sha ?? "?"} declared in ${pin.declaredIn} and fetchable`
        : `pin ${pin.project ?? "?"}@${pin.sha ?? "?"} declared in ${pin.declaredIn} but unreachable in this run; the problem is known only through the author's retelling`
      : references.length > 0
        ? "no machine-readable pin; only prose references to an external problem"
        : "no recoverable problem statement";

  return {
    cap: { tier, ...CEILINGS[tier], rationale },
    statementPath, pin, references, rubricPath, rubricHeadings, emptySections,
  };
}
