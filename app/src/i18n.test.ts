import { describe, it, expect, vi, beforeEach } from "vitest";
import { en, pt, mapLocale, resolveLocale, t, setLocale } from "./i18n";
import * as os from "@tauri-apps/plugin-os";

describe("dictionary parity", () => {
  it("pt has exactly the same keys as en", () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("mapLocale", () => {
  it("maps pt-BR and pt to pt", () => {
    expect(mapLocale("pt-BR")).toBe("pt");
    expect(mapLocale("pt")).toBe("pt");
  });
  it("maps en-US to en", () => {
    expect(mapLocale("en-US")).toBe("en");
  });
  it("falls back to en for null/unknown", () => {
    expect(mapLocale(null)).toBe("en");
    expect(mapLocale("de-DE")).toBe("en");
  });
});

describe("resolveLocale", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the explicit override without touching the OS", () => {
    const spy = vi.spyOn(os, "locale");
    return resolveLocale("pt").then((lang) => {
      expect(lang).toBe("pt");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("auto-detects from the OS locale", async () => {
    vi.spyOn(os, "locale").mockResolvedValue("pt-BR");
    expect(await resolveLocale("auto")).toBe("pt");
  });

  it("auto falls back to en when OS locale is null", async () => {
    vi.spyOn(os, "locale").mockResolvedValue(null);
    expect(await resolveLocale("auto")).toBe("en");
  });
});

describe("t / setLocale", () => {
  it("returns the active language string", () => {
    setLocale("en");
    expect(t("settings.save")).toBe("Save");
    setLocale("pt");
    expect(t("settings.save")).toBe("Salvar");
    setLocale("en");
  });

  it("supports interpolated function entries", () => {
    setLocale("en");
    const fn = t("updater.available");
    expect(fn("1.2.3")).toBe("Scanline 1.2.3 available");
  });
});
