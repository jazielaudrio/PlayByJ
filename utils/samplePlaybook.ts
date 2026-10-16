import type { PlayCategory } from "./playcall";

// Built-in sample playbook: 40 classic-inspired plays (10 per category).
// Lives in code so it is visible to every user with zero seeding.
// Call history is shared too: logs live under playbooks/{SAMPLE_BOOK_ID}/calls.

export const SAMPLE_BOOK_ID = "sample-playbook-40";
export const SAMPLE_BOOK_TITLE = "Sample: Pro 40";

export interface SamplePlayer {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
}

export interface SampleRoute {
  points: number[];
  color: string;
  hasArrow: boolean;
  isDashed: boolean;
}

export interface SamplePlay {
  name: string;
  category: PlayCategory;
  players: SamplePlayer[];
  routes: SampleRoute[];
}

// Field is 800x500, offense lined up near the bottom (LOS ~y=372), up = -y.
// 100px ≈ 5 yards.
const FORMATION: SamplePlayer[] = [
  { id: "qb", x: 400, y: 425, color: "red", label: "QB" },
  { id: "c", x: 400, y: 372, color: "blue", label: "C" },
  { id: "x", x: 180, y: 372, color: "orange", label: "X" },
  { id: "y", x: 620, y: 372, color: "green", label: "Y" },
  { id: "z", x: 470, y: 425, color: "pink", label: "Z" },
];

const R = (points: number[], o?: { arrow?: boolean; dashed?: boolean }): SampleRoute => ({
  points,
  color: "black",
  hasArrow: o?.arrow ?? true,
  isDashed: o?.dashed ?? false,
});

function mkPlay(name: string, category: PlayCategory, routes: SampleRoute[]): SamplePlay {
  return {
    name,
    category,
    players: FORMATION.map((p) => ({ ...p })),
    routes: routes.map((r) => ({ ...r, points: [...r.points] })),
  };
}

export const SAMPLE_PLAYS: SamplePlay[] = [
  // ---------------- SHORT (10) ----------------
  mkPlay("Slant", "short", [R([180, 372, 230, 322, 252, 242])]),
  mkPlay("Quick Out", "short", [R([620, 372, 690, 368, 745, 365])]),
  mkPlay("Hitch", "short", [R([180, 372, 180, 300], { arrow: false })]),
  mkPlay("Stick", "short", [R([470, 425, 480, 360, 486, 330])]),
  mkPlay("RB Flat", "short", [R([470, 425, 560, 428, 640, 422])]),
  mkPlay("Bubble Screen", "short", [R([620, 372, 590, 392, 560, 402])]),
  mkPlay("TE Pop", "short", [R([400, 372, 430, 330, 442, 300])]),
  mkPlay("Shallow Cross", "short", [R([180, 372, 300, 362, 450, 357, 600, 352])]),
  mkPlay("Speed Out", "short", [R([180, 372, 185, 320, 130, 315, 90, 315])]),
  mkPlay("QB Sneak", "short", [R([400, 425, 400, 372])]),

  // ---------------- MEDIUM (10) ----------------
  mkPlay("Dig", "medium", [R([620, 372, 620, 280, 540, 275, 480, 275])]),
  mkPlay("Curl", "medium", [R([180, 372, 180, 270], { arrow: false })]),
  mkPlay("Comeback", "medium", [R([620, 372, 620, 260, 590, 300])]),
  mkPlay("Deep Out", "medium", [R([180, 372, 180, 250, 110, 250])]),
  mkPlay("Post", "medium", [R([180, 372, 200, 260, 300, 200])]),
  mkPlay("Cross", "medium", [R([470, 425, 470, 300, 380, 280, 300, 280])]),
  mkPlay("TE Corner", "medium", [R([400, 372, 430, 260, 480, 230])]),
  mkPlay("Whip", "medium", [R([620, 372, 680, 320, 660, 290, 620, 300])]),
  mkPlay("Deep Hitch", "medium", [R([180, 372, 190, 240], { arrow: false })]),
  mkPlay("Seam", "medium", [R([400, 372, 410, 240, 415, 180])]),

  // ---------------- LONG (10) ----------------
  mkPlay("Go", "long", [R([180, 372, 185, 200, 190, 80])]),
  mkPlay("Fade", "long", [R([620, 372, 660, 220, 680, 100])]),
  mkPlay("Deep Post", "long", [R([620, 372, 600, 240, 500, 160])]),
  mkPlay("Deep Corner", "long", [R([180, 372, 190, 220, 120, 150])]),
  mkPlay("Double Move", "long", [R([180, 372, 185, 300, 190, 340, 200, 220, 230, 120])]),
  mkPlay("Wheel", "long", [R([470, 425, 560, 415, 640, 380, 660, 260, 665, 150])]),
  mkPlay("Deep Over", "long", [R([620, 372, 600, 250, 450, 200, 300, 190])]),
  mkPlay("Hail Mary", "long", [R([180, 372, 190, 120]), R([620, 372, 610, 120])]),
  mkPlay("Seam Shot", "long", [R([400, 372, 405, 200, 410, 90])]),
  mkPlay("Post Corner", "long", [R([620, 372, 600, 250, 520, 190, 560, 150, 620, 130])]),

  // ---------------- TRICK (10) ----------------
  mkPlay("Flea Flicker", "trick", [
    R([470, 425, 420, 412], { arrow: false, dashed: true }),
    R([180, 372, 190, 150]),
  ]),
  mkPlay("Reverse", "trick", [
    R([620, 372, 500, 380, 350, 375, 220, 365]),
    R([180, 372, 120, 375], { dashed: true }),
  ]),
  mkPlay("Double Pass", "trick", [
    R([470, 425, 300, 402], { arrow: false, dashed: true }),
    R([200, 300, 220, 180]),
  ]),
  mkPlay("Hook & Ladder", "trick", [
    R([620, 372, 620, 290], { arrow: false }),
    R([590, 290, 500, 280], { dashed: true }),
  ]),
  mkPlay("Philly Special", "trick", [
    R([400, 372, 350, 392, 300, 387], { dashed: true }),
    R([400, 425, 480, 382]),
  ]),
  mkPlay("Statue of Liberty", "trick", [
    R([400, 425, 340, 415], { arrow: false, dashed: true }),
    R([470, 425, 380, 415, 300, 410]),
  ]),
  mkPlay("WR Pass", "trick", [
    R([180, 372, 260, 365, 340, 360], { dashed: true }),
    R([620, 372, 600, 220]),
  ]),
  mkPlay("End Around", "trick", [R([180, 372, 320, 375, 480, 370, 600, 360])]),
  mkPlay("Fake Screen", "trick", [
    R([620, 372, 580, 390], { arrow: false, dashed: true }),
    R([180, 372, 200, 220]),
  ]),
  mkPlay("Tackle Eligible", "trick", [R([400, 372, 340, 330, 320, 280])]),
];
