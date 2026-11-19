import { describe, it, expect, vi } from 'vitest';

// Mock every Forge client so the orchestrator test runs hermetically.
vi.mock('@forge/api', () => ({ default: {}, route: (s) => s, routeFromAbsolute: (s) => s }));
vi.mock('@forge/kvs', () => ({ default: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));
vi.mock('../src/backend/jira-client', () => ({ getAllBoards: vi.fn(async () => []) }));
vi.mock('../src/backend/history-client', () => ({
  getActiveSprint: vi.fn(async () => ({ id: '9', name: 'S4', endDate: '2026-11-25T00:00:00Z' })),
  getPastSprints: vi.fn(async () => [{ id: '8', name: 'S3' }]),
  getSprintIssues: vi.fn(async (id) =>
    id === '9' ? [
      { key: 'B-1', summary: 'Payment gateway retry storm on cold cache', description: null, statusCategory: 'indeterminate', statusName: 'In Progress', duedate: null, resolvedAt: null, created: '2026-11-12T00:00:00Z', updated: '2026-11-13T00:00:00Z' },
      { key: 'B-2', summary: 'Write ADR for event bus', description: null, statusCategory: 'new', statusName: 'To Do', duedate: null, resolvedAt: null, created: '2026-11-12T00:00:00Z', updated: '2026-11-12T00:00:00Z' },
    ] : [
      { key: 'P-1', summary: 'Payment gateway 502s for stored cards', description: null, statusCategory: 'done', statusName: 'Done', duedate: '2026-11-10', resolvedAt: '2026-11-14', created: '2026-11-01T00:00:00Z', updated: '2026-11-14T00:00:00Z' },
      { key: 'C-1', summary: 'CSV export', description: null, statusCategory: 'done', statusName: 'Done', duedate: '2026-11-12', resolvedAt: '2026-11-11', created: '2026-11-01T00:00:00Z', updated: '2026-11-11T00:00:00Z' },
    ]),
  getChangelog: vi.fn(async (key) => key === 'B-1'
    ? [{ at: '2026-11-12T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] }]
    : []),
  getHistoryCorpus: vi.fn(async () => [
    { key: 'P-1', summary: 'Payment gateway 502s for stored cards', description: 'Saved payment methods hit 502s when the token cache is cold.', resolved: true, outcome: 'breach' },
    { key: 'C-1', summary: 'Export report to CSV', description: 'Streaming export.', resolved: true, outcome: 'on-time' },
  ]),
  getCompletionTimestamps: vi.fn(async () => ['2026-11-11T10:00:00Z', '2026-11-12T10:00:00Z', '2026-11-13T10:00:00Z']),
}));

import { learnBoard } from '../src/backend/orchestrator';

describe('learnBoard (integration over mocked history)', () => {
  it('learns: forecast + preflight + déjà-vu + retro, and persists', async () => {
    const r = await learnBoard('1', { now: '2026-11-16T10:00:00Z' });
    const s = r.summary;
    expect(s.sprint.name).toBe('S4');
    expect(s.openCount).toBe(2);
    expect(s.corpusSize).toBe(2);
    expect(s.onTimeProbability).not.toBeNull();
    expect(['GO', 'GO-WITH-CAUTION', 'NO-GO']).toContain(s.preflight.verdict);
    // B-1 (payment retry storm) must resemble P-1 (payment breach) more than C-1
    const b1 = r.issueReports.find((x) => x.issue.key === 'B-1');
    expect(b1).toBeTruthy();
    expect(b1.similar.length).toBeGreaterThan(0);
    expect(b1.similar[0].key).toBe('P-1');
    expect(b1.historicalRisk).toBeGreaterThan(0);
    // Retro of the closed sprint exists and classifies the late P-1 as crashed
    expect(r.retro).toBeTruthy();
    expect(r.retro.crashed.map((c) => c.key)).toContain('P-1');
  });
});
