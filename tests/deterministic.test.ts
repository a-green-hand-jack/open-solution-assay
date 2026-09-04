import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../src/inventory.js";
import { auditHashAssertions, parseProseHashes, parseSumsFile } from "../src/manifest.js";
import { findEmptySections, recoverProblem } from "../src/problem.js";
import { ciIsTheater, extractFromCi, extractFromMarkdown, isPresenceOnly } from "../src/exec.js";
import { buildGraph } from "../src/graph.js";
import { unresolvedPlaceholder } from "../src/validation.js";
import { sha256 } from "../src/fs.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "osa-test-"));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

/** Read files back out of a fixture the way the controller does. */
function loader(root: string) {
  return (relative: string) => readFile(join(root, relative), "utf8");
}

describe("inventory", () => {
  it("hashes every file and is stable across runs", async () => {
    const root = await fixture({ "a.md": "alpha", "dir/b.txt": "beta" });
    const first = await buildInventory(root);
    const second = await buildInventory(root);
    expect(first.digest).toBe(second.digest);
    expect(first.files.map((f) => f.path)).toEqual(["a.md", "dir/b.txt"]);
    expect(first.files[0]!.sha256).toBe(sha256("alpha"));
  });

  it("never leaks the absolute path into the artifact", async () => {
    const root = await fixture({ "a.md": "x" });
    expect((await buildInventory(root)).root).toBe("source");
  });

  it("prunes download-cache mirrors", async () => {
    const root = await fixture({ "a.md": "x", ".cache/huggingface/a.md": "x" });
    const inventory = await buildInventory(root);
    expect(inventory.files).toHaveLength(1);
    expect(inventory.prunedPaths).toContain(".cache");
  });

  it("flags a self-verdict but not the checker that produced it", async () => {
    const root = await fixture({
      "INDEPENDENT-AGENT-REVIEW.md": "Outcome: PASS",
      "certificate_checker.py": "print(1)",
      "CERTIFICATE_CHECK.json": "{}",
    });
    const inventory = await buildInventory(root);
    const flagged = inventory.files.filter((f) => f.selfVerdict).map((f) => f.path);
    expect(flagged).toContain("INDEPENDENT-AGENT-REVIEW.md");
    expect(flagged).toContain("CERTIFICATE_CHECK.json");
    expect(flagged).not.toContain("certificate_checker.py");
  });
});

describe("hash assertions", () => {
  it("separates match, mismatch and absent in a sums file", async () => {
    const root = await fixture({ "payload.txt": "content", "SHA256SUMS": "" });
    const inventory = await buildInventory(root);
    const good = sha256("content");
    const parsed = parseSumsFile("SHA256SUMS", [
      `${good}  payload.txt`,
      `${"0".repeat(64)}  payload.txt`,
      `${good}  never-shipped.bin`,
    ].join("\n"), inventory);
    expect(parsed.map((a) => a.verdict)).toEqual(["match", "mismatch", "absent"]);
  });

  it("reads hash assertions out of prose, which is where frozen bindings hide", async () => {
    const root = await fixture({ "PROOF.md": "body" });
    const inventory = await buildInventory(root);
    const good = sha256("body");
    const parsed = parseProseHashes("review.md", [
      `- \`PROOF.md\`: \`${good}\``,
      `- \`RESULT.json\`: \`${"1".repeat(64)}\``,
    ].join("\n"), inventory);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.verdict).toBe("match");
    expect(parsed[1]!.verdict).toBe("absent");
  });

  it("calls a declared path that does not exist relocated, not missing", async () => {
    const root = await fixture({ "artifacts/evidence/CERTIFICATE.json": "{}", "SHA256SUMS": "" });
    const inventory = await buildInventory(root);
    const parsed = parseSumsFile("SHA256SUMS", `${sha256("{}")}  support/evidence/CERTIFICATE.json`, inventory);
    expect(parsed[0]!.verdict).toBe("relocated");
    expect(parsed[0]!.resolved).toBe("artifacts/evidence/CERTIFICATE.json");
  });

  it("ignores a bare digest mentioned in a sentence", async () => {
    const root = await fixture({ "a.md": "x" });
    const inventory = await buildInventory(root);
    expect(parseProseHashes("a.md", `the digest is \`${"a".repeat(64)}\` today`, inventory)).toHaveLength(0);
  });
});

describe("problem recovery", () => {
  it("caps a pinned but unreachable problem at T2", async () => {
    const root = await fixture({
      "solution.yaml": "problem_project_id: 559\nproblem_sha: 7abbc6cd4a2757755e062963a399d48601e3ef97\n",
      "README.md": "# S\n## Problem\ntext\n",
    });
    const inventory = await buildInventory(root);
    const recovery = await recoverProblem(inventory, loader(root), { network: false });
    expect(recovery.cap.tier).toBe("T2");
    // T2 forbids only `closed`. `declared-partial` is not a weaker `narrowed`:
    // it is an honestly scoped partial result, and an unreachable pin is no
    // reason to deny it to a repository that earned it.
    expect(recovery.cap.resolution_ceiling).toBe("declared-partial");
    expect(recovery.cap.scope_coverage_ceiling).toBe(3);
  });

  it("reaches T0 when the deliverable carries the statement itself", async () => {
    const root = await fixture({ "problem/PROBLEM.md": "the question", "README.md": "# S" });
    const inventory = await buildInventory(root);
    const recovery = await recoverProblem(inventory, loader(root), { network: false });
    expect(recovery.cap.tier).toBe("T0");
    expect(recovery.cap.resolution_ceiling).toBe("closed");
  });

  it("reports an empty gap section but ignores an empty prose heading", () => {
    const found = findEmptySections("README.md", "## Open Questions\n\n## Solution\n\n## Notes\n\n");
    expect(found.map((s) => s.heading)).toEqual(["Open Questions"]);
  });
});

describe("command extraction", () => {
  it("pulls reproduction commands out of table cells, not just fenced blocks", () => {
    const found = extractFromMarkdown("VALIDATION.md", [
      "| Claim | Reproduction | Expected result |",
      "| --- | --- | --- |",
      "| binding | `python3 checker.py cert.json` | accepted=true |",
    ].join("\n"));
    expect(found).toHaveLength(1);
    expect(found[0]!.origin).toBe("validation-table");
    expect(found[0]!.expected).toBe("accepted=true");
  });

  it("records no independent expectation when the column fuses expected and observed", () => {
    const found = extractFromMarkdown("VALIDATION.md", [
      "| Claim | Reproduction | Expected and observed result |",
      "| --- | --- | --- |",
      "| binding | `python3 checker.py` | matches |",
    ].join("\n"));
    expect(found[0]!.expected).toBeNull();
  });

  it("classifies presence-only CI as theater", () => {
    const ci = extractFromCi(".gitlab-ci.yml", "  script:\n    - test -s SOLUTION.md\n    - test -d artifacts\n");
    expect(ci).toHaveLength(2);
    expect(isPresenceOnly(ci[0]!.argv)).toBe(true);
    expect(ciIsTheater(ci)).toBe(true);
  });

  it("does not call CI theater when it actually runs the verification", () => {
    const ci = extractFromCi(".gitlab-ci.yml", "  script:\n    - test -s SOLUTION.md\n    - python3 -m unittest discover\n");
    expect(ciIsTheater(ci)).toBe(false);
  });
});

describe("placeholder detection", () => {
  it("does not mistake nested LaTeX braces for an unfilled template", () => {
    expect(unresolvedPlaceholder("gives \\(q^{\\bullet}=O_s(\\varepsilon^{3^{-d-2}})\\) for every fixed")).toBeNull();
    expect(unresolvedPlaceholder("the state \\(\\rho_{A_{1}}\\) factorises")).toBeNull();
  });

  it("catches a copied report skeleton", () => {
    expect(unresolvedPlaceholder("# Solution Assay — <problem id / repo>")).toBe("<problem id / repo>");
    expect(unresolvedPlaceholder("Decidable coverage: <m>/<n> support edges")).toBe("<m>/<n>");
  });

  it("catches a genuine mustache placeholder", () => {
    expect(unresolvedPlaceholder("the claim is {{ claim_text }} here")).toContain("claim_text");
  });
});

describe("graph", () => {
  it("counts coverage rather than asserting it, and gives each finding a dimension", async () => {
    const root = await fixture({ "payload.txt": "content", "SHA256SUMS": "" });
    const inventory = await buildInventory(root);
    const manifest = await auditHashAssertions(inventory, async (p) =>
      p === "SHA256SUMS" ? `${sha256("content")}  payload.txt\n${"0".repeat(64)}  payload.txt` : "content");
    const problem = await recoverProblem(inventory, async () => "", { network: false });
    const graph = buildGraph({ inventory, manifest, problem, commands: [], execRecords: [] });
    expect(graph.coverage.total).toBeGreaterThan(0);
    expect(graph.coverage.closed).toBeLessThanOrEqual(graph.coverage.total);
    expect(graph.findings.every((f) => f.dimension.length > 0)).toBe(true);
    expect(graph.findings.map((f) => f.code)).toContain("hash-mismatch");
  });
});
