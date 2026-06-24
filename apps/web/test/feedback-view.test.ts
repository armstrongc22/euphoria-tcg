/**
 * @vitest-environment jsdom
 *
 * Feedback modal behavior: the trigger opens the modal, the type + message fields
 * render, a valid submit assembles the debug context (user/build/view/userAgent/
 * mobile, plus the compact match and reward summaries) and persists it through the
 * Auth backend, an empty message is blocked, and a failed send parks the report in
 * localStorage while preserving the typed message (Feature F — never discarded).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedbackButton, openFeedbackModal } from "../src/feedback-view";
import { setBuildStamp } from "@euphoria/core/debug-log";
import { pendingFeedbackCount } from "@euphoria/core/feedback";
import type { Auth } from "@euphoria/core/auth";
import type { KeyValueStore } from "@euphoria/core/signup";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function fakeAuth(saveFeedback: Auth["saveFeedback"]): Auth {
  return { isRemote: true, saveFeedback } as unknown as Auth;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function modal(): HTMLElement {
  return document.querySelector<HTMLElement>(".feedback-modal")!;
}
function typeMessage(text: string): void {
  modal().querySelector<HTMLTextAreaElement>("#feedback-message")!.value = text;
}
function submit(): void {
  modal().querySelector<HTMLFormElement>(".feedback-modal__card")!.requestSubmit();
}

beforeEach(() => {
  document.body.replaceChildren();
  setBuildStamp("test-build-9");
});

describe("feedback modal", () => {
  it("opens from a trigger button (Feature A)", () => {
    const btn = createFeedbackButton("Send feedback", {
      auth: fakeAuth(vi.fn()),
      context: () => ({ view: "account", userId: "u1" }),
    });
    document.body.append(btn);
    expect(document.querySelector(".feedback-modal")).toBeNull();
    btn.click();
    expect(document.querySelector(".feedback-modal")).not.toBeNull();
  });

  it("renders the type select and message field (Feature B)", () => {
    openFeedbackModal({
      auth: fakeAuth(vi.fn()),
      context: () => ({ view: "account", userId: "u1" }),
    });
    const select = modal().querySelector<HTMLSelectElement>("#feedback-type")!;
    expect(select.options.length).toBeGreaterThan(1);
    expect(modal().querySelector("#feedback-message")).not.toBeNull();
  });

  it("hides the contact email field when signed in, shows it when anonymous", () => {
    openFeedbackModal({
      auth: fakeAuth(vi.fn()),
      context: () => ({ view: "account", userId: "u1" }),
    });
    expect(modal().querySelector("#feedback-email")).toBeNull();
    document.body.replaceChildren();
    openFeedbackModal({
      auth: fakeAuth(vi.fn()),
      context: () => ({ view: "account", userId: null }),
    });
    expect(modal().querySelector("#feedback-email")).not.toBeNull();
  });

  it("attaches user/build/view/userAgent/mobile context on a signed-in submit (Feature C)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    openFeedbackModal({
      auth: fakeAuth(save),
      store: memoryStore(),
      context: () => ({
        view: "account",
        userId: "user-42",
        email: "p@example.com",
        selectedFaction: "Monk",
      }),
    });
    typeMessage("something is off");
    submit();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    const insert = save.mock.calls[0]![0];
    expect(insert).toMatchObject({
      user_id: "user-42",
      email: "p@example.com",
      view: "account",
      build: "test-build-9",
      selected_faction: "Monk",
      message: "something is off",
    });
    expect(typeof insert.user_agent).toBe("string");
    expect(typeof insert.mobile).toBe("boolean");
  });

  it("includes the compact match summary on a live-match submit (Feature C)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    openFeedbackModal({
      auth: fakeAuth(save),
      store: memoryStore(),
      context: () => ({
        view: "live-match",
        userId: "u1",
        match: { turn: 3, phase: "battle", playerLives: 2, opponentLives: 1 },
      }),
    });
    typeMessage("the attack didn't resolve");
    submit();
    await flush();
    expect(save.mock.calls[0]![0].context.match).toEqual({
      turn: 3,
      phase: "battle",
      playerLives: 2,
      opponentLives: 1,
    });
  });

  it("includes the reward summary on an account/reward submit (Feature C)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    openFeedbackModal({
      auth: fakeAuth(save),
      store: memoryStore(),
      context: () => ({
        view: "account",
        userId: "u1",
        reward: { wins: 4, owned: 2, pending: 1 },
      }),
    });
    typeMessage("my reward card is missing");
    submit();
    await flush();
    expect(save.mock.calls[0]![0].context.reward).toEqual({
      wins: 4,
      owned: 2,
      pending: 1,
    });
  });

  it("blocks an empty message (Feature B/E)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    openFeedbackModal({
      auth: fakeAuth(save),
      context: () => ({ view: "account", userId: "u1" }),
    });
    typeMessage("   ");
    submit();
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(modal().querySelector<HTMLElement>(".feedback-modal__error")!.hidden).toBe(false);
  });

  it("parks the report locally and preserves the typed message when the send fails (Feature F)", async () => {
    const store = memoryStore();
    const save = vi.fn().mockRejectedValue(new Error("network down"));
    openFeedbackModal({
      auth: fakeAuth(save),
      store,
      context: () => ({ view: "account", userId: "u1" }),
    });
    typeMessage("please keep this");
    submit();
    await flush();
    // Queued for retry — not lost.
    expect(pendingFeedbackCount(store)).toBe(1);
    // The modal stays open with the typed message and the error.
    expect(
      modal().querySelector<HTMLTextAreaElement>("#feedback-message")!.value,
    ).toBe("please keep this");
    const error = modal().querySelector<HTMLElement>(".feedback-modal__error")!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/network down/);
  });

  it("shows a thank-you on a successful send (Feature E)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    openFeedbackModal({
      auth: fakeAuth(save),
      store: memoryStore(),
      context: () => ({ view: "account", userId: "u1" }),
    });
    typeMessage("nice work");
    submit();
    await flush();
    expect(
      modal().querySelector<HTMLElement>(".feedback-modal__success")!.hidden,
    ).toBe(false);
  });
});
