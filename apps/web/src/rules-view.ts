/**
 * Rules page. A PURE DOM builder (no auth, no network) over the static copy in
 * rules.ts, so it can be unit-tested with jsdom and mounted by main.ts. Matches
 * the dark Euphoria style via the shared `.page` classes (styles.css).
 */
import { RULES_SECTIONS, RULES_SUBTITLE, RULES_TITLE, type RulesSection } from "./rules";

function sectionEl(section: RulesSection): HTMLElement {
  const el = document.createElement("section");
  el.className = "page__section";

  const heading = document.createElement("h3");
  heading.className = "page__section-heading";
  heading.textContent = section.heading;
  el.append(heading);

  for (const paragraph of section.body ?? []) {
    const p = document.createElement("p");
    p.className = "page__text";
    p.textContent = paragraph;
    el.append(p);
  }

  if (section.list !== undefined) {
    const list = document.createElement(section.list.ordered ? "ol" : "ul");
    list.className = "page__list";
    for (const item of section.list.items) {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    }
    el.append(list);
  }

  return el;
}

/** Builds the Rules page element. Pure DOM — safe to call repeatedly. */
export function renderRules(): HTMLElement {
  const page = document.createElement("section");
  page.className = "page page--rules";

  const header = document.createElement("div");
  header.className = "page__header";
  header.innerHTML =
    `<p class="page__eyebrow">Euphoria TCG · Beta</p>` +
    `<h2 class="page__title"></h2>` +
    `<p class="page__subtitle"></p>`;
  header.querySelector(".page__title")!.textContent = RULES_TITLE;
  header.querySelector(".page__subtitle")!.textContent = RULES_SUBTITLE;
  page.append(header);

  for (const section of RULES_SECTIONS) page.append(sectionEl(section));

  return page;
}

/** Renders the Rules page into `container` (replacing its contents). */
export function mountRules(container: HTMLElement): void {
  container.replaceChildren(renderRules());
}
