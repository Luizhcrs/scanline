/**
 * Feed: blocking approval cards. An agent hook (or `scanline ask`) makes a
 * blocking request; ask() shows a card with option buttons and resolves with
 * the clicked option — the caller (over the pipe) stays blocked until then.
 */
export interface FeedCard {
  title: string;
  body: string;
  options: string[];
}

export class FeedPanel {
  private panel: HTMLElement;
  private list: HTMLElement;
  private pending = 0;

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

  /** Show a card; resolves with the chosen option label. */
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
      options.forEach((opt, i) => {
        const b = document.createElement("button");
        b.className = "feed-btn" + (i === 0 ? " primary" : "");
        b.textContent = opt;
        b.onclick = () => {
          row.remove();
          this.pending--;
          if (this.pending <= 0) this.panel.style.display = "none";
          resolve(opt);
        };
        btns.append(b);
      });
      row.append(title, body, btns);
      this.list.appendChild(row);
      this.pending++;
      this.panel.style.display = "flex";
    });
  }
}
