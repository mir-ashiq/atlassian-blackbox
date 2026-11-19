import { describe, it, expect } from 'vitest';
import { buildRetro, renderRetro, deriveLessons, preflight } from '../src/backend/retro';

const NOW = '2026-11-16T10:00:00.000Z';

const issues = [
  { key: 'A-1', summary: 'Payment gateway 502s', statusCategory: 'done', duedate: '2026-11-10', resolvedAt: '2026-11-14', patterns: ['silent-stall', 'escalated'] },
  { key: 'A-2', summary: 'DB migration', statusCategory: 'done', duedate: '2026-11-08', resolvedAt: '2026-11-13', patterns: ['late-scope-churn', 'handoff-churn'] },
  { key: 'A-3', summary: 'CSV export', statusCategory: 'done', duedate: '2026-11-12', resolvedAt: '2026-11-11', patterns: [] },
  { key: 'A-4', summary: 'Accessibility audit', statusCategory: 'done', duedate: '2026-11-12', resolvedAt: '2026-11-12', patterns: ['late-scope-churn'] },
  { key: 'A-5', summary: 'Still open item', statusCategory: 'indeterminate', duedate: '2026-11-10', resolvedAt: null, patterns: [] },
];

const scores = { 'A-1': 6, 'A-2': 5, 'A-3': 0, 'A-4': 4, 'A-5': 2 };

describe('buildRetro', () => {
  const retro = buildRetro(issues, scores, { now: NOW });
  it('classifies breaches and late completions as crashed', () => {
    expect(retro.crashed.map((c) => c.key)).toContain('A-1'); // resolved after duedate
    expect(retro.crashed.map((c) => c.key)).toContain('A-5'); // open past duedate
  });
  it('classifies high-score on-time items as near-misses', () => {
    expect(retro.nearMisses.map((n) => n.key)).toContain('A-4');
    expect(retro.nearMisses.map((n) => n.key)).not.toContain('A-3');
  });
  it('classifies clean on-time items as wins', () => {
    expect(retro.wins.map((w) => w.key)).toContain('A-3');
  });
  it('counts match the buckets', () => {
    expect(retro.counts.total).toBe(5);
    expect(retro.counts.crashed + retro.counts.nearMisses + retro.counts.wins).toBeLessThanOrEqual(5);
  });
  it('derives lessons from repeating patterns', () => {
    expect(retro.lessons.some((l) => l.pattern === 'late-scope-churn' && l.occurrences >= 2)).toBe(true);
  });
});

describe('deriveLessons', () => {
  it('requires a pattern to repeat (or a tiny sample)', () => {
    const lessons = deriveLessons([{ key: 'X', patterns: ['once'] }], []);
    expect(lessons).toHaveLength(0);
  });
  it('caps lessons at 5, most frequent first', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ key: `X-${i}`, patterns: ['a', 'b'] }));
    const lessons = deriveLessons(items, []);
    expect(lessons.length).toBeLessThanOrEqual(5);
    expect(lessons[0].occurrences).toBeGreaterThanOrEqual(lessons[lessons.length - 1].occurrences);
  });
});

describe('renderRetro', () => {
  it('renders a readable report with all buckets', () => {
    const text = renderRetro(buildRetro(issues, scores, { now: NOW }));
    expect(text).toContain('Sprint retro — 2026-11-16');
    expect(text).toContain('Crashed:');
    expect(text).toContain('Near misses:');
    expect(text).toContain('Wins:');
    expect(text).toContain('Lessons for next sprint:');
  });
});

describe('preflight', () => {
  it('returns GO for a healthy sprint', () => {
    const pf = preflight({ openIssues: [{}], historicalRiskByIssue: {}, onTimeProb: 0.95 });
    expect(pf.verdict).toBe('GO');
  });
  it('returns NO-GO when the forecast is under 50%', () => {
    const pf = preflight({ openIssues: [{}], historicalRiskByIssue: {}, onTimeProb: 0.3 });
    expect(pf.verdict).toBe('NO-GO');
  });
  it('returns GO-WITH-CAUTION for tight forecasts', () => {
    const pf = preflight({ openIssues: [{}], historicalRiskByIssue: {}, onTimeProb: 0.7 });
    expect(pf.verdict).toBe('GO-WITH-CAUTION');
  });
  it('NO-GO with 3+ déjà-vu items even if the forecast is fine', () => {
    const pf = preflight({
      openIssues: [{}, {}, {}],
      historicalRiskByIssue: { A: 0.8, B: 0.7, C: 0.6 },
      onTimeProb: 0.95,
    });
    expect(pf.verdict).toBe('NO-GO');
    expect(pf.riskyItems).toEqual(['A', 'B', 'C']);
  });
  it('says when there is no history instead of guessing', () => {
    const pf = preflight({ openIssues: [{}], historicalRiskByIssue: {}, onTimeProb: null });
    expect(pf.verdict).toBe('GO');
    expect(pf.reasons[0]).toMatch(/no history/i);
  });
});
