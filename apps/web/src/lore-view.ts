/**
 * Lore page. A PURE DOM builder (no auth, no network) over the static copy in
 * lore.ts, so it can be unit-tested with jsdom and mounted by main.ts. Matches
 * the dark Euphoria style via the shared `.page` classes (styles.css). Player
 * flavor only — no card data, engine, or game behavior is touched.
 */
import {
  LORE_SECTIONS,
  LORE_SUBTITLE,
  LORE_TITLE,
  type LoreSection,
  type LoreSubsection,
} from "./lore";

function paragraphs(parent: HTMLElement, body: readonly string[]): void {
  for (const text of body) {
    const p = document.createElement("p");
    p.className = "page__text";
    p.textContent = text;
    parent.append(p);
  }
}

function subsectionEl(sub: LoreSubsection): HTMLElement {
  const el = document.createElement("div");
  el.className = "page__subsection";

  const heading = document.createElement("h4");
  heading.className = "page__subheading";
  heading.textContent = sub.heading;
  el.append(heading);

  paragraphs(el, sub.body);

  if (sub.note !== undefined) {
    const note = document.createElement("p");
    note.className = "page__note";
    note.textContent = sub.note;
    el.append(note);
  }

  return el;
}

function sectionEl(section: LoreSection): HTMLElement {
  const el = document.createElement("section");
  el.className = "page__section";

  const heading = document.createElement("h3");
  heading.className = "page__section-heading";
  heading.textContent = section.heading;
  el.append(heading);

  paragraphs(el, section.body ?? []);

  if (section.list !== undefined) {
    const list = document.createElement("ul");
    list.className = "page__list";
    for (const item of section.list) {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    }
    el.append(list);
  }

  for (const sub of section.subsections ?? []) el.append(subsectionEl(sub));

  return el;
}

/** Builds the Lore page element. Pure DOM — safe to call repeatedly. */
export function renderLore(): HTMLElement {
  const page = document.createElement("section");
  page.className = "page page--lore";

  const header = document.createElement("div");
  header.className = "page__header";
  header.innerHTML =
    `<p class="page__eyebrow">Euphoria TCG · Beta</p>` +
    `<h2 class="page__title"></h2>` +
    `<p class="page__subtitle"></p>`;
  header.querySelector(".page__title")!.textContent = LORE_TITLE;
  header.querySelector(".page__subtitle")!.textContent = LORE_SUBTITLE;
  page.append(header);

  for (const section of LORE_SECTIONS) page.append(sectionEl(section));

  return page;
}

/** Renders the Lore page into `container` (replacing its contents). */
export function mountLore(container: HTMLElement): void {
  container.replaceChildren(renderLore());
}
