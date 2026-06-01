import { describe, it, expect } from "vitest";
import { stripJsonc, merge, DEFAULTS } from "./config";

describe("stripJsonc", () => {
  it("passes plain JSON through unchanged", () => {
    const s = '{"a":1,"b":"hello"}';
    expect(stripJsonc(s)).toBe(s);
  });

  it("removes // line comments", () => {
    const input = '{\n  "a": 1 // trailing comment\n}';
    const result = stripJsonc(input);
    expect(result).not.toContain("trailing comment");
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("removes /* block comments */", () => {
    const input = '{"a": /* block */ 2}';
    const result = stripJsonc(input);
    expect(JSON.parse(result)).toEqual({ a: 2 });
  });

  it("preserves // inside a string value (e.g. a URL)", () => {
    const input = '{"url": "https://example.com/path"}';
    const result = stripJsonc(input);
    expect(result).toContain("https://example.com/path");
    expect(JSON.parse(result)).toEqual({ url: "https://example.com/path" });
  });

  it("preserves /* inside a string value", () => {
    const input = '{"note": "use /* style */"}';
    const result = stripJsonc(input);
    expect(JSON.parse(result)).toEqual({ note: "use /* style */" });
  });

  it("removes a standalone comment line leaving valid JSON", () => {
    const input = '{\n  // whole line comment\n  "x": 42\n}';
    expect(JSON.parse(stripJsonc(input))).toEqual({ x: 42 });
  });

  it("handles escaped quote inside string without breaking", () => {
    const input = '{"msg": "say \\"hello\\" // not a comment"}';
    expect(JSON.parse(stripJsonc(input))).toEqual({ msg: 'say "hello" // not a comment' });
  });
});

describe("merge", () => {
  it("returns base when over is null", () => {
    const base = { a: 1 };
    expect(merge(base, null)).toEqual(base);
  });

  it("returns base when over is a scalar (non-object)", () => {
    const base = { a: 1 };
    expect(merge(base, 42)).toEqual(base);
  });

  it("shallow scalar override", () => {
    const result = merge({ a: 1, b: 2 }, { a: 99 });
    expect(result).toEqual({ a: 99, b: 2 });
  });

  it("deep-merges nested objects", () => {
    const base = { a: { x: 1, y: 2 } };
    const over = { a: { x: 99 } };
    expect(merge(base, over)).toEqual({ a: { x: 99, y: 2 } });
  });

  it("type-mismatch guard: scalar over object keeps the default", () => {
    const base = { terminal: { fontSize: 14, fontFamily: "mono" } };
    const over = { terminal: "bad" };
    // over key is a scalar where base has an object — keep base.
    const result = merge(base, over);
    expect(result.terminal).toEqual(base.terminal);
  });

  it("type-mismatch guard: object over scalar keeps the default", () => {
    const base = { fontSize: 14 };
    const over = { fontSize: { nested: true } };
    const result = merge(base, over);
    expect(result.fontSize).toBe(14);
  });

  it("prototype-pollution: __proto__ key is dropped", () => {
    const base = { a: 1 };
    const evil = JSON.parse('{"__proto__":{"polluted":true},"a":2}');
    const result = merge(base, evil);
    expect(result.a).toBe(2);
    // The prototype of a plain object must not be polluted.
    expect(({} as any).polluted).toBeUndefined();
  });

  it("prototype-pollution: constructor key is not set as an own property", () => {
    const base = { a: 1 };
    const over = { constructor: { exploit: true }, a: 5 };
    const result = merge(base, over);
    expect(result.a).toBe(5);
    // The guard drops the key so it must not appear as an own property.
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
  });

  it("prototype-pollution: prototype key is not set as an own property", () => {
    const base = { a: 1 };
    const over = { prototype: { x: 1 }, a: 7 };
    const result = merge(base, over);
    expect(result.a).toBe(7);
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
  });

  it("merges partial config over DEFAULTS preserving unset keys", () => {
    const partial = { terminal: { fontSize: 18 } };
    const result = merge(DEFAULTS, partial);
    expect(result.terminal.fontSize).toBe(18);
    // All other terminal keys intact.
    expect(result.terminal.fontFamily).toBe(DEFAULTS.terminal.fontFamily);
    expect(result.terminal.scrollback).toBe(DEFAULTS.terminal.scrollback);
    expect(result.terminal.theme).toEqual(DEFAULTS.terminal.theme);
    // ui and keybindings untouched.
    expect(result.ui).toEqual(DEFAULTS.ui);
    expect(result.keybindings).toEqual(DEFAULTS.keybindings);
  });
});
