"use client";
import React, { useState } from "react";
import { Stage, Layer, Circle, Arrow, Text } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";

// --- TYPES ---
export type Player = { id: string; x: number; y: number; color: string; label: string };
export type Route = { 
  id: string; 
  points: number[]; 
  color: string; 
  hasArrow: boolean; 
  isDashed: boolean 
};

interface PlayCanvasProps {
  players: Player[];
  routes: Route[];
  setRoutes: (r: Route[]) => void;
  setPlayers: (p: Player[]) => void;
  stageRef: any;
  onDeleteRoute: (id: string) => void;
  drawMode: 'free' | 'straight';
  hasArrow: boolean;
  isDashed: boolean;
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
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);

  // FIX: Use 'any' to prevent TypeScript errors between MouseEvent and TouchEvent
  const handleMouseDown = (e: KonvaEventObject<any>) => {
    const isClickingOnStage = e.target === e.target.getStage();
    if (!isClickingOnStage) return;

    setIsDrawing(true);
    
    const pos = e.target.getStage()?.getPointerPosition();
    if (pos) {
      setCurrentLine([pos.x, pos.y]);
    }
  };

  const handleMouseMove = (e: KonvaEventObject<any>) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    const point = stage?.getPointerPosition();
    
    if (point) {
      if (drawMode === 'straight') {
        setCurrentLine((prev) => [prev[0], prev[1], point.x, point.y]);
      } else {
        setCurrentLine((prev) => [...prev, point.x, point.y]);
      }
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;

    setIsDrawing(false);

    if (currentLine.length > 2) {
      const newRoute: Route = {
        id: crypto.randomUUID(),
        points: currentLine,
        color: "black",
        hasArrow: hasArrow,
        isDashed: isDashed
      };
      setRoutes([...routes, newRoute]);
    }
    
    setCurrentLine([]);
  };

  const handleDragEnd = (e: any, id: string) => {
    const newPlayers = players.map((p) =>
      p.id === id ? { ...p, x: e.target.x(), y: e.target.y() } : p
    );
    setPlayers(newPlayers);
  };

  return (
    <div className={`border-2 border-slate-300 rounded-lg overflow-hidden bg-green-50 shadow-inner ${drawMode === 'free' ? 'cursor-crosshair' : 'cursor-alias'}`}>
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
      >
        <Layer>
          {routes.map((route) => (
            <Arrow
              key={route.id}
              points={route.points}
              stroke={route.color}
              strokeWidth={4}
              fill={route.color}
              tension={drawMode === 'straight' ? 0 : 0.4}
              dash={route.isDashed ? [10, 10] : undefined}
              pointerLength={route.hasArrow ? 10 : 0}
              pointerWidth={route.hasArrow ? 10 : 0}
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

          {isDrawing && (
             <Arrow
               points={currentLine}
               stroke="black"
               strokeWidth={4}
               tension={drawMode === 'straight' ? 0 : 0.4}
               opacity={0.5}
               dash={isDashed ? [10, 10] : undefined}
               pointerLength={hasArrow ? 10 : 0}
               pointerWidth={hasArrow ? 10 : 0}
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