"use client";
import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Circle, Arrow, Text, Line } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";

// --- TYPES ---
export type Player = { id: string; x: number; y: number; color: string; label: string };
export type Route = {
  id: string;
  points: number[];
  color: string;
  hasArrow: boolean;
  isDashed: boolean;
  tension?: number;
  open?: boolean; // true = still chaining, plain left-drag strokes append to it
};

export type DrawMode = 'free' | 'straight' | 'curve';

interface PlayCanvasProps {
  players: Player[];
  routes: Route[];
  setRoutes: (r: Route[]) => void;
  setPlayers: (p: Player[]) => void;
  stageRef: any;
  onDeleteRoute: (id: string) => void;
  drawMode: DrawMode;
  hasArrow: boolean;
  isDashed: boolean;
}

// --- SMOOTHING HELPERS (fix shaky freehand arrow) ---
const MIN_POINT_DIST = 6; // ignore jitter smaller than this (px)
const RDP_EPSILON = 3; // simplification tolerance (px)
const ARROW_ANCHOR_LEN = 20; // arrow direction measured over at least this length
const CHAIN_JOIN_RADIUS = 30; // new plain stroke within this of chain end continues it
const CHAIN_TAIL_POINTS = 3; // seed smoothing with this many tail points for kink-free joints

function simplifyRDP(points: number[], epsilon: number): number[] {
  if (points.length <= 6) return points;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const [sx, sy] = pts[s];
    const [ex, ey] = pts[e];
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      const dist = Math.abs(dy * px - dx * py + ex * sy - ey * sx) / len;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon && index !== -1) {
      keep[index] = true;
      stack.push([s, index], [index, e]);
    }
  }
  const out: number[] = [];
  pts.forEach(([x, y], i) => {
    if (keep[i]) out.push(x, y);
  });
  return out;
}

function smoothMovingAverage(points: number[]): number[] {
  if (points.length <= 6) return points;
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    out.push(
      (points[i - 2] + points[i] + points[i + 2]) / 3,
      (points[i - 1] + points[i + 1] + points[i + 3]) / 3
    );
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

// Blend a new stroke with the tail of the line being continued so the
// joint inherits the existing direction instead of forming a kink.
function smoothWithTail(raw: number[], tail: number[] | null): number[] {
  if (!tail || tail.length < 4 || raw.length < 2) return smoothMovingAverage(raw);
  const full = smoothMovingAverage([...tail, ...raw]);
  return full.slice(tail.length);
}

// Force the final segment (which sets the arrowhead angle) to be measured
// over a stable distance so endpoint jitter doesn't spin the arrow.
function stabilizeEnd(points: number[], minLen: number): number[] {
  if (points.length < 6) return points;
  const ex = points[points.length - 2];
  const ey = points[points.length - 1];
  let anchorIdx = points.length - 4;
  for (let i = points.length - 4; i >= 0; i -= 2) {
    const d = Math.hypot(ex - points[i], ey - points[i + 1]);
    if (d >= minLen) {
      anchorIdx = i;
      break;
    }
    anchorIdx = i;
  }
  return [
    ...points.slice(0, anchorIdx),
    points[anchorIdx],
    points[anchorIdx + 1],
    ex,
    ey,
  ];
}

// Fit a clean quadratic bezier through a freehand gesture:
// start -> end, control = point farthest from the chord. Sampled to 25 points.
function fitQuadraticCurve(raw: number[]): number[] {
  if (raw.length < 8) return raw;
  const sx = raw[0];
  const sy = raw[1];
  const ex = raw[raw.length - 2];
  const ey = raw[raw.length - 1];
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 10) return [sx, sy, ex, ey];
  let bestDist = 0;
  let cx = (sx + ex) / 2;
  let cy = (sy + ey) / 2;
  for (let i = 2; i < raw.length - 2; i += 2) {
    const px = raw[i];
    const py = raw[i + 1];
    const dist = Math.abs(dy * px - dx * py + ex * sy - ey * sx) / len;
    if (dist > bestDist) {
      bestDist = dist;
      // Control point mirrored: quadratic midpoint = (P0 + 2C + P2)/4,
      // so C = 2*midOnCurve - midpoint(P0,P2)
      cx = 2 * px - (sx + ex) / 2;
      cy = 2 * py - (sy + ey) / 2;
    }
  }
  // Gesture was basically straight — keep it straight
  if (bestDist < 8) return [sx, sy, ex, ey];
  const out: number[] = [];
  const SEGMENTS = 24;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const mt = 1 - t;
    out.push(
      mt * mt * sx + 2 * mt * t * cx + t * t * ex,
      mt * mt * sy + 2 * mt * t * cy + t * t * ey
    );
  }
  return out;
}

const PlayCanvas = ({
  players,
  routes,
  setRoutes,
  setPlayers,
  stageRef,
  onDeleteRoute,
  drawMode = 'free',
  hasArrow = true,
  isDashed = false
}: PlayCanvasProps) => {
  // 20 yards total, one line every 5 yards (4 gaps x 100px)
  const YARD_LINES = [
    { y: 50, label: "20" },
    { y: 150, label: "15" },
    { y: 250, label: "10" },
    { y: 350, label: "5" },
    { y: 450, label: "0" },
  ];

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);
  const [currentArrow, setCurrentArrow] = useState(hasArrow);
  const rawRef = useRef<number[]>([]);
  const seedTailRef = useRef<number[] | null>(null);
  const seedRouteIdRef = useRef<string | null>(null);

  const hasOpenChain = routes.some((r) => r.open);

  // Esc finishes the open chained line (keeps it as a plain line)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && routes.some((r) => r.open)) {
        setRoutes(routes.map((r) => (r.open ? { ...r, open: false } : r)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routes, setRoutes]);

  const finishOpenChain = () => {
    setRoutes(routes.map((r) => (r.open ? { ...r, open: false } : r)));
  };

  const resolveArrowForEvent = (e: KonvaEventObject<any>): boolean => {
    // Arrow mode: every stroke ends the line with an arrow, any button.
    if (hasArrow) return true;
    const evt: any = (e as any).evt;
    // Touch / pen without buttons: fall back to the toolbar toggle (plain here)
    if (!evt || typeof evt.button !== "number" || evt.type?.startsWith("touch")) {
      return false;
    }
    // Line mode: left-drag = plain (chains), right-drag = arrow (ends the line)
    return evt.button === 2;
  };

  // The most recent open line we can continue (same dash style only)
  const getChainable = (list: Route[]): { route: Route; end: { x: number; y: number } } | null => {
    const last = list.length ? list[list.length - 1] : null;
    if (last && last.open && !last.hasArrow && last.isDashed === isDashed && last.points.length >= 2) {
      return {
        route: last,
        end: { x: last.points[last.points.length - 2], y: last.points[last.points.length - 1] },
      };
    }
    return null;
  };

  // FIX: Use 'any' to prevent TypeScript errors between MouseEvent and TouchEvent
  const handleMouseDown = (e: KonvaEventObject<any>) => {
    const target: any = e.target;
    const stage = target.getStage();
    const isJoint = typeof target.name === "function" && target.name() === "chain-joint";
    if (target !== stage && !isJoint) return;

    const pos = stage?.getPointerPosition();
    if (!pos) return;

    const arrow = resolveArrowForEvent(e);

    // Pressing the blue dot (or near an open end) grabs the line:
    // seed smoothing with its tail so the continuation flows, not kinks.
    let tail: number[] | null = null;
    let seedId: string | null = null;
    let snapX = pos.x;
    let snapY = pos.y;
    if (!arrow) {
      const pressedId = isJoint && typeof target.id === "function" ? (target.id() as string) : null;
      const pressed = pressedId
        ? routes.find((r) => r.id === pressedId && r.open && !r.hasArrow && r.isDashed === isDashed)
        : undefined;
      const candidate = pressed
        ? {
            route: pressed,
            end: {
              x: pressed.points[pressed.points.length - 2],
              y: pressed.points[pressed.points.length - 1],
            },
          }
        : getChainable(routes);
      if (candidate && candidate.route.points.length >= 2) {
        const d = Math.hypot(pos.x - candidate.end.x, pos.y - candidate.end.y);
        if (isJoint || d <= CHAIN_JOIN_RADIUS) {
          tail = candidate.route.points.slice(-CHAIN_TAIL_POINTS * 2);
          seedId = candidate.route.id;
          snapX = candidate.end.x;
          snapY = candidate.end.y;
        }
      }
    }

    seedTailRef.current = tail;
    seedRouteIdRef.current = seedId;
    rawRef.current = [snapX, snapY];
    setCurrentArrow(arrow);
    setCurrentLine([snapX, snapY]);
    setIsDrawing(true);
  };

  const pushFreehandPoint = (point: { x: number; y: number }) => {
    const raw = rawRef.current;
    const n = raw.length;
    if (n >= 2) {
      const dx = point.x - raw[n - 2];
      const dy = point.y - raw[n - 1];
      if (Math.hypot(dx, dy) < MIN_POINT_DIST) return; // drop jitter
    }
    raw.push(point.x, point.y);
    if (drawMode === 'curve') {
      setCurrentLine(fitQuadraticCurve([...raw]));
    } else {
      setCurrentLine(smoothWithTail([...raw], seedTailRef.current));
    }
  };

  const handleMouseMove = (e: KonvaEventObject<any>) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    const point = stage?.getPointerPosition();
    if (!point) return;

    if (drawMode === 'straight') {
      const raw = rawRef.current;
      setCurrentLine([raw[0], raw[1], point.x, point.y]);
    } else {
      pushFreehandPoint(point);
    }
  };

  // Build the cleaned points for the stroke that just ended (without arrow logic).
  const buildSegment = (raw: number[], dragLine: number[], tail: number[] | null): { points: number[]; tension: number } | null => {
    if (drawMode === 'straight') {
      if (dragLine.length < 4) return null;
      return { points: [...dragLine], tension: 0 };
    }
    if (drawMode === 'curve') {
      const fitted = fitQuadraticCurve(raw);
      if (fitted.length < 4) return null;
      return { points: fitted, tension: 0.3 };
    }
    const cleaned = simplifyRDP(smoothWithTail(raw, tail), RDP_EPSILON);
    if (cleaned.length < 4) return null;
    return { points: cleaned, tension: 0.5 };
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;

    setIsDrawing(false);

    const raw = rawRef.current;
    const tail = seedTailRef.current;
    const seedId = seedRouteIdRef.current;
    const seg = buildSegment(raw, currentLine, tail);
    rawRef.current = [];
    seedTailRef.current = null;
    seedRouteIdRef.current = null;
    setCurrentLine([]);
    if (!seg) return;

    // Continue the grabbed line if it's still open, else the latest chainable one
    const seeded = seedId ? routes.find((r) => r.id === seedId) : undefined;
    const last = routes.length ? routes[routes.length - 1] : null;
    const isChainable = (r: Route | null | undefined): r is Route =>
      !!r && !!r.open && !r.hasArrow && r.isDashed === isDashed && r.points.length >= 2;
    const chainable =
      seeded && isChainable(seeded) ? seeded : isChainable(last) ? last : null;
    const chainEnd = chainable
      ? { x: chainable.points[chainable.points.length - 2], y: chainable.points[chainable.points.length - 1] }
      : null;
    const strokeStart = { x: seg.points[0], y: seg.points[1] };
    const continuesChain =
      !!chainable &&
      !!chainEnd &&
      Math.hypot(strokeStart.x - chainEnd.x, strokeStart.y - chainEnd.y) <= CHAIN_JOIN_RADIUS;

    if (!currentArrow) {
      // PLAIN stroke: keep chaining — merge into the open line or start a new one
      if (continuesChain && chainable && chainEnd) {
        const snapped = [...seg.points];
        snapped[0] = chainEnd.x;
        snapped[1] = chainEnd.y;
        const merged = [...chainable.points, ...snapped.slice(2)];
        setRoutes(routes.map((r) => (r.id === chainable.id ? { ...chainable, points: merged } : r)));
      } else {
        const closed = routes.map((r) => (r.open ? { ...r, open: false } : r));
        const newRoute: Route = {
          id: crypto.randomUUID(),
          points: seg.points,
          color: "black",
          hasArrow: false,
          isDashed: isDashed,
          tension: seg.tension,
          open: true,
        };
        setRoutes([...closed, newRoute]);
      }
    } else {
      // ARROW stroke: ends the line
      if (continuesChain && chainable) {
        const combined = [...chainable.points, ...seg.points.slice(2)];
        const stabilized = stabilizeEnd(combined, ARROW_ANCHOR_LEN);
        setRoutes(
          routes.map((r) =>
            r.id === chainable.id ? { ...chainable, points: stabilized, hasArrow: true, open: false } : r
          )
        );
      } else {
        const closed = routes.map((r) => (r.open ? { ...r, open: false } : r));
        const stabilized = stabilizeEnd(seg.points, ARROW_ANCHOR_LEN);
        const newRoute: Route = {
          id: crypto.randomUUID(),
          points: stabilized,
          color: "black",
          hasArrow: true,
          isDashed: isDashed,
          tension: seg.tension,
          open: false,
        };
        setRoutes([...closed, newRoute]);
      }
    }
  };

  const handleDragEnd = (e: any, id: string) => {
    const newPlayers = players.map((p) =>
      p.id === id ? { ...p, x: e.target.x(), y: e.target.y() } : p
    );
    setPlayers(newPlayers);
  };

  const previewTension = drawMode === 'straight' ? 0 : drawMode === 'curve' ? 0.3 : 0.5;

  return (
    <div
      className={`relative border-2 border-slate-300 rounded-lg overflow-hidden bg-green-50 shadow-inner ${drawMode === 'free' ? 'cursor-crosshair' : 'cursor-alias'}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasOpenChain && (
        <button
          onClick={finishOpenChain}
          className="absolute top-2 right-2 z-10 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg px-3 py-1.5 shadow transition"
        >
          Finish line (Esc)
        </button>
      )}
      <Stage
        width={800}
        height={500}
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        {/* Yard lines background - non-interactive so drawing still works */}
        <Layer listening={false}>
          {YARD_LINES.map((line) => (
            <React.Fragment key={line.y}>
              <Line
                points={[0, line.y, 800, line.y]}
                stroke="#94a3b8"
                strokeWidth={2}
                opacity={0.7}
              />
              <Text
                x={8}
                y={line.y - 18}
                text={line.label}
                fontSize={12}
                fontStyle="bold"
                fill="#64748b"
              />
              <Text
                x={778}
                y={line.y - 18}
                text={line.label}
                fontSize={12}
                fontStyle="bold"
                fill="#64748b"
              />
            </React.Fragment>
          ))}
        </Layer>
        <Layer>
          {routes.map((route) => (
            <Arrow
              key={route.id}
              points={route.points}
              stroke={route.color}
              strokeWidth={4}
              fill={route.color}
              tension={route.tension ?? 0.4}
              dash={route.isDashed ? [10, 10] : undefined}
              pointerLength={route.hasArrow ? 12 : 0}
              pointerWidth={route.hasArrow ? 12 : 0}
              lineCap="round"
              lineJoin="round"
              onDblClick={() => onDeleteRoute(route.id)}
              onTap={() => onDeleteRoute(route.id)}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "pointer";
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = drawMode === 'free' ? 'crosshair' : 'alias';
              }}
            />
          ))}

          {/* Live endpoint marker for the chained (open) line — press it to continue */}
          {routes.map((route) =>
            route.open && route.points.length >= 2 ? (
              <Circle
                key={`${route.id}-joint`}
                name="chain-joint"
                id={route.id}
                x={route.points[route.points.length - 2]}
                y={route.points[route.points.length - 1]}
                radius={7}
                fill="#2563eb"
                stroke="white"
                strokeWidth={2}
                hitStrokeWidth={12}
                onMouseEnter={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = "crosshair";
                  (e.target as any).scale({ x: 1.5, y: 1.5 });
                }}
                onMouseLeave={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = drawMode === 'free' ? 'crosshair' : 'alias';
                  (e.target as any).scale({ x: 1, y: 1 });
                }}
              />
            ) : null
          )}

          {isDrawing && (
             <Arrow
               points={currentLine}
               stroke="black"
               strokeWidth={4}
               tension={previewTension}
               opacity={0.5}
               dash={isDashed ? [10, 10] : undefined}
               pointerLength={currentArrow ? 12 : 0}
               pointerWidth={currentArrow ? 12 : 0}
               lineCap="round"
               lineJoin="round"
             />
          )}

          {players.map((player) => (
            <React.Fragment key={player.id}>
              <Circle
                x={player.x}
                y={player.y}
                radius={16}
                fill={player.color}
                stroke="black"
                strokeWidth={2}
                draggable
                onDragEnd={(e) => handleDragEnd(e, player.id)}
                onMouseDown={(e) => e.cancelBubble = true}
                onTouchStart={(e) => e.cancelBubble = true}
                onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = "grab";
                }}
                onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = drawMode === 'free' ? 'crosshair' : 'alias';
                }}
              />
              <Text
                x={player.x - 7}
                y={player.y - 6}
                text={player.label}
                fontSize={13}
                fontStyle="bold"
                fill="white"
                listening={false}
              />
            </React.Fragment>
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export default PlayCanvas;
