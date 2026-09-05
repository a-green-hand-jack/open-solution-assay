import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./fs.js";

/** Locate the packaged prompts directory, whether running from dist/ or src/. */
export function promptsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
}

/**
 * Install the agent prompt and the OpenCode permission policy into the run
 * workspace. Note `bash: allow` — unlike a paper reviewer, OSA must execute
 * the auditee's verification code. `external_directory` stays denied so the
 * agent cannot reach outside the workspace.
 */
export async function installAssets(workspace: string): Promise<void> {
  const agentDir = join(workspace, ".opencode", "agent");
  await mkdir(agentDir, { recursive: true });
  await copyFile(join(promptsDir(), "osa-audit.md"), join(agentDir, "osa-runner.md"));

  const permission = {
    "*": "deny",
    read: "allow",
    glob: "allow",
    grep: "allow",
    write: "allow",
    edit: "allow",
    patch: "allow",
    bash: "allow",
    external_directory: "deny",
    question: "deny",
    // The development container intentionally mirrors a normal connected
    // OpenCode installation. Network access remains a user-visible choice in
    // the audit prompt, while external filesystem access stays isolated.
    webfetch: "allow",
    websearch: "allow",
  } as const;

  await writeJsonAtomic(join(workspace, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    permission,
    agent: { "osa-runner": { mode: "primary", description: "Open SolutionAssay phase executor", permission } },
  });
}
