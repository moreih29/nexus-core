import fs from "node:fs";
import path from "node:path";
import { getCurrentBranch, getStateRoot } from "./paths.js";

function sanitizeBranch(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function getSessionId(): string {
  const envId = process.env["NEXUS_SESSION_ID"];
  if (envId) return envId;

  const branch = getCurrentBranch();
  const pid = process.pid;
  if (!branch) return `unknown-${pid}`;
  return `${sanitizeBranch(branch)}-${pid}`;
}

export function logToolCall(entry: {
  tool: string;
  args: unknown;
  response: unknown;
  duration_ms: number;
  timestamp?: string;
}): void {
  try {
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const record = { ...entry, timestamp };

    const sessionId = getSessionId();
    const logDir = path.join(getStateRoot(), "sessions", sessionId);

    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      return;
    }

    const logFile = path.join(logDir, "tool-log.jsonl");
    fs.appendFileSync(logFile, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // best-effort — silently ignore all failures
  }
}
