/**
 * Interactive match board. A self-re-rendering DOM component (jsdom-testable):
 * given a {@link PlayableMatch}, it draws the player's hand, both fields, Spirit
 * and lives, and a battle log, and wires every control to an action taken
 * straight from `match.legalActions()`. It never builds actions itself, so the
 * UI can only ever offer legal moves; cards/warriors with no legal action are
 * rendered disabled with a short reason.
 *
 * Scope (first version): summon (playWarrior), play Item, equip Weapon, reclaim
 * a stolen Warrior, enter Battle, attack / direct attack, and end turn — i.e.
 * every action kind the engine currently exposes through getLegalActions. Attack
 * cards are auto-skipped (the engine's skip variant is used); per-Item targeting
 * beyond the engine defaults is a known later step.
 */
import type {
  GameAction,
  GameState,
  PlayerState,
  WarriorInPlay,
} from "@euphoria/game-engine";
import type { MatchSummary } from "./match";
import { OPPONENT_SEAT, PLAYER_SEAT, type PlayableMatch } from "./play-match";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Callbacks for the board. */
export interface PlayableMatchActions {
  /** Fired once when the match ends, with the final summary. */
  readonly onComplete: (summary: MatchSummary) => void;
  /** Fired when the player concedes / quits back out. */
  readonly onQuit: () => void;
}

/** A short, human-readable line for the battle log. */
function describeEvent(state: GameState, ev: GameState["events"][number]): string | null {
  const who = (p: "player1" | "player2"): string => (p === PLAYER_SEAT ? "You" : "Opponent");
  const cardName = (id: string): string => {
    const all = [
      ...state.players.player1.hand,
      ...state.players.player2.hand,
      ...state.players.player1.outDeck,
      ...state.players.player2.outDeck,
      ...state.players.player1.field.map((w) => w.card),
      ...state.players.player2.field.map((w) => w.card),
    ];
    return all.find((c) => c.id === id)?.name ?? id;
  };
  switch (ev.type) {
    case "turnStarted":
      return `— ${who(ev.player)} turn ${ev.turn} —`;
    case "warriorSummoned":
      return `${who(ev.player)} summoned ${cardName(ev.cardId)}.`;
    case "itemPlayed":
      return `${who(ev.player)} played ${cardName(ev.cardId)}.`;
    case "weaponEquipped":
      return `${who(ev.player)} equipped ${cardName(ev.cardId)}.`;
    case "warriorAttacked":
      return `${who(ev.player)} attacked for ${ev.damage}.`;
    case "warriorDestroyed":
      return `${who(ev.player)}'s ${cardName(ev.cardId)} was destroyed.`;
    case "directAttacked":
      return `${who(ev.player)} struck directly — ${ev.livesRemaining} lives left.`;
    case "gameWon":
      return `${who(ev.winner)} won the match.`;
    default:
      return null;
  }
}

/**
 * Renders the board for `match` into a fresh element and returns it. The element
 * re-renders itself in place after every action. Pure of network/auth; the only
 * outside effects are the supplied callbacks.
 */
export function renderPlayableMatch(
  match: PlayableMatch,
  actions: PlayableMatchActions,
): HTMLElement {
  const root = document.createElement("section");
  root.className = "account play-match";

  // Transient UI selection state, reset on every successful action.
  let selectedAttacker: string | null = null;
  let pendingWeapon: string | null = null;
  let error: string | null = null;
  let completed = false;

  const act = (action: GameAction): void => {
    const res = match.apply(action);
    error = res.ok ? null : res.message;
    selectedAttacker = null;
    pendingWeapon = null;
    paint();
  };

  // --- legal-action indexes, rebuilt each paint -----------------------------
  interface ActionIndex {
    playWarrior: Map<string, GameAction>;
    playItem: Map<string, GameAction>;
    equip: Map<string, GameAction[]>;
    reclaim: Map<string, GameAction>;
    attack: Map<string, Map<string, GameAction>>;
    direct: Map<string, GameAction>;
    enterBattle?: GameAction;
    endTurn?: GameAction;
  }

  const indexLegal = (legal: readonly GameAction[]): ActionIndex => {
    const idx: ActionIndex = {
      playWarrior: new Map(),
      playItem: new Map(),
      equip: new Map(),
      reclaim: new Map(),
      attack: new Map(),
      direct: new Map(),
    };
    for (const a of legal) {
      switch (a.kind) {
        case "playWarrior":
          idx.playWarrior.set(a.cardId, a);
          break;
        case "playItem":
          if (!idx.playItem.has(a.cardId)) idx.playItem.set(a.cardId, a);
          break;
        case "equipWeapon": {
          const list = idx.equip.get(a.cardId) ?? [];
          list.push(a);
          idx.equip.set(a.cardId, list);
          break;
        }
        case "reclaimWarrior":
          idx.reclaim.set(a.warriorInstanceId, a);
          break;
        case "attack": {
          const byDef = idx.attack.get(a.attackerInstanceId) ?? new Map();
          const prev = byDef.get(a.defenderInstanceId);
          // One control per (attacker, defender): prefer the skip-attack-card
          // variant so v1 never has to choose an Attack card.
          if (prev === undefined || a.skipAttackCard === true) {
            byDef.set(a.defenderInstanceId, a);
          }
          idx.attack.set(a.attackerInstanceId, byDef);
          break;
        }
        case "directAttack":
          idx.direct.set(a.attackerInstanceId, a);
          break;
        case "enterBattle":
          idx.enterBattle = a;
          break;
        case "endTurn":
          idx.endTurn = a;
          break;
      }
    }
    return idx;
  };

  // --- small DOM builders ---------------------------------------------------
  const statBar = (label: string, p: PlayerState): HTMLElement => {
    const el = document.createElement("div");
    el.className = "play-match__stats";
    el.innerHTML =
      `<span class="play-match__seat">${escapeHtml(label)}</span>` +
      `<span class="play-match__stat play-match__stat--lives" title="Lives">` +
      `♥ ${p.lives}</span>` +
      `<span class="play-match__stat play-match__stat--spirit" title="Spirit">` +
      `◆ ${p.spirit}</span>` +
      `<span class="play-match__stat" title="Cards in hand">✋ ${p.hand.length}</span>`;
    return el;
  };

  const warriorEl = (
    w: WarriorInPlay,
    opts: {
      clickable?: boolean;
      highlighted?: boolean;
      selected?: boolean;
      badge?: string;
      onClick?: () => void;
    },
  ): HTMLElement => {
    const el = document.createElement("button");
    el.type = "button";
    el.className =
      "play-match__warrior" +
      (opts.selected ? " play-match__warrior--selected" : "") +
      (opts.highlighted ? " play-match__warrior--target" : "");
    el.disabled = opts.clickable !== true;
    const weapon = w.attachedWeapon ? ` ⚔${escapeHtml(w.attachedWeapon.name)}` : "";
    el.innerHTML =
      `<span class="play-match__warrior-name">${escapeHtml(w.card.name)}</span>` +
      `<span class="play-match__warrior-stats">${w.currentAttack} / ${w.currentHealth}</span>` +
      `<span class="play-match__warrior-meta">⚡${w.attacksRemaining}${weapon}</span>` +
      (opts.badge ? `<span class="play-match__warrior-badge">${escapeHtml(opts.badge)}</span>` : "");
    if (opts.onClick) el.addEventListener("click", opts.onClick);
    return el;
  };

  // --- the painter ----------------------------------------------------------
  function paint(): void {
    if (match.isOver()) {
      if (!completed) {
        completed = true;
        actions.onComplete(match.summary());
      }
      return;
    }

    const state = match.state();
    const me = state.players[PLAYER_SEAT];
    const opp = state.players[OPPONENT_SEAT];
    const legal = match.legalActions();
    const idx = indexLegal(legal);
    const yourTurn = state.activePlayer === PLAYER_SEAT;

    const frag = document.createDocumentFragment();

    // Header: turn / phase / whose turn + concede.
    const header = document.createElement("div");
    header.className = "account__header play-match__header";
    header.innerHTML =
      `<p class="account__eyebrow">Euphoria TCG · Live match</p>` +
      `<h2 class="account__title">${escapeHtml(match.playerFaction)} vs ` +
      `${escapeHtml(match.opponentFaction)}</h2>` +
      `<p class="account__mode">Turn ${state.turn} · ${escapeHtml(state.phase)} phase · ` +
      `${yourTurn ? "Your move" : "Opponent…"}</p>`;
    const concede = document.createElement("button");
    concede.type = "button";
    concede.className = "account__signout play-match__quit";
    concede.textContent = "Concede";
    concede.addEventListener("click", actions.onQuit);
    header.append(concede);
    frag.append(header);

    if (error !== null) {
      const err = document.createElement("p");
      err.className = "play-match__error";
      err.textContent = error;
      frag.append(err);
    }

    // Opponent: stats + field.
    frag.append(statBar("Opponent", opp));
    frag.append(fieldRow(opp, /* mine */ false, idx));

    // Player: field + stats + hand.
    frag.append(fieldRow(me, /* mine */ true, idx));
    frag.append(statBar("You", me));
    frag.append(handRow(me, idx));

    // Action bar: enter battle / end turn.
    const bar = document.createElement("div");
    bar.className = "play-match__actionbar";
    bar.append(
      barButton("Enter Battle", idx.enterBattle, "play-match__enter"),
      barButton("End Turn", idx.endTurn, "play-match__end"),
    );
    frag.append(bar);

    // Battle log.
    frag.append(logPanel(state));

    root.replaceChildren(frag);
  }

  const barButton = (
    label: string,
    action: GameAction | undefined,
    cls: string,
  ): HTMLElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `account__play ${cls}`;
    b.textContent = label;
    b.disabled = action === undefined;
    if (action !== undefined) b.addEventListener("click", () => act(action));
    return b;
  };

  const fieldRow = (
    player: PlayerState,
    mine: boolean,
    idx: ActionIndex,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = `play-match__field play-match__field--${mine ? "mine" : "theirs"}`;
    if (player.field.length === 0) {
      const empty = document.createElement("p");
      empty.className = "play-match__empty";
      empty.textContent = mine ? "No Warriors in play." : "Opponent has no Warriors.";
      row.append(empty);
      return row;
    }
    for (const w of player.field) {
      if (mine) {
        const canAttack = idx.attack.has(w.instanceId) || idx.direct.has(w.instanceId);
        row.append(
          warriorEl(w, {
            clickable: canAttack,
            selected: selectedAttacker === w.instanceId,
            // While choosing a weapon target, friendly warriors that can take it
            // light up and become the click target.
            highlighted:
              pendingWeapon !== null &&
              (idx.equip.get(pendingWeapon) ?? []).some(
                (a) => a.kind === "equipWeapon" && a.warriorInstanceId === w.instanceId,
              ),
            onClick: () => {
              if (pendingWeapon !== null) {
                const equip = (idx.equip.get(pendingWeapon) ?? []).find(
                  (a) => a.kind === "equipWeapon" && a.warriorInstanceId === w.instanceId,
                );
                if (equip !== undefined) {
                  act(equip);
                  return;
                }
              }
              if (canAttack) {
                selectedAttacker = selectedAttacker === w.instanceId ? null : w.instanceId;
                error = null;
                paint();
              }
            },
          }),
        );
      } else {
        // Enemy Warrior: a legal attack target while an attacker is selected,
        // or a reclaim target if it is one of ours under foreign control.
        const attackAction =
          selectedAttacker !== null
            ? idx.attack.get(selectedAttacker)?.get(w.instanceId)
            : undefined;
        const reclaim = idx.reclaim.get(w.instanceId);
        const badge = reclaim !== undefined ? "reclaim" : undefined;
        row.append(
          warriorEl(w, {
            clickable: attackAction !== undefined || reclaim !== undefined,
            highlighted: attackAction !== undefined,
            badge,
            onClick: () => {
              if (attackAction !== undefined) act(attackAction);
              else if (reclaim !== undefined) act(reclaim);
            },
          }),
        );
      }
    }
    // Direct attack lives with the player's field when an attacker is selected
    // and the opponent's field is empty.
    if (mine && selectedAttacker !== null && idx.direct.has(selectedAttacker)) {
      const direct = idx.direct.get(selectedAttacker)!;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "account__play play-match__direct";
      b.textContent = "Direct attack";
      b.addEventListener("click", () => act(direct));
      row.append(b);
    }
    return row;
  };

  const handRow = (me: PlayerState, idx: ActionIndex): HTMLElement => {
    const row = document.createElement("div");
    row.className = "play-match__hand";
    if (me.hand.length === 0) {
      const empty = document.createElement("p");
      empty.className = "play-match__empty";
      empty.textContent = "Your hand is empty.";
      row.append(empty);
      return row;
    }
    const seen = new Set<string>();
    for (const card of me.hand) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      const copies = me.hand.filter((c) => c.id === card.id).length;

      const el = document.createElement("div");
      el.className = "play-match__card";
      el.innerHTML =
        `<span class="play-match__card-name">${escapeHtml(card.name)}` +
        `${copies > 1 ? ` ×${copies}` : ""}</span>` +
        `<span class="play-match__card-meta">${escapeHtml(card.type)} · ` +
        `◆${card.cost}</span>`;

      const controls = document.createElement("div");
      controls.className = "play-match__card-controls";

      const playWarrior = idx.playWarrior.get(card.id);
      const playItem = idx.playItem.get(card.id);
      const equip = idx.equip.get(card.id);

      if (playWarrior !== undefined) {
        controls.append(cardButton("Summon", () => act(playWarrior)));
      } else if (playItem !== undefined) {
        controls.append(cardButton("Play", () => act(playItem)));
      } else if (equip !== undefined && equip.length > 0) {
        const b = cardButton(
          pendingWeapon === card.id ? "Pick a Warrior…" : "Equip",
          () => {
            pendingWeapon = pendingWeapon === card.id ? null : card.id;
            error = null;
            paint();
          },
        );
        if (pendingWeapon === card.id) b.classList.add("play-match__card-btn--active");
        controls.append(b);
      } else {
        // No legal play for this card right now — show why, disabled.
        const reason =
          card.cost > me.spirit
            ? "Not enough Spirit"
            : match.state().phase === "battle"
              ? "Not during Battle"
              : card.type === "Weapon"
                ? "No Warrior to equip"
                : card.type === "Attack"
                  ? "Used with an attack"
                  : "No legal play";
        const b = cardButton(reason, undefined);
        controls.append(b);
      }
      el.append(controls);
      row.append(el);
    }
    return row;
  };

  const cardButton = (label: string, onClick?: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "play-match__card-btn";
    b.textContent = label;
    b.disabled = onClick === undefined;
    if (onClick !== undefined) b.addEventListener("click", onClick);
    return b;
  };

  const logPanel = (state: GameState): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "account__panel play-match__log";
    const heading = document.createElement("h3");
    heading.className = "account__panel-heading";
    heading.textContent = "Battle log";
    panel.append(heading);
    const ul = document.createElement("ul");
    ul.className = "play-match__log-list";
    const lines: string[] = [];
    for (const ev of state.events) {
      const line = describeEvent(state, ev);
      if (line !== null) lines.push(line);
    }
    for (const line of lines.slice(-12)) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.append(li);
    }
    panel.append(ul);
    return panel;
  };

  paint();
  return root;
}
