import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "./i18n";

/**
 * On-launch update check. Uses the Tauri updater (ed25519-signed artifacts on
 * GitHub Releases — independent of OS code signing). Silent if offline or no
 * release is published; otherwise offers a minimal styled prompt. The app keeps
 * running normally either way — the check never blocks startup.
 */
export async function checkForUpdateOnLaunch(): Promise<void> {
  let update: Update | null = null;
  try {
    update = await check();
  } catch {
    return; // offline / no endpoint / no release yet — never bother the user
  }
  if (!update) return;
  showPrompt(update);
}

function showPrompt(update: Update): void {
  const scrim = document.createElement("div");
  scrim.className = "updater-scrim";
  const card = document.createElement("div");
  card.className = "updater-card";

  const title = document.createElement("div");
  title.className = "updater-title";
  title.textContent = t("updater.available")(update.version);

  const note = document.createElement("div");
  note.className = "updater-note";
  note.textContent = (update.body ?? "").trim() || t("updater.defaultNote");

  const status = document.createElement("div");
  status.className = "updater-status";

  const row = document.createElement("div");
  row.className = "updater-actions";
  const later = document.createElement("button");
  later.className = "updater-btn";
  later.textContent = t("updater.later");
  const now = document.createElement("button");
  now.className = "updater-btn primary";
  now.textContent = t("updater.now");

  const close = () => scrim.remove();
  later.onclick = close;
  now.onclick = async () => {
    now.disabled = true;
    later.disabled = true;
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          status.textContent = t("updater.downloading");
        } else if (e.event === "Progress") {
          got += e.data.chunkLength;
          status.textContent = total
            ? t("updater.progressPct")(Math.round((got / total) * 100))
            : t("updater.progressMb")((got / 1048576).toFixed(1));
        } else if (e.event === "Finished") {
          status.textContent = t("updater.installing");
        }
      });
      status.textContent = t("updater.restarting");
      await relaunch();
    } catch (err) {
      status.textContent = t("updater.failed")(String(err));
      now.disabled = false;
      later.disabled = false;
    }
  };

  row.append(later, now);
  card.append(title, note, status, row);
  scrim.append(card);
  document.body.append(scrim);
}
