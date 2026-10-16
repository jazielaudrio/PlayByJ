"use client";
import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { generatePDF } from "@/utils/pdfGenerator";
import { type PlayCategory, CATEGORY_META } from "@/utils/playcall";
import { SAMPLE_BOOK_ID, SAMPLE_BOOK_TITLE, SAMPLE_PLAYS } from "@/utils/samplePlaybook";
import { v4 as uuidv4 } from "uuid";
import { db, auth } from "@/utils/firebase"; 
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  serverTimestamp,
  where,
  getDoc
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

const PlayCanvas = dynamic(() => import("@/components/PlayCanvas"), {
  ssr: false,
  loading: () => (
    <div className="w-[800px] h-[500px] bg-gray-200 dark:bg-gray-800 animate-pulse flex items-center justify-center rounded-lg">
      <span className="text-gray-500 dark:text-gray-400 font-medium">Loading Field...</span>
    </div>
  ),
});
const DarkModeToggle = dynamic(() => import("@/components/DarkModeToggle"), {
  ssr: false,
});
const PlaycallView = dynamic(() => import("@/components/PlaycallView"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <span className="text-gray-400 font-medium animate-pulse">Loading Playcall...</span>
    </div>
  ),
});
const PlayDiagram = dynamic(() => import("@/components/PlayDiagram"), {
  ssr: false,
});

// Types
type Player = { id: string; x: number; y: number; color: string; label: string };
type Route = { id: string; points: number[]; color: string; hasArrow: boolean; isDashed: boolean; tension?: number; open?: boolean };
type Play = { id: string; name: string; image?: string; status?: 'syncing' | 'saved' | 'error'; players?: Player[]; routes?: Route[]; category?: PlayCategory };

type Playbook = {
  id: string;
  title: string;
  createdAt: any;
  userId: string;
};

// Built-in shared sample playbook (vectors only, no snapshot image)
const samplePlays: Play[] = SAMPLE_PLAYS.map((s, i) => ({
  id: `${SAMPLE_BOOK_ID}-play-${i}`,
  name: s.name,
  category: s.category,
  players: s.players.map((p) => ({ ...p })),
  routes: s.routes.map((r, ri) => ({ id: `${SAMPLE_BOOK_ID}-r${i}-${ri}`, tension: 0, ...r })),
  status: 'saved' as const,
}));

export default function PlaybookEditor() {
  const stageRef = useRef<any>(null);
  
  // Data State
  const [library, setLibrary] = useState<Playbook[]>([]);
  const [currentPlaybook, setCurrentPlaybook] = useState<Playbook | null>(null);
  const [currentPlays, setCurrentPlays] = useState<Play[]>([]); 
  const [user, setUser] = useState<any>(null);
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  
  // UI State
  const [view, setView] = useState<'editor' | 'library' | 'playcall'>('library');
  const [isSaving, setIsSaving] = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);
  const router = useRouter();

  // Editor State
  const [playName, setPlayName] = useState("Untitled Play");
  const [playCategory, setPlayCategory] = useState<PlayCategory>('medium');
  const [playbookTitle, setPlaybookTitle] = useState("My Playbook");
  const [titleSavingStatus, setTitleSavingStatus] = useState<'saved' | 'saving'>('saved');
  
  // Tools State
  const [drawMode, setDrawMode] = useState<'free' | 'straight' | 'curve'>('free');
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

  // --- 1. AUTH CHECK ---
  useEffect(() => {
    let unsubscribeUserDoc: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
      } else {
        setUser(currentUser);
        
        const userDocRef = doc(db, "users", currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setIsApproved(data.approved === true);

                const dbSessionId = data.currentSessionId;
                const localSessionId = localStorage.getItem("playmaker_session_id");

                if (dbSessionId && localSessionId && dbSessionId !== localSessionId) {
                    alert("Security Alert: Your account was logged in on another device. You have been signed out.");
                    signOut(auth).then(() => router.push("/login"));
                }
            } else {
                setIsApproved(false); 
            }
        });
      }
    });

    return () => {
        unsubscribeAuth();
        if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, [router]);

  // --- 2. FETCH PLAYBOOKS ---
  useEffect(() => {
    if (!user || !isApproved) return;

    const q = query(
      collection(db, "playbooks"), 
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const books: Playbook[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Playbook));
      setLibrary(books);
      
      if (currentPlaybook) {
        const updated = books.find(b => b.id === currentPlaybook.id);
        if (updated) {
            setCurrentPlaybook(prev => prev ? ({ ...prev, title: updated.title }) : updated);
        }
      }
    });

    return () => unsubscribe();
  }, [user, isApproved, currentPlaybook?.id]);

  // --- 3. FETCH PLAYS (Real-time) ---
  useEffect(() => {
    if (!currentPlaybook) return;
    if (currentPlaybook.id === SAMPLE_BOOK_ID) return; // built-in sample plays, no Firestore

    const playsRef = collection(db, "playbooks", currentPlaybook.id, "plays");
    const q = query(playsRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedPlays: Play[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                image: data.image,
                players: data.players,
                routes: data.routes,
                category: data.category,
                status: 'saved'
            };
        });
        setCurrentPlays(fetchedPlays);
    });

    return () => unsubscribe();
  }, [currentPlaybook?.id]);

  // --- 4. AUTO-SAVE TITLE ---
  useEffect(() => {
    if (!currentPlaybook || !playbookTitle) return;
    if (currentPlaybook.id === SAMPLE_BOOK_ID) return; // shared sample is read-only
    if (playbookTitle === currentPlaybook.title) return;

    setTitleSavingStatus('saving');
    
    const handler = setTimeout(async () => {
        try {
            const bookRef = doc(db, "playbooks", currentPlaybook.id);
            await updateDoc(bookRef, { title: playbookTitle });
            setTitleSavingStatus('saved');
        } catch (error) {
            console.error("Auto-save title failed:", error);
            setTitleSavingStatus('saved'); 
        }
    }, 1000); 

    return () => clearTimeout(handler);
  }, [playbookTitle, currentPlaybook]);

  // --- ACTIONS ---

  const createNewPlaybook = async () => {
    if (!user) return;
    const newBook = { 
      title: "New Playbook", 
      createdAt: serverTimestamp(),
      userId: user.uid
    };
    try {
        const docRef = await addDoc(collection(db, "playbooks"), newBook);
        const createdBook = { ...newBook, id: docRef.id } as Playbook;
        openPlaybook(createdBook);
    } catch (e) {
        console.error("Error creating playbook: ", e);
    }
  };

  const openPlaybook = (book: Playbook) => {
    setCurrentPlaybook(book);
    setPlaybookTitle(book.title);
    setView('editor');
    setPlayName("Untitled Play");
    setPlayCategory('medium');
    setPlayers(defaultPlayers);
    setRoutes([]);
    setCurrentPlays([]);
    setEditingPlayId(null);
  };

  const openPlaycall = (book: Playbook) => {
    openPlaybook(book);
    setView('playcall');
  };

  const openSamplePlaycall = () => {
    setCurrentPlaybook({ id: SAMPLE_BOOK_ID, title: SAMPLE_BOOK_TITLE, createdAt: null, userId: "shared" });
    setPlaybookTitle(SAMPLE_BOOK_TITLE);
    setPlayName("Untitled Play");
    setPlayCategory('medium');
    setPlayers(defaultPlayers);
    setRoutes([]);
    setCurrentPlays(samplePlays);
    setEditingPlayId(null);
    setView('playcall');
  };

  // --- NEW FUNCTION: Correctly Close Editor ---
  const closeEditor = () => {
    setView('library');
    setCurrentPlaybook(null); // <--- THIS FIXES THE BUG!
    setCurrentPlays([]);
    setEditingPlayId(null);
  };

  const deletePlaybook = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this playbook?")) {
      await deleteDoc(doc(db, "playbooks", id));
      if (currentPlaybook?.id === id) closeEditor(); // Use new close function
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaybookTitle(e.target.value);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const savePlaySnapshot = async () => {
    if (!stageRef.current || !currentPlaybook) return;
    if (currentPlaybook.id === SAMPLE_BOOK_ID) {
      alert("The shared sample playbook is read-only. Re-draw plays you like in your own playbook.");
      return;
    }
    setIsSaving(true); 

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    players.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    });
    routes.forEach(r => {
        for (let i = 0; i < r.points.length; i += 2) {
            const x = r.points[i], y = r.points[i + 1];
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
    });
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 800; maxY = 500; }
    const PADDING = 30;
    let x = minX - PADDING, y = minY - PADDING;
    let w = (maxX - minX) + (PADDING * 2), h = (maxY - minY) + (PADDING * 2);
    if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; }

    const config = { x, y, width: w, height: h, pixelRatio: 1.5, mimeType: "image/png" };
    const dataUrl = stageRef.current.toDataURL(config);

    const playId = uuidv4();
    const playersSnapshot = players.map(p => ({ ...p }));
    const routesSnapshot = routes.map(r => {
      const { open: _open, ...rest } = r;
      return { ...rest, points: [...rest.points] };
    });
    const tempPlay: Play = {
        id: playId,
        name: playName,
        image: dataUrl,
        players: playersSnapshot,
        routes: routesSnapshot,
        category: playCategory,
        status: 'syncing'
    };

    // Editing mode: update canvas optimistically, persist below
    if (editingPlayId) {
      setCurrentPlays(prev => prev.map(p => p.id === editingPlayId ? { ...p, name: playName, image: dataUrl, players: playersSnapshot, routes: routesSnapshot, category: playCategory } : p));
    } else {
      setCurrentPlays(prev => [...prev, tempPlay]);
      setPlayName(`Play ${currentPlays.length + 2}`);
    }
    setIsSaving(false);

    try {
        const playsCollectionRef = collection(db, "playbooks", currentPlaybook.id, "plays");
        const payload = {
            name: playName,
            image: dataUrl,
            players: playersSnapshot,
            routes: routesSnapshot,
            category: playCategory,
            createdAt: serverTimestamp()
        };
        if (editingPlayId) {
          const { createdAt: _omit, ...updatePayload } = payload;
          await updateDoc(doc(db, "playbooks", currentPlaybook.id, "plays", editingPlayId), updatePayload);
        } else {
          await addDoc(playsCollectionRef, payload);
        }
    } catch (e: any) {
        console.error("Save failed:", e);
        if (editingPlayId) {
          alert("Failed to update play in cloud.");
        } else {
          setCurrentPlays(prev => prev.map(p => p.id === playId ? { ...p, status: 'error' } : p));
        }

        if (e.code === 'resource-exhausted') {
            alert("Error: Play image is too large. Try drawing less.");
        } else if (!editingPlayId) {
            alert("Failed to save play to cloud.");
        }
    }
  };

  const deletePlay = async (playId: string) => {
    if (!currentPlaybook) return;
    if (currentPlaybook.id === SAMPLE_BOOK_ID) return; // shared sample is read-only
    if (confirm("Delete this play?")) {
      setCurrentPlays(prev => prev.filter(p => p.id !== playId));
      if (editingPlayId === playId) {
        setEditingPlayId(null);
        setPlayers(defaultPlayers);
        setRoutes([]);
      }

      try {
        const playDocRef = doc(db, "playbooks", currentPlaybook.id, "plays", playId);
        await deleteDoc(playDocRef);
      } catch (e) {
        console.error("Error deleting play:", e);
        alert("Failed to delete form cloud.");
      }
    }
  };

  const undoLastRoute = () => setRoutes(prev => prev.slice(0, -1));
  const deleteRoute = (id: string) => setRoutes(prev => prev.filter(r => r.id !== id));
  const clearRoutes = () => setRoutes([]);

  // Shared styling for the drawing-tool toggle buttons (light + dark)
  const toolBtn = (active: boolean) =>
    `p-2 text-xs font-bold rounded border transition ${active
      ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
      : 'border-gray-100 text-gray-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'}`;

  // Load a saved play back into the editor for re-editing.
  // Legacy plays saved before vector storage only have an image and can't be restored.
  const loadPlayForEdit = (play: Play) => {
    if (!play.players || !play.routes) {
      alert("This play was saved as an image only (old format) and can't be re-edited. Re-draw it, or save new plays to re-edit them.");
      return;
    }
    setPlayers(play.players.map(p => ({ ...p })));
    setRoutes(play.routes.map(r => ({ ...r, points: [...r.points] })));
    setPlayName(play.name);
    setPlayCategory(play.category ?? 'medium');
    setEditingPlayId(play.id);
  };

  const startNewPlay = () => {
    setEditingPlayId(null);
    setPlayName(`Play ${currentPlays.length + 1}`);
    setPlayCategory('medium');
    setPlayers(defaultPlayers);
    setRoutes([]);
  };

  const recategorizePlay = async (playId: string, category: PlayCategory) => {
    setCurrentPlays(prev => prev.map(p => p.id === playId ? { ...p, category } : p));
    const play = currentPlays.find(p => p.id === playId);
    if (!currentPlaybook || !play || play.status !== 'saved') return; // temp plays persist on upload
    try {
      await updateDoc(doc(db, "playbooks", currentPlaybook.id, "plays", playId), { category });
    } catch (e) {
      console.error("Failed to update category:", e);
      alert("Failed to save category.");
    }
  };

  // --- RENDER ---

  if (!user || isApproved === null) {    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <span className="text-gray-400 font-medium animate-pulse">Verifying Access...</span>
      </div>
    );
  }

  if (isApproved === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 p-6 font-sans">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm text-center max-w-md border border-gray-200 dark:border-gray-700">
          <div className="text-4xl mb-4">⏳</div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">Access Pending</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm leading-relaxed">
            Your account is waiting for approval.
          </p>
          <button onClick={handleSignOut} className="text-red-500 font-bold text-sm hover:underline">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (view === 'library') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white">My Playbooks</h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2">Manage your team's strategies.</p>
            </div>
            <div className="flex items-center gap-4">
               <DarkModeToggle />
               <button onClick={handleSignOut} className="text-gray-400 hover:text-red-500 font-bold text-sm px-3 py-2">
                 Sign Out
               </button>
               <button onClick={createNewPlaybook} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-lg font-bold transition flex items-center gap-2">
                 + New Playbook
               </button>
            </div>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div onClick={openSamplePlaycall} className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-xl shadow-sm border-2 border-dashed border-emerald-400 dark:border-emerald-700 hover:shadow-md cursor-pointer transition relative">
              <span className="absolute top-3 right-3 text-[10px] font-bold bg-emerald-500 text-white rounded px-2 py-0.5">SHARED SAMPLE</span>
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-300 text-xl">📋</div>
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">{SAMPLE_BOOK_TITLE}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">10 short · 10 medium · 10 long · 10 trick</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold mt-2">📢 Open playcall — shared call log</p>
            </div>
            {library.map((book) => (
              <div key={book.id} onClick={() => openPlaybook(book)} className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer transition group relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-300 text-xl">📚</div>
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); openPlaycall(book); }} title="Open playcall mode" className="hover:text-emerald-500 text-slate-400 p-2 opacity-0 group-hover:opacity-100 transition">📢</button>
                    <button onClick={(e) => deletePlaybook(book.id, e)} className="text-slate-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition">🗑</button>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">{book.title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Open to view plays</p>
                <div className="flex gap-1 mt-4 h-12 overflow-hidden opacity-50 bg-gray-50 dark:bg-slate-900 rounded border border-gray-100 dark:border-slate-700">
                   <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-slate-500 text-xs">Preview</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'playcall' && currentPlaybook) {
    const isSample = currentPlaybook.id === SAMPLE_BOOK_ID;
    return (
      <PlaycallView
        playbookId={currentPlaybook.id}
        playbookTitle={playbookTitle}
        plays={currentPlays}
        onBack={() => { if (isSample) { closeEditor(); } else { setView('editor'); } }}
        onEditPlay={(p) => { loadPlayForEdit(p as Play); setView('editor'); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 font-sans text-gray-800 dark:text-gray-100">
      <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-4">
          {/* UPDATED BACK BUTTON: Calls closeEditor() */}
          <button onClick={closeEditor} className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 font-bold text-sm flex items-center gap-1">← Library</button>
          <div className="h-8 w-[1px] bg-gray-300 dark:bg-gray-700 mx-2"></div>
          <div>
            <div className="flex items-center gap-2">
              <input value={playbookTitle} onChange={handleTitleChange} className="text-2xl font-bold text-gray-900 dark:text-white bg-transparent hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 rounded px-1 -ml-1 focus:ring-2 focus:ring-blue-500 outline-none" />
              {titleSavingStatus === 'saving' && <span className="text-xs text-gray-400 animate-pulse">Saving...</span>}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{currentPlays.length} Plays Saved</p>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <DarkModeToggle />
          <button onClick={() => setView('playcall')} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2 rounded-lg shadow-sm font-medium transition flex items-center gap-2"><span>📢</span> Playcall</button>
          <button onClick={() => generatePDF(currentPlays, 'sheet')} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2 rounded-lg shadow-sm font-medium transition flex items-center gap-2"><span>📄</span> A4 Sheet</button>
          <button onClick={() => generatePDF(currentPlays, 'wristband')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg shadow-sm font-medium transition flex items-center gap-2"><span>⌚</span> Wristband</button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-1/4 space-y-4">
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Drawing Tools</h2>
            <div className="grid grid-cols-2 gap-2">
               <button onClick={() => setDrawMode('free')} className={toolBtn(drawMode === 'free')}>✎ Freehand</button>
               <button onClick={() => setDrawMode('straight')} className={toolBtn(drawMode === 'straight')}>📏 Straight</button>
               <button onClick={() => setDrawMode('curve')} className={`${toolBtn(drawMode === 'curve')} col-span-2`}>⌒ Curved</button>
               <button onClick={() => setIsDashed(false)} className={toolBtn(!isDashed)}>⎯ Solid</button>
               <button onClick={() => setIsDashed(true)} className={toolBtn(isDashed)}>--- Dashed</button>
               <button onClick={() => setHasArrow(true)} className={toolBtn(hasArrow)}>➤ Arrow</button>
               <button onClick={() => setHasArrow(false)} className={toolBtn(!hasArrow)}>— Line</button>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">Arrow mode: every stroke ends with an arrow. Line mode: left-drag draws & continues (press the blue dot to extend smoothly), right-drag ends with an arrow. Esc / Finish line ends without arrow. Curved auto-smooths your stroke (works with Solid/Dashed).</p>
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
               <label className="text-xs font-bold text-gray-500 dark:text-gray-400">Play Category</label>
               <div className="grid grid-cols-4 gap-1 mt-1">
                 {(Object.keys(CATEGORY_META) as PlayCategory[]).map((c) => (
                   <button key={c} onClick={() => setPlayCategory(c)} title={c === 'short' ? 'Short (0-3 yds)' : c === 'medium' ? 'Medium (4-7 yds)' : c === 'long' ? 'Long (8+ yds)' : 'Trick / gadget play'} className={toolBtn(playCategory === c)}>
                     {CATEGORY_META[c].label}
                   </button>
                 ))}
               </div>
            </div>
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
               <label className="text-xs font-bold text-gray-500 dark:text-gray-400">Play Name</label>
               <input value={playName} onChange={(e) => setPlayName(e.target.value)} className="w-full mt-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white p-2 rounded text-sm focus:border-blue-500 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={undoLastRoute} className="bg-yellow-50 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 py-2 rounded text-xs font-bold hover:bg-yellow-100 dark:hover:bg-yellow-900/60">Undo</button>
              <button onClick={clearRoutes} className="bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 py-2 rounded text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/60">Clear</button>
            </div>
            <button onClick={savePlaySnapshot} disabled={isSaving} className="w-full bg-slate-900 dark:bg-blue-600 text-white py-3 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 font-bold shadow-md mt-2 disabled:opacity-50">
              {isSaving ? "Saving..." : editingPlayId ? "Update Play" : "+ Add to Playbook"}
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 h-[380px] flex flex-col">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Plays in Book</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {currentPlays.map((p, idx) => {
                const isEditing = editingPlayId === p.id;
                const isReEditable = !!(p.players && p.routes);
                return (
                <div
                  key={p.id}
                  onClick={() => loadPlayForEdit(p)}
                  title={isReEditable ? "Click to re-edit this play" : "Old image-only format — can't re-edit"}
                  className={`flex justify-between items-center p-2 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 group cursor-pointer transition ${isEditing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500 ring-1 ring-blue-500' : ''}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-gray-400 font-mono text-xs">{idx + 1}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${p.category ? CATEGORY_META[p.category].dot : 'bg-gray-300 dark:bg-gray-600'}`} title={p.category ? CATEGORY_META[p.category].label : 'Uncategorized'} />
                    <span className="text-sm font-medium truncate w-20">{p.name}</span>
                    {p.status === 'syncing' && <span className="text-[10px] text-blue-500 animate-pulse">Sync...</span>}
                    {p.status === 'error' && <span className="text-[10px] text-red-500">Failed</span>}
                    {!isReEditable && p.status === 'saved' && <span className="text-[10px] text-gray-400">img</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={p.category ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => recategorizePlay(p.id, e.target.value as PlayCategory)}
                      title="Categorize play"
                      className="text-[10px] font-bold rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1 py-0.5 outline-none cursor-pointer max-w-[64px]"
                    >
                      <option value="" disabled>CAT</option>
                      <option value="short">Short</option>
                      <option value="medium">Med</option>
                      <option value="long">Long</option>
                      <option value="trick">Trick</option>
                    </select>
                    {p.image ? (
                      <img src={p.image} className="w-8 h-5 object-cover border rounded bg-white" />
                    ) : p.players && p.routes ? (
                      <PlayDiagram players={p.players} routes={p.routes} className="w-12 h-8 object-cover border rounded bg-white" />
                    ) : null}
                    <button onClick={(e) => { e.stopPropagation(); deletePlay(p.id); }} className="text-gray-300 hover:text-red-500 transition">×</button>
                  </div>
                </div>
                );
              })}
              {currentPlays.length === 0 && <p className="text-center text-gray-400 text-xs mt-10">Empty Playbook</p>}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white dark:bg-gray-800 p-1 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-start items-center overflow-hidden relative">
            {editingPlayId && (() => {
              const editingPlay = currentPlays.find(p => p.id === editingPlayId);
              return (
                <div className="w-full max-w-[800px] flex items-center justify-between bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 m-2">
                  <span className="text-sm font-bold text-blue-800 dark:text-blue-200 truncate">Editing: {editingPlay?.name ?? playName}</span>
                  <button onClick={startNewPlay} className="text-xs font-bold text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-100 border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg px-3 py-1.5 transition shrink-0 ml-2">+ New play</button>
                </div>
              );
            })()}
            <div className="flex justify-center items-center w-full">
              <PlayCanvas players={players} routes={routes} setPlayers={setPlayers} setRoutes={setRoutes} stageRef={stageRef} onDeleteRoute={deleteRoute} drawMode={drawMode} hasArrow={hasArrow} isDashed={isDashed} />
            </div>
            <p className="text-[11px] text-gray-400 mt-2 mb-1">{editingPlayId ? "Saving updates this play." : "Click a play in the list to load it for re-editing."}</p>
        </div>
      </div>
    </div>
  );
}