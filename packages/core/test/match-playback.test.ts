/**
 * Pure event → playback-step mapping (match-playback.ts). Confirms ordering,
 * tones, floating-text strings, and that each step carries its frame snapshot.
 */
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "@euphoria/game-engine";
import { cards } from "@euphoria/core/cards";
import type { MatchFrame } from "../src/play-match";
import { battleLogLines, toPlaybackSteps } from "../src/match-playback";

const warriorA = cards.find((c) => c.type === "Warrior")!;
const warriorB = cards.find((c) => c.type === "Warrior" && c.id !== warriorA.id)!;

/** A minimal GameState carrying just what the mapper reads (zones + events). */
function stateWith(events: GameEvent[], inPlay: Array<typeof warriorA>): GameState {
  const seat = (outDeck: Array<typeof warriorA>) => ({
    hand: [],
    deck: [],
    outDeck,
    field: [] as { card: typeof warriorA }[],
  });
  return {
    players: { player1: seat(inPlay), player2: seat([]) },
    events,
  } as unknown as GameState;
}

function frame(
  events: GameEvent[],
  actor: "player" | "opponent",
  inPlay: Array<typeof warriorA> = [warriorA, warriorB],
): MatchFrame {
  return { state: stateWith(events, inPlay), events, actor };
}

describe("toPlaybackSteps", () => {
  it("keeps events in order across frames and tags the actor", () => {
    const steps = toPlaybackSteps([
      frame(
        [{ type: "warriorSummoned", player: "player1", cardId: warriorA.id, instanceId: "a1", cost: 1 }],
        "player",
      ),
      frame(
        [{ type: "warriorSummoned", player: "player2", cardId: warriorB.id, instanceId: "b1", cost: 1 }],
        "opponent",
      ),
    ]);
    expect(steps.map((s) => s.actor)).toEqual(["player", "opponent"]);
    expect(steps[0]!.message).toBe(`You summoned ${warriorA.name}.`);
    expect(steps[1]!.message).toBe(`Opponent summoned ${warriorB.name}.`);
    // Info steps carry no floating text.
    expect(steps[0]!.floatingText).toBeUndefined();
  });

  it("maps combat damage to a red damage float anchored to the defender", () => {
    const steps = toPlaybackSteps([
      frame(
        [
          { type: "warriorSummoned", player: "player1", cardId: warriorA.id, instanceId: "a1", cost: 1 },
          { type: "warriorSummoned", player: "player2", cardId: warriorB.id, instanceId: "b1", cost: 1 },
          { type: "warriorAttacked", player: "player1", attackerInstanceId: "a1", defenderInstanceId: "b1", damage: 2200 },
        ],
        "player",
      ),
    ]);
    const atk = steps.find((s) => s.tone === "damage")!;
    expect(atk.floatingText).toBe("-2200 HEALTH");
    expect(atk.targetInstanceId).toBe("b1");
  });

  it("maps heal, buff, debuff, destroy, and revive to the right tones/text", () => {
    const steps = toPlaybackSteps([
      frame(
        [
          { type: "warriorHealthModified", player: "player1", instanceId: "a1", amount: 500, newHealth: 5 },
          { type: "warriorHealthModified", player: "player1", instanceId: "a1", amount: -300, newHealth: 4 },
          { type: "warriorAttackModified", player: "player1", instanceId: "a1", amount: 1000, newAttack: 9 },
          { type: "warriorAttackModified", player: "player1", instanceId: "a1", amount: -500, newAttack: 8 },
          { type: "warriorDestroyed", player: "player1", instanceId: "a1", cardId: warriorA.id },
          { type: "warriorRevived", player: "player1", instanceId: "a2", cardId: warriorA.id },
        ],
        "player",
      ),
    ]);
    const byTone = Object.fromEntries(steps.map((s) => [s.tone, s.floatingText]));
    expect(byTone["heal"]).toBe("+500 HEALTH");
    expect(byTone["damage"]).toBe("-300 HEALTH");
    expect(byTone["buff"]).toBe("+1000 ATK");
    expect(byTone["debuff"]).toBe("-500 ATK");
    expect(byTone["destroy"]).toBe("DESTROYED");
    expect(byTone["revive"]).toBe("REVIVED");
  });

  it("maps every attack-card use to the 'attackCard' moment anchored on the attacker", () => {
    const attackCard = cards.find((c) => c.type === "Attack")!;
    const steps = toPlaybackSteps([
      frame(
        [
          {
            type: "attackCardUsed",
            player: "player1",
            cardId: attackCard.id,
            attackerInstanceId: "a1",
            cost: 1,
          },
        ],
        "player",
        [attackCard],
      ),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.anim).toBe("attackCard");
    expect(steps[0]!.targetInstanceId).toBe("a1");
    expect(steps[0]!.message).toBe(`You used ${attackCard.name}.`);
    expect(steps[0]!.floatingText).toBeUndefined();
  });

  it("maps a direct attack to a -1 LIFE float on the player who lost the life", () => {
    const steps = toPlaybackSteps([
      frame([{ type: "directAttacked", player: "player2", attackerInstanceId: "x", livesRemaining: 2 }], "opponent"),
    ]);
    const life = steps.find((s) => s.floatingText === "-1 LIFE")!;
    expect(life.tone).toBe("damage");
    expect(life.targetPlayer).toBe("player1"); // opponent attacked, player1 lost a life
  });

  it("drops events with neither a message nor a float (e.g. spirit gain)", () => {
    const steps = toPlaybackSteps([
      frame([{ type: "spiritGained", player: "player1", amount: 1, total: 2 }], "player"),
    ]);
    expect(steps).toHaveLength(0);
  });

  it("carries the frame's board snapshot on every step", () => {
    const f = frame(
      [{ type: "warriorSummoned", player: "player1", cardId: warriorA.id, instanceId: "a1", cost: 1 }],
      "player",
    );
    const steps = toPlaybackSteps([f]);
    expect(steps[0]!.state).toBe(f.state);
  });
});

describe("battleLogLines (re-homed, still the full history)", () => {
  it("renders readable lines for a sequence of events", () => {
    const lines = battleLogLines(
      stateWith(
        [
          { type: "warriorSummoned", player: "player1", cardId: warriorA.id, instanceId: "a1", cost: 1 },
          { type: "directAttacked", player: "player1", attackerInstanceId: "a1", livesRemaining: 2 },
        ],
        [warriorA],
      ),
    );
    expect(lines).toContain(`You summoned ${warriorA.name}.`);
    expect(lines).toContain("You landed a direct attack — opponent lives: 2.");
  });
});
