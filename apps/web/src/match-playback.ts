/**
 * Pure event → UI mapping for live matches (no DOM). Two jobs:
 *
 *   1. battleLogLines(state): the permanent, full-history battle log lines.
 *   2. toPlaybackSteps(frames): convert the resolved {@link MatchFrame}s from
 *      the controller into ordered playback steps the board animates — a callout
 *      message, optional floating combat text, a tone, an anchor (a Warrior
 *      instance or a player's life area), the board snapshot to show, and a
 *      duration.
 *
 * Everything is derived from the engine's structured event log — no rules are
 * re-run here. Where an event lacks an exact target id or delta we fall back to
 * the best readable summary rather than inventing data.
 */
import type { GameEvent, GameState, PlayerId } from "@euphoria/game-engine";
import { OPPONENT_SEAT, PLAYER_SEAT } from "./match";
import type { MatchFrame } from "./play-match";

/** Visual tone of a playback step / floating text. */
export type PlaybackTone =
  | "damage"
  | "heal"
  | "buff"
  | "debuff"
  | "destroy"
  | "revive"
  | "info";

/** One step of match playback: a callout + optional floating text + snapshot. */
export interface PlaybackStep {
  /** The callout line, e.g. "Opponent summoned Kit." */
  readonly message: string;
  /** Who acted (drives the "Opponent is acting…" framing). */
  readonly actor: "player" | "opponent";
  readonly tone: PlaybackTone;
  /** Floating combat text, e.g. "-2200 HEALTH"; absent for info-only steps. */
  readonly floatingText?: string;
  /** Anchor the float over this Warrior, when known. */
  readonly targetInstanceId?: string;
  /** Anchor the float over this player's life area (direct attacks). */
  readonly targetPlayer?: PlayerId;
  /** Milliseconds to show this step before advancing. */
  readonly durationMs: number;
  /** Board snapshot to render while this step is shown. */
  readonly state: GameState;
}

interface Resolvers {
  who: (p: PlayerId) => string;
  possessive: (p: PlayerId) => string;
  cardName: (id: string) => string;
  instanceName: (id: string) => string;
}

/** Builds name/label resolvers from a state (cards never leave the game). */
export function makeResolvers(state: GameState): Resolvers {
  const who = (p: PlayerId): string => (p === PLAYER_SEAT ? "You" : "Opponent");
  const possessive = (p: PlayerId): string =>
    p === PLAYER_SEAT ? "your" : "the opponent's";

  const cardName = (id: string): string => {
    for (const seat of [state.players.player1, state.players.player2]) {
      for (const c of [...seat.hand, ...seat.deck, ...seat.outDeck]) {
        if (c.id === id) return c.name;
      }
      for (const w of seat.field) if (w.card.id === id) return w.card.name;
    }
    return id;
  };

  // instanceId → cardId from every event that introduced a Warrior, so attacker/
  // defender ids resolve even after the Warrior has left the field.
  const instanceToCard = new Map<string, string>();
  for (const ev of state.events) {
    if ("instanceId" in ev && "cardId" in ev) {
      instanceToCard.set(ev.instanceId, ev.cardId);
    }
  }
  const instanceName = (id: string): string => {
    const cardId = instanceToCard.get(id);
    return cardId !== undefined ? cardName(cardId) : id;
  };

  return { who, possessive, cardName, instanceName };
}

/** A short, human-readable callout for one event (null = not shown). */
export function describeMatchEvent(
  ev: GameEvent,
  r: Resolvers,
): string | null {
  switch (ev.type) {
    case "turnStarted":
      return `— ${r.who(ev.player)} · turn ${ev.turn} —`;
    case "cardDrawn":
      // Don't reveal the opponent's drawn card (hidden information).
      return ev.player === PLAYER_SEAT
        ? `You drew ${r.cardName(ev.cardId)}.`
        : "Opponent drew a card.";
    case "warriorSummoned":
      return `${r.who(ev.player)} summoned ${r.cardName(ev.cardId)}.`;
    case "warriorRevived":
      return `${r.who(ev.player)} revived ${r.cardName(ev.cardId)}.`;
    case "itemPlayed":
      return `${r.who(ev.player)} played ${r.cardName(ev.cardId)}.`;
    case "weaponEquipped":
      return `${r.who(ev.player)} equipped ${r.cardName(ev.cardId)}.`;
    case "attackCardUsed":
      return `${r.who(ev.player)} used ${r.cardName(ev.cardId)}.`;
    case "deckSearched":
      return `${r.who(ev.player)} searched their deck and added ${r.cardName(ev.cardId)} to hand.`;
    case "cardStolenFromHand":
      return `${r.who(ev.player)} took ${r.cardName(ev.cardId)} from ${r.possessive(ev.fromPlayer)} hand.`;
    case "warriorAttacked":
      return `${r.instanceName(ev.attackerInstanceId)} attacked ${r.instanceName(ev.defenderInstanceId)} for ${ev.damage} HEALTH.`;
    case "warriorHealthModified":
      return ev.amount < 0
        ? `${r.instanceName(ev.instanceId)} lost ${-ev.amount} HEALTH.`
        : `${r.instanceName(ev.instanceId)} gained ${ev.amount} HEALTH.`;
    case "warriorAttackModified":
      return ev.amount < 0
        ? `${r.instanceName(ev.instanceId)} lost ${-ev.amount} ATK.`
        : `${r.instanceName(ev.instanceId)} gained ${ev.amount} ATK.`;
    case "warriorDestroyed":
      return `${r.cardName(ev.cardId)} was destroyed.`;
    case "weaponDestroyed":
      return `${r.cardName(ev.cardId)} was destroyed.`;
    case "directAttacked":
      return ev.player === PLAYER_SEAT
        ? `You landed a direct attack — opponent lives: ${ev.livesRemaining}.`
        : `Opponent landed a direct attack — your lives: ${ev.livesRemaining}.`;
    case "gameWon":
      return `${r.who(ev.winner)} won the match.`;
    default:
      return null;
  }
}

/**
 * The full battle-log history for the game so far (both players). Pure.
 */
export function battleLogLines(state: GameState): string[] {
  const r = makeResolvers(state);
  const lines: string[] = [];
  for (const ev of state.events) {
    const line = describeMatchEvent(ev, r);
    if (line !== null) lines.push(line);
  }
  return lines;
}

/** Durations per tone (ms). Snappy by design; reduced-motion ignores animation. */
const DURATION: Record<PlaybackTone, number> = {
  damage: 750,
  destroy: 800,
  revive: 800,
  heal: 700,
  buff: 700,
  debuff: 700,
  info: 600,
};

/** The other seat (no engine import needed for this 2-player game). */
function other(p: PlayerId): PlayerId {
  return p === "player1" ? "player2" : "player1";
}

/**
 * Floating text + tone + anchor for one event, or null when the event gets no
 * floating overlay (it still produces a callout via {@link describeMatchEvent}).
 */
function floatFor(
  ev: GameEvent,
): Pick<PlaybackStep, "tone" | "floatingText" | "targetInstanceId" | "targetPlayer"> | null {
  switch (ev.type) {
    case "warriorAttacked":
      return { tone: "damage", floatingText: `-${ev.damage} HEALTH`, targetInstanceId: ev.defenderInstanceId };
    case "warriorHealthModified":
      return ev.amount < 0
        ? { tone: "damage", floatingText: `-${-ev.amount} HEALTH`, targetInstanceId: ev.instanceId }
        : { tone: "heal", floatingText: `+${ev.amount} HEALTH`, targetInstanceId: ev.instanceId };
    case "warriorAttackModified":
      return ev.amount < 0
        ? { tone: "debuff", floatingText: `-${-ev.amount} ATK`, targetInstanceId: ev.instanceId }
        : { tone: "buff", floatingText: `+${ev.amount} ATK`, targetInstanceId: ev.instanceId };
    case "warriorDestroyed":
      return { tone: "destroy", floatingText: "DESTROYED", targetInstanceId: ev.instanceId };
    case "warriorRevived":
      return { tone: "revive", floatingText: "REVIVED", targetInstanceId: ev.instanceId };
    case "directAttacked":
      // The life is lost by the player who was attacked (the other seat).
      return { tone: "damage", floatingText: "-1 LIFE", targetPlayer: other(ev.player) };
    default:
      return null;
  }
}

/**
 * Converts resolved frames into ordered playback steps. Each event that has a
 * callout and/or a floating overlay becomes one step carrying that frame's
 * post-action board snapshot. Events with neither (e.g. spirit gain) are
 * dropped. The actor is the frame's actor (who took the action).
 */
export function toPlaybackSteps(frames: readonly MatchFrame[]): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  for (const frame of frames) {
    const r = makeResolvers(frame.state);
    for (const ev of frame.events) {
      const message = describeMatchEvent(ev, r);
      const float = floatFor(ev);
      if (message === null && float === null) continue;
      const tone = float?.tone ?? "info";
      steps.push({
        message: message ?? "",
        actor: frame.actor,
        tone,
        floatingText: float?.floatingText,
        targetInstanceId: float?.targetInstanceId,
        targetPlayer: float?.targetPlayer,
        durationMs: DURATION[tone],
        state: frame.state,
      });
    }
  }
  return steps;
}
