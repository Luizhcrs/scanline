/** Play exit animation on an overlay then hide it. */
export function closeOverlay(el: HTMLElement, onDone: () => void): void {
  el.classList.add("closing");
  const done = () => {
    el.classList.remove("closing");
    onDone();
  };
  el.addEventListener("animationend", done, { once: true });
  // Fallback if animation doesn't fire (e.g. prefers-reduced-motion)
  setTimeout(done, 300);
}
