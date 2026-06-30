import { useState } from "react";
import {
  factionColor,
  parseMarkers,
  serializeMarkers,
  STARTER_MARKERS,
  type MapMarker,
} from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";

interface DebugPanelProps {
  readonly markers: readonly MapMarker[];
  readonly onEdit: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onReplaceAll: (markers: MapMarker[]) => void;
  /** Leave notation mode and return to the public map. */
  readonly onExit: () => void;
}

/**
 * The hidden admin/debug panel — only mounted when ?mapDebug=1 is present. Lists
 * every marker (edit/delete), clears all behind a confirm, and offers JSON
 * import/export so a tuned set can be lifted into a permanent data file later.
 * Sits on the right on desktop and collapses to a bottom drawer on mobile.
 */
export function DebugPanel({
  markers,
  onEdit,
  onDelete,
  onReplaceAll,
  onExit,
}: DebugPanelProps) {
  const [open, setOpen] = useState(true);
  const [jsonText, setJsonText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleExport(): void {
    setJsonText(serializeMarkers(markers));
    setFeedback(`Exported ${markers.length} markers below.`);
  }

  async function handleCopy(): Promise<void> {
    const text = serializeMarkers(markers);
    setJsonText(text);
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied JSON to clipboard.");
    } catch {
      setFeedback("Clipboard blocked — copy from the box manually.");
    }
  }

  function handleImport(): void {
    const result = parseMarkers(jsonText);
    if (!result.ok) {
      setFeedback(`Import failed: ${result.error}`);
      return;
    }
    onReplaceAll(result.markers);
    setFeedback(`Imported ${result.markers.length} markers.`);
  }

  function handleClearAll(): void {
    if (markers.length === 0) return;
    if (
      window.confirm(
        `Delete all ${markers.length} markers? This cannot be undone.`,
      )
    ) {
      onReplaceAll([]);
      setFeedback("Cleared all markers.");
    }
  }

  function handleReseed(): void {
    if (
      window.confirm("Replace the current markers with the starter placeholders?")
    ) {
      onReplaceAll([...STARTER_MARKERS]);
      setFeedback("Restored starter placeholders.");
    }
  }

  return (
    <aside className={`eu-map-debug${open ? "" : " eu-map-debug--collapsed"}`}>
      <header className="eu-map-debug__head">
        <div>
          <p className="eu-map-debug__eyebrow">Debug mode</p>
          <h2 className="eu-map-debug__title">Map notation</h2>
        </div>
        <button
          type="button"
          className="eu-map-btn eu-map-debug__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <div className="eu-map-debug__body">
          <p className="eu-map-debug__hint">
            Click anywhere on the map to place a marker. Drag a marker to
            fine-tune its position.
          </p>

          <div className="eu-map-debug__section">
            <div className="eu-map-debug__section-head">
              <span>Markers ({markers.length})</span>
              <button
                type="button"
                className="eu-map-btn eu-map-btn--danger eu-map-btn--sm"
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>
            <ul className="eu-map-list">
              {markers.length === 0 && (
                <li className="eu-map-list__empty">No markers yet.</li>
              )}
              {markers.map((m) => {
                const lead = m.factionAffinity[0];
                return (
                  <li key={m.id} className="eu-map-list__row">
                    <button
                      type="button"
                      className="eu-map-list__name"
                      onClick={() => onEdit(m.id)}
                      title="Edit"
                    >
                      <span
                        className="eu-map-list__glyph"
                        style={
                          {
                            ...(lead !== undefined
                              ? { ["--faction"]: factionColor(lead) }
                              : {}),
                          } as React.CSSProperties
                        }
                      >
                        <MarkerGlyph symbol={m.markerSymbol} />
                      </span>
                      <span className="eu-map-list__text">
                        <span className="eu-map-list__title">{m.name}</span>
                        <span className="eu-map-list__meta">
                          {m.type} · {m.markerSymbol}
                          {m.factionAffinity.length > 0 &&
                            ` · ${m.factionAffinity.join("/")}`}
                          {m.tags.length > 0 && ` · #${m.tags.join(" #")}`}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="eu-map-btn eu-map-btn--danger eu-map-btn--sm"
                      onClick={() => onDelete(m.id)}
                      aria-label={`Delete ${m.name}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="eu-map-debug__section">
            <div className="eu-map-debug__section-head">
              <span>JSON import / export</span>
            </div>
            <div className="eu-map-debug__btns">
              <button type="button" className="eu-map-btn" onClick={handleExport}>
                Export ↓
              </button>
              <button type="button" className="eu-map-btn" onClick={handleCopy}>
                Copy
              </button>
              <button type="button" className="eu-map-btn" onClick={handleImport}>
                Import ↑
              </button>
              <button type="button" className="eu-map-btn" onClick={handleReseed}>
                Reset starters
              </button>
            </div>
            <textarea
              className="eu-map-debug__json"
              rows={8}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="Paste marker JSON here and press Import, or press Export to dump the current set."
              spellCheck={false}
            />
            {feedback !== null && (
              <p className="eu-map-debug__feedback">{feedback}</p>
            )}
          </div>

          <button
            type="button"
            className="eu-map-btn eu-map-debug__exit"
            onClick={onExit}
          >
            Exit notation mode
          </button>
        </div>
      )}
    </aside>
  );
}
