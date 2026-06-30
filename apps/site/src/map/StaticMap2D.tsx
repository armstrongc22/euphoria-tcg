import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  factionColor,
  upsertMarker,
  type MapMarker,
  type MarkerType,
} from "./markers";
import { MarkerGlyph } from "./MarkerGlyph";
import { MarkerForm } from "./MarkerForm";
import { MarkerPopup } from "./MarkerPopup";
import { DebugPanel } from "./DebugPanel";
import {
  isUnlockReached,
  readNotationUnlocked,
  registerTap,
  writeNotationUnlocked,
  type TapState,
} from "./notation";

const MAP_SRC = `${import.meta.env.BASE_URL}maps/euphoria-base-map.png`;
const MIN_SCALE = 1;
const MAX_SCALE = 6;
/** Pointer travel (px) under which a gesture counts as a click, not a drag/pan. */
const CLICK_SLOP = 5;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface StaticMap2DProps {
  readonly markers: MapMarker[];
  /** The same setter the container uses, so edits flow straight into shared state. */
  readonly onMarkersChange: Dispatch<SetStateAction<MapMarker[]>>;
}

/** Detect the hidden editor switch: ?mapDebug=1 anywhere in the query string. */
function isMapDebug(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mapDebug") === "1";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keep the (scaled) image covering the viewport — no empty gutters. */
function clampView(v: View, vpW: number, vpH: number): View {
  const minTx = vpW * (1 - v.scale);
  const minTy = vpH * (1 - v.scale);
  return {
    scale: v.scale,
    tx: clamp(v.tx, minTx, 0),
    ty: clamp(v.ty, minTy, 0),
  };
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; startTx: number; startTy: number; moved: boolean }
  | { kind: "marker"; id: string; startX: number; startY: number; moved: boolean }
  | null;

/**
 * The 2D static map and the source-of-truth notation editor. Normal visitors get
 * a responsive, zoom/pan map whose markers open lore popups. Notation (editor)
 * mode is hidden: it's revealed by the secret gesture of tapping the corner
 * compass emblem 5× within a few seconds (or via the ?mapDebug=1 developer
 * fallback). Once unlocked you can click to place a marker, drag to fine-tune,
 * edit/delete, and JSON import/export. Markers come from the container (shared
 * with the 3D preview); the unlock flag lives in sessionStorage so it never
 * leaks to normal visitors and resets each session.
 *
 * All pointer gestures are handled on the viewport with pointer capture, so a
 * drag keeps tracking outside the element and there are no global listeners to
 * leak. The gesture target (pan vs. a specific marker) is decided on pointerdown
 * from the DOM target; the zoom controls and compass live outside the viewport
 * so they never register as map clicks.
 */
export function StaticMap2D({ markers, onMarkersChange }: StaticMap2DProps) {
  const setMarkers = onMarkersChange;

  // `debug` (notation mode) is reactive: it can flip on/off at runtime via the
  // secret compass gesture or the Exit button, seeded from the ?mapDebug=1
  // fallback and any sessionStorage unlock from earlier this session.
  const [debug, setDebug] = useState<boolean>(
    () => isMapDebug() || readNotationUnlocked(),
  );
  const [toast, setToast] = useState<string | null>(null);
  const tapRef = useRef<TapState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<{ marker: MapMarker; isExisting: boolean } | null>(null);
  const [popup, setPopup] = useState<MapMarker | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const gestureRef = useRef<Gesture>(null);
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  /** Convert a client point to ORIGINAL natural image pixels (zoom-independent). */
  const clientToNatural = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (img === null || natural === null) return null;
      const r = img.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        x: clamp(((clientX - r.left) / r.width) * natural.w, 0, natural.w),
        y: clamp(((clientY - r.top) / r.height) * natural.h, 0, natural.h),
      };
    },
    [natural],
  );

  // ---- Zoom (non-passive wheel so we can preventDefault) -------------------
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp === null) return;
    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const rect = vp!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
        const worldX = (cx - prev.tx) / prev.scale;
        const worldY = (cy - prev.ty) / prev.scale;
        const next: View = { scale, tx: cx - worldX * scale, ty: cy - worldY * scale };
        return clampView(next, rect.width, rect.height);
      });
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Pointer gestures ----------------------------------------------------
  function onPointerDown(e: React.PointerEvent): void {
    const vp = viewportRef.current;
    if (vp === null) return;
    const markerEl = (e.target as HTMLElement).closest<HTMLElement>(".eu-map-marker");
    if (markerEl !== null && markerEl.dataset["id"] !== undefined) {
      gestureRef.current = {
        kind: "marker",
        id: markerEl.dataset["id"],
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    } else {
      const v = viewRef.current;
      gestureRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startTx: v.tx,
        startTy: v.ty,
        moved: false,
      };
    }
    vp.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const g = gestureRef.current;
    if (g === null) return;

    if (g.kind === "pan") {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) g.moved = true;
      const vp = viewportRef.current;
      if (vp === null) return;
      const rect = vp.getBoundingClientRect();
      setView(
        clampView(
          { scale: viewRef.current.scale, tx: g.startTx + dx, ty: g.startTy + dy },
          rect.width,
          rect.height,
        ),
      );
    } else {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) g.moved = true;
      // Marker drag is debug-only; in public mode a marker tap just opens lore.
      if (!debug || !g.moved) return;
      const nat = clientToNatural(e.clientX, e.clientY);
      if (nat === null) return;
      setMarkers((prev) =>
        prev.map((m) => (m.id === g.id ? { ...m, x: nat.x, y: nat.y } : m)),
      );
    }
  }

  function onPointerUp(e: React.PointerEvent): void {
    const vp = viewportRef.current;
    if (vp !== null && vp.hasPointerCapture(e.pointerId)) {
      vp.releasePointerCapture(e.pointerId);
    }
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g === null || g.moved) return;

    if (g.kind === "pan") {
      // Clean click on empty map → place a marker (debug only).
      if (!debug) return;
      const nat = clientToNatural(e.clientX, e.clientY);
      if (nat === null) return;
      setDraft({
        marker: {
          id: "",
          name: "",
          type: "city" as MarkerType,
          tags: [],
          markerSymbol: "circle",
          x: nat.x,
          y: nat.y,
          territory: "",
          factionAffinity: [],
          spoilerLevel: 0,
          description: "",
        },
        isExisting: false,
      });
    } else {
      const target = markers.find((m) => m.id === g.id);
      if (target === undefined) return;
      if (debug) setDraft({ marker: target, isExisting: true });
      else setPopup(target);
    }
  }

  // ---- Marker CRUD ---------------------------------------------------------
  function handleSave(marker: MapMarker): void {
    setMarkers((prev) => upsertMarker(prev, marker));
    setDraft(null);
  }
  function handleDelete(id: string): void {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
    setDraft(null);
  }
  function handleEditById(id: string): void {
    const target = markers.find((m) => m.id === id);
    if (target !== undefined) setDraft({ marker: target, isExisting: true });
  }

  // ---- Notation mode (secret unlock) ---------------------------------------
  function flashToast(message: string): void {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }
  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  /** Persist + announce a notation-mode change. */
  function setNotation(on: boolean): void {
    setDebug(on);
    writeNotationUnlocked(on);
    if (!on) setDraft(null);
    flashToast(on ? "Notation mode unlocked" : "Notation mode hidden");
  }

  /** The secret gesture: tapping the compass emblem N× within the window. */
  function handleEmblemTap(): void {
    const next = registerTap(tapRef.current, Date.now());
    tapRef.current = next;
    if (isUnlockReached(next)) {
      tapRef.current = null;
      setNotation(!debug);
    }
  }

  function zoomBy(factor: number): void {
    const vp = viewportRef.current;
    if (vp === null) return;
    const rect = vp.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setView((prev) => {
      const scale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (cx - prev.tx) / prev.scale;
      const worldY = (cy - prev.ty) / prev.scale;
      return clampView(
        { scale, tx: cx - worldX * scale, ty: cy - worldY * scale },
        rect.width,
        rect.height,
      );
    });
  }

  return (
    <div className={`eu-map-wrap${debug ? " eu-map-wrap--debug" : ""}`}>
      <div className="eu-map-stage">
        <div className="eu-map-frame">
          <div
            ref={viewportRef}
            className="eu-map-viewport"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="eu-map-canvas"
              style={{
                transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              }}
            >
              <img
                ref={imgRef}
                className="eu-map-img"
                src={MAP_SRC}
                alt="Map of the Euphoria worlds"
                draggable={false}
                onLoad={(e) =>
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
              />
              {natural !== null &&
                markers.map((m) => {
                  const faction = m.factionAffinity[0];
                  return (
                    <span
                      key={m.id}
                      className={`eu-map-marker${faction !== undefined ? " eu-map-marker--faction" : ""}`}
                      data-id={m.id}
                      data-type={m.type}
                      style={
                        {
                          left: `${(m.x / natural.w) * 100}%`,
                          top: `${(m.y / natural.h) * 100}%`,
                          ...(faction !== undefined
                            ? { ["--faction"]: factionColor(faction) }
                            : {}),
                        } as React.CSSProperties
                      }
                      title={m.name}
                      role="button"
                      aria-label={m.name}
                    >
                      <span className="eu-map-marker__glyph">
                        <MarkerGlyph symbol={m.markerSymbol} />
                      </span>
                      <span className="eu-map-marker__label">{m.name}</span>
                    </span>
                  );
                })}
            </div>
          </div>

          {/* Corner compass — reads as map decoration, but tapping it 5× is the
              secret gesture that toggles notation mode. */}
          <button
            type="button"
            className="eu-map-compass"
            onClick={handleEmblemTap}
            aria-label="Map compass"
            title="Euphoria"
          >
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="21" className="eu-map-compass__ring" />
              <circle cx="24" cy="24" r="15" className="eu-map-compass__ring2" />
              <polygon points="24,5 28,24 24,43 20,24" className="eu-map-compass__ns" />
              <polygon points="5,24 24,20 43,24 24,28" className="eu-map-compass__ew" />
              <circle cx="24" cy="24" r="2.4" className="eu-map-compass__hub" />
            </svg>
          </button>

          <div className="eu-map-zoom">
            <button type="button" className="eu-map-btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in">
              +
            </button>
            <button type="button" className="eu-map-btn" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">
              −
            </button>
            <button
              type="button"
              className="eu-map-btn"
              onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
              aria-label="Reset view"
            >
              ⤢
            </button>
          </div>

          {debug && (
            <p className="eu-map-badge">Debug · click to place · drag to move</p>
          )}
          {toast !== null && <p className="eu-map-toast">{toast}</p>}
        </div>

        {debug && (
          <DebugPanel
            markers={markers}
            onEdit={handleEditById}
            onDelete={handleDelete}
            onReplaceAll={setMarkers}
            onExit={() => setNotation(false)}
          />
        )}
      </div>

      {draft !== null && (
        <MarkerForm
          draft={draft.marker}
          isExisting={draft.isExisting}
          onSave={handleSave}
          onDelete={() => handleDelete(draft.marker.id)}
          onClose={() => setDraft(null)}
        />
      )}
      {popup !== null && (
        <MarkerPopup marker={popup} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}
