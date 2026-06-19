/**
 * Static Lore copy for the beta. PURE data — no DOM, no imports — so the world
 * text is easy to edit and unit-test. This is player-facing flavor only; it never
 * touches card data, the engine, or game behavior.
 */

/** A subsection within a Lore section (e.g. one of the Five Races). */
export interface LoreSubsection {
  readonly heading: string;
  readonly body: readonly string[];
  /** An optional aside (e.g. the Shaman starter-deck clarification). */
  readonly note?: string;
}

/** One Lore section: a heading plus prose, an optional list, and/or subsections. */
export interface LoreSection {
  readonly heading: string;
  readonly body?: readonly string[];
  /** An optional bulleted list rendered after the body. */
  readonly list?: readonly string[];
  /** Optional nested subsections (used by "The Five Races"). */
  readonly subsections?: readonly LoreSubsection[];
}

export const LORE_TITLE = "Lore";

export const LORE_SUBTITLE =
  "A continent of evolved races, ancient power, political fracture, and mythic " +
  "conflict.";

export const LORE_SECTIONS: readonly LoreSection[] = [
  {
    heading: "Welcome to Euphoria",
    body: [
      "Euphoria is a vast multimedia fantasy universe built around epic " +
        "storytelling, supernatural factions, political intrigue, and " +
        "character-driven conflict. Set across a diverse continent shaped by " +
        "ancient power and fragile alliances, Euphoria follows evolved human races " +
        "as they struggle for survival, territory, identity, and control of forces " +
        "that could alter the fate of the world.",
    ],
  },
  {
    heading: "The World",
    body: [
      "The continent of Euphoria is home to five supernatural races that evolved " +
        "from humanity over thousands of years: Surfers, Monks, Shamans, Dwarves, " +
        "and Sonics. Each race developed unique abilities, cultures, territories, " +
        "and philosophies. Their powers define not only how they fight, but how " +
        "they govern, worship, build, rebel, and survive.",
      "Euphoria is not a peaceful world. Its societies exist in a delicate balance " +
        "shaped by old wars, sacred resources, unstable borders, and buried " +
        "prophecies.",
    ],
  },
  {
    heading: "The Five Races",
    subsections: [
      {
        heading: "Surfers",
        body: [
          "Surfers are tide-readers, storm-chasers, and masters of pressure. Their " +
            "culture is tied to water, movement, survival, and adaptation. In " +
            "battle, Surfers favor flexibility, tempo, and momentum — wearing " +
            "enemies down while waiting for the perfect moment to turn the tide.",
        ],
      },
      {
        heading: "Monks",
        body: [
          "Monks are keepers of the inner flame. Their power is rooted in " +
            "discipline, devotion, and spiritual intensity. At their best, Monks " +
            "represent focus, sacrifice, and sacred purpose. At their worst, that " +
            "same fire becomes ruin. In battle, Monks favor aggressive tempo, " +
            "direct pressure, and explosive bursts of force.",
        ],
      },
      {
        heading: "Shamans",
        body: [
          "Shamans are among the most mysterious and powerful beings in Euphoria. " +
            "They move through the world as strategists, mystics, rulers, " +
            "wanderers, and living weapons. Their influence extends beyond ordinary " +
            "politics, and figures like Nexus stand at the center of conflicts that " +
            "can reshape the continent.",
        ],
        note:
          "Shamans exist in the broader world and card data, but are not currently " +
          "one of the four starter deck choices in the beta.",
      },
      {
        heading: "Dwarves",
        body: [
          "Dwarves are mountain-born, durable, and deeply tied to endurance, craft, " +
            "ancestry, and territorial pride. Their societies value resilience and " +
            "legacy. In battle, Dwarves are difficult to break, relying on " +
            "heavy-health Warriors, defensive pressure, and long-term advantage.",
        ],
      },
      {
        heading: "Sonics",
        body: [
          "Sonics are fast, loud, and overwhelming. Their power is tied to speed, " +
            "weather, sound, and explosive movement. Sonic culture prizes decisive " +
            "action and battlefield dominance. In battle, Sonics favor aggressive " +
            "beatdown, quick pressure, and tempo that can collapse an enemy before " +
            "they can stabilize.",
        ],
      },
    ],
  },
  {
    heading: "The Conflict",
    body: [
      "The Euphoria saga begins in a world already under strain. Nexus, a powerful " +
        "Shaman, undertakes a dangerous mission from Port Troy while traveling with " +
        "Flamma, an undefeated gladiator whose strength is matched by his " +
        "complicated sense of duty. Their path draws the attention of the Nimbus " +
        "Unit, an elite Sonic force led by Captain Titus, turning a covert journey " +
        "into a deadly chase.",
      "Along the way, personal destinies collide with continental politics. " +
        "Yosenvy, a boy from the slums, becomes tied to Flamma’s path. Tun, a " +
        "reluctant Dwarf heir, faces trials that force him toward leadership. In " +
        "Marina, Surfer power struggles threaten to ignite rebellion. Across the " +
        "continent, private grief, state violence, ancient prophecy, and " +
        "supernatural ambition begin moving toward the same storm.",
    ],
  },
  {
    heading: "Themes",
    body: [
      "Euphoria blends manga-inspired action with epic fantasy world-building and " +
        "political drama. Its stories explore:",
    ],
    list: [
      "power and inheritance,",
      "loyalty and betrayal,",
      "poverty and empire,",
      "prophecy and free will,",
      "identity and transformation,",
      "the cost of survival,",
      "the difference between strength and justice.",
    ],
  },
  {
    heading: "The TCG",
    body: [
      "Euphoria TCG translates the world’s factions, characters, weapons, and " +
        "conflicts into a playable card battler. Starter decks introduce the major " +
        "combat identities of the beta factions, while reward cards and deck " +
        "building let players shape their own path through the world.",
      "The beta begins with four starter factions:",
    ],
    list: ["Dwarf", "Monk", "Sonic", "Surfer"],
  },
  {
    heading: "Coming Later",
    body: [
      "Future Euphoria stories and game updates may explore deeper faction " +
        "histories, legendary Shamans, Najma, major territories, political powers, " +
        "and the wider conflicts shaping the continent.",
    ],
  },
];
