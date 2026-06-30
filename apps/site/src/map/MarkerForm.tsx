import { useEffect, useRef, useState } from "react";
import {
  defaultSymbolForType,
  factionColor,
  FACTIONS,
  MARKER_SYMBOLS,
  MARKER_TYPES,
  parseTags,
  slugify,
  type MapMarker,
  type MarkerSymbol,
  type MarkerType,
} from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";

interface MarkerFormProps {
  /** The marker being edited/created. New markers carry their clicked x/y. */
  readonly draft: MapMarker;
  /** True when this id already exists in the set (shows the Delete button). */
  readonly isExisting: boolean;
  readonly onSave: (marker: MapMarker) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/**
 * Create/edit form for a single map marker, rendered as a centered overlay that
 * reuses the site's `eu-modal` look. The x/y come from where the map was clicked
 * (or the dragged position) and are shown read-only — fine-tuning is done by
 * dragging the marker on the map, per the debug workflow.
 */
export function MarkerForm({
  draft,
  isExisting,
  onSave,
  onDelete,
  onClose,
}: MarkerFormProps) {
  const [name, setName] = useState(draft.name);
  const [type, setType] = useState<MarkerType>(draft.type);
  // New markers start on the type's suggested symbol; existing keep their own.
  const [symbol, setSymbol] = useState<MarkerSymbol>(
    isExisting ? draft.markerSymbol : defaultSymbolForType(draft.type),
  );
  const [tagsInput, setTagsInput] = useState(draft.tags.join(", "));
  const [territory, setTerritory] = useState(draft.territory);
  const [factions, setFactions] = useState<string[]>([
    ...draft.factionAffinity,
  ]);
  const [spoilerLevel, setSpoilerLevel] = useState(draft.spoilerLevel);
  const [description, setDescription] = useState(draft.description);
  const nameRef = useRef<HTMLInputElement>(null);

  /** Changing the type re-suggests its symbol — unless you've picked your own. */
  function handleTypeChange(next: MarkerType): void {
    setSymbol((current) =>
      current === defaultSymbolForType(type) ? defaultSymbolForType(next) : current,
    );
    setType(next);
  }

  useEffect(() => {
    nameRef.current?.focus();
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleFaction(faction: string): void {
    setFactions((prev) =>
      prev.includes(faction)
        ? prev.filter((f) => f !== faction)
        : [...prev, faction],
    );
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      nameRef.current?.focus();
      return;
    }
    onSave({
      // Keep the original id when editing; derive a slug for brand-new markers.
      id: isExisting ? draft.id : slugify(trimmed),
      name: trimmed,
      type,
      tags: parseTags(tagsInput),
      markerSymbol: symbol,
      x: Math.round(draft.x),
      y: Math.round(draft.y),
      territory: territory.trim(),
      factionAffinity: factions,
      spoilerLevel,
      description: description.trim(),
      // The form doesn't edit the optional 3D fields yet, but it must preserve
      // any that were imported so editing a marker never silently drops them.
      ...(draft.elevation !== undefined ? { elevation: draft.elevation } : {}),
      ...(draft.markerHeight !== undefined
        ? { markerHeight: draft.markerHeight }
        : {}),
      ...(draft.view3d !== undefined ? { view3d: draft.view3d } : {}),
    });
  }

  return (
    <div
      className="eu-modal"
      role="dialog"
      aria-modal="true"
      aria-label={isExisting ? "Edit marker" : "New marker"}
      onClick={onClose}
    >
      <form
        className="eu-modal__card eu-map-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          className="eu-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <h2 className="eu-modal__name">
          {isExisting ? "Edit marker" : "New marker"}
        </h2>
        <p className="eu-map-form__coords">
          x {Math.round(draft.x)} · y {Math.round(draft.y)} (natural px)
        </p>

        <label className="eu-map-field">
          <span>Name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Port Troy"
          />
        </label>

        <label className="eu-map-field">
          <span>Type</span>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as MarkerType)}
          >
            {MARKER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="eu-map-field">
          <span>
            Symbol / shape
            <span className="eu-map-form__glyph-preview">
              <MarkerGlyph symbol={symbol} />
            </span>
          </span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value as MarkerSymbol)}
          >
            {MARKER_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="eu-map-field">
          <span>Tags (comma-separated)</span>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="historic site, battle site, temple"
          />
        </label>

        <fieldset className="eu-map-field eu-map-field--factions">
          <legend>Faction affinity</legend>
          <div className="eu-map-factions">
            {FACTIONS.map((f) => (
              <label key={f} className="eu-map-faction">
                <input
                  type="checkbox"
                  checked={factions.includes(f)}
                  onChange={() => toggleFaction(f)}
                />
                <span
                  className="eu-map-faction__swatch"
                  style={{ background: factionColor(f) }}
                />
                {f}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="eu-map-field">
          <span>Territory</span>
          <input
            type="text"
            value={territory}
            onChange={(e) => setTerritory(e.target.value)}
            placeholder="Euphrates Territory"
          />
        </label>

        <label className="eu-map-field">
          <span>Spoiler level</span>
          <select
            value={spoilerLevel}
            onChange={(e) => setSpoilerLevel(Number(e.target.value))}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
                {n === 0 ? " — safe" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="eu-map-field">
          <span>Short description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A major coastal city devastated during the Port Troy dragon event."
          />
        </label>

        <div className="eu-map-form__actions">
          {isExisting && (
            <button
              type="button"
              className="eu-map-btn eu-map-btn--danger"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
          <span className="eu-map-form__spacer" />
          <button type="button" className="eu-map-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="eu-map-btn eu-map-btn--primary">
            Save marker
          </button>
        </div>
      </form>
    </div>
  );
}
