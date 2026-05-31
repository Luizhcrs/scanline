/**
 * Command palette (fuzzy command/switcher overlay) and a find bar. DOM-only;
 * the app supplies the items / search handlers.
 */
export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Subsequence fuzzy score (null = no match); contiguous chars score higher. */
function fuzzyScore(q: string, s: string): number | null {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const sl = s.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let si = 0; si < sl.length && qi < ql.length; si++) {
    if (sl[si] === ql[qi]) {
      score += last === si - 1 ? 3 : 1;
      last = si;
      qi++;
    }
  }
  return qi === ql.length ? score : null;
}

export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private listEl: HTMLElement;
  private items: PaletteItem[] = [];
  private filtered: PaletteItem[] = [];
  private sel = 0;
  private restore: HTMLElement | null = null;
  private provider: ((q: string) => Promise<PaletteItem[]>) | null = null;
  private debounce?: ReturnType<typeof setTimeout>;
  private usage: Record<string, number> = JSON.parse(
    localStorage.getItem("scanline.cmdUsage") || "{}",
  );

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "palette-overlay";
    this.overlay.style.display = "none";
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.close();
    };

    const box = document.createElement("div");
    box.className = "palette-box";
    this.input = document.createElement("input");
    this.input.className = "palette-input";
    this.input.spellcheck = false;
    this.listEl = document.createElement("div");
    this.listEl.className = "palette-list";
    box.append(this.input, this.listEl);
    this.overlay.append(box);
    document.body.appendChild(this.overlay);

    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
  }

  open(items: PaletteItem[], placeholder = "Type a command…"): void {
    this.items = items;
    this.provider = null;
    this.restore = document.activeElement as HTMLElement;
    this.input.value = "";
    this.input.placeholder = placeholder;
    this.overlay.style.display = "flex";
    this.render();
    this.input.focus();
  }

  /** Live backend-driven results: each keystroke queries `provider`. */
  openAsync(
    provider: (q: string) => Promise<PaletteItem[]>,
    placeholder = "Search…",
  ): void {
    this.items = [];
    this.provider = provider;
    this.restore = document.activeElement as HTMLElement;
    this.input.value = "";
    this.input.placeholder = placeholder;
    this.overlay.style.display = "flex";
    this.filtered = [];
    this.renderRows();
    this.input.focus();
  }

  private onInput(): void {
    if (this.provider) {
      clearTimeout(this.debounce);
      const q = this.input.value.trim();
      this.debounce = setTimeout(async () => {
        this.filtered = await this.provider!(q);
        this.renderRows();
      }, 180);
    } else {
      this.render();
    }
  }

  close(): void {
    this.overlay.style.display = "none";
    this.restore?.focus();
  }

  private get isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  private render(): void {
    const q = this.input.value.trim();
    const boost = (it: PaletteItem) => this.usage[it.id] ?? 0;
    this.filtered = this.items
      .map((it) => ({ it, score: fuzzyScore(q, it.label + " " + (it.hint ?? "")) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => (b.score! + boost(b.it)) - (a.score! + boost(a.it)))
      .map((x) => x.it);
    this.renderRows();
  }

  private renderRows(): void {
    this.sel = 0;
    this.listEl.replaceChildren(
      ...this.filtered.map((it, i) => {
        const row = document.createElement("div");
        row.className = "palette-row" + (i === 0 ? " sel" : "");
        const lbl = document.createElement("span");
        lbl.textContent = it.label;
        row.append(lbl);
        if (it.hint) {
          const h = document.createElement("span");
          h.className = "palette-hint";
          h.textContent = it.hint;
          row.append(h);
        }
        row.onmouseenter = () => this.setSel(i);
        row.onclick = () => this.runSel();
        return row;
      }),
    );
  }

  private setSel(i: number): void {
    const rows = this.listEl.children;
    if (rows[this.sel]) rows[this.sel].classList.remove("sel");
    this.sel = Math.max(0, Math.min(i, this.filtered.length - 1));
    if (rows[this.sel]) {
      rows[this.sel].classList.add("sel");
      (rows[this.sel] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }

  private runSel(): void {
    const it = this.filtered[this.sel];
    if (it) {
      this.usage[it.id] = (this.usage[it.id] ?? 0) + 1;
      localStorage.setItem("scanline.cmdUsage", JSON.stringify(this.usage));
    }
    this.close();
    it?.run();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "n")) {
      e.preventDefault();
      this.setSel(this.sel + 1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
      e.preventDefault();
      this.setSel(this.sel - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.runSel();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  }
}

export interface FindHandlers {
  search: (q: string) => void;
  next: () => void;
  prev: () => void;
  closed: () => void;
}

export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private handlers?: FindHandlers;

  constructor() {
    this.bar = document.createElement("div");
    this.bar.className = "find-bar";
    this.bar.style.display = "none";
    this.input = document.createElement("input");
    this.input.className = "find-input";
    this.input.placeholder = "Find…";
    this.input.spellcheck = false;
    const prev = this.btn("‹", () => this.handlers?.prev());
    const next = this.btn("›", () => this.handlers?.next());
    const close = this.btn("✕", () => this.close());
    this.bar.append(this.input, prev, next, close);
    document.body.appendChild(this.bar);

    this.input.addEventListener("input", () => this.handlers?.search(this.input.value));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.shiftKey ? this.handlers?.prev() : this.handlers?.next();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  private btn(label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "find-btn";
    b.textContent = label;
    b.onclick = fn;
    return b;
  }

  open(handlers: FindHandlers): void {
    this.handlers = handlers;
    this.bar.style.display = "flex";
    this.input.value = "";
    this.input.focus();
  }

  close(): void {
    this.bar.style.display = "none";
    this.handlers?.closed();
    this.handlers = undefined;
  }
}
