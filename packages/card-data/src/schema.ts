import { z } from "zod";

export const factionSchema = z.enum([
  "Monk",
  "Dwarf",
  "Sonic",
  "Surfer",
  "Shaman",
  "Neutral",
]);

export const cardTypeSchema = z.enum(["Warrior", "Attack", "Item", "Weapon"]);

/**
 * Validates a card exactly as it appears in data/cards/cards.json.
 * Strict: unknown keys are rejected so typos in the source of truth surface
 * as validation errors instead of silently passing through.
 */
export const rawCardSchema = z.strictObject({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  faction: factionSchema,
  type: cardTypeSchema,
  spiritCost: z.number().int().nonnegative(),
  costResource: z.literal("Spirit"),
  attack: z.number().int().nonnegative().optional(),
  health: z.number().int().nonnegative().optional(),
  rulesText: z.string().optional(),
  imageFile: z
    .string()
    .min(1)
    .refine((file) => file.endsWith(".png"), "imageFile must be a .png"),
  rarity: z.string().min(1),
  color: z.string().optional(),
  subtype: z.string().optional(),
  supportFaction: z.string().optional(),
  deckTags: z.array(z.string()).optional(),
  effects: z.array(z.record(z.string(), z.unknown())).optional(),
  effectCode: z.string().optional(),
  effectParams: z.record(z.string(), z.unknown()).optional(),
  timing: z.string().optional(),
});

/**
 * Normalized card: the raw card plus `cost` (from spiritCost) and
 * `effectText` (from rulesText; "" for vanilla cards with no rules text).
 * cards.json itself is never rewritten.
 */
export const cardSchema = rawCardSchema.transform((raw) => ({
  ...raw,
  cost: raw.spiritCost,
  effectText: raw.rulesText ?? "",
}));

export const cardListSchema = z.array(cardSchema);

export type RawCard = z.infer<typeof rawCardSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Faction = z.infer<typeof factionSchema>;
export type CardType = z.infer<typeof cardTypeSchema>;
