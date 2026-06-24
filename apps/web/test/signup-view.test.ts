/**
 * @vitest-environment jsdom
 *
 * Signup screen behavior against the localStorage demo backend: renders the
 * email + password form, blocks an invalid email or too-short password without
 * authenticating, and on valid input authenticates and calls onContinue. A
 * returning signed-in visitor gets the "Continue" shortcut.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountSignup } from "../src/signup-view";
import { createLocalAuth } from "../src/auth";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function fill(container: HTMLElement, email: string, password: string): void {
  container.querySelector<HTMLInputElement>("#signup-email")!.value = email;
  container.querySelector<HTMLInputElement>("#signup-password")!.value = password;
}

function submit(container: HTMLElement): void {
  container.querySelector<HTMLFormElement>(".signup__form")!.requestSubmit();
}

/** Lets queued microtasks (the async signUpOrSignIn chain) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("mountSignup", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
  });

  it("renders email + password fields and the helper note", async () => {
    await mountSignup(container, {
      auth: createLocalAuth(memoryStore()),
      onContinue: () => {},
    });
    expect(container.querySelector("#signup-email")).not.toBeNull();
    expect(container.querySelector("#signup-password")).not.toBeNull();
    expect(container.querySelector(".signup__note")?.textContent).toBeTruthy();
  });

  it("blocks an invalid email: no onContinue, shows an error", async () => {
    const onContinue = vi.fn();
    await mountSignup(container, { auth: createLocalAuth(memoryStore()), onContinue });

    fill(container, "not-an-email", "supersecret");
    submit(container);
    await flush();

    expect(onContinue).not.toHaveBeenCalled();
    const error = container.querySelector<HTMLElement>(".signup__error")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBeTruthy();
  });

  it("blocks a too-short password", async () => {
    const onContinue = vi.fn();
    await mountSignup(container, { auth: createLocalAuth(memoryStore()), onContinue });

    fill(container, "player@example.com", "123");
    submit(container);
    await flush();

    expect(onContinue).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>(".signup__error")!.hidden).toBe(false);
  });

  it("accepts valid input: authenticates and advances with a session", async () => {
    const store = memoryStore();
    const onContinue = vi.fn();
    await mountSignup(container, { auth: createLocalAuth(store), onContinue });

    fill(container, "player@example.com", "supersecret");
    submit(container);
    await flush();

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0]?.[0]?.email).toBe("player@example.com");
  });

  it("greets a returning signed-in visitor with a Continue button", async () => {
    const store = memoryStore();
    const auth = createLocalAuth(store);
    await auth.signUp("player@example.com", "supersecret");

    await mountSignup(container, { auth, onContinue: () => {} });
    const welcome = container.querySelector(".signup__welcome");
    expect(welcome?.textContent).toContain("player@example.com");

    const onContinue = vi.fn();
    container.replaceChildren();
    await mountSignup(container, { auth, onContinue });
    container.querySelector<HTMLButtonElement>('[data-action="continue"]')!.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
