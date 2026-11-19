/**
 * Atlassian Blackbox — forecast engine.
 *
 * PURE. Monte-Carlo sprint completion forecast from the team's own
 * historical throughput (issues/day distribution), exactly the way
 * evidence-based scheduling works: don't fit a curve, replay history.
 *
 * seeded PRNG so forecasts are reproducible and unit-testable.
 */

/** mulberry32 — small deterministic PRNG. */
export function makeRng(seed = 42) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Throughput samples: issues completed per (working) day over the last N
 * sprints. completedAtIso: array of ISO timestamps of completed issues.
 * Returns a distribution of daily throughput values (array of numbers,
 * one per observed day), which the forecast samples from with replacement.
 */
export function throughputSamples(completedAtIso, windowDays = 60) {
  if (!completedAtIso.length) return [];
  const byDay = new Map();
  for (const iso of completedAtIso) {
    const day = String(iso).slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  // Fill the working days in the window; zero-throughput days are data too.
  const days = [...byDay.keys()].sort();
  if (!days.length) return [];
  const samples = [];
  const start = new Date(days[0]).getTime();
  const end = new Date(days[days.length - 1]).getTime();
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    samples.push(byDay.get(key) || 0);
  }
  void windowDays;
  return samples;
}

/**
 * Monte-Carlo: given daily throughput samples and remaining open issues,
 * simulate `runs` sprints and return the completion-date distribution.
 * Each run: sample a daily throughput (with replacement) until the backlog
 * is empty; the day count is the forecast duration.
 */
export function forecastCompletion({ openCount, samples, runs = 2000, rng = makeRng() }) {
  if (openCount <= 0) return { runs: 0, percentiles: null, certain: true, medianDays: 0 };
  if (!samples.length || samples.every((s) => s === 0)) {
    return { runs: 0, percentiles: null, certain: false, medianDays: null };
  }
  const durations = [];
  for (let r = 0; r < runs; r++) {
    let remaining = openCount;
    let day = 0;
    while (remaining > 0 && day < 400) {
      remaining -= samples[Math.floor(rng() * samples.length)];
      day += 1;
    }
    durations.push(day);
  }
  durations.sort((a, b) => a - b);
  const at = (p) => durations[Math.min(durations.length - 1, Math.floor(p * durations.length))];
  return {
    runs,
    certain: false,
    medianDays: at(0.5),
    percentiles: { p50: at(0.5), p85: at(0.85), p95: at(0.95) },
  };
}

/**
 * Sprint-end risk statement: given the forecast and the sprint's remaining
 * working days, compute the probability of finishing on time.
 */
export function onTimeProbability({ openCount, samples, remainingWorkingDays, runs = 2000, rng = makeRng() }) {
  const f = forecastCompletion({ openCount, samples, runs, rng });
  if (f.certain) return 1;
  if (!f.percentiles) return null; // no history: refuse to guess
  // Probability = share of simulated durations that fit in the remaining days.
  // Recompute directly from a fresh simulation for accuracy.
  let fit = 0;
  let total = 0;
  for (let r = 0; r < runs; r++) {
    let remaining = openCount;
    let day = 0;
    while (remaining > 0 && day < 400) {
      if (day >= remainingWorkingDays) break;
      remaining -= samples[Math.floor(rng() * samples.length)];
      day += 1;
    }
    total += 1;
    if (remaining <= 0 && day <= remainingWorkingDays) fit += 1;
  }
  return total ? Number((fit / total).toFixed(3)) : null;
}

/** Working days between now and a sprint end date (inclusive of end). */
export function workingDaysUntil(nowIso, endIso) {
  // new Date(null) is epoch 0 — guard explicitly or missing dates look valid.
  if (endIso === null || endIso === undefined) return null;
  const a = new Date(nowIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(b)) return null;
  const DAY = 86400000;
  let days = 0;
  for (let t = a; t < b; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}
