import { test, expect, describe } from "bun:test";
import { textResult } from "./mcp-utils.ts";

describe("textResult", () => {
  test("1. 객체 입력 — content[0].text가 JSON round-trip 보존", () => {
    const input = { foo: "bar", num: 42, nested: { a: true } };
    const result = textResult(input);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed).toEqual(input);
  });

  test("2. 배열 입력 — content[0].text가 JSON round-trip 보존", () => {
    const input = [1, "two", { three: 3 }];
    const result = textResult(input);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed).toEqual(input);
  });

  test("3. null 입력 — content[0].text가 'null'", () => {
    const result = textResult(null);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed).toBeNull();
  });

  test("4. 빈 객체 입력 — content[0].text가 '{}'", () => {
    const input = {};
    const result = textResult(input);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed).toEqual(input);
  });

  test("5. 숫자 입력 — round-trip 보존", () => {
    const result = textResult(123);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed).toBe(123);
  });
});
