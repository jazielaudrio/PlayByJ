"use client";
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { db } from "@/utils/firebase";
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  scorePlays,
  situationLabel,
  distanceLabel,
  CATEGORY_META,
  type PlayCategory,
  type Down,
  type DistanceBucket,
  type PlayTarget,
  type PlayOutcome,
  type CallRecord,
} from "@/utils/playcall";
import type { DiagramPlayer, DiagramRoute } from "./PlayDiagram";

const DarkModeToggle = dynamic(() => import("@/components/DarkModeToggle"), {
  ssr: false,
});
const PlayDiagram = dynamic(() => import("@/components/PlayDiagram"), {
  ssr: false,
});

export interface CallablePlay {
  id: string;
  name: string;
  image?: string;
  category?: PlayCategory;
  players?: DiagramPlayer[];
  routes?: DiagramRoute[];
  [key: string]: unknown;
}

interface StoredCall extends CallRecord {
  id: string;
  playName: string;
}

interface PlaycallViewProps {
  playbookId: string;
  playbookTitle: string;
  plays: CallablePlay[];
  onBack: () => void;
  onEditPlay: (play: CallablePlay) => void;
}

const DOWNS: Down[] = [1, 2, 3, 4];
const DISTANCES: DistanceBucket[] = ["short", "medium", "long"];

const OUTCOMES: { value: PlayOutcome; label: string; pts: string; btn: string }[] = [
  {
    value: "incomplete",
    label: "Incomplete",
    pts: "+0",
    btn: "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200",
  },
  {
    value: "completion",
    label: "Completion",
    pts: "+1",
    btn: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  {
    value: "firstdown",
    label: "First Down",
    pts: "+2.2",
    btn: "bg-green-600 hover:bg-green-700 text-white",
  },
  {
    value: "touchdown",
    label: "Touchdown",
    pts: "+3",
    btn: "bg-amber-500 hover:bg-amber-600 text-white",
  },
];

const OUTCOME_CHIP: Record<PlayOutcome, string> = {
  incomplete: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  completion: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  firstdown: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  touchdown: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
};

const OUTCOME_LABEL: Record<PlayOutcome, string> = {
  incomplete: "Incomplete",
  completion: "Completion",
  firstdown: "First Down",
  touchdown: "Touchdown",
};

function CatBadge({ category }: { category?: PlayCategory }) {
  if (!category) {
    return (
      <span className="text-[10px] font-bold text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5">
        UNCAT
      </span>
    );
  }
  const meta = CATEGORY_META[category];
  return (
    <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${meta.badge}`}>
      {meta.label.toUpperCase()}
    </span>
  );
}

export default function PlaycallView({ playbookId, playbookTitle, plays, onBack, onEditPlay }: PlaycallViewProps) {
  const [down, setDown] = useState<Down>(1);
  const [distance, setDistance] = useState<DistanceBucket>("medium");
  const [target, setTarget] = useState<PlayTarget>("sticks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calls, setCalls] = useState<StoredCall[]>([]);
  const [callsError, setCallsError] = useState(false);
  const [logging, setLogging] = useState(false);
  const [justLogged, setJustLogged] = useState("");

  // Live call log — rankings react to every logged result in real time
  useEffect(() => {
    const callsRef = collection(db, "playbooks", playbookId, "calls");
    const q = query(callsRef, orderBy("createdAt", "desc"), limit(200));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCallsError(false);
        setCalls(
          snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              playId: data.playId,
              playName: data.playName ?? "?",
              down: data.down,
              distance: data.distance,
              target: data.target ?? "sticks",
              outcome: data.outcome,
            } as StoredCall;
          })
        );
      },
      (err) => {
        console.error("Call history listener failed:", err);
        setCallsError(true);
      }
    );
    return () => unsubscribe();
  }, [playbookId]);

  const situation = useMemo(() => ({ down, distance, target }), [down, distance, target]);

  const ranked = useMemo(() => scorePlays(plays, calls, situation), [plays, calls, situation]);

  const displayed = useMemo(() => {
    if (selectedId) return ranked.find((r) => r.play.id === selectedId) ?? ranked[0] ?? null;
    return ranked[0] ?? null;
  }, [ranked, selectedId]);

  const logResult = async (outcome: PlayOutcome) => {
    if (!displayed || logging) return;
    setLogging(true);
    try {
      await addDoc(collection(db, "playbooks", playbookId, "calls"), {
        playId: displayed.play.id,
        playName: displayed.play.name,
        category: displayed.play.category ?? null,
        down,
        distance,
        target,
        outcome,
        createdAt: serverTimestamp(),
      });
      setJustLogged(`${displayed.play.name} — ${OUTCOME_LABEL[outcome]} logged`);
      setTimeout(() => setJustLogged(""), 2500);
    } catch (e) {
      console.error("Failed to log call:", e);
      alert("Failed to log result.");
    }
    setLogging(false);
  };

  const pick = (active: boolean) =>
    `p-2 text-xs font-bold rounded border transition ${active
      ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300"
      : "border-gray-100 text-gray-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600"}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 font-sans text-gray-800 dark:text-gray-100">
      <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 font-bold text-sm flex items-center gap-1">
            ← Editor
          </button>
          <div className="h-8 w-[1px] bg-gray-300 dark:bg-gray-700 mx-2"></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{playbookTitle} — Playcall</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {situationLabel(situation)} · {calls.length} calls logged · rankings react live
            </p>
          </div>
        </div>
        <DarkModeToggle />
      </header>

      {callsError && (
        <div className="max-w-3xl mx-auto mb-6 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl p-4 text-sm">
          <p className="font-bold text-amber-800 dark:text-amber-200 mb-1">
            Call history unavailable — Firestore rules are blocking the <code>calls</code> subcollection.
          </p>
          <p className="text-amber-700 dark:text-amber-300 mb-2">
            Suggestions still work from scheme fit, but results won&apos;t save. In Firebase Console → Firestore
            Database → Rules, mirror your <code>plays</code> rule for <code>calls</code>, e.g.:
          </p>
          <pre className="bg-black/80 text-green-200 text-[11px] font-mono rounded-lg p-3 overflow-x-auto">
{`match /playbooks/{bookId}/calls/{callId} {
  allow read, write: if request.auth != null;
}`}
          </pre>
          <p className="text-amber-700 dark:text-amber-300 mt-2">Then Publish the rules and reload.</p>
        </div>
      )}

      {plays.length === 0 ? (
        <div className="max-w-md mx-auto bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">No plays in this playbook yet.</p>
          <button onClick={onBack} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-bold transition">
            Draw plays in the editor
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* LEFT: situation + ranked suggestions */}
          <div className="w-full lg:w-1/3 space-y-4">
            <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Situation</h2>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">Down</label>
                <div className="grid grid-cols-4 gap-1 mt-1">
                  {DOWNS.map((d) => (
                    <button key={d} onClick={() => setDown(d)} className={pick(down === d)}>
                      {d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : "4th"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">Yards to go</label>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  {DISTANCES.map((d) => (
                    <button key={d} onClick={() => setDistance(d)} title={distanceLabel(d)} className={pick(distance === d)}>
                      {d === "short" ? "Short" : d === "medium" ? "Med" : "Long"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Short 0–3 · Med 4–7 · Long 8+ yds</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">Target</label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <button onClick={() => setTarget("sticks")} className={pick(target === "sticks")}>To Sticks</button>
                  <button onClick={() => setTarget("goal")} className={pick(target === "goal")}>To Goal</button>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col max-h-[480px]">
              <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
                Suggested calls <span className="text-xs font-normal text-gray-400">({situationLabel(situation)})</span>
              </h3>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {ranked.map((r, idx) => (
                  <div
                    key={r.play.id}
                    onClick={() => setSelectedId(r.play.id)}
                    className={`p-2 border rounded cursor-pointer transition hover:bg-gray-50 dark:hover:bg-gray-700 ${displayed?.play.id === r.play.id
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-500"
                      : "border-gray-200 dark:border-gray-700"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className={`font-mono text-xs font-bold ${idx < 3 ? "text-amber-500" : "text-gray-400"}`}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-bold truncate">{r.play.name}</span>
                        <CatBadge category={r.play.category} />
                      </div>
                      <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-300 shrink-0">
                        {r.score.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                      {r.reasons[0]}
                      {r.reasons[1] ? ` · ${r.reasons[1]}` : ""}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
                      {r.stats.attempts} att · {r.stats.completions} comp · {r.stats.firstDowns} 1D · {r.stats.touchdowns} TD
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* MAIN: current play on field + result logging */}
          <div className="flex-1 space-y-4">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col items-center">
              {displayed ? (
                <>
                  <div className="w-full max-w-[800px] flex items-center justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{displayed.play.name}</h2>
                      <CatBadge category={displayed.play.category} />
                      {displayed.play.id !== ranked[0]?.play.id && (
                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 shrink-0">
                          ★ #{ranked.findIndex((x) => x.play.id === displayed.play.id) + 1} pick: {ranked[0]?.play.name}
                        </span>
                      )}
                    </div>
                    {displayed.play.image ? (
                      <button
                        onClick={() => onEditPlay(displayed.play)}
                        className="text-xs font-bold text-blue-600 dark:text-blue-300 hover:text-blue-800 border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition shrink-0"
                      >
                        Edit play
                      </button>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                        SHARED SAMPLE
                      </span>
                    )}
                  </div>
                  {displayed.play.image ? (
                    <img
                      src={displayed.play.image}
                      alt={displayed.play.name}
                      className="max-w-full max-h-[420px] object-contain rounded-lg border-2 border-slate-200 dark:border-slate-700 bg-green-50 shadow-inner"
                    />
                  ) : displayed.play.players && displayed.play.routes ? (
                    <PlayDiagram
                      players={displayed.play.players}
                      routes={displayed.play.routes}
                      className="w-full max-w-[800px] rounded-lg border-2 border-slate-200 dark:border-slate-700 shadow-inner"
                    />
                  ) : (
                    <p className="text-gray-400 text-sm py-10">No diagram available for this play.</p>
                  )}
                  <div className="w-full max-w-[800px] grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => logResult(o.value)}
                        disabled={logging}
                        className={`py-2.5 px-2 rounded-lg font-bold text-sm transition disabled:opacity-50 ${o.btn}`}
                      >
                        {o.label}
                        <span className="block text-[10px] font-mono opacity-70">{o.pts} pts</span>
                      </button>
                    ))}
                  </div>
                  {justLogged && (
                    <p className="text-xs font-bold text-green-600 dark:text-green-400 mt-2">✓ {justLogged}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-2">Logging as {situationLabel(situation)} — rankings update instantly.</p>
                </>
              ) : (
                <p className="text-gray-400 text-sm py-10">Select a play to put it on the field.</p>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Recent calls</h3>
              {calls.length === 0 ? (
                <p className="text-xs text-gray-400">No results logged yet — call a play and log what happened.</p>
              ) : (
                <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                  {calls.slice(0, 8).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-gray-500 dark:text-gray-400 font-mono shrink-0">
                        {c.down === 1 ? "1st" : c.down === 2 ? "2nd" : c.down === 3 ? "3rd" : "4th"} &{" "}
                        {c.distance === "short" ? "S" : c.distance === "medium" ? "M" : "L"}
                        {c.target === "goal" ? " (G)" : ""}
                      </span>
                      <span className="font-bold truncate flex-1">{c.playName}</span>
                      <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0 ${OUTCOME_CHIP[c.outcome]}`}>
                        {OUTCOME_LABEL[c.outcome].toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
