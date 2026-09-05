import { dirname, join, normalize, sep } from "node:path";
import type { Inventory } from "./inventory.js";

/**
 * A hash assertion found anywhere in the deliverable: a SHA256SUMS-style
 * manifest line, or an inline `path` / `hash` pair in prose. Prose matters
 * because repos routinely state "frozen bindings" inside a narrative file, and
 * those references are exactly the ones that turn out to point at artifacts
 * that were never shipped.
 */
export type HashAssertion = {
  declaredIn: string;
  target: string;
  claimed: string;
  /** Resolved deliverable-relative path, or null when nothing matched. */
  resolved: string | null;
  verdict: "match" | "relocated" | "mismatch" | "absent";
  actual: string | null;
  /** True when the declared path did not exist and only a basename match did. */
  relocated: boolean;
};

const SUMS_LINE = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i;
/** `path` ... `<64 hex>` or `<64 hex>` ... `path`, both seen in the wild. */
const INLINE_PATH_FIRST = /`([^`\n]{1,200})`\s*[:=]?\s*`?([0-9a-f]{64})`?/gi;
const INLINE_HASH_ONLY = /`?([0-9a-f]{64})`?/gi;

function looksLikePath(value: string): boolean {
  return /[./]/.test(value) && !/\s{2,}/.test(value) && !/^[0-9a-f]{64}$/i.test(value);
}

function candidateBases(declaredIn: string): string[] {
  const dir = dirname(declaredIn);
  const bases = new Set<string>(["", dir === "." ? "" : dir]);
  // A manifest under artifacts/ frequently addresses paths rooted at a sibling
  // payload directory (paper/, artifacts/), not at its own location.
  for (const segment of ["paper", "artifacts", "artifacts/evidence"]) bases.add(segment);
  if (dir !== ".") {
    const parent = dirname(dir);
    if (parent !== "." && parent !== dir) bases.add(parent);
  }
  return [...bases];
}

function resolve(inventory: Inventory, declaredIn: string, target: string): { path: string; relocated: boolean } | null {
  const cleaned = target.replace(/^\.\//, "").split(sep).join("/");
  const byPath = new Map(inventory.files.map((file) => [file.path, file.path]));
  for (const base of candidateBases(declaredIn)) {
    const joined = normalize(base ? join(base, cleaned) : cleaned).split(sep).join("/");
    if (byPath.has(joined)) return { path: joined, relocated: false };
  }
  // Last resort: a unique basename match anywhere in the deliverable.
  const base = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  const matches = inventory.files.filter((file) => file.path.endsWith(`/${base}`) || file.path === base);
  return matches.length === 1 ? { path: matches[0]!.path, relocated: true } : null;
}

function judge(inventory: Inventory, declaredIn: string, target: string, claimed: string): HashAssertion {
  const hit = resolve(inventory, declaredIn, target);
  if (!hit) return { declaredIn, target, claimed, resolved: null, verdict: "absent", actual: null, relocated: false };
  const actual = inventory.files.find((file) => file.path === hit.path)?.sha256 ?? null;
  const same = Boolean(actual && actual.toLowerCase() === claimed.toLowerCase());
  return {
    declaredIn, target, claimed, resolved: hit.path, actual, relocated: hit.relocated,
    verdict: same ? (hit.relocated ? "relocated" : "match") : "mismatch",
  };
}

/** Parse a `sha256sum`-format manifest. */
export function parseSumsFile(declaredIn: string, content: string, inventory: Inventory): HashAssertion[] {
  const out: HashAssertion[] = [];
  for (const line of content.split("\n")) {
    const match = SUMS_LINE.exec(line.trim());
    if (match) out.push(judge(inventory, declaredIn, match[2]!, match[1]!));
  }
  return out;
}

/**
 * Parse hash assertions out of prose. Only pairs where the non-hash half looks
 * like a path are kept, so a bare digest mentioned in a sentence is ignored.
 */
export function parseProseHashes(declaredIn: string, content: string, inventory: Inventory): HashAssertion[] {
  const out: HashAssertion[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    INLINE_PATH_FIRST.lastIndex = 0;
    let match: RegExpExecArray | null;
    let matchedOnLine = false;
    while ((match = INLINE_PATH_FIRST.exec(line))) {
      const [, left, hash] = match;
      if (!left || !hash || !looksLikePath(left)) continue;
      const key = `${left}|${hash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matchedOnLine = true;
      out.push(judge(inventory, declaredIn, left, hash));
    }
    if (matchedOnLine) continue;
    // `path`: hash written with the digest unquoted and the path bare.
    const bare = /^[-*]?\s*`?([^`\s:]+\.[A-Za-z0-9_]+)`?\s*[:=]\s*`?([0-9a-f]{64})`?/i.exec(line);
    if (bare && bare[1] && bare[2] && !seen.has(`${bare[1]}|${bare[2]}`)) {
      seen.add(`${bare[1]}|${bare[2]}`);
      out.push(judge(inventory, declaredIn, bare[1], bare[2]));
    }
  }
  return out;
}

export type ManifestAudit = {
  assertions: HashAssertion[];
  mismatches: HashAssertion[];
  absent: HashAssertion[];
  matches: HashAssertion[];
  relocated: HashAssertion[];
  sources: string[];
};

/**
 * Collect and verify every hash assertion in the deliverable — from manifests
 * and from prose. Reads files through the supplied loader so callers control
 * the read-only source root.
 */
export async function auditHashAssertions(
  inventory: Inventory,
  load: (relativePath: string) => Promise<string>,
): Promise<ManifestAudit> {
  const assertions: HashAssertion[] = [];
  const sources: string[] = [];
  for (const file of inventory.files) {
    const base = file.path.slice(file.path.lastIndexOf("/") + 1);
    const isSums = /sha256|sums|\.sha256$|manifest/i.test(base);
    const isText = /\.(md|txt|json|yaml|yml)$/i.test(base) || isSums;
    if (!isText || file.bytes > 2_000_000) continue;
    let content: string;
    try { content = await load(file.path); } catch { continue; }
    if (!/[0-9a-f]{64}/i.test(content)) continue;
    const found = isSums && !base.toLowerCase().endsWith(".json")
      ? parseSumsFile(file.path, content, inventory)
      : parseProseHashes(file.path, content, inventory);
    if (found.length > 0) { assertions.push(...found); sources.push(file.path); }
  }
  return {
    assertions,
    mismatches: assertions.filter((a) => a.verdict === "mismatch"),
    absent: assertions.filter((a) => a.verdict === "absent"),
    matches: assertions.filter((a) => a.verdict === "match"),
    relocated: assertions.filter((a) => a.verdict === "relocated"),
    sources: [...new Set(sources)].sort(),
  };
}
