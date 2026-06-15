/**
 * Match result view. A PURE DOM builder (no auth, no network) so it can be
 * unit-tested with jsdom: it renders the summary produced by ./match —
 * player faction, opponent faction, winner, turns, win/loss, an event recap,
 * the "Reward cards coming soon." placeholder — plus Play again / Back to
 * account buttons wired to the supplied callbacks.
 */
import type { MatchSummary } from "./match";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Callbacks for the two result-screen buttons. */
export interface MatchResultActions {
  readonly onPlayAgain: () => void;
  readonly onBack: () => void;
}

/** Builds the result card for one finished test match. */
export function renderMatchResult(
  summary: MatchSummary,
  actions: MatchResultActions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = `account match-result match-result--${summary.outcome}`;

  const verdict =
    summary.outcome === "win"
      ? "Victory"
      : summary.outcome === "loss"
        ? "Defeat"
        : "Draw";

  const header = document.createElement("div");
  header.className = "account__header";
  header.innerHTML =
    `<p class="account__eyebrow">Euphoria TCG · Test match</p>` +
    `<h2 class="account__title match-result__verdict">${escapeHtml(verdict)}</h2>` +
    `<p class="account__mode">${escapeHtml(summary.playerFaction)}` +
    ` vs ${escapeHtml(summary.opponentFaction)} · ${summary.turns} turns</p>`;
  section.append(header);

  const list = document.createElement("dl");
  list.className = "account__fields";
  const row = (label: string, value: string): void => {
    const el = document.createElement("div");
    el.className = "account__field";
    el.innerHTML =
      `<dt class="account__label">${escapeHtml(label)}</dt>` +
      `<dd class="account__value">${escapeHtml(value)}</dd>`;
    list.append(el);
  };
  row("Your faction", summary.playerFaction);
  row("Opponent faction", summary.opponentFaction);
  row("Winner", summary.winnerLabel);
  row("Turns", String(summary.turns));
  row("Result", summary.playerWon ? "You won" : summary.outcome === "draw" ? "Draw" : "You lost");
  section.append(list);

  const recap = document.createElement("section");
  recap.className = "account__panel match-result__recap";
  const recapItems = summary.highlights
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  recap.innerHTML =
    `<h3 class="account__panel-heading">Match recap</h3>` +
    `<ul class="match-result__events">${recapItems}</ul>`;
  section.append(recap);

  const rewards = document.createElement("section");
  rewards.className = "account__panel account__rewards";
  rewards.innerHTML =
    `<h3 class="account__panel-heading">Reward cards</h3>` +
    `<p class="account__panel-body">Reward cards coming soon.</p>`;
  section.append(rewards);

  const buttons = document.createElement("div");
  buttons.className = "match-result__actions";

  const playAgain = document.createElement("button");
  playAgain.type = "button";
  playAgain.className = "account__play match-result__again";
  playAgain.textContent = "Play again";
  playAgain.addEventListener("click", actions.onPlayAgain);

  const back = document.createElement("button");
  back.type = "button";
  back.className = "account__signout match-result__back";
  back.textContent = "Back to account";
  back.addEventListener("click", actions.onBack);

  buttons.append(playAgain, back);
  section.append(buttons);

  return section;
}
