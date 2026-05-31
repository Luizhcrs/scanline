import { type PaneLike, nextPaneId } from "./types";

/** Normalize user input into a URL (add scheme, or web-search bare terms). */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^[a-z]+:\/\//i.test(s)) return s;
  // Looks like a domain or localhost? add https/http.
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

/**
 * A browser pane: a URL bar plus an <iframe> rendering real web inside the
 * WebView2 window. Lives in a layout leaf like a terminal pane.
 *
 * Note: sites that send X-Frame-Options: DENY (e.g. google.com) refuse to load
 * in an iframe. Local dev servers, docs, and most content work. Native
 * embedded webviews are a future upgrade for the blocked cases.
 */
export class BrowserPane implements PaneLike {
  readonly paneId = nextPaneId();
  readonly el: HTMLElement;
  private iframe: HTMLIFrameElement;
  private urlInput: HTMLInputElement;

  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;

  constructor(initialUrl = "https://duckduckgo.com") {
    this.el = document.createElement("div");
    this.el.className = "pane browser";
    this.el.tabIndex = -1;

    const bar = document.createElement("div");
    bar.className = "browser-bar";

    const back = document.createElement("button");
    back.textContent = "‹";
    back.title = "Back";
    back.onclick = () => this.iframe.contentWindow?.history.back();

    const fwd = document.createElement("button");
    fwd.textContent = "›";
    fwd.title = "Forward";
    fwd.onclick = () => this.iframe.contentWindow?.history.forward();

    const reload = document.createElement("button");
    reload.textContent = "⟳";
    reload.title = "Reload";
    reload.onclick = () => this.navigate(this.urlInput.value);

    this.urlInput = document.createElement("input");
    this.urlInput.className = "browser-url";
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = "Enter URL or search…";
    this.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.navigate(this.urlInput.value);
      }
    });

    bar.append(back, fwd, reload, this.urlInput);

    this.iframe = document.createElement("iframe");
    this.iframe.className = "browser-frame";
    this.iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups",
    );

    this.el.append(bar, this.iframe);

    // App shortcuts: the browser pane isn't an xterm, so we capture keys here.
    this.el.addEventListener("keydown", (e) => {
      if (this.keyHandler && this.keyHandler(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.el.addEventListener("mousedown", () => this.onFocusRequest?.(this));

    this.navigate(initialUrl);
  }

  navigate(input: string): void {
    const url = toUrl(input);
    this.urlInput.value = url;
    this.iframe.src = url;
  }

  focus(): void {
    this.el.classList.add("focused");
    // Focus the URL bar so shortcuts work without clicking into the page.
    this.urlInput.focus();
    this.urlInput.select();
  }

  blur(): void {
    this.el.classList.remove("focused");
  }

  refit(): void {
    /* iframe fills its container via CSS; nothing to do */
  }

  async dispose(): Promise<void> {
    this.iframe.src = "about:blank";
    this.el.remove();
  }
}
