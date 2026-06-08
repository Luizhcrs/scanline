import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { pushOverlay, popOverlay } from "./overlay";
import { t } from "./i18n";

/**
 * Notification store: the "an agent needs you" signal. A notification rings its
 * pane (blue ring) and lands in a panel. Rings clear when the pane is focused.
 * Producers: OSC 9 / OSC 777 / bell (from terminal panes) and the `notify` CLI.
 * When the window is not focused, also raises a native OS toast.
 */
export interface Notif {
  id: number;
  leafId: number;
  wsId: number;
  title: string;
  body: string;
  read: boolean;
  ts: number;
}

export class NotificationStore {
  private items: Notif[] = [];
  private nextId = 1;
  private panel: HTMLElement;
  private listEl: HTMLElement;
  private updateHeader?: () => void;

  constructor(
    private getPaneEl: (leafId: number) => HTMLElement | null,
    private focusPane: (leafId: number) => void,
  ) {
    this.panel = document.createElement("div");
    this.panel.className = "notif-panel";
    this.panel.style.display = "none";

    const header = document.createElement("div");
    header.className = "notif-panel-header";
    const title = document.createElement("span");
    title.textContent = t("notif.title");
    const clear = document.createElement("button");
    clear.className = "notif-clear";
    clear.textContent = t("notif.clearAll");
    clear.onclick = () => this.clearAll();
    header.append(title, clear);
    // Re-apply translated text when panel opens (locale may not be set at construction).
    this.updateHeader = () => {
      title.textContent = t("notif.title");
      clear.textContent = t("notif.clearAll");
    };

    this.listEl = document.createElement("div");
    this.listEl.className = "notif-list";
    this.panel.append(header, this.listEl);
    document.body.appendChild(this.panel);
  }

  /** Called by the app to refresh the sidebar when notifications change. */
  onChange?: () => void;

  /** Record a notification and ring its pane. */
  add(leafId: number, title: string, body: string, wsId = 0): void {
    this.items.unshift({
      id: this.nextId++,
      leafId,
      wsId,
      title,
      body,
      read: false,
      ts: Date.now(),
    });
    this.onChange?.();
    this.getPaneEl(leafId)?.classList.add("notif-ring");
    this.render();
    // Native toast only when the window isn't focused (don't nag the active user).
    if (!document.hasFocus()) {
      void this.toast(title || t("notif.pane")(leafId), body);
    }
  }

  private async toast(title: string, body: string): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } catch (e) {
      console.warn("toast:", e);
    }
  }

  /** Pane focused → clear its ring and mark its notifications read. */
  clearForPane(leafId: number): void {
    this.getPaneEl(leafId)?.classList.remove("notif-ring");
    let changed = false;
    for (const n of this.items) {
      if (n.leafId === leafId && !n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) {
      this.render();
      this.onChange?.();
    }
  }

  /** Drop all notifications for a pane that was closed (prevents stuck badges
   *  and unbounded growth). */
  removePane(leafId: number): void {
    const before = this.items.length;
    this.items = this.items.filter((n) => n.leafId !== leafId);
    if (this.items.length !== before) {
      this.render();
      this.onChange?.();
    }
  }

  clearAll(): void {
    for (const n of this.items) this.getPaneEl(n.leafId)?.classList.remove("notif-ring");
    this.items = [];
    this.render();
    this.onChange?.();
  }

  /** Snapshot for the notif.list CLI. */
  list(): Notif[] {
    return this.items.map((n) => ({ ...n }));
  }

  /** Unread notifications for a given workspace (sidebar badge). */
  unreadForWs(wsId: number): number {
    return this.items.filter((n) => n.wsId === wsId && !n.read).length;
  }

  /** Total unread across all workspaces (bell button badge). */
  totalUnread(): number {
    return this.items.filter((n) => !n.read).length;
  }

  togglePanel(): void {
    const showing = this.panel.style.display !== "none";
    if (showing) {
      // Hiding: pop before removing from DOM flow so browser webviews restore
      // only after the panel is gone (key "notif" is stable and idempotent).
      popOverlay("notif");
      this.panel.style.display = "none";
    } else {
      this.updateHeader?.();
      this.render();
      this.panel.style.display = "flex";
      pushOverlay("notif");
      // Close when clicking outside the panel. Guard: skip if the triggering
      // element is the bell button itself — the button's click handler calls
      // togglePanel() after this mousedown, which would re-open the panel.
      const bellBtn = document.getElementById("tb-notifications");
      const onOutside = (e: MouseEvent) => {
        const t = e.target as Node;
        if (this.panel.contains(t) || bellBtn?.contains(t)) return;
        document.removeEventListener("mousedown", onOutside, true);
        this.togglePanel();
      };
      setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
    }
  }

  /** Jump to the most recent unread notification's pane (Alt+Shift+U). */
  jumpLatestUnread(): void {
    const n = this.items.find((x) => !x.read);
    if (n) this.focusPane(n.leafId); // focus clears the ring via onFocusChange
  }

  private render(): void {
    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "notif-empty";
      empty.textContent = t("notif.empty");
      this.listEl.replaceChildren(empty);
      return;
    }
    this.listEl.replaceChildren(
      ...this.items.map((n) => {
        const row = document.createElement("div");
        row.className = "notif-row" + (n.read ? " read" : "");
        const label = n.title || t("notif.pane")(n.leafId);
        row.textContent = n.body ? `${label} — ${n.body}` : label;
        row.onclick = () => {
          this.focusPane(n.leafId);
          this.togglePanel();
        };
        return row;
      }),
    );
  }
}
