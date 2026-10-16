"use client";
import React from "react";

// Lightweight SVG diagram renderer for plays that have vectors but no
// snapshot image (e.g. the built-in sample playbook). Same 800x500
// coordinate system and yard lines as the Konva field.

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
  className?: string;
}

const YARD_LINES = [50, 150, 250, 350, 450];

function toPairs(points: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(" ");
}

export default function PlayDiagram({ players, routes, className }: PlayDiagramProps) {
  return (
    <svg viewBox="0 0 800 500" className={className} role="img">
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
      <rect x="0" y="0" width="800" height="500" fill="#f0fdf4" />
      {YARD_LINES.map((y) => (
        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#94a3b8" strokeWidth="2" opacity="0.7" />
      ))}
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
    </svg>
  );
}
