import type { Card } from "@euphoria/card-data";
import { DEFAULT_RULES } from "./config";
import { createRng, shuffleCards } from "./rng";
import { runStartPhase } from "./turn";
import {
  PLAYER_IDS,
  type GameState,
  type PlayerId,
  type PlayerState,
  type RulesConfig,
} from "./types";

export interface CreateGameOptions {
  decks: Record<PlayerId, readonly Card[]>;
  config?: Partial<RulesConfig>;
  /** Same seed + same decks = identical shuffle. Defaults to Date.now(). */
  seed?: number;
  /** Set false for scripted tests that need a known deck order. */
  shuffleDecks?: boolean;
}

/**
 * Builds the initial GameState: shuffle, opening hands, then Player 1's
 * first Start Phase (so the returned state is in Main Phase of turn 1, with
 * Player 1 at startingSpirit + 1 Spirit and startingHandSize + 1 cards).
 * Input deck arrays are copied, never mutated.
 */
export function createGame(options: CreateGameOptions): GameState {
  const config: RulesConfig = { ...DEFAULT_RULES, ...options.config };
  const seed = options.seed ?? Date.now();
  const rng = createRng(seed);
  const shouldShuffle = options.shuffleDecks ?? true;

  for (const id of PLAYER_IDS) {
    const size = options.decks[id].length;
    if (size !== config.deckSize) {
      throw new Error(
        `${id} deck must have exactly ${config.deckSize} cards, got ${size}`,
      );
    }
  }

  const state: GameState = {
    config,
    turn: 1,
    activePlayer: "player1",
    phase: "start",
    players: {
      player1: createPlayer("player1", config),
      player2: createPlayer("player2", config),
    },
    winner: null,
    statuses: [],
    events: [],
    // In-game randomness draws from an independent, deterministic stream
    // (offset from the seed) so it never correlates with the opening shuffle.
    rngState: ((seed >>> 0) ^ 0x9e3779b9) >>> 0,
    nextInstanceId: 1,
    nextStatusId: 1,
  };

  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    const deck = shouldShuffle
      ? shuffleCards(options.decks[id], rng)
      : [...options.decks[id]];
    player.hand = deck.slice(0, config.startingHandSize);
    player.deck = deck.slice(config.startingHandSize);
    state.events.push({
      type: "startingHandDrawn",
      player: id,
      count: player.hand.length,
    });
  }

  runStartPhase(state);
  return state;
}

function createPlayer(id: PlayerId, config: RulesConfig): PlayerState {
  return {
    id,
    lives: config.startingLives,
    spirit: config.startingSpirit,
    deck: [],
    hand: [],
    field: [],
    outDeck: [],
    directAttackUsedThisTurn: false,
    warriorSummonsUsedThisTurn: 0,
    delayedEffects: [],
    outOfPlay: [],
  };
}
