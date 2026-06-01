/**
 * Feed: blocking approval cards. An agent hook (or `scanline ask`) makes a
 * blocking request; ask() shows a card with option buttons and resolves with
 * the clicked option — the caller (over the pipe) stays blocked until then.
 */
import { pushOverlay, popOverlay } from "./overlay";

export interface FeedCard {
  title: string;
  body: string;
  options: string[];
}

/** Match the Rust V2 reply deadline for feed.ask; auto-dismiss just after it
 *  so a card never lingers after the caller has already timed out. */
const FEED_TIMEOUT_MS = 605_000;

export class FeedPanel {
  private panel: HTMLElement;
  private list: HTMLElement;

  constructor() {
    this.panel = document.createElement("div");
    this.panel.className = "feed-panel";
    this.panel.style.display = "none";
    const header = document.createElement("div");
    header.className = "feed-header";
    header.textContent = "Agent requests";
    this.list = document.createElement("div");
    this.list.className = "feed-list";
    this.panel.append(header, this.list);
    document.body.appendChild(this.panel);
  }

  /** Show a card; resolves with the chosen option label, or "" if it
   *  auto-dismisses after FEED_TIMEOUT_MS (the caller has timed out by then). */
  ask(card: FeedCard): Promise<string> {
    const options = card.options.length ? card.options : ["Allow", "Deny"];
    return new Promise((resolve) => {
      const row = document.createElement("div");
      row.className = "feed-card";
      const title = document.createElement("div");
      title.className = "feed-card-title";
      title.textContent = card.title || "Agent request";
      const body = document.createElement("div");
      body.className = "feed-card-body";
      body.textContent = card.body;
      const btns = document.createElement("div");
      btns.className = "feed-card-btns";
      const settle = (decision: string) => {
        clearTimeout(timer);
        row.remove();
        // Panel hides once no cards remain — derived from the DOM, never a
        // separate counter that could desync.
        if (!this.list.childElementCount) {
          this.panel.style.display = "none";
          popOverlay();
        }
        resolve(decision);
      };
      const timer = setTimeout(() => settle(""), FEED_TIMEOUT_MS);
      options.forEach((opt, i) => {
        const b = document.createElement("button");
        b.className = "feed-btn" + (i === 0 ? " primary" : "");
        b.textContent = opt;
        b.onclick = () => settle(opt);
        btns.append(b);
      });
      row.append(title, body, btns);
      const wasEmpty = !this.list.childElementCount;
      this.list.appendChild(row);
      if (wasEmpty) pushOverlay();
      this.panel.style.display = "flex";
    });
  }
}
