/**
 * Static Rules copy for the beta. PURE data — no DOM, no engine imports — so the
 * text is easy to edit and unit-test. The numbers here mirror the engine's
 * DEFAULT_RULES (packages/game-engine/src/config.ts) and the reward cadence in
 * rewards.ts as of this beta; update both together if the rules engine changes.
 * This module never changes game behavior — it only describes it.
 */

/** One Rules section: a heading, optional prose paragraphs, and an optional list. */
export interface RulesSection {
  readonly heading: string;
  /** Body paragraphs, rendered in order. */
  readonly body?: readonly string[];
  /** An optional list rendered after the body. */
  readonly list?: {
    /** Ordered (numbered) vs unordered (bulleted). */
    readonly ordered: boolean;
    readonly items: readonly string[];
  };
}

export const RULES_TITLE = "Rules";

export const RULES_SUBTITLE =
  "Learn the current Euphoria TCG beta rules. The system is still evolving, but " +
  "this guide reflects how the playable build works today.";

export const RULES_SECTIONS: readonly RulesSection[] = [
  {
    heading: "Objective",
    body: [
      "Euphoria TCG is won by reducing your opponent’s Lives to 0. Build a board " +
        "of Warriors, use Items and Weapons to create advantage, and break through " +
        "the enemy field with direct attacks.",
    ],
  },
  {
    heading: "Deck Basics",
    body: [
      "Each player uses a 30-card deck. In the beta, players begin with a fixed " +
        "starter deck from one of four starter factions: Dwarf, Monk, Sonic, or " +
        "Surfer. As players win matches, they earn reward cards that can be added " +
        "to their collection and used in the Deck Builder.",
    ],
  },
  {
    heading: "Starting Setup",
    body: [
      "Each match begins with both players at 3 Lives. Players draw an opening " +
        "hand of 5 cards and begin with 1 Spirit — the resource used to summon " +
        "Warriors and play cards.",
      "At the start of each turn a player gains 1 more Spirit before drawing, so " +
        "Spirit grows over time and gives each player access to stronger plays as " +
        "the match progresses.",
    ],
  },
  {
    heading: "Turn Flow",
    body: ["A turn moves through a simple structure:"],
    list: {
      ordered: true,
      items: [
        "Start the turn.",
        "Gain Spirit and draw.",
        "Play cards during the Main Phase.",
        "Enter Battle Phase.",
        "Attack with Warriors.",
        "End the turn.",
      ],
    },
  },
  {
    heading: "Summoning Warriors",
    body: [
      "Warriors are the main fighters in Euphoria TCG. A player may perform one " +
        "normal Warrior summon per turn. Warriors cost Spirit to summon. Once on " +
        "the field, Warriors can attack, defend, carry Weapons, and become targets " +
        "for card effects.",
    ],
  },
  {
    heading: "Items and Weapons",
    body: [
      "Items create immediate effects, such as healing, searching the deck, " +
        "reviving Warriors, stealing cards, forcing duels, or temporarily removing " +
        "Warriors from play. Weapons equip to Warriors and can modify how that " +
        "Warrior attacks or interacts with the board.",
      "Some Items and Weapons require targets. When a card needs a target, the " +
        "game will prompt you to choose a valid card or Warrior.",
    ],
  },
  {
    heading: "Attacking",
    body: [
      "Warriors attack during the Battle Phase. A Warrior can attack an enemy " +
        "Warrior. If the opponent has no Warriors, a direct attack may be possible. " +
        "Direct attacks reduce the opponent’s Lives. A player may make at most one " +
        "direct attack per turn.",
      "Some Attack cards can be used when a Warrior attacks. If a compatible Attack " +
        "card is available, the game may prompt you to choose between a regular " +
        "attack and an Attack card.",
    ],
  },
  {
    heading: "Out Deck",
    body: [
      "The Out Deck is where used, destroyed, or spent cards go. Some cards " +
        "interact with the Out Deck, such as reviving a Warrior or gaining value " +
        "based on cards that have already left play.",
    ],
  },
  {
    heading: "Rewards and Progression",
    body: [
      "Rewards are based on wins, not total games played. Winning matches moves " +
        "the player toward reward milestones. When a reward is earned, the player " +
        "chooses one card from a reward offer. Reward cards are added to the " +
        "player’s collection and can be used in the Deck Builder.",
      "How milestones work in the current build:",
    ],
    list: {
      ordered: false,
      items: [
        "Rewards occur on win milestones — never on losses or draws.",
        "A reward is offered every 5 wins (your 5th, 10th, 15th win, and so on).",
        "Each milestone you reach counts as a higher reward tier.",
      ],
    },
  },
  {
    heading: "Beta Note",
    body: [
      "Euphoria TCG is currently in beta. Rules, card effects, UI, reward pacing, " +
        "and balance may continue to evolve as the game grows.",
    ],
  },
];
