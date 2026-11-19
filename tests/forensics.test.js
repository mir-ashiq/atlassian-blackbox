import { describe, it, expect } from 'vitest';
import {
  workingDaysBetween, classifyChange, buildTimeline, findStalls,
  statusIntervals, windowBefore, forensicFindings, forensicScore,
} from '../src/backend/forensics';

const NOW = '2026-11-16T10:00:00.000Z';
const baseIssue = {
  key: 'PROJ-1', summary: 'Do a thing', created: '2026-11-01T00:00:00Z',
  statusName: 'In Progress', statusCategory: 'indeterminate',
  duedate: null,
};

describe('workingDaysBetween', () => {
  it('counts weekdays only (Mon–Fri 2026-11-09 → 2026-11-16)', () => {
    // Nov 9 2026 is a Monday; Nov 16 is a Monday; 7 calendar days = 5 weekdays
    expect(workingDaysBetween('2026-11-09T00:00:00Z', '2026-11-16T00:00:00Z')).toBe(5);
  });
  it('is order-agnostic', () => {
    expect(workingDaysBetween('2026-11-16T00:00:00Z', '2026-11-09T00:00:00Z')).toBe(5);
  });
  it('returns 0 for the same instant or bad input', () => {
    expect(workingDaysBetween(NOW, NOW)).toBe(0);
    expect(workingDaysBetween(null, NOW)).toBe(0);
  });
});

describe('classifyChange', () => {
  it('maps the fields the engines care about', () => {
    expect(classifyChange('status')).toBe('status');
    expect(classifyChange('assignee')).toBe('assignment');
    expect(classifyChange('description')).toBe('scope');
    expect(classifyChange('Story Points')).toBe('estimate');
    expect(classifyChange('priority')).toBe('priority');
    expect(classifyChange('something-else')).toBe('other');
  });
});

describe('buildTimeline', () => {
  const changelog = [
    { at: '2026-11-02T00:00:00Z', author: 'Ada', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
    { at: '2026-11-08T00:00:00Z', author: 'Ada', items: [{ field: 'description', from: 'a', to: 'b' }] },
    { at: '2026-11-12T00:00:00Z', author: 'Grace', items: [
      { field: 'status', from: 'In Progress', to: 'In Review' },
      { field: 'assignee', from: 'Ada', to: 'Grace' },
    ] },
  ];
  it('sorts events by time and tags gaps', () => {
    const tl = buildTimeline(baseIssue, changelog);
    expect(tl.map((e) => e.kind)).toEqual(['created', 'status', 'scope', 'status', 'assignment']);
    expect(tl[3].gapDays).toBeGreaterThan(0);
  });
  it('marks stalled events (gap >= 3 working days)', () => {
    const tl = buildTimeline(baseIssue, changelog);
    const stalled = tl.filter((e) => e.stalled);
    expect(stalled.length).toBeGreaterThan(0); // Nov 2 -> Nov 8 spans a weekend
  });
});

describe('findStalls', () => {
  it('finds silence windows >= threshold', () => {
    const tl = buildTimeline(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
      { at: '2026-11-13T00:00:00Z', items: [{ field: 'status', from: 'In Progress', to: 'In Review' }] },
    ]);
    const stalls = findStalls(tl);
    expect(stalls.length).toBe(1);
    expect(stalls[0].days).toBeGreaterThanOrEqual(3);
  });
  it('returns none for dense timelines', () => {
    const tl = buildTimeline(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
      { at: '2026-11-03T00:00:00Z', items: [{ field: 'status', from: 'In Progress', to: 'Done' }] },
    ]);
    expect(findStalls(tl)).toHaveLength(0);
  });
});

describe('statusIntervals', () => {
  it('opens the last interval (to: null)', () => {
    const tl = buildTimeline(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
      { at: '2026-11-05T00:00:00Z', items: [{ field: 'status', from: 'In Progress', to: 'Done' }] },
    ]);
    const iv = statusIntervals(tl);
    expect(iv.map((i) => i.status)).toEqual(['In Progress', 'Done']);
    expect(iv[1].to).toBeNull();
  });
});

describe('windowBefore', () => {
  it('returns events inside the N days before an anchor', () => {
    const tl = buildTimeline(baseIssue, [
      { at: '2026-11-01T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
      { at: '2026-11-10T00:00:00Z', items: [{ field: 'status', from: 'In Progress', to: 'In Review' }] },
      { at: '2026-11-15T00:00:00Z', items: [{ field: 'status', from: 'In Review', to: 'Done' }] },
    ]);
    const w = windowBefore(tl, '2026-11-16T00:00:00Z', 7);
    expect(w.events.map((e) => e.to)).toContain('In Review');
    expect(w.events.map((e) => e.to)).not.toContain('In Progress');
  });
});

describe('forensicFindings', () => {
  it('flags silent stalls on open issues', () => {
    const { findings } = forensicFindings(
      { ...baseIssue, updated: '2026-11-02T00:00:00Z' },
      [{ at: '2026-11-02T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] }],
      { now: NOW }
    );
    expect(findings.some((f) => f.code === 'silent-stall')).toBe(true);
  });
  it('flags late scope churn (>= 3 edits after start)', () => {
    const edits = [3, 4, 5].map((d) => ({
      at: `2026-11-0${d}T00:00:00Z`, items: [{ field: 'description', from: 'x', to: 'y' }],
    }));
    const { findings } = forensicFindings(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'status', from: 'To Do', to: 'In Progress' }] },
      ...edits,
    ], { now: NOW });
    expect(findings.some((f) => f.code === 'late-scope-churn')).toBe(true);
  });
  it('flags estimate creep only when raised', () => {
    const { findings } = forensicFindings(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'Story Points', from: '3', to: '8' }] },
    ], { now: NOW });
    expect(findings.some((f) => f.code === 'estimate-creep')).toBe(true);
    const { findings: down } = forensicFindings(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'Story Points', from: '8', to: '3' }] },
    ], { now: NOW });
    expect(down.some((f) => f.code === 'estimate-creep')).toBe(false);
  });
  it('flags escalations to Highest', () => {
    const { findings } = forensicFindings(baseIssue, [
      { at: '2026-11-02T00:00:00Z', items: [{ field: 'priority', from: 'High', to: 'Highest' }] },
    ], { now: NOW });
    expect(findings.some((f) => f.code === 'escalated')).toBe(true);
  });
  it('flags due-date breaches while open', () => {
    const { findings } = forensicFindings(
      { ...baseIssue, duedate: '2026-11-10' },
      [],
      { now: NOW }
    );
    expect(findings.some((f) => f.code === 'duedate-breach')).toBe(true);
  });
  it('clean issue yields no findings (recently touched, no changelog)', () => {
    // Created NOW with no changelog: no trailing silence possible.
    const { findings } = forensicFindings(
      { ...baseIssue, created: NOW, updated: NOW },
      [],
      { now: NOW }
    );
    expect(findings).toHaveLength(0);
    expect(forensicScore(findings)).toBe(0);
  });
  it('counts trailing silence to NOW for open issues', () => {
    // Untouched for ~2 weeks while In Progress: the flight recorder must
    // notice even with an empty changelog.
    const { findings } = forensicFindings(
      { ...baseIssue, updated: '2026-11-02T00:00:00Z' },
      [],
      { now: NOW }
    );
    expect(findings.some((f) => f.code === 'silent-stall')).toBe(true);
  });
  it('scores by severity weights', () => {
    expect(forensicScore([{ severity: 'high' }, { severity: 'medium' }, { severity: 'low' }])).toBe(6);
  });
});
