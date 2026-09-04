import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, readJson } from "./fs.js";
import { ARTIFACT_SECTIONS, DIMENSIONS, OUTPUTS, REPORT_SECTIONS, RESOLUTION_LABELS, isDeterministic, type Phase } from "./phases.js";
import type { TierCap } from "./state.js";

export type Check = { name: string; passed: boolean; detail: string };

const CEILING_RANK: Record<string, number> = {
  closed: 0, "declared-partial": 1, narrowed: 2, unsupported: 3,
  unverifiable: 4, contradicted: 5, misaligned: 6, unauditable: 7,
};

/** Every artifact a phase is contracted to write must exist and be non-trivial. */
export async function validatePhase(workspace: string, phase: Phase, cap: TierCap | null): Promise<Check[]> {
  const checks: Check[] = [];
  for (const relative of OUTPUTS[phase]) {
    const path = join(workspace, relative);
    if (!await exists(path)) {
      checks.push({ name: relative, passed: false, detail: "missing artifact" });
      continue;
    }
    const content = await readFile(path, "utf8");
    if (relative.endsWith(".json")) {
      // A JSON artifact may be legitimately empty: a deliverable with no
      // runnable command produces `[]`, which is a finding about the
      // deliverable, not a failure of the phase. Require valid JSON instead.
      let parsed = true;
      try { JSON.parse(content); } catch { parsed = false; }
      checks.push({ name: `${relative}:valid-json`, passed: parsed, detail: parsed ? `${content.length} bytes` : "not parseable" });
    } else {
      checks.push({ name: `${relative}:non-empty`, passed: content.trim().length > 40, detail: `${content.length} bytes` });
    }
    if (relative.endsWith(".md") && !isDeterministic(phase)) {
      for (const section of ARTIFACT_SECTIONS) {
        checks.push({ name: `${relative}:${section}`, passed: content.includes(section), detail: content.includes(section) ? "present" : "missing" });
      }
    }
    if (content.includes("{{") || content.includes("}}")) {
      checks.push({ name: `${relative}:template`, passed: false, detail: "unresolved template placeholder" });
    }
  }
  if (phase === "report") checks.push(...await exportGate(workspace, cap));
  return checks;
}

/**
 * The nine export-gate checks, enforced here rather than trusted to the model.
 * Anything a controller can decide, a controller decides.
 */
export async function exportGate(workspace: string, cap: TierCap | null): Promise<Check[]> {
  const checks: Check[] = [];
  const path = join(workspace, ".assay", "report", "assay.md");
  if (!await exists(path)) return [{ name: "gate:report", passed: false, detail: "no report to gate" }];
  const report = await readFile(path, "utf8");

  // G-sections: fixed names, fixed order.
  let cursor = -1;
  let ordered = true;
  for (const section of REPORT_SECTIONS) {
    const index = report.search(new RegExp(`^## ${section.replace(/[()]/g, "\\$&")}\\s*$`, "m"));
    checks.push({ name: `gate:## ${section}`, passed: index >= 0, detail: index >= 0 ? "present" : "missing" });
    if (index >= 0) { if (index < cursor) ordered = false; cursor = index; }
  }
  checks.push({ name: "gate:section-order", passed: ordered, detail: "sections appear in the contracted order" });

  // G1: resolution label from the closed vocabulary; both axes reported.
  const resolutionBody = report.split(/^## Resolution[ \t]*$/m)[1]?.split(/^## /m)[0] ?? "";
  const firstLine = resolutionBody.split("\n").map((line) => line.trim().replace(/^\*\*(.*)\*\*$/, "$1")).find(Boolean) ?? "";
  const label = firstLine.split(",")[0]?.trim().toLowerCase() ?? "";
  const validLabel = (RESOLUTION_LABELS as readonly string[]).includes(label);
  checks.push({ name: "gate:resolution-label", passed: validLabel, detail: validLabel ? label : `"${label}" is not in the closed vocabulary` });
  checks.push({ name: "gate:both-axes", passed: /claim reach\s*:/i.test(resolutionBody) && /established support\s*:/i.test(resolutionBody), detail: "both axes reported separately" });

  // G6: the tier ceiling must not be exceeded.
  if (cap && validLabel) {
    const within = (CEILING_RANK[label] ?? 99) >= (CEILING_RANK[cap.resolution_ceiling] ?? 0);
    checks.push({ name: "gate:tier-ceiling", passed: within, detail: within ? `${label} is within ${cap.tier} ceiling ${cap.resolution_ceiling}` : `${label} exceeds ${cap.tier} ceiling ${cap.resolution_ceiling}` });
  }

  // G2/G3: one evidenced row per dimension; any score <= 2 forces a condition.
  const scoreSection = report.split(/^## Dimension Scores[ \t]*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = scoreSection.split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 5 && !/^[-: ]+$/.test(cells[0] ?? "") && !/^dimension$/i.test(cells[0] ?? ""));
  const labels = new Set(rows.map((cells) => (cells[0] ?? "").toLowerCase()));
  const allPresent = DIMENSIONS.every((dimension) => labels.has(dimension));
  checks.push({ name: "gate:dimension-rows", passed: rows.length === DIMENSIONS.length && allPresent, detail: `${rows.length} rows for ${DIMENSIONS.length} dimensions` });
  const evidenced = rows.every((cells) => Boolean(cells[2]) && Boolean(cells[3]) && Boolean(cells[4]));
  checks.push({ name: "gate:scores-evidenced", passed: evidenced, detail: "every row carries band wording and artifact evidence" });
  const lowScore = rows.some((cells) => /^[0-2]\b/.test(cells[1] ?? ""));
  checks.push({ name: "gate:conditional-on-low-score", passed: !lowScore || /\bconditional on\b/i.test(firstLine), detail: lowScore ? "a score of 0-2 requires ', conditional on ...' on the Resolution line" : "no score at or below 2" });

  // G7: coverage must equal the counted value in graph.json.
  const graphPath = join(workspace, ".assay", "graph", "graph.json");
  if (await exists(graphPath)) {
    const graph = await readJson(graphPath) as { coverage?: { closed?: number; total?: number } };
    const stated = /decidable coverage\s*:\s*(\d+)\s*\/\s*(\d+)/i.exec(report);
    const matches = Boolean(stated && Number(stated[1]) === graph.coverage?.closed && Number(stated[2]) === graph.coverage?.total);
    checks.push({ name: "gate:coverage-matches-graph", passed: matches, detail: matches ? `${stated?.[1]}/${stated?.[2]}` : `report states ${stated?.[0] ?? "nothing"}, graph counted ${graph.coverage?.closed}/${graph.coverage?.total}` });
  }

  // G8: no quarantined self-verdict may be cited as support.
  if (await exists(graphPath)) {
    const graph = await readJson(graphPath) as { quarantined?: string[] };
    const cited = (graph.quarantined ?? []).filter((file) => {
      const base = file.slice(file.lastIndexOf("/") + 1);
      const index = report.indexOf(base);
      if (index < 0) return false;
      // Naming it in the quarantine list is required; using it as support is not.
      const window = report.slice(Math.max(0, index - 200), index + 200).toLowerCase();
      return !/quarantin|not used as support|zero evidential|self-verdict/.test(window);
    });
    checks.push({ name: "gate:self-verdict-not-cited", passed: cited.length === 0, detail: cited.length === 0 ? "clean" : `cited without quarantine context: ${cited.join(", ")}` });
  }

  // G9: no numeric confidence score.
  const confidence = /^##+\s*Confidence\s*$/m.test(report) || /\bconfidence\s*:?\s*\**\s*\d\s*\/\s*(?:5|10)\b/i.test(report);
  checks.push({ name: "gate:no-numeric-confidence", passed: !confidence, detail: confidence ? "a numeric confidence score is present" : "absent" });

  return checks;
}
