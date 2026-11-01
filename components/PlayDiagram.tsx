"use client";
import React from "react";
import { FIELD_W, FIELD_H, LOS_Y } from "@/utils/field";
import { FOOTBALL_STICKER, type Sticker } from "@/utils/stickers";

// Lightweight SVG diagram renderer for plays that have vectors but no
// snapshot image (e.g. the built-in sample playbook). Same 800x500
// coordinate system and line of scrimmage as the Konva field.

export interface DiagramPlayer {
  x: number;
  y: number;
  color: string;
  label: string;
}

export interface DiagramRoute {
  points: number[];
  color: string;
  hasArrow: boolean;
  isDashed: boolean;
}

interface PlayDiagramProps {
  players: DiagramPlayer[];
  routes: DiagramRoute[];
  stickers?: Sticker[];
  className?: string;
}

function toPairs(points: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(" ");
}

export default function PlayDiagram({ players, routes, stickers, className }: PlayDiagramProps) {
  return (
    <svg viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} className={className} role="img">
      <defs>
        <marker
          id="pd-arrow"
          viewBox="0 0 20 20"
          refX="16"
          refY="10"
          markerWidth="20"
          markerHeight="20"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M2,3 L17,10 L2,17 z" fill="#111" />
        </marker>
      </defs>
      <rect x="0" y="0" width={FIELD_W} height={FIELD_H} fill="#f0fdf4" />
      {/* Line of scrimmage — the single reference line */}
      <line x1="0" y1={LOS_Y} x2={FIELD_W} y2={LOS_Y} stroke="#64748b" strokeWidth="2.5" />
      {routes.map((r, i) => (
        <polyline
          key={i}
          points={toPairs(r.points)}
          fill="none"
          stroke={r.color === "black" ? "#111" : r.color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={r.isDashed ? "12 10" : undefined}
          markerEnd={r.hasArrow ? "url(#pd-arrow)" : undefined}
        />
      ))}
      {players.map((p) => (
        <React.Fragment key={`${p.x}-${p.y}-${p.label}`}>
          <circle cx={p.x} cy={p.y} r="17" fill={p.color} stroke="#000" strokeWidth="3" />
          <text
            x={p.x}
            y={p.y + 8}
            textAnchor="middle"
            fontSize="24"
            fontWeight="800"
            fill="#fff"
            fontFamily="sans-serif"
          >
            {p.label}
          </text>
        </React.Fragment>
      ))}
      {stickers?.map((s) => {
        const f = FOOTBALL_STICKER;
        return (
          <g key={s.id} transform={`translate(${s.x} ${s.y}) rotate(${s.rotation ?? f.rotation})`}>
            <ellipse rx={f.rx} ry={f.ry} fill={f.body} stroke={f.outline} strokeWidth={f.strokeWidth} />
            <line
              x1={-f.seamHalfLength}
              y1={0}
              x2={f.seamHalfLength}
              y2={0}
              stroke={f.seam}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {f.laceXs.map((x) => (
              <line
                key={x}
                x1={x}
                y1={-f.laceY}
                x2={x}
                y2={f.laceY}
                stroke={f.seam}
                strokeWidth="2"
                strokeLinecap="round"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
