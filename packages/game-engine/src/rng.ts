/**
 * One mulberry32 step from a serialized state word: returns the value in
 * [0, 1) and the next state. Pure, so in-game random effects can advance a
 * `rngState` stored on GameState and stay reproducible from the seed.
 */
export function nextRandom(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

/** mulberry32 — tiny deterministic PRNG so shuffles are reproducible from a seed. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const next = nextRandom(state);
    state = next.state;
    return next.value;
  };
}

/** Fisher–Yates on a copy; the input array is never mutated. */
export function shuffleCards<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/**
 * Fisher–Yates threading the serializable rng state instead of a closure:
 * returns the shuffled copy and the next state, so callers can persist it
 * back onto GameState. The input array is never mutated.
 */
export function shuffleWithState<T>(
  items: readonly T[],
  state: number,
): { items: T[]; state: number } {
  const result = [...items];
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const next = nextRandom(s);
    s = next.state;
    const j = Math.floor(next.value * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return { items: result, state: s };
}
