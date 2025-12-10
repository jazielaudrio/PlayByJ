"use client";
import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { generatePDF } from "@/utils/pdfGenerator";
import { v4 as uuidv4 } from "uuid"; 

const PlayCanvas = dynamic(() => import("@/components/PlayCanvas"), {
  ssr: false,
  loading: () => (
    <div className="w-[800px] h-[500px] bg-gray-200 animate-pulse flex items-center justify-center rounded-lg">
      <span className="text-gray-500 font-medium">Loading Field...</span>
    </div>
  ),
});

type Player = { id: string; x: number; y: number; color: string; label: string };
type Route = { id: string; points: number[]; color: string; hasArrow: boolean; isDashed: boolean };
type Play = { id: string; name: string; image: string };

type Playbook = {
  id: string;
  title: string;
  plays: Play[];
  updatedAt: number;
};

export default function PlaybookEditor() {
  const stageRef = useRef<any>(null);
  const [library, setLibrary] = useState<Playbook[]>([]);
  const [currentPlaybookId, setCurrentPlaybookId] = useState<string | null>(null);
  const [view, setView] = useState<'editor' | 'library'>('library');
  const [isLoaded, setIsLoaded] = useState(false);

  // Editor State
  const [playName, setPlayName] = useState("Untitled Play");
  const [currentPlays, setCurrentPlays] = useState<Play[]>([]);
  const [playbookTitle, setPlaybookTitle] = useState("My Playbook");
  
  // Tools State
  const [drawMode, setDrawMode] = useState<'free' | 'straight'>('free');
  const [hasArrow, setHasArrow] = useState(true);
  const [isDashed, setIsDashed] = useState(false);
  
  const defaultPlayers: Player[] = [
    { id: 'qb', x: 400, y: 400, color: 'red', label: 'QB' },
    { id: 'c', x: 400, y: 350, color: 'blue', label: 'C' },
    { id: 'wr1', x: 200, y: 350, color: 'orange', label: 'X' },
    { id: 'wr2', x: 600, y: 350, color: 'green', label: 'Y' },
    { id: 'rb', x: 450, y: 400, color: 'pink', label: 'Z' },
  ];
  
  const [players, setPlayers] = useState<Player[]>(defaultPlayers);
  const [routes, setRoutes] = useState<Route[]>([]);

  useEffect(() => {
    const savedLib = localStorage.getItem("flag_playmaker_library");
    if (savedLib) {
      try { setLibrary(JSON.parse(savedLib)); } catch (e) {}
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) localStorage.setItem("flag_playmaker_library", JSON.stringify(library));
  }, [library, isLoaded]);

  const createNewPlaybook = () => {
    const newBook: Playbook = { id: uuidv4(), title: "New Playbook", plays: [], updatedAt: Date.now() };
    setLibrary([newBook, ...library]);
    openPlaybook(newBook);
  };

  const openPlaybook = (book: Playbook) => {
    setCurrentPlaybookId(book.id);
    setPlaybookTitle(book.title);
    setCurrentPlays(book.plays);
    setView('editor');
    setRoutes([]);
    setPlayers(defaultPlayers);
    setPlayName("Untitled Play");
  };

  const deletePlaybook = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this entire playbook?")) {
      setLibrary(prev => prev.filter(b => b.id !== id));
      if (currentPlaybookId === id) setView('library');
    }
  };

  const updateCurrentPlaybook = (updatedPlays: Play[]) => {
    if (!currentPlaybookId) return;
    setCurrentPlays(updatedPlays);
    setLibrary(prev => prev.map(book => 
      book.id === currentPlaybookId ? { ...book, plays: updatedPlays, updatedAt: Date.now(), title: playbookTitle } : book
    ));
  };

  const savePlaybookTitle = (newTitle: string) => {
    setPlaybookTitle(newTitle);
    setLibrary(prev => prev.map(book => 
      book.id === currentPlaybookId ? { ...book, title: newTitle } : book
    ));
  };

  // --- IMPROVED AUTO-CROP ---
  const savePlaySnapshot = () => {
    if (!stageRef.current) return;

    // 1. Calculate Tight Boundaries
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Check Players
    players.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });

    // Check Routes
    routes.forEach(r => {
        for (let i = 0; i < r.points.length; i += 2) {
            const x = r.points[i];
            const y = r.points[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    });

    // Handle empty canvas
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 800; maxY = 500; }

    // 2. Add Padding (Tighter than before)
    const PADDING = 30;
    
    let x = minX - PADDING;
    let y = minY - PADDING;
    let w = (maxX - minX) + (PADDING * 2);
    let h = (maxY - minY) + (PADDING * 2);

    // 3. Prevent Negative Coordinates (Can't crop outside canvas)
    if (x < 0) { w += x; x = 0; } // Shrink width if shifting right
    if (y < 0) { h += y; y = 0; }

    // 4. Capture
    const config = {
      x: x,
      y: y,
      width: w,
      height: h,
      pixelRatio: 3 // Higher Quality for PDF
    };

    const dataUrl = stageRef.current.toDataURL(config);
    const newPlay = { id: uuidv4(), name: playName, image: dataUrl };
    
    updateCurrentPlaybook([...currentPlays, newPlay]);
    alert("Play Added!");
  };

  const deletePlay = (playId: string) => {
    if (confirm("Delete this play?")) {
      updateCurrentPlaybook(currentPlays.filter(p => p.id !== playId));
    }
  };

  const undoLastRoute = () => setRoutes(prev => prev.slice(0, -1));
  const deleteRoute = (id: string) => setRoutes(prev => prev.filter(r => r.id !== id));
  const clearRoutes = () => setRoutes([]);

  if (!isLoaded) return null;

  if (view === 'library') {
    return (
      <div className="min-h-screen bg-slate-50 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-extrabold text-slate-900">My Playbooks</h1>
              <p className="text-slate-500 mt-2">Manage your team's strategies.</p>
            </div>
            <button onClick={createNewPlaybook} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-lg font-bold transition flex items-center gap-2">
              + New Playbook
            </button>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {library.map((book) => (
              <div key={book.id} onClick={() => openPlaybook(book)} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-blue-300 cursor-pointer transition group relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 text-xl">📚</div>
                  <button onClick={(e) => deletePlaybook(book.id, e)} className="text-slate-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition">🗑</button>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">{book.title}</h3>
                <p className="text-sm text-slate-500">{book.plays.length} plays • {new Date(book.updatedAt).toLocaleDateString()}</p>
                <div className="flex gap-1 mt-4 h-12 overflow-hidden opacity-50">
                   {book.plays.slice(0, 3).map(p => <img key={p.id} src={p.image} className="h-full w-auto border rounded" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-800">
      <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('library')} className="text-gray-500 hover:text-blue-600 font-bold text-sm flex items-center gap-1">← Library</button>
          <div className="h-8 w-[1px] bg-gray-300 mx-2"></div>
          <div>
            <input value={playbookTitle} onChange={(e) => savePlaybookTitle(e.target.value)} className="text-2xl font-bold text-gray-900 bg-transparent hover:bg-white border border-transparent hover:border-gray-200 rounded px-1 -ml-1 focus:ring-2 focus:ring-blue-500 outline-none" />
            <p className="text-xs text-gray-500 mt-0.5">{currentPlays.length} Plays Saved</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => generatePDF(currentPlays, 'sheet')} className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg shadow-sm font-medium transition flex items-center gap-2"><span>📄</span> A4 Sheet</button>
          <button onClick={() => generatePDF(currentPlays, 'wristband')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg shadow-sm font-medium transition flex items-center gap-2"><span>⌚</span> Wristband</button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-1/4 space-y-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4">
            <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-400">Drawing Tools</h2>
            <div className="grid grid-cols-2 gap-2">
               <button onClick={() => setDrawMode('free')} className={`p-2 text-xs font-bold rounded border ${drawMode === 'free' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>✎ Freehand</button>
               <button onClick={() => setDrawMode('straight')} className={`p-2 text-xs font-bold rounded border ${drawMode === 'straight' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>📏 Straight</button>
               <button onClick={() => setIsDashed(false)} className={`p-2 text-xs font-bold rounded border ${!isDashed ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>⎯ Solid</button>
               <button onClick={() => setIsDashed(true)} className={`p-2 text-xs font-bold rounded border ${isDashed ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>--- Dashed</button>
               <button onClick={() => setHasArrow(true)} className={`p-2 text-xs font-bold rounded border ${hasArrow ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>➤ Arrow</button>
               <button onClick={() => setHasArrow(false)} className={`p-2 text-xs font-bold rounded border ${!hasArrow ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500'}`}>— Line</button>
            </div>
            <div className="pt-2 border-t border-gray-100">
               <label className="text-xs font-bold text-gray-500">Play Name</label>
               <input value={playName} onChange={(e) => setPlayName(e.target.value)} className="w-full mt-1 border border-gray-300 p-2 rounded text-sm focus:border-blue-500 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={undoLastRoute} className="bg-yellow-50 text-yellow-700 py-2 rounded text-xs font-bold hover:bg-yellow-100">Undo</button>
              <button onClick={clearRoutes} className="bg-red-50 text-red-700 py-2 rounded text-xs font-bold hover:bg-red-100">Clear</button>
            </div>
            <button onClick={savePlaySnapshot} className="w-full bg-slate-900 text-white py-3 rounded-lg hover:bg-slate-800 font-bold shadow-md mt-2">+ Add to Playbook</button>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 h-[380px] flex flex-col">
            <h3 className="font-semibold text-gray-700 mb-2">Plays in Book</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {currentPlays.map((p, idx) => (
                <div key={p.id} className="flex justify-between items-center p-2 border rounded hover:bg-gray-50 group">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="text-gray-400 font-mono text-xs">{idx + 1}</span>
                    <span className="text-sm font-medium truncate w-24">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src={p.image} className="w-8 h-5 object-cover border rounded bg-white" />
                    <button onClick={() => deletePlay(p.id)} className="text-gray-300 hover:text-red-500 transition">×</button>
                  </div>
                </div>
              ))}
              {currentPlays.length === 0 && <p className="text-center text-gray-400 text-xs mt-10">Empty Playbook</p>}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white p-1 rounded-xl shadow-sm border border-gray-200 flex justify-center items-center overflow-hidden relative">
            <PlayCanvas players={players} routes={routes} setPlayers={setPlayers} setRoutes={setRoutes} stageRef={stageRef} onDeleteRoute={deleteRoute} drawMode={drawMode} hasArrow={hasArrow} isDashed={isDashed} />
        </div>
      </div>
    </div>
  );
}