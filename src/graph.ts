import type { Inventory } from "./inventory.js";
import type { ManifestAudit } from "./manifest.js";
import type { ProblemRecovery } from "./problem.js";
import type { CommandCandidate, ExecRecord } from "./exec.js";
import { ciIsTheater, isPresenceOnly } from "./exec.js";

export type NodeKind = "artifact" | "command" | "assertion" | "derivation" | "external" | "problem";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  attrs: Record<string, unknown>;
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: "supports" | "hashes" | "produced-by" | "cites" | "contradicts" | "duplicates";
  /** True when this edge was mechanically closed by OSA rather than asserted. */
  closed: boolean;
  detail: string;
};

export type Finding = {
  code:
    | "hash-mismatch"
    | "hash-target-absent"
    | "hash-target-relocated"
    | "self-verdict-present"
    | "verification-theater"
    | "duplicate-primary"
    | "vendored-third-party"
    | "empty-declared-section"
    | "unreachable-problem-pin"
    | "no-executable-evidence"
    | "command-failed";
  severity: "explicit flaw" | "strong concern" | "concern" | "minor concern";
  /** The dimension this finding must move, so a finding always has a consequence. */
  dimension: string;
  summary: string;
  evidence: string[];
};

export type EvidenceGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: Finding[];
  coverage: { closed: number; total: number };
  quarantined: string[];
};

function node(id: string, kind: NodeKind, label: string, attrs: Record<string, unknown> = {}): GraphNode {
  return { id, kind, label, attrs };
}

/**
 * Assemble the graph and derive every mechanically decidable finding. Nothing
 * here depends on a model: the same bytes always produce the same graph, so
 * `coverage` is a counted quantity rather than an asserted one.
 */
export function buildGraph(input: {
  inventory: Inventory;
  manifest: ManifestAudit;
  problem: ProblemRecovery;
  commands: CommandCandidate[];
  execRecords: ExecRecord[];
}): EvidenceGraph {
  const { inventory, manifest, problem, commands, execRecords } = input;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const findings: Finding[] = [];

  nodes.push(node("problem", "problem", problem.statementPath ?? problem.pin?.declaredIn ?? "unrecovered", {
    tier: problem.cap.tier,
    ceiling: problem.cap.resolution_ceiling,
    rubric: problem.rubricPath,
  }));

  for (const file of inventory.files) {
    nodes.push(node(`file:${file.path}`, file.selfVerdict ? "assertion" : "artifact", file.path, {
      sha256: file.sha256, bytes: file.bytes,
      selfVerdict: file.selfVerdict, thirdParty: file.thirdParty, shadowCopy: file.shadowCopy,
    }));
  }

  // Hash assertions become `hashes` edges. A verified one is a closed edge; a
  // mismatch or an absent target is an open edge plus a finding.
  for (const assertion of manifest.assertions) {
    const to = assertion.resolved ? `file:${assertion.resolved}` : `missing:${assertion.target}`;
    if (!assertion.resolved) nodes.push(node(to, "external", assertion.target, { resolvable: false }));
    edges.push({
      from: `file:${assertion.declaredIn}`, to, kind: "hashes",
      closed: assertion.verdict === "match" || assertion.verdict === "relocated",
      detail: `${assertion.verdict}: claimed ${assertion.claimed.slice(0, 12)}`,
    });
  }

  if (manifest.mismatches.length > 0) {
    findings.push({
      code: "hash-mismatch",
      severity: "explicit flaw",
      dimension: "deliverable-integrity",
      summary: `${manifest.mismatches.length} shipped hash assertion(s) do not match the shipped file`,
      evidence: manifest.mismatches.map((m) => `${m.declaredIn} → ${m.target}: claimed ${m.claimed.slice(0, 12)}, actual ${m.actual?.slice(0, 12) ?? "n/a"}`),
    });
  }
  if (manifest.absent.length > 0) {
    const byFile = new Map<string, string[]>();
    for (const a of manifest.absent) byFile.set(a.declaredIn, [...(byFile.get(a.declaredIn) ?? []), a.target]);
    findings.push({
      code: "hash-target-absent",
      severity: "concern",
      dimension: "replayability",
      summary: `${manifest.absent.length} hash-referenced artifact(s) are absent from the deliverable — partially unverifiable, not fabricated`,
      evidence: [...byFile].map(([file, targets]) => `${file} references ${targets.length} absent: ${targets.slice(0, 6).join(", ")}${targets.length > 6 ? " …" : ""}`),
    });
  }
  if (manifest.relocated.length > 0) {
    findings.push({
      code: "hash-target-relocated",
      severity: "minor concern",
      dimension: "deliverable-integrity",
      summary: `${manifest.relocated.length} hash assertion(s) name a path that does not exist, though matching bytes are shipped elsewhere`,
      evidence: manifest.relocated.map((r) => `${r.declaredIn}: declared ${r.target}, found at ${r.resolved}`),
    });
  }

  const quarantined = inventory.files.filter((file) => file.selfVerdict).map((file) => file.path);
  if (quarantined.length > 0) {
    findings.push({
      code: "self-verdict-present",
      severity: "strong concern",
      dimension: "evidence-independence",
      summary: `${quarantined.length} file(s) in the deliverable render a verdict on the deliverable; their conclusions carry no evidential weight`,
      evidence: quarantined,
    });
  }

  for (const command of commands) {
    const id = `cmd:${command.declaredIn}|${command.argv}`;
    nodes.push(node(id, "command", command.argv, {
      origin: command.origin, expected: command.expected, presenceOnly: isPresenceOnly(command.argv),
    }));
    edges.push({ from: `file:${command.declaredIn}`, to: id, kind: "produced-by", closed: false, detail: command.origin });
  }

  for (const record of execRecords) {
    const id = `cmd:${record.declaredIn}|${record.argv}`;
    const derivation = `derivation:${record.id}`;
    nodes.push(node(derivation, "derivation", `run of ${record.argv}`, {
      ran: record.ran, exitCode: record.exitCode, timedOut: record.timedOut, skipReason: record.skipReason,
    }));
    edges.push({
      from: id, to: derivation, kind: "supports",
      closed: record.ran && record.exitCode === 0 && !record.timedOut,
      detail: record.ran ? `exit ${record.exitCode}${record.timedOut ? " (timed out)" : ""}` : `skipped: ${record.skipReason}`,
    });
  }

  const failed = execRecords.filter((record) => record.ran && record.exitCode !== 0);
  if (failed.length > 0) {
    findings.push({
      code: "command-failed",
      severity: "concern",
      dimension: "replayability",
      summary: `${failed.length} reproduction command(s) did not exit 0`,
      evidence: failed.map((record) => `${record.argv} → exit ${record.exitCode}${record.timedOut ? " (timeout)" : ""} [${record.declaredIn}]`),
    });
  }
  if (execRecords.filter((record) => record.ran && record.exitCode === 0).length === 0) {
    findings.push({
      code: "no-executable-evidence",
      severity: "strong concern",
      dimension: "replayability",
      summary: "no reproduction command completed successfully in this run",
      evidence: execRecords.length === 0 ? ["no runnable command was found"] : execRecords.slice(0, 5).map((r) => `${r.argv}: ${r.skipReason ?? `exit ${r.exitCode}`}`),
    });
  }

  if (ciIsTheater(commands)) {
    findings.push({
      code: "verification-theater",
      severity: "concern",
      dimension: "deliverable-integrity",
      summary: "CI only asserts that files exist; it never runs the verification",
      evidence: commands.filter((c) => c.origin === "ci").map((c) => `${c.declaredIn}: ${c.argv}`),
    });
  }

  const shadows = inventory.files.filter((file) => file.shadowCopy);
  if (shadows.length > 0) {
    findings.push({
      code: "duplicate-primary",
      severity: "concern",
      dimension: "deliverable-integrity",
      summary: `${shadows.length} file(s) sit under a shadow package directory and may be a divergent duplicate of a primary artifact`,
      evidence: shadows.map((file) => file.path),
    });
  }

  const thirdParty = inventory.files.filter((file) => file.thirdParty);
  if (thirdParty.length > 0) {
    findings.push({
      code: "vendored-third-party",
      severity: "minor concern",
      dimension: "deliverable-integrity",
      summary: `${thirdParty.length} file(s) appear to be third-party content and must not count as the submitter's evidence`,
      evidence: thirdParty.slice(0, 12).map((file) => file.path),
    });
  }

  if (problem.emptySections.length > 0) {
    findings.push({
      code: "empty-declared-section",
      severity: "concern",
      dimension: "boundary-honesty",
      summary: `${problem.emptySections.length} declared section(s) that should record gaps are empty`,
      evidence: problem.emptySections.map((section) => `${section.file}: "${section.heading}"`),
    });
  }

  if (problem.cap.tier === "T2" || problem.cap.tier === "T3") {
    findings.push({
      code: "unreachable-problem-pin",
      severity: "strong concern",
      dimension: "problem-binding",
      summary: `problem recovery is ${problem.cap.tier}; the verdict is capped at "${problem.cap.resolution_ceiling}"`,
      evidence: [problem.cap.rationale],
    });
  }

  const supportEdges = edges.filter((edge) => edge.kind === "supports" || edge.kind === "hashes");
  return {
    nodes, edges, findings, quarantined,
    coverage: { closed: supportEdges.filter((edge) => edge.closed).length, total: supportEdges.length },
  };
}
