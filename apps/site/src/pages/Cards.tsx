import { cards, cardImageUrl } from "@euphoria/core/cards";

// Proof-of-wiring: the card database is imported and validated through the
// shared @euphoria/core package (same source of truth as the beta) — no copy,
// no server. A full filterable collection viewer is a later milestone; for now
// we show the count and a small sample so the data path is verified.
const SAMPLE_SIZE = 12;
const sample = cards.slice(0, SAMPLE_SIZE);
const base = import.meta.env.BASE_URL;

function factionTone(faction: string): string {
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

/** Card archive preview, reading live data from @euphoria/core. */
export function Cards() {
  return (
    <div className="eu-page eu-page--blue">
      <p className="eu-page__eyebrow">Card Archive</p>
      <h1 className="eu-page__title">Cards</h1>
      <p className="eu-page__body">
        Loaded <strong>{cards.length}</strong> cards from{" "}
        <code>@euphoria/core</code>. Showing the first {sample.length} as a
        wiring check — the full collection viewer with filters and search comes
        next.
      </p>

      <div className="eu-card-grid">
        {sample.map((card) => (
          <article
            key={card.id}
            className={`eu-tile eu-tile--${factionTone(card.faction)}`}
          >
            <div className="eu-tile__art">
              <img
                src={cardImageUrl(card, base)}
                alt={card.name}
                loading="lazy"
              />
            </div>
            <div className="eu-tile__meta">
              <span className="eu-tile__name">{card.name}</span>
              <span className="eu-tile__sub">
                {card.faction} · {card.type} · ◆{card.cost}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
