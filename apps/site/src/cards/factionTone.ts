/**
 * Maps a faction to one of the five Euphoria accent tones used across the site
 * (red/blue/white/green/purple). Unknown/Neutral falls back to white.
 */
export function factionTone(faction: string): string {
  switch (faction) {
    case "Monk":
      return "red";
    case "Sonic":
      return "blue";
    case "Surfer":
      return "white";
    case "Dwarf":
      return "green";
    case "Shaman":
      return "purple";
    default:
      return "white";
  }
}
