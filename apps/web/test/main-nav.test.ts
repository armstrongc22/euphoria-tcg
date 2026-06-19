/**
 * @vitest-environment jsdom
 *
 * Top-nav integration: boots the real app (main.ts) into a jsdom document and
 * verifies the Rules and Lore tabs appear alongside the existing sections, switch
 * correctly, and that existing navigation still works. No Supabase env is set, so
 * the app falls back to the localStorage demo backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mounts a fresh #app and (re-)imports main.ts so its boot runs against it. */
async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  vi.resetModules();
  await import("../src/main");
  // Let the async boot (signup/starter mounts) settle; nav itself is synchronous.
  await Promise.resolve();
  await Promise.resolve();
}

function tab(view: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(
    `.site-nav__tab[data-view="${view}"]`,
  );
  if (el === null) throw new Error(`nav tab "${view}" not found`);
  return el;
}

function view(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`#view-${id}`);
  if (el === null) throw new Error(`view "${id}" not found`);
  return el;
}

describe("site navigation", () => {
  beforeEach(async () => {
    await boot();
  });

  it("adds Rules and Lore tabs alongside the existing sections", () => {
    const labels = Array.from(
      document.querySelectorAll(".site-nav__tab"),
    ).map((t) => t.textContent);
    // New sections.
    expect(labels).toContain("Rules");
    expect(labels).toContain("Lore");
    // Existing sections are untouched.
    expect(labels).toEqual(
      expect.arrayContaining([
        "Signup / Start",
        "Starter Decks",
        "Deck Builder",
        "Account",
        "Card Viewer",
      ]),
    );
  });

  it("shows the Rules page (with verified rules) when its tab is clicked", () => {
    tab("rules").click();
    expect(view("rules").hidden).toBe(false);
    expect(view("rules").textContent).toContain("30-card deck");
    // Other views are hidden.
    expect(view("lore").hidden).toBe(true);
    expect(view("viewer").hidden).toBe(true);
  });

  it("shows the Lore page (with the world's races) when its tab is clicked", () => {
    tab("lore").click();
    expect(view("lore").hidden).toBe(false);
    expect(view("lore").textContent).toContain("Surfers");
    expect(view("rules").hidden).toBe(true);
  });

  it("keeps existing navigation working (Card Viewer still switches in)", () => {
    tab("rules").click();
    expect(view("viewer").hidden).toBe(true);
    tab("viewer").click();
    expect(view("viewer").hidden).toBe(false);
    expect(view("rules").hidden).toBe(true);
  });
});
