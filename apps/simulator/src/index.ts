/**
 * Public surface of the simulator package. Re-exports only the browser-safe,
 * pure pieces — the game loop, the agents, and the deck-building helpers — so
 * other workspaces (e.g. the web app) can drive a match without pulling in the
 * CLI entry points, which read argv and load cards from disk via `fs`.
 */
export {
  runGame,
  buildGameResult,
  type GameSetup,
  type GameResult,
  type EndReason,
} from "./runner";
export {
  greedyAgent,
  randomAgent,
  smartAgent,
  type Agent,
} from "./agents";
export {
  buildDeck,
  buildFactionDeck,
  DECK_FACTIONS,
  DECK_STAPLE_SLUGS,
  type DeckFaction,
  type DeckOptions,
} from "./deck";
