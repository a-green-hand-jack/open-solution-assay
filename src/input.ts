import { chmod, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { buildInventory, type Inventory } from "./inventory.js";
import { exists } from "./fs.js";

/** Directories that are download-tool residue rather than deliverable content. */
const STRIP = [".cache", ".git", "node_modules", "__pycache__", ".pytest_cache"];

export type ImportedTask = { workspace: string; runId: string; source: string; inventory: Inventory };

async function assertSafe(task: string): Promise<void> {
  const info = await stat(task).catch(() => null);
  if (!info) throw new Error(`task path does not exist: ${task}`);
  if (!info.isDirectory()) throw new Error(`task must be a directory: ${task}`);
  const entries = await readdir(task);
  if (entries.length === 0) throw new Error(`task directory is empty: ${task}`);
}

/**
 * Copy the task into `<output>/<name>__<timestamp>/source` and freeze it
 * read-only. OSA is report-only: it never modifies the deliverable.
 */
export async function importTask(taskPath: string, outputDir: string): Promise<ImportedTask> {
  const task = isAbsolute(taskPath) ? taskPath : resolve(process.cwd(), taskPath);
  await assertSafe(task);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const runId = `${basename(task)}__${stamp}`;
  const workspace = join(resolve(outputDir), runId);
  const source = join(workspace, "source");

  await mkdir(workspace, { recursive: true });
  await cp(task, source, { recursive: true, dereference: false });
  for (const name of STRIP) await rm(join(source, name), { recursive: true, force: true });

  const inventory = await buildInventory(source);
  // Freeze after inventory so the walk itself is not affected by mode changes.
  await freeze(source);

  for (const dir of [".assay/raw", ".assay/graph", ".assay/exec", ".assay/report", ".osa-run"]) {
    await mkdir(join(workspace, dir), { recursive: true });
  }
  return { workspace, runId, source, inventory };
}

async function freeze(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) { await freeze(abs); await chmod(abs, 0o555).catch(() => undefined); }
    else if (entry.isFile()) await chmod(abs, 0o444).catch(() => undefined);
  }
  await chmod(dir, 0o555).catch(() => undefined);
}

/** Restore write permission so the workspace can be cleaned up later. */
export async function thaw(dir: string): Promise<void> {
  if (!await exists(dir)) return;
  await chmod(dir, 0o755).catch(() => undefined);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) await thaw(abs);
    else await chmod(abs, 0o644).catch(() => undefined);
  }
}
