import type { ReactNode } from "react";
import type { MarkerSymbol } from "./markers";

/**
 * Pure SVG glyphs for marker symbols — fantasy map icons, not browser defaults.
 * Every shape is drawn in a 24×24 box and fills with `currentColor` so callers
 * control the ink via CSS; "cut-out" details use a dark wash so they read on the
 * light glyph. The shape is intentionally independent of faction color (which
 * the marker applies as a ring/glow around this glyph).
 */

const CUT = "rgba(8, 10, 16, 0.8)";

const SHAPES: Record<MarkerSymbol, ReactNode> = {
  circle: <circle cx="12" cy="12" r="9" />,
  square: <rect x="4" y="4" width="16" height="16" rx="2" />,
  triangle: <polygon points="12,3 21,20 3,20" />,
  diamond: <polygon points="12,2 22,12 12,22 2,12" />,
  pentagon: <polygon points="12,3 20.6,9.2 17.3,19.3 6.7,19.3 3.4,9.2" />,
  hexagon: (
    <polygon points="12,3 19.8,7.5 19.8,16.5 12,21 4.2,16.5 4.2,7.5" />
  ),
  octagon: (
    <polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8" />
  ),
  star: (
    <polygon points="12,2.5 14.2,9 21,9.1 15.5,13.2 17.6,19.8 12,15.8 6.4,19.8 8.5,13.2 3,9.1 9.8,9" />
  ),
  cross: (
    <polygon points="9,3 15,3 15,9 21,9 21,15 15,15 15,21 9,21 9,15 3,15 3,9 9,9" />
  ),
  tower: (
    <path d="M6 21 V8 H8 V10 H11 V8 H13 V10 H16 V8 H18 V21 Z" />
  ),
  temple: (
    <>
      <polygon points="12,3 21,9 3,9" />
      <rect x="5" y="9" width="2" height="8" />
      <rect x="9" y="9" width="2" height="8" />
      <rect x="13" y="9" width="2" height="8" />
      <rect x="17" y="9" width="2" height="8" />
      <rect x="3.5" y="17.5" width="17" height="2.5" rx="0.8" />
    </>
  ),
  skull: (
    <>
      <path d="M12 3c-4.2 0-7.5 3.1-7.5 7 0 2.5 1.3 4.6 3.3 5.9V19h2v-1.5h1V19h1v-1.5h1V19h2v-3.1c2-1.3 3.3-3.4 3.3-5.9C19.5 6.1 16.2 3 12 3z" />
      <circle cx="9" cy="10.5" r="1.8" fill={CUT} />
      <circle cx="15" cy="10.5" r="1.8" fill={CUT} />
      <polygon points="12,12 13,14.5 11,14.5" fill={CUT} />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke={CUT} strokeWidth="1" />
      <polygon points="12,8.5 13.6,12 12,15.5 10.4,12" fill={CUT} />
    </>
  ),
  scroll: (
    <>
      <rect x="6" y="6.5" width="12" height="11" rx="1.5" />
      <rect x="4.5" y="5" width="15" height="2.6" rx="1.3" />
      <rect x="4.5" y="16.4" width="15" height="2.6" rx="1.3" />
      <rect x="8.5" y="9.5" width="7" height="1.2" rx="0.6" fill={CUT} />
      <rect x="8.5" y="12.2" width="7" height="1.2" rx="0.6" fill={CUT} />
    </>
  ),
  flag: (
    <>
      <rect x="6" y="3" width="1.8" height="18" rx="0.6" />
      <path d="M7.8 3.6 H19 L16 7.2 L19 10.8 H7.8 Z" />
    </>
  ),
};

interface MarkerGlyphProps {
  readonly symbol: MarkerSymbol;
  readonly className?: string;
}

/** Render one marker symbol as an inline SVG (fills with the current text color). */
export function MarkerGlyph({ symbol, className }: MarkerGlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {SHAPES[symbol] ?? SHAPES.circle}
    </svg>
  );
}
