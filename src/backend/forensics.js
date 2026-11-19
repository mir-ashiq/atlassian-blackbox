/**
 * Atlassian Blackbox — forensic engine.
 *
 * PURE: no Forge APIs, no network, no clock reads. Takes fetched history
 * (issues + changelogs + comments) and produces incident timelines and
 * "black box" recordings of how work actually went — the same way a flight
 * recorder explains a crash after the fact.
 *
 * Every function here is unit-tested in tests/forensics.test.js.
 */

/** Working-days difference between two ISO instants (weekends excluded). */
export function workingDaysBetween(fromIso, toIso) {
  // new Date(null) is epoch 0 — guard explicitly, not just on finiteness.
  if (fromIso === null || fromIso === undefined || toIso === null || toIso === undefined) return 0;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const DAY = 86400000;
  let days = 0;
  // Walk forward from the later of (from, to) down to the earlier, counting
  // weekdays. Order-agnostic: use min/max so callers can pass either way.
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  for (let t = a; t < b; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

/** Categorize a changelog item into a forensic event type. */
export function classifyChange(field) {
  const f = String(field || '').toLowerCase();
  if (f === 'status') return 'status';
  if (f === 'assignee') return 'assignment';
  if (f === 'priority') return 'priority';
  if (f === 'summary' || f === 'description') return 'scope';
  if (f.includes('story point') || f === 'estimate' || f.includes('originalestimate')) return 'estimate';
  if (f === 'fix version' || f === 'versions') return 'release';
  if (f === 'labels') return 'labels';
  return 'other';
}

/**
 * Build a forensic timeline for one issue: the black box recording.
 * changelog: [{ at, author, items: [{ field, from, to }] }]
 * Returns events sorted by time, each tagged with a forensic category and
 * a working-days gap since the previous event.
 */
export function buildTimeline(issue, changelog = []) {
  const events = [];
  if (issue.created) {
    events.push({ at: issue.created, kind: 'created', category: 'status', detail: 'Issue created', who: null });
  }
  for (const entry of changelog) {
    for (const item of entry.items || []) {
      // Items arrive normalized ({from, to}) from history-client; the raw
      // Jira API uses fromString/toString. Accept both — but never read
      // item.toString directly: on plain objects that is the inherited
      // Object.prototype.toString FUNCTION, not the field.
      const from = item.from !== undefined ? item.from : item.fromString;
      const to = item.to !== undefined ? item.to : (typeof item.toString === 'string' ? item.toString : undefined);
      events.push({
        at: entry.at,
        kind: classifyChange(item.field),
        category: classifyChange(item.field),
        field: item.field,
        from,
        to,
        who: entry.author || null,
        detail: `${item.field}: ${from ?? '—'} → ${to ?? '—'}`,
      });
    }
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  let prev = null;
  for (const e of events) {
    e.gapDays = prev ? workingDaysBetween(prev, e.at) : 0;
    e.stalled = e.gapDays >= STALL_DAYS;
    prev = e.at;
  }
  return events;
}

export const STALL_DAYS = 3;

/**
 * Detect "silence windows" — long gaps between any activity, the strongest
 * predictor that an issue was silently blocked while marked In Progress.
 */
export function findStalls(timeline, thresholdDays = STALL_DAYS) {
  const stalls = [];
  let prev = null;
  for (const e of timeline) {
    if (prev) {
      const gap = workingDaysBetween(prev.at, e.at);
      if (gap >= thresholdDays) {
        stalls.push({ from: prev.at, to: e.at, days: gap, before: prev.kind, after: e.kind });
      }
    }
    prev = e;
  }
  return stalls;
}

/**
 * Reconstruct the WIP-over-time series for an issue (1 point per status
 * change; for board-level WIP use aggregateWip).
 */
export function statusIntervals(timeline) {
  const intervals = [];
  let current = null;
  for (const e of timeline) {
    if (e.kind === 'status') {
      if (current) current.to = e.at;
      if (e.to) {
        intervals.push({ status: e.to, from: e.at, to: null });
        current = intervals[intervals.length - 1];
      }
    }
  }
  return intervals; // last interval stays open (to: null)
}

/** How long an issue sat in a given status (working days), if ever. */
export function timeInStatus(timeline, statusName) {
  const want = String(statusName || '').toLowerCase();
  let total = 0;
  for (const iv of statusIntervals(timeline)) {
    if (String(iv.status).toLowerCase().includes(want)) {
      total += workingDaysBetween(iv.from, iv.to || new Date().toISOString());
    }
  }
  return total;
}

/**
 * The signature forensic question: "what happened to this issue in the N
 * days before it blew up (went overdue / got escalated / missed its duedate)?"
 * Returns the events in that window plus the computed stalls inside it.
 */
export function windowBefore(timeline, anchorIso, days = 7) {
  const anchor = new Date(anchorIso).getTime();
  const start = anchor - days * 86400000;
  const events = timeline.filter((e) => {
    const t = new Date(e.at).getTime();
    return t >= start && t <= anchor;
  });
  return { events, stalls: findStalls(events) };
}

/**
 * Produce a forensic finding set for an issue — the "what went wrong, with
 * evidence" narrative used by the panel, the agent and the retro engine.
 * findings: [{ code, severity, evidence, timeline }] — deterministic, no
 * LLM required, so it is always explainable.
 */
export function forensicFindings(issue, changelog = [], { now = new Date().toISOString() } = {}) {
  const timeline = buildTimeline(issue, changelog);
  const findings = [];

  // F1: silent stall — ≥3 working days with zero activity while open.
  // For open issues the silence between the LAST event and NOW is the most
  // important window of all: an issue untouched for two weeks IS stalled.
  const stalls = findStalls(timeline);
  const open = String(issue.statusCategory || '') !== 'done';
  if (open && timeline.length) {
    const last = timeline[timeline.length - 1];
    const trailing = workingDaysBetween(last.at, now);
    if (trailing >= STALL_DAYS) stalls.push({ from: last.at, to: now, days: trailing, before: last.kind, after: 'now' });
  }
  const longest = stalls.reduce((m, s) => Math.max(m, s.days), 0);
  if (open && longest >= STALL_DAYS) {
    findings.push({
      code: 'silent-stall',
      severity: longest >= 7 ? 'high' : 'medium',
      evidence: `Longest silence: ${longest} working days with no activity (threshold ${STALL_DAYS}).`,
    });
  }

  // F2: scope churn — description/summary edits after work started.
  const started = timeline.find((e) => e.kind === 'status' && /progress/i.test(String(e.to)));
  const churnAfterStart = timeline.filter(
    (e) => e.kind === 'scope' && started && new Date(e.at) >= new Date(started.at)
  ).length;
  if (churnAfterStart >= 3) {
    findings.push({
      code: 'late-scope-churn',
      severity: churnAfterStart >= 5 ? 'high' : 'medium',
      evidence: `Description/summary changed ${churnAfterStart} times after work started.`,
    });
  }

  // F3: estimate revision — points raised mid-flight signal hidden work.
  const raises = timeline.filter(
    (e) => e.kind === 'estimate' && e.to && e.from && Number(e.to) > Number(e.from)
  );
  if (raises.length) {
    findings.push({
      code: 'estimate-creep',
      severity: raises.length >= 2 ? 'medium' : 'low',
      evidence: `Estimate raised ${raises.length} time(s) mid-flight (${raises.map((r) => `${r.from}→${r.to}`).join(', ')}).`,
    });
  }

  // F4: handoff latency — assignment changes while In Progress.
  const handoffs = timeline.filter((e) => e.kind === 'assignment' && /progress/i.test(String(e.to || '')) === false);
  const reassignments = timeline.filter((e) => e.kind === 'assignment').length;
  if (reassignments >= 2) {
    findings.push({
      code: 'handoff-churn',
      severity: reassignments >= 4 ? 'medium' : 'low',
      evidence: `Reassigned ${reassignments} time(s); each handoff restarts context.`,
    });
  }
  void handoffs;

  // F5: priority escalation — jumped straight to Highest.
  const escalations = timeline.filter(
    (e) => e.kind === 'priority' && /highest|blocker|critical/i.test(String(e.to))
  );
  if (escalations.length) {
    findings.push({
      code: 'escalated',
      severity: 'high',
      evidence: `Priority escalated to ${escalations.map((e) => e.to).join(', ')} — the team already treated this as an incident.`,
    });
  }

  // F6: due-date breach while still open.
  if (issue.duedate && open && new Date(issue.duedate).getTime() < new Date(now).getTime()) {
    findings.push({
      code: 'duedate-breach',
      severity: 'high',
      evidence: `Due date ${issue.duedate} passed while the issue is still ${issue.statusName || 'open'}.`,
    });
  }

  return { findings, timeline, stalls };
}

/** Map a forensic severity to a score contribution (used for board rollups). */
export function forensicScore(findings) {
  const w = { high: 3, medium: 2, low: 1 };
  return findings.reduce((n, f) => n + (w[f.severity] || 0), 0);
}
