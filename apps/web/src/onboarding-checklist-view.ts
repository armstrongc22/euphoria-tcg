/**
 * "Getting Started" checklist card — a PURE DOM builder (jsdom-testable) over the
 * computed {@link Checklist}. Deliberately prominent (Feature I): a heading, a
 * progress bar, status-marked rows, and the current step's CTA — not tiny helper
 * text. Three shapes: full (default), collapsed (after "Skip for now"), and a
 * small completion card. All behavior is the injected callbacks; no auth/network.
 */
import type { Checklist, ChecklistItem } from "./onboarding-checklist";

export interface ChecklistCardCallbacks {
  /** Fired when the current step's CTA is clicked. */
  readonly onCta: (item: ChecklistItem) => void;
  /** Collapse the full checklist to a small card ("Skip for now"). */
  readonly onCollapse: () => void;
  /** Re-expand a collapsed checklist ("Show all steps"). */
  readonly onExpand: () => void;
  /** Dismiss the completion card entirely. */
  readonly onDismissComplete: () => void;
}

const STATUS_GLYPH: Record<ChecklistItem["status"], string> = {
  done: "✓",
  current: "►",
  upcoming: "○",
};

function progressBar(done: number, total: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "onboarding__progress";
  wrap.setAttribute("role", "progressbar");
  wrap.setAttribute("aria-valuemin", "0");
  wrap.setAttribute("aria-valuemax", String(total));
  wrap.setAttribute("aria-valuenow", String(done));
  const fill = document.createElement("div");
  fill.className = "onboarding__progress-fill";
  fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  wrap.append(fill);
  return wrap;
}

function ctaButton(item: ChecklistItem, onCta: ChecklistCardCallbacks["onCta"]): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "account__play onboarding__cta";
  btn.textContent = item.cta ?? "Continue";
  btn.addEventListener("click", () => onCta(item));
  return btn;
}

/** The current actionable item, if any. */
function currentItem(checklist: Checklist): ChecklistItem | undefined {
  return checklist.items.find((i) => i.id === checklist.currentId);
}

/**
 * Builds the checklist card for the given state. `collapsed` shows the compact
 * shape. A completed checklist renders a small completion card regardless.
 */
export function renderChecklistCard(
  checklist: Checklist,
  collapsed: boolean,
  cb: ChecklistCardCallbacks,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "account__panel onboarding";
  card.dataset.complete = String(checklist.complete);

  // Completion state (Feature G): short message + dismiss.
  if (checklist.complete) {
    card.classList.add("onboarding--complete");
    card.innerHTML =
      `<h3 class="onboarding__heading">You're all set 🎉</h3>` +
      `<p class="onboarding__body"></p>`;
    card.querySelector(".onboarding__body")!.textContent = checklist.completionMessage;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "onboarding__dismiss";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", cb.onDismissComplete);
    card.append(dismiss);
    return card;
  }

  const heading = document.createElement("h3");
  heading.className = "onboarding__heading";
  heading.textContent = "Getting Started";
  card.append(heading);

  const count = document.createElement("p");
  count.className = "onboarding__count";
  count.textContent = `${checklist.doneCount} of ${checklist.total} complete`;
  card.append(count);
  card.append(progressBar(checklist.doneCount, checklist.total));

  const current = currentItem(checklist);

  if (collapsed) {
    // Compact shape: just the current step + CTA + a way to expand.
    card.classList.add("onboarding--collapsed");
    if (current !== undefined) {
      const body = document.createElement("p");
      body.className = "onboarding__body";
      body.textContent = current.body;
      card.append(body);
      if (current.cta !== undefined) card.append(ctaButton(current, cb.onCta));
    }
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "onboarding__expand";
    expand.textContent = "Show all steps";
    expand.addEventListener("click", cb.onExpand);
    card.append(expand);
    return card;
  }

  // Full shape: every step as a status row.
  const list = document.createElement("ol");
  list.className = "onboarding__list";
  for (const item of checklist.items) {
    const li = document.createElement("li");
    li.className = `onboarding__item onboarding__item--${item.status}`;
    li.dataset.step = item.id;
    const mark = document.createElement("span");
    mark.className = "onboarding__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = STATUS_GLYPH[item.status];
    const text = document.createElement("div");
    text.className = "onboarding__item-text";
    const label = document.createElement("span");
    label.className = "onboarding__label";
    label.textContent = item.label;
    text.append(label);
    // Only the current step shows its explanatory body + CTA inline.
    if (item.status === "current") {
      const body = document.createElement("p");
      body.className = "onboarding__body";
      body.textContent = item.body;
      text.append(body);
      if (item.cta !== undefined) text.append(ctaButton(item, cb.onCta));
    }
    li.append(mark, text);
    list.append(li);
  }
  card.append(list);

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "onboarding__collapse";
  skip.textContent = "Skip for now";
  skip.addEventListener("click", cb.onCollapse);
  card.append(skip);

  return card;
}
