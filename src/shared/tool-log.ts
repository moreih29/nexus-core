import fs from "node:fs";
import path from "node:path";
import { getSessionRoot } from "./paths.js";

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

    const logDir = getSessionRoot();

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
