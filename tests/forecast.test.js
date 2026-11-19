import { describe, it, expect } from 'vitest';
import { makeRng, throughputSamples, forecastCompletion, onTimeProbability, workingDaysUntil } from '../src/backend/forecast';

describe('makeRng', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(7); const b = makeRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('throughputSamples', () => {
  it('aggregates completions per working day and includes zero days', () => {
    // Two completions on Mon 2026-11-09, one on Wed 2026-11-11
    const samples = throughputSamples(['2026-11-09T10:00:00Z', '2026-11-09T15:00:00Z', '2026-11-11T10:00:00Z']);
    expect(samples).toEqual([2, 0, 1]);
  });
  it('skips weekends', () => {
    const samples = throughputSamples(['2026-11-06T10:00:00Z', '2026-11-09T10:00:00Z']);
    // Fri Nov 6 -> Mon Nov 9: no Sat/Sun entries
    expect(samples.every((s) => Number.isFinite(s))).toBe(true);
    expect(samples.length).toBe(2);
  });
  it('returns [] with no completions', () => {
    expect(throughputSamples([])).toEqual([]);
  });
});

describe('forecastCompletion', () => {
  const samples = [1, 1, 2, 0];
  it('is certain when nothing is open', () => {
    const f = forecastCompletion({ openCount: 0, samples });
    expect(f.certain).toBe(true);
    expect(f.medianDays).toBe(0);
  });
  it('refuses to guess without history', () => {
    const f = forecastCompletion({ openCount: 5, samples: [] });
    expect(f.certain).toBe(false);
    expect(f.percentiles).toBeNull();
  });
  it('produces ordered percentiles p50 <= p85 <= p95', () => {
    const f = forecastCompletion({ openCount: 10, samples, runs: 500, rng: makeRng(42) });
    expect(f.percentiles.p50).toBeLessThanOrEqual(f.percentiles.p85);
    expect(f.percentiles.p85).toBeLessThanOrEqual(f.percentiles.p95);
    expect(f.runs).toBe(500);
  });
  it('is deterministic under a fixed seed', () => {
    const a = forecastCompletion({ openCount: 6, samples, runs: 300, rng: makeRng(1) });
    const b = forecastCompletion({ openCount: 6, samples, runs: 300, rng: makeRng(1) });
    expect(a.percentiles).toEqual(b.percentiles);
  });
});

describe('onTimeProbability', () => {
  const fast = [5, 5, 5]; // very fast team
  const slow = [0, 0, 1]; // struggling team
  it('is 1 when nothing is open', () => {
    expect(onTimeProbability({ openCount: 0, samples: fast, remainingWorkingDays: 5 })).toBe(1);
  });
  it('is null without history', () => {
    expect(onTimeProbability({ openCount: 3, samples: [], remainingWorkingDays: 5 })).toBeNull();
  });
  it('gives a fast team a higher probability than a slow one', () => {
    const fastP = onTimeProbability({ openCount: 5, samples: fast, remainingWorkingDays: 5, runs: 400, rng: makeRng(3) });
    const slowP = onTimeProbability({ openCount: 5, samples: slow, remainingWorkingDays: 5, runs: 400, rng: makeRng(3) });
    expect(fastP).toBeGreaterThan(slowP);
  });
  it('produces a probability in [0,1]', () => {
    const p = onTimeProbability({ openCount: 4, samples: [1, 2, 0], remainingWorkingDays: 4, runs: 400, rng: makeRng(9) });
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('workingDaysUntil', () => {
  it('counts weekdays between now and the end date', () => {
    // Mon 2026-11-09 -> Mon 2026-11-16 = 5 working days
    expect(workingDaysUntil('2026-11-09T00:00:00Z', '2026-11-16T00:00:00Z')).toBe(5);
  });
  it('returns null for a missing end date', () => {
    expect(workingDaysUntil(NOW_SAFE, null)).toBeNull();
  });
});

const NOW_SAFE = '2026-11-16T00:00:00Z';
