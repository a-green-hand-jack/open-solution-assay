import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { sha256 } from "./fs.js";

/**
 * Directories that are never part of a deliverable. `.cache/huggingface` in
 * particular is created by `hf download --local-dir` and mirrors every path in
 * the snapshot, which doubles every file count if it is not pruned.
 */
const PRUNED_DIRS = new Set([".git", ".cache", "node_modules", "__pycache__", ".pytest_cache", ".venv"]);

/**
 * A file in the deliverable that renders a verdict on the deliverable. Its
 * conclusion carries zero evidential weight because it was written by the
 * submitting party, but its own claims are auditable. Matched on basename.
 */
const SELF_VERDICT_PATTERNS: readonly RegExp[] = [
  /independent.*review/i,
  /^review-verdict\b/i,
  /^solution-review\b/i,
  /^build-review\b/i,
  /final.*(audit|verdict|closure)/i,
  /closure[_-]?status/i,
  /theorem[_-]?audit/i,
  /certificate[_-]?check(?!er)/i,
];

/** Paths that usually hold content the submitter did not write. */
const THIRD_PARTY_PATTERNS: readonly RegExp[] = [
  /(^|\/)references\//i,
  /(^|\/)revtex\d*\//i,
  /(^|\/)vendor(ed)?\//i,
  /(^|\/)third[_-]party\//i,
  /(^|\/)src\d{4}\//i,
];

/** A second, divergent copy of a primary artifact hidden under a package dir. */
const SHADOW_COPY_PATTERNS: readonly RegExp[] = [
  /reviewed-package\//i,
  /(^|\/)legacy[-_]/i,
];

export type FileEntry = {
  path: string;
  bytes: number;
  sha256: string;
  selfVerdict: boolean;
  thirdParty: boolean;
  shadowCopy: boolean;
};

export type Inventory = {
  root: string;
  files: FileEntry[];
  prunedPaths: string[];
  byExtension: Record<string, number>;
  totalBytes: number;
  digest: string;
};

function classify(rel: string): Pick<FileEntry, "selfVerdict" | "thirdParty" | "shadowCopy"> {
  const posix = rel.split(sep).join("/");
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  return {
    selfVerdict: SELF_VERDICT_PATTERNS.some((p) => p.test(base)),
    thirdParty: THIRD_PARTY_PATTERNS.some((p) => p.test(posix)),
    shadowCopy: SHADOW_COPY_PATTERNS.some((p) => p.test(posix)),
  };
}

/**
 * Walk the deliverable and hash every file. Deterministic: entries are sorted
 * by path, so two runs over identical bytes produce an identical digest.
 */
export async function buildInventory(root: string): Promise<Inventory> {
  const files: FileEntry[] = [];
  const prunedPaths: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name)) { prunedPaths.push(rel); continue; }
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(abs);
      files.push({ path: rel, bytes: info.size, sha256: sha256(await readFile(abs)), ...classify(rel) });
    }
  }

  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const byExtension: Record<string, number> = {};
  for (const file of files) {
    const dot = file.path.lastIndexOf(".");
    const slash = file.path.lastIndexOf("/");
    const ext = dot > slash + 1 ? file.path.slice(dot + 1).toLowerCase() : "(none)";
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
  }

  return {
    // Deliberately not the absolute path: it carries the timestamped run
    // directory, which would make an otherwise identical inventory differ
    // between runs and defeat byte-level reproducibility.
    root: "source",
    files,
    prunedPaths: prunedPaths.sort(),
    byExtension,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    digest: sha256(files.map((file) => `${file.sha256}  ${file.path}`).join("\n")),
  };
}

export function findByBasename(inventory: Inventory, pattern: RegExp): FileEntry[] {
  return inventory.files.filter((file) => pattern.test(file.path.slice(file.path.lastIndexOf("/") + 1)));
}
