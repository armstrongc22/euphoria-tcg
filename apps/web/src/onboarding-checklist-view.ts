/**
 * "Getting Started" card — a PURE DOM builder (jsdom-testable) over the computed
 * {@link Checklist}. Designed as a COMPACT quest-log card, not an admin list:
 *
 *   - compact (default): title, progress, the CURRENT step only + its CTA, and a
 *     "Show all steps" link. Upcoming/locked steps are NOT rendered.
 *   - expanded: the same header plus all 8 steps as compact rows (current
 *     highlighted), and a "Collapse" link.
 *   - complete: a small "you're set up" card with a Dismiss.
 *
 * A separate {@link renderShowGuide} renders the tiny "Show Getting Started"
 * button shown after the guide is hidden. All behavior is the injected
 * callbacks; no auth/network/state — the checklist logic lives elsewhere.
 */
import type { Checklist, ChecklistItem } from "./onboarding-checklist";

/** Which shape to render. */
export type ChecklistView = "compact" | "expanded";

export interface ChecklistCardCallbacks {
  /** Fired when the current step's CTA is clicked. */
  readonly onCta: (item: ChecklistItem) => void;
  /** compact → expanded ("Show all steps"). */
  readonly onExpand: () => void;
  /** expanded → compact ("Collapse"). */
  readonly onCollapse: () => void;
  /** Hide the guide entirely ("Hide guide"); bring back via renderShowGuide. */
  readonly onHide: () => void;
  /** Dismiss the completion card. */
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

/** A status row. The current row also carries its body + CTA; others are compact. */
function itemRow(
  item: ChecklistItem,
  onCta: ChecklistCardCallbacks["onCta"],
): HTMLElement {
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
  if (item.status === "current") {
    const body = document.createElement("p");
    body.className = "onboarding__body";
    body.textContent = item.body;
    text.append(body);
    if (item.cta !== undefined) text.append(ctaButton(item, onCta));
  }
  li.append(mark, text);
  return li;
}

function textButton(label: string, cls: string, onClick: () => void): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** The current actionable item, if any. */
function currentItem(checklist: Checklist): ChecklistItem | undefined {
  return checklist.items.find((i) => i.id === checklist.currentId);
}

/**
 * Builds the compact (default) or expanded "Getting Started" card. A completed
 * checklist always renders the small completion card.
 */
export function renderChecklistCard(
  checklist: Checklist,
  view: ChecklistView,
  cb: ChecklistCardCallbacks,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "account__panel onboarding";
  card.dataset.complete = String(checklist.complete);

  // Completion: short, satisfying, dismissible.
  if (checklist.complete) {
    card.classList.add("onboarding--complete");
    card.innerHTML =
      `<h3 class="onboarding__heading">You're all set 🎉</h3>` +
      `<p class="onboarding__body"></p>`;
    card.querySelector(".onboarding__body")!.textContent = checklist.completionMessage;
    card.append(textButton("Dismiss", "onboarding__dismiss", cb.onDismissComplete));
    return card;
  }

  card.classList.add(view === "compact" ? "onboarding--compact" : "onboarding--expanded");

  // Header: title + progress (same in both shapes).
  const head = document.createElement("div");
  head.className = "onboarding__head";
  const heading = document.createElement("h3");
  heading.className = "onboarding__heading";
  heading.textContent = "Getting Started";
  const count = document.createElement("span");
  count.className = "onboarding__count";
  count.textContent = `${checklist.doneCount} of ${checklist.total} complete`;
  head.append(heading, count);
  card.append(head, progressBar(checklist.doneCount, checklist.total));

  const list = document.createElement("ol");
  list.className = "onboarding__list";
  if (view === "compact") {
    // Only the current step — no locked future rows taking over the page.
    const current = currentItem(checklist);
    if (current !== undefined) list.append(itemRow(current, cb.onCta));
  } else {
    for (const item of checklist.items) list.append(itemRow(item, cb.onCta));
  }
  card.append(list);

  // Footer controls.
  const footer = document.createElement("div");
  footer.className = "onboarding__footer";
  footer.append(
    view === "compact"
      ? textButton("Show all steps", "onboarding__expand", cb.onExpand)
      : textButton("Collapse", "onboarding__collapse", cb.onCollapse),
  );
  footer.append(textButton("Hide guide", "onboarding__hide", cb.onHide));
  card.append(footer);

  return card;
}

/** The tiny "Show Getting Started" button shown once the guide is hidden. */
export function renderShowGuide(onShow: () => void): HTMLElement {
  return textButton("Show Getting Started", "onboarding__show", onShow);
}
