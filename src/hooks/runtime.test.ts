import { describe, it, expect } from "bun:test";
import { parseBashCommand, __test } from "./runtime.ts";
import type { NexusHookOutput, NexusHookInput } from "./types.ts";

const { serializeForClaude, serializeForCodex, normalizeBashToolName, normalizeCodexToolName } =
  __test;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePreToolUse(toolName: string, command?: string): NexusHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test-session",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: command !== undefined ? { command } : undefined,
  };
}

function makeSessionStart(): NexusHookInput {
  return {
    hook_event_name: "SessionStart",
    session_id: "test-session",
    cwd: "/tmp",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runtime.ts", () => {
  // ── parseBashCommand ──────────────────────────────────────────────────────

  describe("parseBashCommand", () => {
    it("ls → LS", () => {
      const result = parseBashCommand("ls -la");
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("LS");
    });

    it("find → Glob", () => {
      const result = parseBashCommand("find . -name '*.ts'");
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("Glob");
    });

    it("rg → Grep", () => {
      const result = parseBashCommand("rg foo src/");
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("Grep");
    });

    it("cat → Read", () => {
      const result = parseBashCommand("cat README.md");
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("Read");
    });

    it("sed -i → Edit", () => {
      const result = parseBashCommand("sed -i 's/a/b/' f");
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("Edit");
    });

    it("파이프 차단", () => {
      const result = parseBashCommand("ls | head");
      expect(result).toBeNull();
    });

    it("&& 차단", () => {
      const result = parseBashCommand("cd x && ls");
      expect(result).toBeNull();
    });

    it("; 차단", () => {
      const result = parseBashCommand("ls; pwd");
      expect(result).toBeNull();
    });

    it("미지 명령", () => {
      const result = parseBashCommand("kubectl get pods");
      expect(result).toBeNull();
    });
  });

  // ── normalizeCodexToolName ────────────────────────────────────────────────

  describe("normalizeCodexToolName", () => {
    it('"shell" → "Bash"', () => {
      expect(normalizeCodexToolName("shell")).toBe("Bash");
    });

    it('"apply_patch" → "Edit"', () => {
      expect(normalizeCodexToolName("apply_patch")).toBe("Edit");
    });

    it('"list_dir" → "LS"', () => {
      expect(normalizeCodexToolName("list_dir")).toBe("LS");
    });

    it('"unknown_tool" → "unknown_tool" (pass-through)', () => {
      expect(normalizeCodexToolName("unknown_tool")).toBe("unknown_tool");
    });
  });

  // ── normalizeBashToolName ─────────────────────────────────────────────────

  describe("normalizeBashToolName", () => {
    it("PreToolUse + tool_name:Bash + command:ls → tool_name:LS", () => {
      const input = makePreToolUse("Bash", "ls -la");
      const result = normalizeBashToolName(input, "claude");
      expect((result as Extract<NexusHookInput, { hook_event_name: "PreToolUse" }>).tool_name).toBe(
        "LS",
      );
    });

    it("PreToolUse + tool_name:Bash + command:kubectl → tool_name:Bash (변경 없음)", () => {
      const input = makePreToolUse("Bash", "kubectl get pods");
      const result = normalizeBashToolName(input, "claude");
      expect((result as Extract<NexusHookInput, { hook_event_name: "PreToolUse" }>).tool_name).toBe(
        "Bash",
      );
    });

    it("SessionStart 이벤트 → 입력 그대로 반환", () => {
      const input = makeSessionStart();
      const result = normalizeBashToolName(input as NexusHookInput, "claude");
      expect(result).toStrictEqual(input);
    });
  });

  // ── serializeForClaude ────────────────────────────────────────────────────

  describe("serializeForClaude", () => {
    it('decision:block + block_reason + PreToolUse → permissionDecision:"deny" + permissionDecisionReason', () => {
      const out: NexusHookOutput = { decision: "block", block_reason: "X" };
      const result = serializeForClaude(out, "PreToolUse");
      expect(result).toStrictEqual({
        permissionDecision: "deny",
        permissionDecisionReason: "X",
      });
    });

    it("decision:block + block_reason + UserPromptSubmit → decision:block + reason", () => {
      const out: NexusHookOutput = { decision: "block", block_reason: "X" };
      const result = serializeForClaude(out, "UserPromptSubmit");
      expect(result).toStrictEqual({ decision: "block", reason: "X" });
    });

    it("additional_context → additionalContext", () => {
      const out: NexusHookOutput = { additional_context: "ctx" };
      const result = serializeForClaude(out, "SessionStart");
      expect(result).toStrictEqual({ additionalContext: "ctx" });
    });

    it("system_message → systemMessage", () => {
      const out: NexusHookOutput = { system_message: "msg" };
      const result = serializeForClaude(out, "SessionStart");
      expect(result).toStrictEqual({ systemMessage: "msg" });
    });

    it("continue:false → continue:false + stopReason:system_message", () => {
      const out: NexusHookOutput = { continue: false };
      const result = serializeForClaude(out, "SessionStart");
      expect(result).toStrictEqual({ continue: false, stopReason: "system_message" });
    });

    it("{} → {}", () => {
      const out: NexusHookOutput = {};
      const result = serializeForClaude(out, "SessionStart");
      expect(result).toStrictEqual({});
    });
  });

  // ── serializeForCodex ─────────────────────────────────────────────────────

  describe("serializeForCodex", () => {
    it("decision:block + block_reason + PreToolUse → decision:block + reason (permissionDecision 아님)", () => {
      const out: NexusHookOutput = { decision: "block", block_reason: "X" };
      const result = serializeForCodex(out, "PreToolUse");
      expect(result).toStrictEqual({ decision: "block", reason: "X" });
      expect(result["permissionDecision"]).toBeUndefined();
    });

    it("additional_context + UserPromptSubmit → hookSpecificOutput", () => {
      const out: NexusHookOutput = { additional_context: "ctx" };
      const result = serializeForCodex(out, "UserPromptSubmit");
      expect(result).toStrictEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "ctx",
        },
      });
    });

    it("system_message → systemMessage", () => {
      const out: NexusHookOutput = { system_message: "msg" };
      const result = serializeForCodex(out, "SessionStart");
      expect(result).toStrictEqual({ systemMessage: "msg" });
    });

    it("continue:false → continue:false + stopReason:system_message", () => {
      const out: NexusHookOutput = { continue: false };
      const result = serializeForCodex(out, "SessionStart");
      expect(result).toStrictEqual({ continue: false, stopReason: "system_message" });
    });

    it("decision:block (reason 없음) → decision:block (reason 키 없음)", () => {
      const out: NexusHookOutput = { decision: "block" };
      const result = serializeForCodex(out, "SessionStart");
      expect(result).toStrictEqual({ decision: "block" });
      expect("reason" in result).toBe(false);
    });
  });

  // ── 대칭성 불변식 ──────────────────────────────────────────────────────────

  describe("harness 대칭성 불변식", () => {
    it("system_message → claude·codex 둘 다 systemMessage === 'm'", () => {
      const out: NexusHookOutput = { system_message: "m" };
      const claude = serializeForClaude(out, "SessionStart");
      const codex = serializeForCodex(out, "SessionStart");
      expect(claude["systemMessage"]).toBe("m");
      expect(codex["systemMessage"]).toBe("m");
    });

    it("continue:false → claude·codex 둘 다 continue === false && stopReason === 'system_message'", () => {
      const out: NexusHookOutput = { continue: false };
      const claude = serializeForClaude(out, "SessionStart");
      const codex = serializeForCodex(out, "SessionStart");
      expect(claude["continue"]).toBe(false);
      expect(claude["stopReason"]).toBe("system_message");
      expect(codex["continue"]).toBe(false);
      expect(codex["stopReason"]).toBe("system_message");
    });
  });
});
