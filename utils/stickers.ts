// Free-floating stickers (sprites) that can be placed on the field and are
// saved with the play. Kept framework-agnostic so the editor canvas, the SVG
// thumbnail, and the PDF rasterizer all draw the exact same artwork.

export type StickerKind = "football";

export interface Sticker {
  id: string;
  kind: StickerKind;
  x: number;
  y: number;
  /** Degrees, clockwise. Defaults to a slight tilt so it looks placed by hand. */
  rotation?: number;
}

// Shared football artwork. The shape is an ellipse with a seam and four laces;
// every renderer draws from these numbers so thumbnails/PDFs match the canvas.
export const FOOTBALL_STICKER = {
  rx: 26,
  ry: 15,
  rotation: -18,
  body: "#8b4513",
  outline: "#1f2937",
  seam: "#f8fafc",
  laceXs: [-6, -2, 2, 6] as const,
  laceY: 4.5,
  seamHalfLength: 9,
  strokeWidth: 2,
} as const;

// Half-size used when computing export bounds so stickers are never clipped.
export const STICKER_EXTENT = Math.max(FOOTBALL_STICKER.rx, FOOTBALL_STICKER.ry) + 8;

export function createFootballSticker(id: string, x: number, y: number): Sticker {
  return { id, kind: "football", x, y, rotation: FOOTBALL_STICKER.rotation };
}
