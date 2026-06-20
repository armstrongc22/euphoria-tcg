/**
 * @vitest-environment jsdom
 *
 * Reward chooser + modal views: the pure DOM builders renderRewardChoice and
 * renderRewardModal. Covers choosing, inspecting, and the modal overlay shape.
 */
import { describe, expect, it, vi } from "vitest";
import { cards } from "../src/cards";
import { renderRewardChoice, renderRewardModal } from "../src/reward-view";

const options = cards.slice(0, 3);

describe("renderRewardChoice", () => {
  it("renders one option per reward card and fires onChoose when picked", () => {
    const onChoose = vi.fn();
    const el = renderRewardChoice(options, "/", onChoose);
    const buttons = el.querySelectorAll<HTMLButtonElement>(".reward-choice__option");
    expect(buttons).toHaveLength(3);
    buttons[0]!.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0].id).toBe(options[0]!.id);
  });

  it("ignores further clicks once a reward is claimed", () => {
    const onChoose = vi.fn();
    const el = renderRewardChoice(options, "/", onChoose);
    const buttons = el.querySelectorAll<HTMLButtonElement>(".reward-choice__option");
    buttons[0]!.click();
    buttons[1]!.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("adds a Details inspect button per option when onInspect is given", () => {
    const onInspect = vi.fn();
    const el = renderRewardChoice(options, "/", vi.fn(), onInspect);
    const details = el.querySelectorAll<HTMLButtonElement>(".reward-choice__inspect");
    expect(details).toHaveLength(3);
    details[1]!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect.mock.calls[0]![0].id).toBe(options[1]!.id);
    // Inspecting does not claim.
    expect(el.querySelector(".reward-choice--claimed")).toBeNull();
  });

  it("omits Details buttons when onInspect is not given", () => {
    const el = renderRewardChoice(options, "/", vi.fn());
    expect(el.querySelector(".reward-choice__inspect")).toBeNull();
  });
});

describe("renderRewardModal", () => {
  it("wraps the chooser in a fixed overlay with a backdrop", () => {
    const overlay = renderRewardModal(options, "/", vi.fn());
    expect(overlay.classList.contains("reward-modal")).toBe(true);
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.querySelector(".reward-modal__backdrop")).not.toBeNull();
    expect(overlay.querySelector(".reward-choice")).not.toBeNull();
    expect(overlay.querySelectorAll(".reward-choice__option")).toHaveLength(3);
  });

  it("fires onChoose from inside the modal and supports inspect", () => {
    const onChoose = vi.fn();
    const onInspect = vi.fn();
    const overlay = renderRewardModal(options, "/", onChoose, onInspect);
    overlay.querySelector<HTMLButtonElement>(".reward-choice__inspect")!.click();
    expect(onInspect).toHaveBeenCalledTimes(1);
    overlay.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

describe("renderRewardChoice — claim result handling", () => {
  /** Flush microtasks so the awaited onChoose result is applied. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  it("confirms the claim when onChoose resolves ok", async () => {
    const el = renderRewardChoice(options, "/", () => Promise.resolve({ ok: true }));
    el.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    await flush();
    expect(el.classList.contains("reward-choice--claimed")).toBe(true);
    expect(el.querySelector(".reward-choice__claimed-msg")).not.toBeNull();
  });

  it("does NOT falsely show claimed and re-enables on save failure", async () => {
    const el = renderRewardChoice(options, "/", () =>
      Promise.resolve({ ok: false, message: "save failed" }),
    );
    const first = el.querySelector<HTMLButtonElement>(".reward-choice__option")!;
    first.click();
    await flush();
    // The failure is surfaced and the panel is not left in a claimed state.
    expect(el.classList.contains("reward-choice--failed")).toBe(true);
    expect(el.classList.contains("reward-choice--claimed")).toBe(false);
    expect(el.querySelector(".reward-choice__error")?.textContent).toContain("save failed");
    // Options are clickable again so the player can retry.
    expect(first.disabled).toBe(false);
  });

  it("treats a void return as success (legacy callers)", async () => {
    const onChoose = vi.fn();
    const el = renderRewardChoice(options, "/", onChoose);
    el.querySelector<HTMLButtonElement>(".reward-choice__option")!.click();
    await flush();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(el.classList.contains("reward-choice--claimed")).toBe(true);
  });
});
