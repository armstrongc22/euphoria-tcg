/**
 * @vitest-environment jsdom
 *
 * Game-client shell integration: boots the real app (main.ts) and verifies the
 * SINGLE-active-screen architecture. The key invariant: exactly one screen is
 * mounted at a time — navigating unmounts the previous screen from the DOM
 * (nothing stacks, nothing is pre-rendered). Also covers the login gate and the
 * hidden debug reveal. No Supabase env is set, so the localStorage demo auth
 * backend is used (signUp/signIn resolve to a session immediately).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  sessionStorage.clear();
  vi.resetModules();
  await import("../src/main");
  await flush();
}

function q<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}
function el<T extends HTMLElement>(sel: string): T {
  const found = q<T>(sel);
  if (found === null) throw new Error(`element "${sel}" not found`);
  return found;
}
function screenName(): string {
  return el(".gc").dataset["screen"] ?? "";
}

async function authenticate(): Promise<void> {
  el<HTMLInputElement>("#gate-email").value = "tester@example.com";
  el<HTMLInputElement>("#gate-password").value = "password1";
  el<HTMLButtonElement>("#gate-create").click();
  await flush();
}

function enter(): void {
  el<HTMLButtonElement>("#gc-enter").click();
}

describe("login gate", () => {
  beforeEach(async () => {
    await boot();
  });

  it("resolves the check to the Auth Gate (not a stuck spinner)", () => {
    expect(screenName()).toBe("auth");
    expect(q(".gc-gate__spinner")).toBeNull(); // no longer 'Verifying access…'
    expect(q("#gate-email")).not.toBeNull();
    // No beta screens are mounted while logged out.
    expect(q(".gc-menu")).toBeNull();
    expect(q(".gc-splash")).toBeNull();
    expect(q("#grid")).toBeNull();
  });

  it("shows only the splash after authenticating", async () => {
    await authenticate();
    expect(screenName()).toBe("splash");
    expect(q(".gc-splash")).not.toBeNull();
    expect(q("#gate-email")).toBeNull(); // gate unmounted
    expect(q(".gc-menu")).toBeNull(); // menu not pre-rendered
  });

  it("rejects an invalid email without leaving the gate", async () => {
    el<HTMLInputElement>("#gate-email").value = "nope";
    el<HTMLInputElement>("#gate-password").value = "password1";
    el<HTMLButtonElement>("#gate-signin").click();
    await flush();
    expect(screenName()).toBe("auth");
    expect(el(".gc-gate__error").hidden).toBe(false);
  });
});

describe("single active screen", () => {
  beforeEach(async () => {
    await boot();
    await authenticate();
    enter();
  });

  it("enters the main menu with only the menu mounted", () => {
    expect(screenName()).toBe("menu");
    expect(document.querySelectorAll(".gc-menu").length).toBe(1);
    expect(q(".gc-splash")).toBeNull();
    expect(q("#gate-email")).toBeNull();

    const labels = Array.from(document.querySelectorAll(".gc-action__label")).map(
      (n) => n.textContent,
    );
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

    // Mobile rehab: the beta always offers a way back OUT to the public site.
    const links = Array.from(document.querySelectorAll(".gc-link")).map(
      (n) => n.textContent,
    );
    expect(links).toContain("← Exit to Site");
  });

  it("replaces the menu with Collection (menu removed from DOM)", () => {
    el<HTMLButtonElement>('[data-go="viewer"]').click();
    expect(screenName()).toBe("collection");
    expect(q("#grid")).not.toBeNull(); // card viewer mounted
    expect(q(".gc-menu")).toBeNull(); // menu unmounted, not stacked
  });

  it("replaces the menu with Settings incl. the OST placeholder", () => {
    el<HTMLButtonElement>('[data-go="settings"]').click();
    expect(screenName()).toBe("settings");
    expect(el(".gc-settings").textContent).toContain("Soundtrack coming soon");
    expect(q(".gc-menu")).toBeNull();
  });

  it("replaces the menu with the Rules screen", () => {
    el<HTMLButtonElement>('[data-go="rules"]').click();
    expect(el("#game-screen-root").textContent).toContain("30-card deck");
    expect(q(".gc-menu")).toBeNull();
  });

  it("routes Start Match to faction select when no deck is chosen", () => {
    el<HTMLButtonElement>('[data-go="play"]').click();
    // Demo profile has no faction, so Start Match sends the player to pick one —
    // and the menu is unmounted (single screen).
    expect(screenName()).toBe("starter");
    expect(q(".gc-menu")).toBeNull();
  });

  it("unmounts the menu when opening Rewards (account hub)", () => {
    el<HTMLButtonElement>('[data-go="rewards"]').click();
    expect(screenName()).toBe("rewards");
    expect(q(".gc-menu")).toBeNull();
  });

  it("returns to the menu via the HUD Menu button, unmounting the prior screen", () => {
    el<HTMLButtonElement>('[data-go="viewer"]').click();
    expect(q("#grid")).not.toBeNull();
    el<HTMLButtonElement>("#gc-menu-btn").click();
    expect(screenName()).toBe("menu");
    expect(q(".gc-menu")).not.toBeNull();
    expect(q("#grid")).toBeNull(); // collection unmounted
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
    expect(q("#debug-toggle")).toBeNull();
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

  it("reflects an already-enabled flag on boot (stamp lit)", async () => {
    localStorage.setItem("euphoriaDebug", "1");
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import("../src/main");
    await flush();
    expect(
      el<HTMLButtonElement>("#build-stamp").classList.contains(
        "site-footer__stamp--debug",
      ),
    ).toBe(true);
  });
});
