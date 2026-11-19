/**
 * Atlassian Blackbox — orchestrator.
 *
 * One pass: fetch history -> run the pure engines -> persist the "memory"
 * (KVS) for trend lines and instant loads. Used by the resolver, the agent
 * actions and the hourly trigger.
 */
import kvs from '@forge/kvs';
import {
  forensicFindings, forensicScore, buildTimeline, windowBefore,
} from './forensics';
import { rankSimilar, historicalRisk } from './similarity';
import { throughputSamples, forecastCompletion, onTimeProbability, workingDaysUntil } from './forecast';
import { buildRetro, renderRetro, preflight } from './retro';
import {
  getActiveSprint, getPastSprints, getSprintIssues, getChangelog,
  getHistoryCorpus, getCompletionTimestamps,
} from './history-client';

/**
 * Full black-box learning pass for a board:
 *  1. corpus + completions from past sprints (the memory)
 *  2. active sprint issues, each forensically examined + similarity-matched
 *  3. Monte-Carlo forecast + preflight verdict
 *  4. retro of the most recent CLOSED sprint
 * Returns everything the UI and agent need; persists a snapshot to KVS.
 */
export async function learnBoard(boardId, { now = new Date().toISOString() } = {}) {
  const sprint = await getActiveSprint(boardId);
  const issues = sprint ? await getSprintIssues(sprint.id) : [];
  const corpus = await getHistoryCorpus(boardId, 4);
  const completions = await getCompletionTimestamps(boardId, 6);

  // Per-issue: forensics (changelog-limited to keep the pass fast) + similarity.
  const issueReports = [];
  const historicalRiskByIssue = {};
  for (const issue of issues.slice(0, 30)) {
    const changelog = await getChangelog(issue.key);
    const forensics = forensicFindings(issue, changelog, { now });
    const similars = corpus.length ? rankSimilar(issue, corpus, 3) : [];
    const risk = historicalRisk(similars);
    historicalRiskByIssue[issue.key] = risk;
    issueReports.push({
      issue: {
        key: issue.key, summary: issue.summary, statusName: issue.statusName,
        statusCategory: issue.statusCategory, issuetypeName: issue.issuetypeName,
        duedate: issue.duedate, updated: issue.updated,
      },
      findings: forensics.findings,
      forensicScore: forensicScore(forensics.findings),
      timeline: forensics.timeline,
      stalls: forensics.stalls,
      similar: similars,
      historicalRisk: risk,
    });
  }

  // Forecast: throughput from completions; open = not-done active items.
  const openIssues = issues.filter((i) => i.statusCategory !== 'done');
  const samples = throughputSamples(completions);
  const remainingDays = sprint?.endDate ? workingDaysUntil(now, sprint.endDate) : null;
  const onTime = samples.length && remainingDays !== null
    ? onTimeProbability({ openCount: openIssues.length, samples, remainingWorkingDays: remainingDays, runs: 1000 })
    : null;
  const forecast = samples.length
    ? forecastCompletion({ openCount: openIssues.length, samples, runs: 1000 })
    : null;

  const pf = preflight({ openIssues, historicalRiskByIssue, onTime });

  // Retro of the most recent closed sprint.
  const closed = await getPastSprints(boardId, 1);
  let retro = null;
  if (closed.length) {
    const closedIssues = await getSprintIssues(closed[0].id);
    const changelogs = {};
    const scores = {};
    for (const i of closedIssues.slice(0, 30)) {
      const cl = await getChangelog(i.key);
      changelogs[i.key] = cl;
      scores[i.key] = forensicScore(forensicFindings(i, cl, { now }).findings);
    }
    // Enrich with patterns for lesson extraction.
    const enriched = closedIssues.map((i) => {
      const f = forensicFindings(i, changelogs[i.key] || [], { now }).findings;
      return { ...i, patterns: f.map((x) => x.code) };
    });
    retro = buildRetro(enriched, scores, { now });
  }

  const summary = {
    sprint,
    issueCount: issues.length,
    openCount: openIssues.length,
    corpusSize: corpus.length,
    onTimeProbability: onTime,
    forecast,
    preflight: pf,
    topHistoricalRisk: issueReports
      .filter((r) => r.historicalRisk > 0)
      .sort((a, b) => b.historicalRisk - a.historicalRisk)
      .slice(0, 5)
      .map((r) => ({ key: r.issue.key, risk: r.historicalRisk, similar: r.similar[0]?.key })),
    topForensic: issueReports
      .sort((a, b) => b.forensicScore - a.forensicScore)
      .slice(0, 5)
      .map((r) => ({ key: r.issue.key, score: r.forensicScore, signals: r.findings.map((f) => f.code) })),
  };

  await persistMemory(boardId, summary, now);
  return { summary, issueReports, retro, corpusSize: corpus.length, learnedAt: now };
}

/** Persist a memory snapshot; keep the last 14 per board. */
async function persistMemory(boardId, summary, now) {
  try {
    const key = `blackbox:${boardId}:snapshots`;
    const existing = (await kvs.get(key)) || [];
    existing.push({
      at: now,
      onTimeProbability: summary.onTimeProbability,
      openCount: summary.openCount,
      corpusSize: summary.corpusSize,
    });
    await kvs.set(key, existing.slice(-14));
    await kvs.set(`blackbox:${boardId}:latest`, { at: now, summary });
  } catch (e) {
    console.error('kvs persist failed', String(e));
  }
}

export async function getLatest(boardId) {
  try {
    return (await kvs.get(`blackbox:${boardId}:latest`)) || null;
  } catch {
    return null;
  }
}

export async function getMemoryTrend(boardId) {
  try {
    return (await kvs.get(`blackbox:${boardId}:snapshots`)) || [];
  } catch {
    return [];
  }
}

/** Deep-dive one issue: timeline + forensics + the 7-days-before window. */
export async function examineIssue(issueKeyOrId, { now = new Date().toISOString() } = {}) {
  const issue = await fetchIssue(issueKeyOrId);
  if (!issue) return { error: `Issue ${issueKeyOrId} not found or not visible to the app.` };
  const changelog = await getChangelog(issue.key);
  const forensics = forensicFindings(issue, changelog, { now });
  const anchor = issue.duedate || issue.updated || now;
  const before = windowBefore(forensics.timeline, anchor, 7);
  const corpus = await getHistoryCorpus(issue.boardId || 'unknown', 4).catch(() => []);
  const similars = corpus.length ? rankSimilar(issue, corpus, 3) : [];
  return {
    issue: {
      key: issue.key, summary: issue.summary, statusName: issue.statusName,
      issuetypeName: issue.issuetypeName, duedate: issue.duedate, updated: issue.updated,
    },
    findings: forensics.findings,
    score: forensicScore(forensics.findings),
    timeline: forensics.timeline,
    stalls: forensics.stalls,
    windowBefore: before,
    similar: similars,
    historicalRisk: historicalRisk(similars),
  };
}

/** Fetch one normalized issue (with boardId for corpus context). */
async function fetchIssue(issueKeyOrId) {
  const data = await (await import('@forge/api')).default.asApp().requestJira(
    (await import('@forge/api')).route`/rest/api/3/issue/${issueKeyOrId}?fields=summary,description,status,assignee,updated,created,duedate,resolutiondate,issuetype`
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) return null;
  const f = data.fields || {};
  // Best-effort board lookup for corpus context.
  let boardId = null;
  try {
    const b = await (await import('@forge/api')).default.asApp().requestJira(
      (await import('@forge/api')).route`/rest/agile/1.0/issue/${issueKeyOrId}/board?maxResults=1`
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    boardId = b?.values?.[0]?.id ? String(b.values[0].id) : null;
  } catch { /* optional */ }
  return {
    id: String(data.id ?? ''),
    key: data.key || '',
    summary: f.summary || '',
    description: f.description || null,
    statusName: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    issuetypeName: f.issuetype?.name || '',
    duedate: f.duedate || null,
    resolvedAt: f.resolutiondate || null,
    updated: f.updated || null,
    created: f.created || null,
    boardId,
  };
}

/** Render the retro as text (agent + comment paths). */
export { renderRetro };
