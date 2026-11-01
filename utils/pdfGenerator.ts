import jsPDF from "jspdf";
import { FIELD_W, FIELD_H, LOS_Y } from "./field";
import { FOOTBALL_STICKER, STICKER_EXTENT, type Sticker as DiagramSticker } from "./stickers";

type DiagramPlayer = { x: number; y: number; color: string; label: string };
type DiagramRoute = {
  points: number[];
  color: string;
  hasArrow: boolean;
  isDashed: boolean;
  tension?: number;
};

type Play = {
  id: string;
  name: string;
  image?: string; // legacy snapshot (cropped to content, so size varies)
  players?: DiagramPlayer[]; // vector data — used for consistent-size export
  routes?: DiagramRoute[];
  stickers?: DiagramSticker[];
};

// Fixed field size shared by the editor canvas and PlayDiagram. Every play
// is rasterized from this same coordinate system so all exported diagrams end
// up with the same dimensions AND the same scale (formations/LOS line up
// across cells, like a PlayMaker-style sheet).
const STAGE_W = FIELD_W;
const STAGE_H = FIELD_H;
const EXPORT_PIXEL_RATIO = 3; // render at 3x so print output stays crisp
const FIELD_BG = "#f0fdf4"; // matches the editor field (bg-green-50)

// Editor-parity constants (see PlayCanvas): routes are Konva Arrows drawn
// with a tensioned spline, strokeWidth 4 and a 12x12 pointer.
const DEFAULT_TENSION = 0.4; // PlayCanvas uses `route.tension ?? 0.4`
const ROUTE_WIDTH = 4;
const POINTER_LENGTH = 12;
const POINTER_WIDTH = 12;
const PLAYER_RADIUS = 16;
const LOS_WIDTH = 2.5;

// ---------------------------------------------------------------------------
// Shared field window
// ---------------------------------------------------------------------------
// The 800x500 editor field has a lot of empty grass (especially above the
// routes). One window is computed for the WHOLE export, trimmed to the area
// every play actually uses, so that:
//   * all cells keep the exact same scale (consistent sheet), and
//   * each drawing fills its frame instead of floating in a big empty box.
// The window is only ever EXPANDED relative to the shared bounding box, so
// nothing can ever be clipped, and the LOS is always kept inside it.
type FieldWindow = { x: number; y: number; w: number; h: number };

const PLAYER_EXTENT = PLAYER_RADIUS + 3; // circle radius + its stroke
const ROUTE_EXTENT = ROUTE_WIDTH; // round cap sticking out past the last point
const MIN_WINDOW_W = 400; // never zoom in so far that linework turns into blobs
const MIN_WINDOW_H = 250;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const computeContentWindow = (plays: Play[]): FieldWindow => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const grow = (x: number, y: number, r: number) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };

  plays.forEach((p) => {
    (p.players ?? []).forEach((pl) => grow(pl.x, pl.y, PLAYER_EXTENT));
    (p.routes ?? []).forEach((r) => {
      const pts = r.points ?? [];
      for (let i = 0; i + 1 < pts.length; i += 2) grow(pts[i], pts[i + 1], ROUTE_EXTENT);
    });
    (p.stickers ?? []).forEach((s) => grow(s.x, s.y, STICKER_EXTENT));
  });

  // No vector data at all (legacy image plays) → keep the full field.
  if (!isFinite(minX)) return { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

  // The line of scrimmage is the reference every play is read against —
  // always keep it inside the window.
  minY = Math.min(minY, LOS_Y);
  maxY = Math.max(maxY, LOS_Y);

  let x = minX;
  let y = minY;
  let w = maxX - minX;
  let h = maxY - minY;

  if (w < MIN_WINDOW_W) {
    const c = x + w / 2;
    w = MIN_WINDOW_W;
    x = c - w / 2;
  }
  if (h < MIN_WINDOW_H) {
    const c = y + h / 2;
    h = MIN_WINDOW_H;
    y = c - h / 2;
  }

  // Keep the window inside the field. Content always lives inside the field,
  // so this can only limit how far we expand — it can never clip anything.
  w = Math.min(w, STAGE_W);
  h = Math.min(h, STAGE_H);
  x = clamp(x, 0, STAGE_W - w);
  y = clamp(y, 0, STAGE_H - h);

  return { x, y, w, h };
};

// Expand (never shrink) a window until its aspect matches the cell it will be
// printed in, so the diagram fills the frame edge to edge. Only empty field is
// added, so the play keeps exactly the same printed size — the white/green
// gutters around it simply disappear.
const expandWindowToAspect = (win: FieldWindow, target: number): FieldWindow => {
  if (!(target > 0) || !isFinite(target)) return win;
  let { x, y, w, h } = win;
  const aspect = w / h;

  if (aspect < target) {
    // Too tall for the cell → add field on the left/right.
    const newW = clamp(h * target, w, STAGE_W);
    x = clamp(x + w / 2 - newW / 2, 0, STAGE_W - newW);
    w = newW;
  } else if (aspect > target) {
    // Too wide for the cell → add field above/below.
    const newH = clamp(w / target, h, STAGE_H);
    y = clamp(y + h / 2 - newH / 2, 0, STAGE_H - newH);
    h = newH;
  }

  return { x, y, w, h };
};

// ---------------------------------------------------------------------------
// Konva-exact route geometry
// ---------------------------------------------------------------------------
// The editor renders routes with Konva's tensioned Line/Arrow. The export
// ports that exact math so the printed curve — and, crucially, the angle of
// every route and arrowhead — matches what was drawn on screen.
// (ported from konva/lib/shapes/Line.js + Arrow.js)
function getControlPoints(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  t: number
): [number, number, number, number] {
  const d01 = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2));
  const d12 = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  const fa = (t * d01) / (d01 + d12);
  const fb = (t * d12) / (d01 + d12);
  return [
    x1 - fa * (x2 - x0),
    y1 - fa * (y2 - y0),
    x1 + fb * (x2 - x0),
    y1 + fb * (y2 - y0),
  ];
}

function expandPoints(p: number[], tension: number): number[] {
  const len = p.length;
  const allPoints: number[] = [];
  for (let n = 2; n < len - 2; n += 2) {
    const cp = getControlPoints(p[n - 2], p[n - 1], p[n], p[n + 1], p[n + 2], p[n + 3], tension);
    if (isNaN(cp[0])) continue;
    allPoints.push(cp[0], cp[1], p[n], p[n + 1], cp[2], cp[3]);
  }
  return allPoints;
}

// Length of a cubic bezier (Konva evaluates the same integral with
// Gauss-Legendre; Simpson over 64 slices agrees to far below a pixel).
function cubicArcLength(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number
): number {
  const N = 64;
  const speed = (t: number) => {
    const mt = 1 - t;
    const bx = 3 * mt * mt * (p1x - p0x) + 6 * mt * t * (p2x - p1x) + 3 * t * t * (p3x - p2x);
    const by = 3 * mt * mt * (p1y - p0y) + 6 * mt * t * (p2y - p1y) + 3 * t * t * (p3y - p2y);
    return Math.hypot(bx, by);
  };
  const h = 1 / N;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const t0 = i * h;
    sum += speed(t0) + 4 * speed(t0 + h / 2) + speed(t0 + h);
  }
  return (sum * h) / 6;
}

// Stroke a route exactly like Konva's Line._sceneFunc: quadratic into the
// first segment, cubics through the middle, quadratic out of the last one.
function strokeKonvaPath(ctx: CanvasRenderingContext2D, pts: number[], tension: number) {
  ctx.moveTo(pts[0], pts[1]);

  if (tension !== 0 && pts.length > 4) {
    const tp = expandPoints(pts, tension);
    if (tp.length >= 6) {
      ctx.quadraticCurveTo(tp[0], tp[1], tp[2], tp[3]);
      for (let n = 4; n < tp.length - 2; n += 6) {
        ctx.bezierCurveTo(tp[n], tp[n + 1], tp[n + 2], tp[n + 3], tp[n + 4], tp[n + 5]);
      }
      ctx.quadraticCurveTo(
        tp[tp.length - 2], tp[tp.length - 1],
        pts[pts.length - 2], pts[pts.length - 1]
      );
      return;
    }
  }

  for (let n = 2; n < pts.length; n += 2) ctx.lineTo(pts[n], pts[n + 1]);
}

// Direction of the arrowhead, measured the way Konva's Arrow measures it:
// back along the actual curve (not the chord between the last two points),
// so a curved route gets the correct tip angle.
function routeArrowVector(pts: number[], tension: number): { dx: number; dy: number } {
  const n = pts.length;

  if (tension !== 0 && pts.length > 4) {
    const tp = expandPoints(pts, tension);
    if (tp.length >= 6) {
      const ax = tp[tp.length - 4];
      const ay = tp[tp.length - 3];
      const cx = tp[tp.length - 2];
      const cy = tp[tp.length - 1];
      const ex = pts[n - 2];
      const ey = pts[n - 1];
      const lastLength = cubicArcLength(ax, ay, ax, ay, cx, cy, ex, ey);
      if (lastLength > 0) {
        const t = Math.min(1, 1 - POINTER_LENGTH / lastLength);
        const mt = 1 - t;
        // Point `pointerLength` back along the final quadratic segment.
        const px = ex * t * t + cx * 2 * t * mt + ax * mt * mt;
        const py = ey * t * t + cy * 2 * t * mt + ay * mt * mt;
        return { dx: ex - px, dy: ey - py };
      }
    }
  }

  return { dx: pts[n - 2] - pts[n - 4], dy: pts[n - 1] - pts[n - 3] };
}

// Filled triangle arrowhead — same geometry as Konva's Arrow pointer
// (12 long, 12 wide, filled AND stroked in the route color so the head
// grows by half the stroke width exactly like the editor).
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  endX: number,
  endY: number,
  angle: number,
  color: string
) {
  ctx.save();
  ctx.translate(endX, endY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-POINTER_LENGTH, POINTER_WIDTH / 2);
  ctx.lineTo(-POINTER_LENGTH, -POINTER_WIDTH / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = ROUTE_WIDTH;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 40)}...`));
    img.src = src;
  });

// Helper to convert remote URL to Base64 (legacy plays stored on storage)
const getBase64FromUrl = async (url: string): Promise<string> => {
  const data = await fetch(url);
  const blob = await data.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result;
      resolve(base64data as string);
    };
  });
};

// Rasterize one play onto the shared export window. Vector plays are drawn
// field-and-all so every diagram shares one scale; legacy image-only plays
// have their (variably cropped) snapshot centered on the same window so the
// exported cell keeps a consistent size either way.
const renderPlayPng = async (play: Play, win: FieldWindow): Promise<string | null> => {
  const hasVectors = (play.players?.length ?? 0) > 0 || (play.stickers?.length ?? 0) > 0;
  if (!hasVectors && !play.image) return null; // nothing to draw — cell exports header only

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(win.w * EXPORT_PIXEL_RATIO));
  canvas.height = Math.max(1, Math.round(win.h * EXPORT_PIXEL_RATIO));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Uniform scale in both axes: the field is never stretched, so every angle
  // the user drew comes out of the export at the same angle.
  ctx.scale(EXPORT_PIXEL_RATIO, EXPORT_PIXEL_RATIO);

  // Field background fills the whole window…
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, win.w, win.h);
  // …and stage coordinates are shifted so the window maps onto it.
  ctx.save();
  ctx.translate(-win.x, -win.y);

  if (hasVectors) {
    // Line of scrimmage
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = LOS_WIDTH;
    ctx.beginPath();
    ctx.moveTo(0, LOS_Y);
    ctx.lineTo(STAGE_W, LOS_Y);
    ctx.stroke();

    // Routes
    (play.routes ?? []).forEach((r) => {
      if (!r.points || r.points.length < 4) return;
      const stroke = r.color === "black" ? "#111" : r.color;
      const tension = r.tension ?? DEFAULT_TENSION;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = ROUTE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(r.isDashed ? [10, 10] : []);
      ctx.beginPath();
      strokeKonvaPath(ctx, r.points, tension);
      ctx.stroke();
      ctx.setLineDash([]);
      if (r.hasArrow) {
        const v = routeArrowVector(r.points, tension);
        if ((v.dx || v.dy) && isFinite(v.dx) && isFinite(v.dy)) {
          drawArrowhead(
            ctx,
            r.points[r.points.length - 2],
            r.points[r.points.length - 1],
            Math.atan2(v.dy, v.dx),
            stroke
          );
        }
      }
      ctx.restore();
    });

    // Players
    (play.players ?? []).forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000";
      ctx.stroke();
      if (p.label) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.label, p.x, p.y + 1);
      }
    });

    // Stickers (drawn last so they sit on top, matching the editor)
    (play.stickers ?? []).forEach((s) => {
      const f = FOOTBALL_STICKER;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(((s.rotation ?? f.rotation) * Math.PI) / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.rx, f.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = f.body;
      ctx.fill();
      ctx.lineWidth = f.strokeWidth;
      ctx.strokeStyle = f.outline;
      ctx.stroke();

      ctx.strokeStyle = f.seam;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-f.seamHalfLength, 0);
      ctx.lineTo(f.seamHalfLength, 0);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      f.laceXs.forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, -f.laceY);
        ctx.lineTo(x, f.laceY);
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      ctx.restore();
    });
  } else if (play.image) {
    try {
      const src = play.image.startsWith("data:") ? play.image : await getBase64FromUrl(play.image);
      const img = await loadImage(src);
      const scale = Math.min(win.w / img.width, win.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, win.x + (win.w - w) / 2, win.y + (win.h - h) / 2, w, h);
    } catch (e) {
      console.error("Failed to rasterize play image", e);
      ctx.restore();
      return null;
    }
  }

  ctx.restore();
  return canvas.toDataURL("image/png");
};

// ---------------------------------------------------------------------------
// Adaptive A4 grid
// ---------------------------------------------------------------------------
// The old export hard-coded 4 columns x 6 rows, so every diagram was 47.5 mm
// wide no matter how few plays there are. Here every plausible grid is scored
// and the best one wins, under two guards:
//   * never more pages than the fixed 4x6 grid needed (24 plays per page),
//   * the diagram must fill at least 82% of its cell — no layouts that leave
//     big empty gutters around the play.
// 2 columns minimum: a single 190 mm column would blow the drawing up so far
// that route lines and player dots turn into blobs instead of staying in the
// same proportion as the editor.
const SHEET_BASE_CELLS = 24;
const SHEET_COLS_MIN = 2;
const SHEET_COLS_MAX = 4;
const SHEET_ROWS_MAX = 10;
const SHEET_HEADER_H = 7;
const MIN_DIAGRAM_MM = 40;
const MIN_FILL = 0.82;

// How a layout renders the shared window: the printed diagram box plus the
// scale it draws at (printed mm per field pixel) — scale is what decides how
// big the play actually LOOKS, and it is directly comparable across layouts
// because every layout rasterizes the same field coordinate system.
const evaluateLayout = (
  baseWin: FieldWindow,
  cellW: number,
  imgAreaH: number
): { win: FieldWindow; imgW: number; imgH: number; fill: number; scale: number } => {
  const win = expandWindowToAspect(baseWin, cellW / imgAreaH);
  const aspect = win.w / win.h;
  const imgH = Math.min(imgAreaH, cellW / aspect);
  const imgW = imgH * aspect;
  const fill = (imgW * imgH) / (cellW * imgAreaH);
  return { win, imgW, imgH, fill, scale: imgW / win.w };
};

// Lexicographic score: the play drawn as large as possible, then fewer pages,
// then tighter fill, then fewer (mostly empty) cells. Page count is still
// hard-capped at what the old fixed 4x6 grid needed, so an export never gets
// longer than it used to — it only gets bigger.
const scoreLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

const chooseSheetGrid = (
  n: number,
  contentW: number,
  contentH: number,
  baseWin: FieldWindow
): { cols: number; rows: number; win: FieldWindow } => {
  const maxPages = Math.max(1, Math.ceil(n / SHEET_BASE_CELLS));
  let best: { cols: number; rows: number; win: FieldWindow; score: number[] } | null = null;

  for (let cols = SHEET_COLS_MIN; cols <= SHEET_COLS_MAX; cols++) {
    for (let rows = 1; rows <= SHEET_ROWS_MAX; rows++) {
      const cells = cols * rows;
      const pages = Math.ceil(n / cells);
      if (pages > maxPages) continue;

      const cellW = contentW / cols;
      const imgAreaH = contentH / rows - SHEET_HEADER_H;
      if (imgAreaH < 8) continue;

      const layout = evaluateLayout(baseWin, cellW, imgAreaH);
      if (layout.imgW < MIN_DIAGRAM_MM) continue;
      if (layout.fill < MIN_FILL) continue;

      const score = [-layout.scale, pages, -layout.fill, cells];
      if (!best || scoreLess(score, best.score)) {
        best = { cols, rows, win: layout.win, score };
      }
    }
  }

  if (best) return { cols: best.cols, rows: best.rows, win: best.win };

  // Fallback (only for very large playbooks): keep the old 24-per-page density.
  const cols = SHEET_COLS_MAX;
  const rows = Math.max(1, Math.ceil(Math.ceil(n / maxPages) / cols));
  const cellW = contentW / cols;
  const imgAreaH = contentH / rows - SHEET_HEADER_H;
  const win = expandWindowToAspect(baseWin, cellW / Math.max(imgAreaH, 1));
  return { cols, rows, win };
};

// ---------------------------------------------------------------------------

export const generatePDF = async (
  playbook: Play[],
  format: 'sheet' | 'wristband',
  title: string = "Team Playbook"
) => {
  if (playbook.length === 0) {
    alert("No plays in playbook to export!");
    return;
  }

  const isWristband = format === 'wristband';

  // --- DIMENSIONS & CONFIGURATION (in mm) ---
  const PAGE_WIDTH = isWristband ? 130 : 210;
  const PAGE_HEIGHT = isWristband ? 70 : 297;

  // Grid Configuration
  // Sheet: adaptive (searched below) — as few pages as the old 4x6 grid
  // needed, with each diagram drawn as large as the page allows.
  // Wristband: 4 cols x 3 rows = 12 plays base, MAX 3 pages.
  // Overflow is divided as evenly as possible across exactly 3 pages
  // by growing the row count (cells shrink to fit).
  const BASE_WB_CELLS = 12;
  const MAX_WB_PAGES = 3;

  const MARGIN_X = isWristband ? 2 : 10;
  const MARGIN_TOP = isWristband ? 2 : 20;
  const MARGIN_BOTTOM = isWristband ? 2 : 10;

  const contentWidth = PAGE_WIDTH - (MARGIN_X * 2);
  const contentHeight = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  // One content window for the whole export → every cell shares one scale.
  const baseWin = computeContentWindow(playbook);

  let wbPageSizes: number[] = [];
  let COLS: number;
  let ROWS: number;
  let win: FieldWindow;

  if (isWristband) {
    const total = playbook.length;
    const pageCount = Math.min(MAX_WB_PAGES, Math.max(1, Math.ceil(total / BASE_WB_CELLS)));
    const baseSize = Math.floor(total / pageCount);
    const remainder = total % pageCount;
    // First `remainder` pages get one extra play (e.g. 40 plays -> 14/13/13)
    wbPageSizes = Array.from({ length: pageCount }, (_, i) => baseSize + (i < remainder ? 1 : 0));
    COLS = 4;
    ROWS = Math.max(3, Math.ceil(wbPageSizes[0] / COLS));
    const wbHeaderH = Math.max(2.4, 4.5 * Math.min(1, 3 / ROWS));
    const cellW = contentWidth / COLS;
    const imgAreaH = contentHeight / ROWS - wbHeaderH;
    win = expandWindowToAspect(baseWin, cellW / Math.max(imgAreaH, 1));
  } else {
    const grid = chooseSheetGrid(playbook.length, contentWidth, contentHeight, baseWin);
    COLS = grid.cols;
    ROWS = grid.rows;
    win = grid.win;
  }

  // Aspect of the exported diagram — used for every placement so the field
  // is scaled uniformly (never stretched) and route angles stay true.
  const winAspect = win.w / win.h;

  const CELLS_PER_PAGE = COLS * ROWS;

  // When the wristband grid grows past 4x3, shrink header/fonts proportionally
  const density = isWristband ? Math.min(1, 3 / ROWS) : 1;

  const cellWidth = contentWidth / COLS;
  const cellHeight = contentHeight / ROWS;

  const doc = new jsPDF({
    orientation: isWristband ? "landscape" : "portrait",
    unit: "mm",
    format: isWristband ? [130, 70] : "a4",
  });

  // Rasterize every play at the SAME window size so all diagrams in the
  // export share one consistent size and scale (plays without vectors fall
  // back to their snapshot, centered on the same window). Rendered one at a
  // time so we never hold a full page worth of canvases in memory.
  const playsWithData: Array<Play & { imageData: string | null }> = [];
  for (const p of playbook) {
    try {
      playsWithData.push({ ...p, imageData: await renderPlayPng(p, win) });
    } catch (e) {
      console.error("Failed to render play for PDF", e);
      playsWithData.push({ ...p, imageData: null });
    }
  }

  // Draw one play cell. globalIndex keeps numbering consistent (1..N) across pages.
  const drawPlayCell = (play: (typeof playsWithData)[number], globalIndex: number, col: number, row: number) => {
    const x = MARGIN_X + (col * cellWidth);
    const y = MARGIN_TOP + (row * cellHeight);

    // 1. Cell Border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellWidth, cellHeight);

    // 2. Header Strip (floored so text never overflows the strip at high density)
    const cellHeaderHeight = isWristband
      ? Math.max(2.4, 4.5 * density)
      : SHEET_HEADER_H;
    doc.setFillColor(51, 51, 51);
    doc.rect(x, y, cellWidth, cellHeaderHeight, "F");

    // 3. Number Box
    const numBoxWidth = isWristband ? 6 : 8;
    doc.setFillColor(255, 140, 0);
    doc.rect(x, y, numBoxWidth, cellHeaderHeight, "F");

    // 4. Text — exactly vertically centered (no fixed-mm offsets, which
    // break centering once the header shrinks at high play counts)
    const headerMidY = y + cellHeaderHeight / 2;
    doc.setTextColor(255, 255, 255);

    doc.setFontSize(isWristband ? Math.max(4, 7 * density) : 9);
    doc.setFont("helvetica", "bold");
    doc.text(`${globalIndex + 1}`, x + (numBoxWidth / 2), headerMidY, { align: "center", baseline: "middle" });

    const nameX = x + numBoxWidth + 1.5;
    doc.setFontSize(isWristband ? Math.max(4, 5.5 * density) : 7);
    doc.setFont("helvetica", "bold");

    const maxNameChar = isWristband ? 18 : 22;
    const displayName = play.name.length > maxNameChar
      ? play.name.substring(0, maxNameChar) + ".."
      : play.name;

    doc.text(displayName.toUpperCase(), nameX, headerMidY, { baseline: "middle" });

    // 5. Image — every diagram is the same window ratio, so this "contain"
    // fit yields identical dimensions in every cell and fills the frame.
    if (play.imageData) {
        const imgAreaX = x + 0.5;
        const imgAreaY = y + cellHeaderHeight + 0.5;
        const imgAreaW = cellWidth - 1;
        const imgAreaH = cellHeight - cellHeaderHeight - 1;

        if (imgAreaW > 2 && imgAreaH > 2) {
        try {
            const finalH = Math.min(imgAreaH, imgAreaW / winAspect);
            const finalW = finalH * winAspect;
            const finalX = imgAreaX + (imgAreaW - finalW) / 2;
            const finalY = imgAreaY + (imgAreaH - finalH) / 2;

            doc.addImage(play.imageData, "PNG", finalX, finalY, finalW, finalH, undefined, 'FAST');
        } catch (e) {
            console.error("Error adding image to PDF", e);
        }
        }
    }
  };

  if (isWristband) {
    // Max 3 pages, plays split as evenly as possible across them
    let cursor = 0;
    wbPageSizes.forEach((size, p) => {
      if (p > 0) doc.addPage();
      for (let j = 0; j < size; j++) {
        const play = playsWithData[cursor];
        drawPlayCell(play, cursor, j % COLS, Math.floor(j / COLS));
        cursor++;
      }
    });
    if (playbook.length > BASE_WB_CELLS * MAX_WB_PAGES) {
      console.info(
        `Wristband capped at ${MAX_WB_PAGES} pages: ${playbook.length} plays fit as ` +
        wbPageSizes.join("/") + " per page."
      );
    }
  } else {
    playsWithData.forEach((play, index) => {
      const positionOnPage = index % CELLS_PER_PAGE;

      if (positionOnPage === 0) {
        if (index > 0) doc.addPage();

        doc.setTextColor(40, 40, 40);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(title.toUpperCase(), MARGIN_X, 10);

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Offense", MARGIN_X, 15);

        const dateStr = new Date().toLocaleDateString();
        doc.setFontSize(8);
        doc.text(dateStr, PAGE_WIDTH - MARGIN_X, 10, { align: "right" });
      }

      const col = positionOnPage % COLS;
      const row = Math.floor(positionOnPage / COLS);

      drawPlayCell(play, index, col, row);
    });
  }

  doc.save(isWristband ? `wristband_${playbook.length}play.pdf` : "playbook_a4.pdf");
};
