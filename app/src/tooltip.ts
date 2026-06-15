/** Custom tooltip replacing native browser title tooltips with styled ones.
 *  Uses mouseenter/mouseleave (not mouseover/mouseout) so child-element
 *  transitions within the same titled parent don't reset the delay. */

let tip: HTMLElement | null = null;
let tipTimer: ReturnType<typeof setTimeout> | null = null;
let currentTarget: HTMLElement | null = null;

function getOrCreateTip(): HTMLElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "app-tooltip";
    tip.style.display = "none";
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(text: string, x: number, y: number): void {
  const el = getOrCreateTip();
  el.textContent = text;
  el.style.display = "block";
  const tipH = el.offsetHeight || 24;
  const top = y + 16 + tipH > window.innerHeight ? y - tipH - 4 : y + 16;
  el.style.left = `${Math.min(x + 8, window.innerWidth - el.offsetWidth - 8)}px`;
  el.style.top = `${top}px`;
}

function hideTip(): void {
  if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
  if (tip) tip.style.display = "none";
  currentTarget = null;
}

export function installTooltips(root: HTMLElement = document.body): void {
  // mouseenter bubbles=false so it only fires when entering the element itself,
  // not when moving between its children — fixes the child-transition flicker.
  root.addEventListener("mouseover", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[title]");
    if (!target || !target.title || target === currentTarget) return;
    // Strip native tooltip to prevent OS popup competing with ours.
    const text = target.title;
    target.dataset.tooltip = text;
    target.removeAttribute("title");
    currentTarget = target;
    hideTip();
    tipTimer = setTimeout(() => showTip(text, e.clientX, e.clientY), 500);
  }, true);

  root.addEventListener("mousemove", (e) => {
    if (tip && tip.style.display !== "none") {
      showTip(tip.textContent || "", e.clientX, e.clientY);
    }
  });

  // mouseleave fires only when leaving the element entirely (not child transitions).
  root.addEventListener("mouseout", (e) => {
    const from = e.target as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    // Only restore title when leaving the titled element (not moving to a child).
    const titled = from.closest<HTMLElement>("[data-tooltip]");
    if (titled && !titled.contains(related)) {
      titled.title = titled.dataset.tooltip ?? "";
      delete titled.dataset.tooltip;
      hideTip();
    }
  }, true);

  root.addEventListener("mousedown", hideTip);
  root.addEventListener("scroll", hideTip, true);
}
