// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Layout } from "./layout";
import type { PaneLike, SurfaceSpec } from "./types";

let idSeq = 0;

function makePane(): PaneLike {
  const el = document.createElement("div");
  el.className = "pane";
  const id = ++idSeq;

  const pane: PaneLike = {
    paneId: id,
    kind: "terminal",
    el,
    keyHandler: null,
    mount() {},
    focus() { el.classList.add("focused"); },
    blur() { el.classList.remove("focused"); },
    refit() {},
    async dispose() {},
    serializeSurface(): SurfaceSpec { return { kind: "terminal" }; },
  };
  return pane;
}

function makeLayout(): { layout: Layout; container: HTMLElement; pane: PaneLike } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const pane = makePane();
  const layout = new Layout(container, pane);
  return { layout, container, pane };
}

describe("Layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("splitFocused", () => {
    it("adds a second pane", () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      expect(layout.panes()).toHaveLength(2);
    });

    it("sets focus on the new pane after split", () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      expect(layout.focusedPane).toBe(b);
    });

    it("splitting twice gives 3 panes", () => {
      const { layout } = makeLayout();
      layout.splitFocused(makePane());
      layout.splitFocused(makePane());
      expect(layout.panes()).toHaveLength(3);
    });

    it("respects an explicit direction", () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b, "col");
      // Just ensure it didn't throw and the pane is in the tree.
      expect(layout.panes()).toContain(b);
    });
  });

  describe("closePane", () => {
    it("closing the only pane is a no-op (at least 1 pane kept)", async () => {
      const { layout, pane } = makeLayout();
      await layout.closePane(pane);
      // The root is still the original pane because there is no sibling.
      expect(layout.panes()).toHaveLength(1);
    });

    it("closing one of two panes leaves one", async () => {
      const { layout, pane } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      await layout.closePane(b);
      expect(layout.panes()).toHaveLength(1);
      expect(layout.panes()[0]).toBe(pane);
    });

    it("focus moves to remaining pane after closing focused pane", async () => {
      const { layout, pane } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      // b is focused after split; close it.
      await layout.closePane(b);
      expect(layout.focusedPane).toBe(pane);
    });

    it("closing a non-focused pane does not steal focus", async () => {
      const { layout, pane } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      // Explicitly focus pane a, then close b (background close).
      layout.setFocus(pane);
      await layout.closePane(b);
      expect(layout.focusedPane).toBe(pane);
    });

    it("onPaneClosed fires with the closed pane id", async () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      const closed: number[] = [];
      layout.onPaneClosed = (id) => closed.push(id);
      await layout.closePane(b);
      expect(closed).toContain(b.paneId);
    });
  });

  describe("paneById", () => {
    it("finds a pane by id", () => {
      const { layout, pane } = makeLayout();
      expect(layout.paneById(pane.paneId)).toBe(pane);
    });

    it("returns null for an unknown id", () => {
      const { layout } = makeLayout();
      expect(layout.paneById(99999)).toBeNull();
    });

    it("finds the second pane after split", () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      expect(layout.paneById(b.paneId)).toBe(b);
    });
  });

  describe("serializeTree round-trip", () => {
    it("single pane serializes to a leaf", () => {
      const { layout } = makeLayout();
      const tree = layout.serializeTree();
      expect(tree.kind).toBe("leaf");
    });

    it("after split serializes to a split node", () => {
      const { layout } = makeLayout();
      layout.splitFocused(makePane());
      const tree = layout.serializeTree();
      expect(tree.kind).toBe("split");
    });

    it("split node contains ratio between 0 and 1", () => {
      const { layout } = makeLayout();
      layout.splitFocused(makePane());
      const tree = layout.serializeTree();
      if (tree.kind !== "split") throw new Error("expected split");
      expect(tree.ratio).toBeGreaterThan(0);
      expect(tree.ratio).toBeLessThan(1);
    });

    it("leaf surfaces contain the pane kind", () => {
      const { layout, pane } = makeLayout();
      const tree = layout.serializeTree();
      if (tree.kind !== "leaf") throw new Error("expected leaf");
      expect(tree.surfaces).toHaveLength(1);
      expect(tree.surfaces[0].kind).toBe(pane.kind);
    });

    it("serializeTree round-trips: can loadTree from its own output", async () => {
      const { layout } = makeLayout();
      layout.splitFocused(makePane());
      const tree = layout.serializeTree();
      // Rebuild from spec — makeLeaf creates a fresh stub for each leaf.
      await layout.loadTree(tree, (_surfaces, _active) => makePane());
      expect(layout.panes()).toHaveLength(2);
    });
  });

  describe("focusedPane self-heal", () => {
    it("returns a real leaf after focus drifts off-tree", async () => {
      const { layout } = makeLayout();
      const b = makePane();
      layout.splitFocused(b);
      // Remove b from the tree (simulate stale reference after close).
      await layout.closePane(b);
      // focusedPane should self-heal and point to a pane in the tree.
      const fp = layout.focusedPane;
      expect(layout.panes()).toContain(fp);
    });
  });

  describe("equalize", () => {
    it("sets all split ratios to 0.5", () => {
      const { layout } = makeLayout();
      layout.splitFocused(makePane());
      layout.equalize();
      const tree = layout.serializeTree();
      if (tree.kind !== "split") throw new Error("expected split");
      expect(tree.ratio).toBe(0.5);
    });
  });
});
