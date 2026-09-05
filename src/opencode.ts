import { spawn, type ChildProcess } from "node:child_process";
import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2";

export type OpenCodeRuntime = { client: OpencodeClient; serverUrl: string; close: () => void };

const SERVER_START_TIMEOUT_MS = 60_000;

async function unwrap<T>(result: PromiseLike<{ data?: T; error?: unknown }>, operation: string): Promise<T> {
  const response = await result;
  if (response.error) throw new Error(`OpenCode ${operation} failed: ${JSON.stringify(response.error)}`);
  if (response.data === undefined) throw new Error(`OpenCode ${operation} returned no data`);
  return response.data;
}

export async function startOpenCode(directory: string): Promise<OpenCodeRuntime> {
  const server = await createOpencodeServer({ hostname: "127.0.0.1", port: 0, timeout: SERVER_START_TIMEOUT_MS });
  return { client: createOpencodeClient({ baseUrl: server.url, directory }), serverUrl: server.url, close: server.close };
}

export async function createSession(runtime: OpenCodeRuntime, directory: string): Promise<string> {
  const session = await unwrap(runtime.client.session.create({ directory, title: "OSA Solution Assay" }), "session.create");
  return (session as { id: string }).id;
}

export async function prompt(
  runtime: OpenCodeRuntime, directory: string, sessionId: string, text: string, model?: string,
): Promise<void> {
  const parsed = model?.includes("/") ? model.split("/") : undefined;
  await unwrap(runtime.client.session.promptAsync({
    directory,
    sessionID: sessionId,
    agent: "osa-runner",
    model: parsed ? { providerID: parsed[0]!, modelID: parsed.slice(1).join("/") } : undefined,
    parts: [{ type: "text", text }],
  }), "session.promptAsync");
}

/** Poll until the session has been busy and then goes quiet. */
export async function waitForIdle(
  runtime: OpenCodeRuntime, directory: string, sessionId: string, timeoutMs: number, signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let observedBusy = false;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("OSA session wait interrupted");
    const statuses = await unwrap(runtime.client.session.status({ directory }), "session.status") as Record<string, { type?: string }>;
    const status = statuses[sessionId]?.type;
    if (status === "busy" || status === "retry") observedBusy = true;
    if (observedBusy && !status) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`OSA session ${sessionId} did not become idle within ${timeoutMs}ms`);
}

/** Attach the native OpenCode TUI to the controller's own server and session. */
export function attachTui(
  runtime: OpenCodeRuntime, directory: string, sessionId: string,
): { process: ChildProcess; exited: Promise<number> } {
  const child = spawn("opencode", ["attach", runtime.serverUrl, "--session", sessionId, "--dir", directory], {
    stdio: "inherit", env: process.env,
  });
  const exited = new Promise<number>((resolve) => {
    child.once("error", () => resolve(127));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 130 : 0)));
  });
  return { process: child, exited };
}

export async function abortSession(runtime: OpenCodeRuntime, directory: string, sessionId: string): Promise<void> {
  try { await unwrap(runtime.client.session.abort({ directory, sessionID: sessionId }), "session.abort"); }
  catch { /* best effort during cleanup */ }
}
