/**
 * Replay / event-trace instrumentation: runs one deterministic game and
 * records a step-by-step log (the action taken plus the engine events it
 * produced), then renders it as a readable turn-by-turn trace. Measurement
 * only — no card data, stats, or deck rules are touched.
 *
 * `generateTrace` is deterministic for a given seed and returns structured
 * data; `formatTrace` renders it for the terminal. The split lets tests check
 * the trace's shape without snapshotting the whole printed block.
 */
import type { Card } from "@euphoria/card-data";
import {
  applyAction,
  createGame,
  createRng,
  getLegalActions,
  type GameAction,
  type GameEvent,
  type PlayerId,
} from "@euphoria/game-engine";
import { greedyAgent } from "./agents";
import { buildFactionDeck, type DeckFaction } from "./deck";
import type { EndReason } from "./runner";

/** One loop step: the action taken and the events it appended (setup has action: null). */
export interface TraceStep {
  action: GameAction | null;
  events: GameEvent[];
}

export interface TraceResult {
  player1Faction: DeckFaction;
  player2Faction: DeckFaction;
  seed: number;
  maxTurns: number;
  deckSizes: Record<PlayerId, number>;
  /** The 5-card opening hands (player1's turn-1 draw removed) as card names. */
  openingHands: Record<PlayerId, string[]>;
  winner: PlayerId | null;
  reason: EndReason;
  turns: number;
  totalEvents: number;
  steps: TraceStep[];
  /** cardId -> display name, so formatTrace can resolve names without the pool. */
  cardNames: Record<string, string>;
}

export interface TraceOptions {
  pool: Card[];
  player1Faction: DeckFaction;
  player2Faction: DeckFaction;
  seed: number;
  maxTurns?: number;
}

/** Runs one game and captures every action and the events it produced. */
export function generateTrace(options: TraceOptions): TraceResult {
  const maxTurns = options.maxTurns ?? 200;
  const rng = createRng(options.seed);
  const decks: Record<PlayerId, Card[]> = {
    player1: buildFactionDeck(options.pool, options.player1Faction, rng),
    player2: buildFactionDeck(options.pool, options.player2Faction, rng),
  };

  let state = createGame({ decks, seed: options.seed });

  let consumed = 0;
  const take = (): GameEvent[] => {
    const slice = state.events.slice(consumed);
    consumed = state.events.length;
    return slice;
  };

  const setupEvents = take();
  const openingHands = recoverOpeningHands(state.players, setupEvents);

  const steps: TraceStep[] = [{ action: null, events: setupEvents }];
  const agents = { player1: greedyAgent(), player2: greedyAgent() };

  let actions = 0;
  let reason: EndReason = "maxTurns";
  while (state.winner === null) {
    if (state.turn > maxTurns) {
      reason = "maxTurns";
      break;
    }
    if (actions >= 5000) {
      reason = "maxActions";
      break;
    }
    const legal = getLegalActions(state);
    if (legal.length === 0) {
      reason = "noLegalActions";
      break;
    }
    const action = agents[state.activePlayer](state, legal);
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `Agent for ${state.activePlayer} chose an illegal ${action.kind}: ${result.error.message}`,
      );
    }
    state = result.state;
    steps.push({ action, events: take() });
    actions += 1;
  }

  return {
    player1Faction: options.player1Faction,
    player2Faction: options.player2Faction,
    seed: options.seed,
    maxTurns,
    deckSizes: { player1: decks.player1.length, player2: decks.player2.length },
    openingHands,
    winner: state.winner,
    reason: state.winner !== null ? "win" : reason,
    turns: state.turn,
    totalEvents: state.events.length,
    steps,
    cardNames: Object.fromEntries(options.pool.map((c) => [c.id, c.name])),
  };
}

/**
 * Player 1 draws once during turn-1 start, so its post-setup hand holds 6
 * cards; drop that single drawn card to recover the true 5-card opening hand.
 */
function recoverOpeningHands(
  players: { player1: { hand: Card[] }; player2: { hand: Card[] } },
  setupEvents: readonly GameEvent[],
): Record<PlayerId, string[]> {
  const p1Hand = [...players.player1.hand];
  const drew = setupEvents.find(
    (e): e is Extract<GameEvent, { type: "cardDrawn" }> =>
      e.type === "cardDrawn" && e.player === "player1",
  );
  if (drew !== undefined) {
    const i = p1Hand.findIndex((c) => c.id === drew.cardId);
    if (i >= 0) p1Hand.splice(i, 1);
  }
  return {
    player1: p1Hand.map((c) => c.name),
    player2: players.player2.hand.map((c) => c.name),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const FACTION_OF: Record<PlayerId, (t: TraceResult) => DeckFaction> = {
  player1: (t) => t.player1Faction,
  player2: (t) => t.player2Faction,
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** Renders the trace as a readable, turn-delimited block for the terminal. */
export function formatTrace(trace: TraceResult): string {
  const instances = new Map<string, string>(); // instanceId -> card name
  const lines: string[] = [];

  const cardName = (id: string): string => trace.cardNames[id] ?? id;
  const instName = (id: string): string => {
    const name = instances.get(id);
    return name !== undefined ? `${name} [${id}]` : id;
  };
  const ctx: RenderCtx = { cardName, instName, instances, trace };

  lines.push("=== Euphoria game trace (instrumentation only) ===");
  lines.push(
    `${trace.player1Faction} (player1) vs ${trace.player2Faction} (player2) · ` +
      `seed ${trace.seed} · max-turns ${trace.maxTurns}`,
  );
  lines.push(
    `decks: player1 ${trace.deckSizes.player1} cards, player2 ${trace.deckSizes.player2} cards`,
  );
  lines.push("opening hands:");
  lines.push(`  player1 (${trace.player1Faction}): ${trace.openingHands.player1.join(", ")}`);
  lines.push(`  player2 (${trace.player2Faction}): ${trace.openingHands.player2.join(", ")}`);

  for (const step of trace.steps) {
    for (const e of step.events) {
      const line = renderEvent(e, step.action, ctx);
      if (line !== null) lines.push(line);
    }
  }

  const winnerFaction =
    trace.winner !== null ? ` (${FACTION_OF[trace.winner](trace)})` : "";
  lines.push("");
  lines.push(
    `result: ${trace.winner ?? "draw"}${winnerFaction} — reason: ${trace.reason}, ${trace.turns} turns, ${trace.totalEvents} events`,
  );
  return lines.join("\n");
}

interface RenderCtx {
  cardName: (id: string) => string;
  instName: (id: string) => string;
  instances: Map<string, string>;
  trace: TraceResult;
}

/** One event -> one readable line (or null to omit pure-noise events). */
function renderEvent(e: GameEvent, action: GameAction | null, ctx: RenderCtx): string | null {
  // Remember which card backs each instance id so later lines can name it.
  const ref = e as { cardId?: string; instanceId?: string };
  if (ref.cardId !== undefined && ref.instanceId !== undefined) {
    ctx.instances.set(ref.instanceId, ctx.cardName(ref.cardId));
  }
  const summon = (cardId: string, instanceId: string): string =>
    `${ctx.cardName(cardId)} [${instanceId}]`;

  switch (e.type) {
    case "turnStarted":
      return `\n── Turn ${e.turn} · ${e.player} (${FACTION_OF[e.player](ctx.trace)}) ──`;
    case "spiritGained":
      return `  spirit ${signed(e.amount)} → ${e.total} (was ${e.total - e.amount})`;
    case "spiritChanged":
      return `  spirit ${signed(e.amount)} → ${e.total} (effect)`;
    case "cardDrawn":
      return `  draw: ${ctx.cardName(e.cardId)}`;
    case "drawFailedDeckEmpty":
      return `  draw failed (deck empty)`;
    case "phaseChanged":
      return e.phase === "battle" ? "  → battle phase" : null;
    case "warriorSummoned":
      return `  summon: ${summon(e.cardId, e.instanceId)} (cost ${e.cost})`;
    case "warriorRevived":
      return `  revive: ${summon(e.cardId, e.instanceId)}`;
    case "itemPlayed":
      return `  item: ${ctx.cardName(e.cardId)} (cost ${e.cost})`;
    case "weaponEquipped":
      return `  equip: ${ctx.cardName(e.cardId)} → ${ctx.instName(e.warriorInstanceId)} (cost ${e.cost})`;
    case "attackCardUsed":
      return `  attack card: ${ctx.cardName(e.cardId)} by ${ctx.instName(e.attackerInstanceId)} (cost ${e.cost})`;
    case "warriorAttacked": {
      const skip =
        action?.kind === "attack" && action.skipAttackCard === true
          ? " (no attack card)"
          : "";
      return `  attack: ${ctx.instName(e.attackerInstanceId)} → ${ctx.instName(e.defenderInstanceId)} for ${e.damage}${skip}`;
    }
    case "warriorHealthModified":
      return `    ${ctx.instName(e.instanceId)} HEALTH ${signed(e.amount)} → ${e.newHealth}`;
    case "warriorAttackModified":
      return `    ${ctx.instName(e.instanceId)} ATTACK ${signed(e.amount)} → ${e.newAttack}`;
    case "warriorDestroyed":
      return `  destroyed: ${summon(e.cardId, e.instanceId)}`;
    case "weaponDestroyed":
      return `  weapon destroyed: ${ctx.cardName(e.cardId)}`;
    case "directAttacked":
      return `  ⚔ DIRECT ATTACK by ${ctx.instName(e.attackerInstanceId)} → ${e.player === "player1" ? "player2" : "player1"} lives ${e.livesRemaining}`;
    case "gameWon":
      return `  >>> ${e.winner} wins`;
    case "statusApplied":
      return `  status applied: ${e.code}`;
    case "statusExpired":
      return `  status expired: ${e.code}`;
    case "warriorSentOutOfPlay":
      return `  out of play: ${summon(e.cardId, e.instanceId)} (${e.turnsRemaining} turns)`;
    case "warriorReturnedFromOutOfPlay":
      return `  returned: ${summon(e.cardId, e.instanceId)} (HEALTH ${e.newHealth})`;
    case "warriorControlStolen":
      return `  control stolen: ${summon(e.cardId, e.instanceId)} (${e.fromPlayer} → ${e.player})`;
    case "warriorControlReclaimed":
      return `  control reclaimed: ${summon(e.cardId, e.instanceId)}`;
    // Pure-noise / already-implied events are omitted to keep the trace readable.
    default:
      return null;
  }
}
