import { getLang } from "./i18n";
import { config, saveConfig } from "./config";
import { pushOverlay, popOverlay } from "./overlay";

const LS_KEY = "scanline.onboardingSeen";

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(LS_KEY) === "1";
}

function markSeen(): void {
  localStorage.setItem(LS_KEY, "1");
}

export function resetOnboarding(): void {
  localStorage.removeItem(LS_KEY);
}

const isMac = (window as any).scanline?.getPlatform() === "darwin";
const mod = isMac ? "Cmd" : "Ctrl";
const alt = isMac ? "Opt" : "Alt";

interface Slide {
  title: string;
  subtitle: string;
  body: () => HTMLElement;
}

function kbdTable(rows: [string, string][]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ob-shortcuts";
  for (const [key, desc] of rows) {
    const row = document.createElement("div");
    row.className = "ob-shortcut-row";
    const kbd = document.createElement("kbd");
    kbd.className = "ob-kbd";
    kbd.textContent = key;
    const label = document.createElement("span");
    label.className = "ob-shortcut-desc";
    label.textContent = desc;
    row.append(kbd, label);
    wrap.append(row);
  }
  return wrap;
}

function buildSlides(pt: boolean): Slide[] {
  return [
    {
      title: pt ? "Bem-vindo ao Scanline" : "Welcome to Scanline",
      subtitle: pt
        ? "Multiplexador de terminal + navegador scriptável para agentes de IA."
        : "Terminal multiplexer + scriptable browser for AI agents.",
      body: () => {
        const wrap = document.createElement("div");
        wrap.className = "ob-logo-wrap";
        const img = document.createElement("img");
        img.src = "./logo-128.png";
        img.alt = "Scanline";
        img.className = "ob-logo";
        wrap.append(img);
        return wrap;
      },
    },
    {
      title: pt ? "Workspaces e Painéis" : "Workspaces & Panes",
      subtitle: pt
        ? "Organize o trabalho em áreas independentes. Divida painéis em qualquer direção."
        : "Organize work into independent areas. Split panes in any direction.",
      body: () =>
        kbdTable(
          pt
            ? [
                [`${mod}+N`,        "Novo workspace"],
                [`${alt}+Shift+→`,  "Dividir à direita"],
                [`${alt}+Shift+↓`,  "Dividir abaixo"],
                [`${mod}+Shift+W`,  "Fechar painel"],
                [`${alt}+Shift+Z`,  "Zoom no painel"],
              ]
            : [
                [`${mod}+N`,        "New workspace"],
                [`${alt}+Shift+→`,  "Split right"],
                [`${alt}+Shift+↓`,  "Split down"],
                [`${mod}+Shift+W`,  "Close pane"],
                [`${alt}+Shift+Z`,  "Zoom pane"],
              ]
        ),
    },
    {
      title: pt ? "Navegador Embutido" : "Built-in Browser",
      subtitle: pt
        ? "Painel de navegador sem restrições de iframe. Ideal para automação com agentes."
        : "Browser pane without iframe restrictions. Built for AI agent automation.",
      body: () =>
        kbdTable(
          pt
            ? [
                [`${alt}+Shift+B`, "Abrir painel de navegador"],
                ["↗  (barra de URL)", "Abrir no navegador padrão"],
                ["F12", "Abrir DevTools"],
              ]
            : [
                [`${alt}+Shift+B`, "Open browser pane"],
                ["↗  (URL bar)", "Open in default browser"],
                ["F12", "Open DevTools"],
              ]
        ),
    },
    {
      title: pt ? "Pronto!" : "All Set!",
      subtitle: pt
        ? `Pressione ${mod}+/ para ver todos os atalhos. Configurações em ${mod}+,`
        : `Press ${mod}+/ for all shortcuts. Settings at ${mod}+,`,
      body: () => {
        const wrap = document.createElement("div");
        wrap.className = "ob-ready-wrap";
        const lines: [string, string][] = pt
          ? [
              [`${mod}/`,       "Todos os atalhos"],
              [`${mod}+,`,      "Configurações"],
              [`${mod}+Shift+P`, "Paleta de comandos"],
            ]
          : [
              [`${mod}/`,       "All shortcuts"],
              [`${mod}+,`,      "Settings"],
              [`${mod}+Shift+P`, "Command palette"],
            ];
        wrap.append(kbdTable(lines));
        return wrap;
      },
    },
  ];
}

export function showOnboarding(onDone?: () => void): void {
  pushOverlay("onboarding");
  const pt = getLang() === "pt";
  const slides = buildSlides(pt);
  let current = 0;

  const overlay = document.createElement("div");
  overlay.className = "ob-overlay";

  const card = document.createElement("div");
  card.className = "ob-card";

  // Skip button (absolute top-right)
  const skipBtn = document.createElement("button");
  skipBtn.className = "ob-skip";
  skipBtn.textContent = pt ? "Pular" : "Skip";

  // Static header: title + subtitle (outside animated area)
  const header = document.createElement("div");
  header.className = "ob-header";

  const titleEl = document.createElement("h2");
  titleEl.className = "ob-title";

  const subtitleEl = document.createElement("p");
  subtitleEl.className = "ob-subtitle";

  header.append(titleEl, subtitleEl);

  // Animated body area
  const slideWrap = document.createElement("div");
  slideWrap.className = "ob-slide-wrap";

  // Footer: dots + nav
  const footer = document.createElement("div");
  footer.className = "ob-footer";

  const dotsWrap = document.createElement("div");
  dotsWrap.className = "ob-dots";

  const nav = document.createElement("div");
  nav.className = "ob-nav";

  const prevBtn = document.createElement("button");
  prevBtn.className = "ob-btn ob-btn-ghost";
  prevBtn.textContent = pt ? "Anterior" : "Previous";

  const nextBtn = document.createElement("button");
  nextBtn.className = "ob-btn ob-btn-primary";

  nav.append(prevBtn, nextBtn);
  footer.append(dotsWrap, nav);

  card.append(skipBtn, header, slideWrap, footer);
  overlay.append(card);
  document.body.append(overlay);

  const dotEls: HTMLElement[] = slides.map((_) => {
    const d = document.createElement("span");
    d.className = "ob-dot";
    dotsWrap.append(d);
    return d;
  });

  function renderSlide(idx: number, dir: "next" | "prev" | "init" = "init"): void {
    const s = slides[idx];

    // Update static header
    titleEl.textContent = s.title;
    subtitleEl.textContent = s.subtitle;

    // Animate body
    const incoming = document.createElement("div");
    incoming.className = "ob-slide";
    incoming.append(s.body());

    if (dir !== "init") {
      incoming.style.transform = dir === "next" ? "translateX(40px)" : "translateX(-40px)";
      incoming.style.opacity = "0";
    }

    slideWrap.innerHTML = "";
    slideWrap.append(incoming);

    if (dir !== "init") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          incoming.style.transition = "transform 0.22s ease, opacity 0.22s ease";
          incoming.style.transform = "translateX(0)";
          incoming.style.opacity = "1";
        });
      });
    }

    dotEls.forEach((d, i) => d.classList.toggle("ob-dot-active", i === idx));
    prevBtn.style.display = idx === 0 ? "none" : "";
    const isLast = idx === slides.length - 1;
    nextBtn.textContent = isLast
      ? (pt ? "Começar" : "Get Started")
      : (pt ? "Próximo" : "Next");
  }

  function dismiss(): void {
    popOverlay("onboarding");
    markSeen();
    saveConfig(config()); // persist default config so loadConfig() won't clear the flag on next launch
    card.style.transition = "transform 0.2s ease, opacity 0.2s ease";
    overlay.style.transition = "opacity 0.2s ease";
    card.style.transform = "scale(0.96)";
    card.style.opacity = "0";
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
      onDone?.();
    }, 200);
  }

  skipBtn.addEventListener("click", () => dismiss());
  prevBtn.addEventListener("click", () => {
    if (current > 0) renderSlide(--current, "prev");
  });
  nextBtn.addEventListener("click", () => {
    if (current < slides.length - 1) {
      renderSlide(++current, "next");
    } else {
      dismiss();
    }
  });

  renderSlide(0, "init");

  // Animate card in
  card.style.transform = "scale(0.94)";
  card.style.opacity = "0";
  overlay.style.opacity = "0";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = "opacity 0.2s ease";
      card.style.transition = "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease";
      overlay.style.opacity = "1";
      card.style.transform = "scale(1)";
      card.style.opacity = "1";
    });
  });
}
