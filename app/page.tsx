"use client";
import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { generatePDF } from "@/utils/pdfGenerator";
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
    <div className="w-[800px] h-[500px] bg-gray-200 animate-pulse flex items-center justify-center rounded-lg">
      <span className="text-gray-500 font-medium">Loading Field...</span>
    </div>
  ),
});

// Types
type Player = { id: string; x: number; y: number; color: string; label: string };
type Route = { id: string; points: number[]; color: string; hasArrow: boolean; isDashed: boolean };
type Play = { id: string; name: string; image: string; status?: 'syncing' | 'saved' | 'error' };

type Playbook = {
  id: string;
  title: string;
  createdAt: any;
  userId: string;
};

export default function PlaybookEditor() {
  const stageRef = useRef<any>(null);
  
  // Data State
  const [library, setLibrary] = useState<Playbook[]>([]);
  const [currentPlaybook, setCurrentPlaybook] = useState<Playbook | null>(null);
  const [currentPlays, setCurrentPlays] = useState<Play[]>([]); 
  const [user, setUser] = useState<any>(null);
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  
  // UI State
  const [view, setView] = useState<'editor' | 'library'>('library');
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  // Editor State
  const [playName, setPlayName] = useState("Untitled Play");
  const [playbookTitle, setPlaybookTitle] = useState("My Playbook");
  const [titleSavingStatus, setTitleSavingStatus] = useState<'saved' | 'saving'>('saved');
  
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

    const playsRef = collection(db, "playbooks", currentPlaybook.id, "plays");
    const q = query(playsRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedPlays: Play[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                image: data.image,
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
    setPlayers(defaultPlayers);
    setRoutes([]);
    setCurrentPlays([]); 
  };

  // --- NEW FUNCTION: Correctly Close Editor ---
  const closeEditor = () => {
    setView('library');
    setCurrentPlaybook(null); // <--- THIS FIXES THE BUG!
    setCurrentPlays([]);
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
    const tempPlay: Play = { 
        id: playId, 
        name: playName, 
        image: dataUrl,
        status: 'syncing' 
    };

    setCurrentPlays(prev => [...prev, tempPlay]);
    setPlayName(`Play ${currentPlays.length + 2}`); 
    setIsSaving(false); 

    try {
        const playsCollectionRef = collection(db, "playbooks", currentPlaybook.id, "plays");
        await addDoc(playsCollectionRef, {
            name: tempPlay.name,
            image: dataUrl,
            createdAt: serverTimestamp()
        });
    } catch (e: any) {
        console.error("Save failed:", e);
        setCurrentPlays(prev => prev.map(p => p.id === playId ? { ...p, status: 'error' } : p));
        
        if (e.code === 'resource-exhausted') {
            alert("Error: Play image is too large. Try drawing less.");
        } else {
            alert("Failed to save play to cloud.");
        }
    }
  };

  const deletePlay = async (playId: string) => {
    if (!currentPlaybook) return;
    if (confirm("Delete this play?")) {
      setCurrentPlays(prev => prev.filter(p => p.id !== playId));

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

  // --- RENDER ---

  if (!user || isApproved === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-400 font-medium animate-pulse">Verifying Access...</span>
      </div>
    );
  }

  if (isApproved === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 font-sans">
        <div className="bg-white p-8 rounded-xl shadow-sm text-center max-w-md border border-gray-200">
          <div className="text-4xl mb-4">⏳</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Access Pending</h1>
          <p className="text-gray-600 mb-6 text-sm leading-relaxed">
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
      <div className="min-h-screen bg-slate-50 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-extrabold text-slate-900">My Playbooks</h1>
              <p className="text-slate-500 mt-2">Manage your team's strategies.</p>
            </div>
            <div className="flex items-center gap-4">
               <button onClick={handleSignOut} className="text-gray-400 hover:text-red-500 font-bold text-sm px-3 py-2">
                 Sign Out
               </button>
               <button onClick={createNewPlaybook} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-lg font-bold transition flex items-center gap-2">
                 + New Playbook
               </button>
            </div>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {library.map((book) => (
              <div key={book.id} onClick={() => openPlaybook(book)} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-blue-300 cursor-pointer transition group relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 text-xl">📚</div>
                  <button onClick={(e) => deletePlaybook(book.id, e)} className="text-slate-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition">🗑</button>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">{book.title}</h3>
                <p className="text-sm text-slate-500">Open to view plays</p>
                <div className="flex gap-1 mt-4 h-12 overflow-hidden opacity-50 bg-gray-50 rounded border border-gray-100">
                   <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">Preview</div>
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
          {/* UPDATED BACK BUTTON: Calls closeEditor() */}
          <button onClick={closeEditor} className="text-gray-500 hover:text-blue-600 font-bold text-sm flex items-center gap-1">← Library</button>
          <div className="h-8 w-[1px] bg-gray-300 mx-2"></div>
          <div>
            <div className="flex items-center gap-2">
              <input value={playbookTitle} onChange={handleTitleChange} className="text-2xl font-bold text-gray-900 bg-transparent hover:bg-white border border-transparent hover:border-gray-200 rounded px-1 -ml-1 focus:ring-2 focus:ring-blue-500 outline-none" />
              {titleSavingStatus === 'saving' && <span className="text-xs text-gray-400 animate-pulse">Saving...</span>}
            </div>
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
            <button onClick={savePlaySnapshot} disabled={isSaving} className="w-full bg-slate-900 text-white py-3 rounded-lg hover:bg-slate-800 font-bold shadow-md mt-2 disabled:opacity-50">
              {isSaving ? "Saving..." : "+ Add to Playbook"}
            </button>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 h-[380px] flex flex-col">
            <h3 className="font-semibold text-gray-700 mb-2">Plays in Book</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {currentPlays.map((p, idx) => (
                <div key={p.id} className="flex justify-between items-center p-2 border rounded hover:bg-gray-50 group">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="text-gray-400 font-mono text-xs">{idx + 1}</span>
                    <span className="text-sm font-medium truncate w-24">{p.name}</span>
                    {p.status === 'syncing' && <span className="text-[10px] text-blue-500 animate-pulse">Sync...</span>}
                    {p.status === 'error' && <span className="text-[10px] text-red-500">Failed</span>}
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