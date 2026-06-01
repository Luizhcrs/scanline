// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { keyToBytes } from "./main";

describe("keyToBytes", () => {
  describe("named keys", () => {
    it("enter -> \\r", () => expect(keyToBytes("enter")).toBe("\r"));
    it("tab -> \\t", () => expect(keyToBytes("tab")).toBe("\t"));
    it("escape -> ESC byte", () => expect(keyToBytes("escape")).toBe("\x1b"));
    it("esc alias -> ESC byte", () => expect(keyToBytes("esc")).toBe("\x1b"));
    it("space -> space", () => expect(keyToBytes("space")).toBe(" "));
    it("backspace -> DEL byte", () => expect(keyToBytes("backspace")).toBe("\x7f"));
    it("up -> CSI A", () => expect(keyToBytes("up")).toBe("\x1b[A"));
    it("down -> CSI B", () => expect(keyToBytes("down")).toBe("\x1b[B"));
    it("right -> CSI C", () => expect(keyToBytes("right")).toBe("\x1b[C"));
    it("left -> CSI D", () => expect(keyToBytes("left")).toBe("\x1b[D"));
    it("delete -> CSI 3~", () => expect(keyToBytes("delete")).toBe("\x1b[3~"));
  });

  describe("F-keys", () => {
    it("f1 -> SS3 OP", () => expect(keyToBytes("f1")).toBe("\x1bOP"));
    it("f2 -> SS3 OQ", () => expect(keyToBytes("f2")).toBe("\x1bOQ"));
    it("f3 -> SS3 OR", () => expect(keyToBytes("f3")).toBe("\x1bOR"));
    it("f4 -> SS3 OS", () => expect(keyToBytes("f4")).toBe("\x1bOS"));
    it("f5 -> CSI 15~", () => expect(keyToBytes("f5")).toBe("\x1b[15~"));
    it("f6 -> CSI 17~", () => expect(keyToBytes("f6")).toBe("\x1b[17~"));
    it("f12 -> CSI 24~", () => expect(keyToBytes("f12")).toBe("\x1b[24~"));
  });

  describe("shift-tab", () => {
    it("s-tab -> CSI Z", () => expect(keyToBytes("s-tab")).toBe("\x1b[Z"));
    it("btab -> CSI Z", () => expect(keyToBytes("btab")).toBe("\x1b[Z"));
  });

  describe("ctrl chords", () => {
    it("c-a -> 0x01", () => expect(keyToBytes("c-a")).toBe("\x01"));
    it("c-c -> 0x03 (SIGINT)", () => expect(keyToBytes("c-c")).toBe("\x03"));
    it("c-z -> 0x1a", () => expect(keyToBytes("c-z")).toBe("\x1a"));
    it("ctrl-a -> 0x01 (ctrl- prefix variant)", () => expect(keyToBytes("ctrl-a")).toBe("\x01"));
    it("ctrl-c -> 0x03 (ctrl- prefix variant)", () => expect(keyToBytes("ctrl-c")).toBe("\x03"));
  });

  describe("alt/meta chords", () => {
    it("m-x -> ESC + x", () => expect(keyToBytes("m-x")).toBe("\x1bx"));
    it("alt-x -> ESC + x", () => expect(keyToBytes("alt-x")).toBe("\x1bx"));
    it("meta-x -> ESC + x", () => expect(keyToBytes("meta-x")).toBe("\x1bx"));
    it("M-enter -> ESC + \\r (recursive)", () => expect(keyToBytes("m-enter")).toBe("\x1b\r"));
  });

  describe("case-insensitivity", () => {
    it("ENTER resolves same as enter", () => expect(keyToBytes("ENTER")).toBe("\r"));
    it("Tab resolves same as tab", () => expect(keyToBytes("Tab")).toBe("\t"));
    it("C-C same as c-c", () => expect(keyToBytes("C-C")).toBe("\x03"));
    it("F1 same as f1", () => expect(keyToBytes("F1")).toBe("\x1bOP"));
  });

  describe("unknown key passthrough", () => {
    it("a single unknown char passes through", () => expect(keyToBytes("a")).toBe("a"));
    it("Z passes through", () => expect(keyToBytes("Z")).toBe("Z"));
    it("an unrecognised name passes through as-is", () => expect(keyToBytes("unknownkey")).toBe("unknownkey"));
  });
});
