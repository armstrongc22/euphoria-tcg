/**
 * @vitest-environment jsdom
 *
 * Signup screen behavior: renders the form + local-preview note, blocks invalid
 * emails without advancing or persisting, and on a valid email persists state
 * and calls onContinue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSignup, type KeyValueStore } from "../src/signup";
import { mountSignup } from "../src/signup-view";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function submit(container: HTMLElement, email: string): void {
  const input = container.querySelector<HTMLInputElement>("#signup-email")!;
  input.value = email;
  const form = container.querySelector<HTMLFormElement>(".signup__form")!;
  form.requestSubmit();
}

describe("mountSignup", () => {
  let container: HTMLElement;
  let store: KeyValueStore;
  beforeEach(() => {
    container = document.createElement("div");
    store = memoryStore();
  });

  it("renders an email field and the local-preview note", () => {
    mountSignup(container, { store, onContinue: () => {} });
    expect(container.querySelector("#signup-email")).not.toBeNull();
    const note = container.querySelector(".signup__note")?.textContent ?? "";
    expect(note.toLowerCase()).toContain("local preview");
  });

  it("blocks an invalid email: no onContinue, nothing stored, shows an error", () => {
    const onContinue = vi.fn();
    mountSignup(container, { store, onContinue });

    submit(container, "not-an-email");

    expect(onContinue).not.toHaveBeenCalled();
    expect(loadSignup(store)).toBeNull();
    const error = container.querySelector<HTMLElement>(".signup__error")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBeTruthy();
  });

  it("accepts a valid email: persists it and advances", () => {
    const onContinue = vi.fn();
    mountSignup(container, { store, onContinue });

    submit(container, "player@example.com");

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(loadSignup(store)?.email).toBe("player@example.com");
  });

  it("greets a returning signed-up visitor", () => {
    mountSignup(container, { store, onContinue: () => {} });
    submit(container, "player@example.com");

    const again = document.createElement("div");
    mountSignup(again, { store, onContinue: () => {} });
    expect(again.querySelector(".signup__welcome")?.textContent).toContain(
      "player@example.com",
    );
  });

  it("works without a store (degrades to a stateless flow)", () => {
    const onContinue = vi.fn();
    mountSignup(container, { store: null, onContinue });
    submit(container, "player@example.com");
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
