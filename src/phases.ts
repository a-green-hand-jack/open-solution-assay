/**
 * Fixed protocol. Deterministic phases are executed by this package; judgment
 * phases are delegated to an OpenCode agent and then validated here.
 */
export const PHASES = [
  "intake",
  "problem",
  "claims",
  "graph",
  "execute",
  "crosscheck",
  "shortfall",
  "report",
] as const;

export type Phase = (typeof PHASES)[number];

export const DETERMINISTIC: readonly Phase[] = ["intake", "problem", "graph", "execute", "shortfall"];
export const JUDGMENT: readonly Phase[] = ["claims", "crosscheck", "report"];

export function isDeterministic(phase: Phase): boolean {
  return DETERMINISTIC.includes(phase);
}

/** Slash command installed into the workspace for each judgment phase. */
export const COMMANDS: Partial<Record<Phase, string>> = {
  claims: "2-osa-claims",
  crosscheck: "5-osa-crosscheck",
  report: "7-osa-report",
};

/** Artifacts a phase is contracted to write, relative to the run workspace. */
export const OUTPUTS: Record<Phase, readonly string[]> = {
  intake: [".assay/graph/inventory.json", ".assay/raw/00_intake.md"],
  problem: [".assay/graph/problem.json", ".assay/raw/01_problem.md"],
  claims: [".assay/raw/02_claims.md"],
  graph: [".assay/graph/graph.json", ".assay/raw/03_graph.md"],
  execute: [".assay/graph/exec.json", ".assay/raw/04_execute.md"],
  crosscheck: [".assay/raw/05_crosscheck.md"],
  shortfall: [".assay/graph/shortfall.json", ".assay/raw/06_shortfall.md"],
  report: [".assay/report/assay.md"],
};

/** Required level-two sections in every judgment artifact. */
export const ARTIFACT_SECTIONS = ["## Method", "## Output", "## Provenance"] as const;

/** Required level-two sections of the final report, in order. */
export const REPORT_SECTIONS = [
  "Resolution",
  "Problem recovered",
  "Claims and typing",
  "Shortfall",
  "What OSA established",
  "Verification agenda",
  "Findings",
  "Dimension Scores",
  "Blockers",
  "Paper review (delegated)",
  "What was not checked",
] as const;

export const DIMENSIONS = [
  "problem-binding",
  "scope-coverage",
  "argument-support",
  "evidence-independence",
  "replayability",
  "boundary-honesty",
  "deliverable-integrity",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const RESOLUTION_LABELS = [
  "closed",
  "declared-partial",
  "narrowed",
  "unsupported",
  "unverifiable",
  "contradicted",
  "misaligned",
  "unauditable",
] as const;

export type ResolutionLabel = (typeof RESOLUTION_LABELS)[number];

export const CLAIM_REACH = ["full", "substantial", "partial", "special-case", "reformulation-only"] as const;

export const ESTABLISHED_SUPPORT = [
  "independently-reproduced",
  "independently-checked",
  "certificate-verified",
  "insufficient evidence to judge",
  "author-attested-only",
  "unreplayable",
  "contradicted",
] as const;
