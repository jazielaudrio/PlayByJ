// Pure playcall logic: no framework/Firebase imports so it can be
// unit-tested standalone (tsc this file alone, then run with node).

export type PlayCategory = 'short' | 'medium' | 'long' | 'trick';
export type Down = 1 | 2 | 3 | 4;
export type DistanceBucket = 'short' | 'medium' | 'long';
export type PlayTarget = 'sticks' | 'goal';
export type PlayOutcome = 'incomplete' | 'completion' | 'firstdown' | 'touchdown';

export interface Situation {
  down: Down;
  distance: DistanceBucket;
  target: PlayTarget;
}

export interface PlayLike {
  id: string;
  name: string;
  category?: PlayCategory;
}

export interface CallRecord {
  playId: string;
  down: Down;
  distance: DistanceBucket;
  target: PlayTarget;
  outcome: PlayOutcome;
}

export interface PlayStats {
  attempts: number;
  completions: number;
  firstDowns: number;
  touchdowns: number;
  points: number;
}

export interface RankedPlay<T extends PlayLike = PlayLike> {
  play: T;
  score: number;
  reasons: string[];
  stats: PlayStats;
  situAttempts: number;
}

// Points per outcome. Moving the chains (firstdown) and scoring (touchdown)
// are worth disproportionately more than a mere completion.
export const OUTCOME_POINTS: Record<PlayOutcome, number> = {
  incomplete: 0,
  completion: 1,
  firstdown: 2.2,
  touchdown: 3,
};

// Scheme fit: how well each play category suits the yards-to-go bucket.
const CATEGORY_MATRIX: Record<PlayCategory | 'none', Record<DistanceBucket, number>> = {
  short: { short: 3, medium: 1, long: 0 },
  medium: { short: 1.5, medium: 3, long: 2 },
  long: { short: 0, medium: 1.5, long: 3 },
  trick: { short: 1, medium: 1.5, long: 1 },
  none: { short: 1.2, medium: 1.2, long: 1.2 },
};

// Situational form is Laplace-smoothed: a play with no history in this spot
// starts at a neutral 1.5 avg instead of 0, so new plays stay in the mix.
// Overall production ramps in with playing time (full weight at 3+ attempts):
// a single lucky play must not hijack ranks, but a short hot streak flips
// a call within ~2-4 results.
const PRIOR_AVG = 1.5;
const PRIOR_WEIGHT = 2;
const OVERALL_RAMP_PLAYS = 3;

function avgWithPrior(points: number, n: number): number {
  return (points + PRIOR_AVG * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
}

function overallBoost(stats: PlayStats): number {
  if (stats.attempts === 0) return 0;
  const raw = stats.points / stats.attempts;
  return 0.4 * raw * Math.min(1, stats.attempts / OVERALL_RAMP_PLAYS);
}

export function statsForPlay(playId: string, calls: CallRecord[]): PlayStats {
  const stats: PlayStats = { attempts: 0, completions: 0, firstDowns: 0, touchdowns: 0, points: 0 };
  for (const c of calls) {
    if (c.playId !== playId) continue;
    stats.attempts++;
    stats.points += OUTCOME_POINTS[c.outcome];
    if (c.outcome !== 'incomplete') stats.completions++;
    if (c.outcome === 'firstdown' || c.outcome === 'touchdown') stats.firstDowns++;
    if (c.outcome === 'touchdown') stats.touchdowns++;
  }
  return stats;
}

function situPoints(playId: string, calls: CallRecord[], s: Situation): { points: number; n: number } {
  let points = 0;
  let n = 0;
  for (const c of calls) {
    if (c.playId !== playId) continue;
    if (c.down === s.down && c.distance === s.distance) {
      points += OUTCOME_POINTS[c.outcome];
      n++;
    }
  }
  return { points, n };
}

export function downLabel(down: Down): string {
  return down === 1 ? '1st' : down === 2 ? '2nd' : down === 3 ? '3rd' : '4th';
}

// Shared display metadata (literal Tailwind classes so the scanner picks them up)
export const CATEGORY_META: Record<PlayCategory, { label: string; dot: string; badge: string }> = {
  short: {
    label: 'Short',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  medium: {
    label: 'Med',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  long: {
    label: 'Long',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  trick: {
    label: 'Trick',
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  },
};

export function distanceLabel(d: DistanceBucket): string {
  return d === 'short' ? 'Short (0-3 yds)' : d === 'medium' ? 'Medium (4-7 yds)' : 'Long (8+ yds)';
}

export function situationLabel(s: Situation): string {
  const goal = s.target === 'goal' ? ' (Goal)' : '';
  const short =
    s.distance === 'short' ? 'Short' : s.distance === 'medium' ? 'Medium' : 'Long';
  return `${downLabel(s.down)} & ${short}${goal}`;
}

function formatRecord(points: number, n: number): string {
  return `${points.toFixed(1)} pts / ${n}`;
}

/**
 * Rank plays for a situation. Reactive: every logged call shifts future
 * rankings through the situational average (Laplace-smoothed) blended with
 * scheme fit. Higher score = better call.
 */
export function scorePlays<T extends PlayLike>(plays: T[], calls: CallRecord[], s: Situation): RankedPlay<T>[] {
  // High-leverage downs trust logged evidence more than the scheme chart.
  const situWeight = s.down === 4 ? 2.5 : s.down === 3 ? 2.2 : 2.0;

  const ranked: RankedPlay<T>[] = plays.map((play) => {
    const cat = play.category ?? 'none';
    let catScore = CATEGORY_MATRIX[cat][s.distance];
    const reasons: string[] = [];

    // Target tweaks (goal-to-go compresses the field)
    if (s.target === 'goal') {
      if (cat === 'long') catScore = Math.max(0, catScore - 1);
      if (cat === 'short') catScore += 0.5;
      if (cat === 'trick') catScore += 0.5;
    }

    // Down tweaks
    let downAdj = 0;
    if (s.down === 4 && cat === 'trick') downAdj -= 2; // no gadgetry on 4th unless data says so
    if (s.down === 4 && cat === 'long') downAdj -= 0.5; // low-% deep shots are risky
    if (s.down === 1 && cat === 'trick') downAdj += 0.5; // best surprise down

    const { points: sPts, n: sN } = situPoints(play.id, calls, s);
    const situ = avgWithPrior(sPts, sN);
    const overallStats = statsForPlay(play.id, calls);

    const score = catScore + situWeight * situ + overallBoost(overallStats) + downAdj;

    // Reasons (most load-bearing first)
    if (sN > 0) {
      reasons.push(`Here: ${formatRecord(sPts, sN)} on ${situationLabel(s)}`);
    }
    if (play.category === s.distance) {
      reasons.push(`Scheme fit: ${s.distance} play for ${s.distance} yardage`);
    } else if (cat === 'trick') {
      reasons.push(downAdj < 0 ? 'Trick play — risky on 4th down' : 'Trick play — surprise factor');
    } else if (cat === 'none') {
      reasons.push('Uncategorized — categorize for sharper calls');
    }
    if (sN === 0) {
      reasons.push('No calls logged in this spot yet');
    }
    if (overallStats.touchdowns > 0) {
      reasons.push(`Scored ${overallStats.touchdowns} TD${overallStats.touchdowns > 1 ? 's' : ''} overall`);
    }

    return {
      play,
      score: Math.round(score * 100) / 100,
      reasons: reasons.slice(0, 3),
      stats: overallStats,
      situAttempts: sN,
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.play.name.localeCompare(b.play.name));
  return ranked;
}
