/**
 * @vitest-environment jsdom
 *
 * Game-client shell integration: boots the real app (main.ts) into a jsdom
 * document and verifies the splash → menu → internal-screen navigation, plus the
 * hidden debug reveal. No Supabase env is set, so the app falls back to the
 * localStorage demo backend. The individual views (rules, lore, viewer, account,
 * etc.) have their own unit tests; here we only check the shell hosts and
 * switches between them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mounts a fresh #app and (re-)imports main.ts so its boot runs against it. */
async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  sessionStorage.clear();
  vi.resetModules();
  await import("../src/main");
  // Let the async boot (session restore + signup/starter mounts) settle.
  await Promise.resolve();
  await Promise.resolve();
}

function el<T extends HTMLElement>(sel: string): T {
  const found = document.querySelector<T>(sel);
  if (found === null) throw new Error(`element "${sel}" not found`);
  return found;
}

function view(id: string): HTMLElement {
  return el(`#view-${id}`);
}

/** Dismiss the splash and land on the main menu. */
function enter(): void {
  el<HTMLButtonElement>("#gc-enter").click();
}

describe("game-client shell", () => {
  beforeEach(async () => {
    await boot();
  });

  it("shows the splash first, hiding the shell until entered", () => {
    expect(el("#gc-splash")).toBeTruthy();
    expect(el("#gc-shell").hidden).toBe(true);
    expect(sessionStorage.getItem("euphoria_beta_entered")).toBeNull();
  });

  it("enters the main menu with the core action buttons", () => {
    enter();
    expect(el("#gc-shell").hidden).toBe(false);
    expect(el("#gc-menu").hidden).toBe(false);
    expect(sessionStorage.getItem("euphoria_beta_entered")).toBe("1");

    const labels = Array.from(
      document.querySelectorAll(".gc-action__label"),
    ).map((n) => n.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        "▶ Start Match",
        "Deck Editor",
        "Collection",
        "Rewards",
        "World Map",
        "Settings",
      ]),
    );
  });

  it("opens the Rules screen from the menu", () => {
    enter();
    el<HTMLButtonElement>('[data-go="rules"]').click();
    expect(view("rules").hidden).toBe(false);
    expect(view("rules").textContent).toContain("30-card deck");
    expect(view("lore").hidden).toBe(true);
    expect(el("#gc-menu").hidden).toBe(true);
  });

  it("opens the Lore screen from the menu", () => {
    enter();
    el<HTMLButtonElement>('[data-go="lore"]').click();
    expect(view("lore").hidden).toBe(false);
    expect(view("lore").textContent).toContain("Surfers");
    expect(view("rules").hidden).toBe(true);
  });

  it("opens the Collection (card viewer) from the menu", () => {
    enter();
    el<HTMLButtonElement>('[data-go="viewer"]').click();
    expect(view("viewer").hidden).toBe(false);
    expect(view("rules").hidden).toBe(true);
  });

  it("returns to the menu via the HUD Menu button", () => {
    enter();
    el<HTMLButtonElement>('[data-go="rules"]').click();
    expect(el("#gc-screen").hidden).toBe(false);
    el<HTMLButtonElement>("#gc-menu-btn").click();
    expect(el("#gc-menu").hidden).toBe(false);
    expect(el("#gc-screen").hidden).toBe(true);
  });
});

describe("hidden debug reveal (tap build stamp 5x)", () => {
  beforeEach(async () => {
    await boot();
  });

  function stamp(): HTMLButtonElement {
    return el<HTMLButtonElement>("#build-stamp");
  }

  function tap(node: HTMLButtonElement, n: number): void {
    for (let i = 0; i < n; i++) node.click();
  }

  it("shows the build stamp but no visible debug control by default", () => {
    expect(stamp().textContent).toContain("build");
    expect(document.querySelector("#debug-toggle")).toBeNull();
    expect(localStorage.getItem("euphoriaDebug")).toBeNull();
  });

  it("does NOT enable debug on fewer than 5 taps", () => {
    tap(stamp(), 4);
    expect(localStorage.getItem("euphoriaDebug")).toBeNull();
  });

  it("enables debug after exactly 5 quick taps on the build stamp", () => {
    const node = stamp();
    tap(node, 5);
    expect(localStorage.getItem("euphoriaDebug")).toBe("1");
    expect(node.getAttribute("aria-pressed")).toBe("true");
    expect(node.classList.contains("site-footer__stamp--debug")).toBe(true);
  });

  it("5 more taps toggles debug back off (reversible from the UI)", () => {
    const node = stamp();
    tap(node, 5);
    expect(localStorage.getItem("euphoriaDebug")).toBe("1");
    tap(node, 5);
    expect(localStorage.getItem("euphoriaDebug")).toBeNull();
    expect(node.getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects an already-enabled flag on boot (stamp lit)", async () => {
    localStorage.setItem("euphoriaDebug", "1");
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import("../src/main");
    await Promise.resolve();
    const node = el<HTMLButtonElement>("#build-stamp");
    expect(node.classList.contains("site-footer__stamp--debug")).toBe(true);
  });
});
