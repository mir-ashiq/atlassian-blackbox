/**
 * Atlassian Blackbox — Forge entry point.
 * Resolver + 6 Rovo/MCP actions + hourly memory. Every surface (panel,
 * page, agent, MCP) calls the same engines — one flight recorder.
 */
import Resolver from '@forge/resolver';
import { getAllBoards, createSubtask, postComment } from './backend/jira-client';
import { learnBoard, examineIssue, getLatest, getMemoryTrend, renderRetro } from './backend/orchestrator';
import { seedDemoData } from './backend/demo-seeder';
import { throughputSamples, onTimeProbability, workingDaysUntil, forecastCompletion } from './backend/forecast';
import { rankSimilar, historicalRisk } from './backend/similarity';
import { getHistoryCorpus, getSprintIssues, getActiveSprint, getCompletionTimestamps } from './backend/history-client';

const resolver = new Resolver();

resolver.define('getBoards', async () => ({ boards: await getAllBoards() }));

resolver.define('seedDemo', async () => {
  const result = await seedDemoData();
  return result;
});

resolver.define('learn', async ({ payload }) => {
  const result = await learnBoard(String(payload.boardId));
  return {
    summary: result.summary,
    issueReports: result.issueReports,
    retroText: result.retro ? renderRetro(result.retro) : null,
    retro: result.retro,
    learnedAt: result.learnedAt,
  };
});

resolver.define('getBoardState', async ({ payload }) => {
  const boardId = String(payload.boardId);
  const [latest, trend] = await Promise.all([getLatest(boardId), getMemoryTrend(boardId)]);
  return { latest, trend };
});

resolver.define('examine', async ({ payload }) => {
  return examineIssue(String(payload.issueKeyOrId));
});

resolver.define('draftFollowUp', async ({ payload }) => {
  const result = await actDraftLessonTask(payload);
  const m = typeof result === 'string' ? result.match(/([A-Z][A-Z0-9]+-\d+)/) : null;
  return m ? { key: m[1] } : result;
});

export const handler = resolver.getDefinitions();

// ---------------------------------------------------------------------------
// Scheduled: refresh the memory for up to 3 boards per run.
// ---------------------------------------------------------------------------
export async function hourlyMemory() {
  try {
    const boards = await getAllBoards();
    for (const board of boards.slice(0, 3)) {
      await learnBoard(String(board.id));
    }
  } catch (e) {
    console.error('hourlyMemory failed', String(e));
  }
}

// ---------------------------------------------------------------------------
// Rovo agent / MCP actions
// ---------------------------------------------------------------------------
function boardIdFromContextOrInput(payload) {
  return payload?.boardId || payload?.context?.board?.id || null;
}

/** 1. Learn the board: memory + forecast + preflight. */
export async function actLearnBoard(payload) {
  const boardId = boardIdFromContextOrInput(payload);
  if (!boardId) return 'No board specified. Ask the user which board, or open Blackbox first.';
  const { summary } = await learnBoard(String(boardId));
  const onTime = summary.onTimeProbability === null ? 'unknown (no history yet)' : `${Math.round(summary.onTimeProbability * 100)}%`;
  const lines = [
    `🔭 Blackbox memory — sprint "${summary.sprint?.name || '—'}"`,
    `History corpus: ${summary.corpusSize} completed items. Open now: ${summary.openCount}.`,
    `Monte-Carlo on-time probability: ${onTime}`,
    summary.forecast?.percentiles ? `Forecast: p50 ${summary.forecast.percentiles.p50}d · p85 ${summary.forecast.percentiles.p85}d · p95 ${summary.forecast.percentiles.p95}d` : 'Forecast: no throughput history yet.',
    `Preflight verdict: ${summary.preflight.verdict}`,
    ...summary.preflight.reasons.map((r) => `- ${r}`),
  ];
  const top = summary.topHistoricalRisk[0];
  if (top) lines.push(`Strongest déjà-vu: ${top.key} resembles past troubled work (${Math.round(top.risk * 100)}% risk).`);
  return lines.join('\n');
}

/** 2. Examine one issue forensically. */
export async function actExamineIssue(payload) {
  const keyOrId = payload?.issueKeyOrId || payload?.context?.jira?.issueKey;
  if (!keyOrId) return 'No issue specified for the examination.';
  const r = await examineIssue(String(keyOrId));
  if (r.error) return r.error;
  const lines = [
    `📼 Blackbox recording — ${r.issue.key}: ${r.issue.summary}`,
    ...r.findings.map((f) => `- ${f.code} (${f.severity}): ${f.evidence}`),
    `Forensic score: ${r.score}`,
  ];
  if (r.stalls.length) lines.push(`Silence windows: ${r.stalls.map((s) => `${s.days}d`).join(', ')}.`);
  if (r.similar.length) {
    lines.push('Déjà-vu (most similar past items):');
    for (const s of r.similar) lines.push(`  - ${s.key} (${s.outcome || 'resolved'}, similarity ${s.score})`);
  }
  return lines.join('\n');
}

/** 3. Forecast the sprint (Monte-Carlo from own history). */
export async function actForecastSprint(payload) {
  const boardId = boardIdFromContextOrInput(payload);
  if (!boardId) return 'No board specified.';
  const sprint = await getActiveSprint(String(boardId));
  if (!sprint) return 'No active sprint on this board.';
  const issues = await getSprintIssues(sprint.id);
  const open = issues.filter((i) => i.statusCategory !== 'done');
  const completions = await getCompletionTimestamps(String(boardId), 6);
  const samples = throughputSamples(completions);
  if (!samples.length) return 'No completion history yet — finish a sprint or seed demo history, then ask again.';
  const remaining = workingDaysUntil(new Date().toISOString(), sprint.endDate);
  const prob = onTimeProbability({ openCount: open.length, samples, remainingWorkingDays: remaining, runs: 1000 });
  const f = forecastCompletion({ openCount: open.length, samples, runs: 1000 });
  const lines = [
    `🎲 Forecast for "${sprint.name}": ${open.length} open items, ${remaining} working days left.`,
    `On-time probability: ${Math.round(prob * 100)}% (2,000-run Monte-Carlo replaying your own throughput).`,
    `Completion: p50 ${f.percentiles.p50}d · p85 ${f.percentiles.p85}d · p95 ${f.percentiles.p95}d.`,
    prob < 0.5 ? 'This sprint is likely to spill. Consider descope before it crashes.' : prob < 0.8 ? 'Tight but feasible — watch the top-risk items.' : 'Healthy sprint by your own historical standards.',
  ];
  return lines.join('\n');
}

/** 4. Déjà-vu: rank past items similar to a target (or the whole open sprint). */
export async function actDejaVu(payload) {
  const boardId = boardIdFromContextOrInput(payload);
  const targetKey = payload?.issueKeyOrId || null;
  if (!boardId) return 'No board specified.';
  const corpus = await getHistoryCorpus(String(boardId), 4);
  if (!corpus.length) return 'No history corpus yet — seed demo history or finish a sprint first.';
  if (targetKey) {
    const target = (await getSprintIssues((await getActiveSprint(String(boardId))).id)).find((i) => i.key === targetKey);
    if (!target) return `Issue ${targetKey} is not in the active sprint; examine it instead.`;
    const similars = rankSimilar(target, corpus, 3);
    if (!similars.length) return 'No similar past items found for this issue.';
    const lines = [`👀 Déjà-vu for ${targetKey}:`];
    for (const s of similars) lines.push(`- ${s.key} "${s.summary}" (${s.outcome}, similarity ${s.score}, shared: ${s.why.join(', ')})`);
    lines.push(`Historical risk: ${Math.round(historicalRisk(similars) * 100)}%.`);
    return lines.join('\n');
  }
  // Whole sprint: the top-3 most historically-risky open items.
  const sprint = await getActiveSprint(String(boardId));
  const issues = (await getSprintIssues(sprint.id)).filter((i) => i.statusCategory !== 'done');
  const lines = [`👀 Déjà-vu across the open sprint:`];
  for (const i of issues.slice(0, 10)) {
    const similars = rankSimilar(i, corpus, 1);
    if (similars.length && historicalRisk(similars) > 0) {
      lines.push(`- ${i.key} "${i.summary}" ← resembles ${similars[0].key} (${similars[0].outcome}, ${Math.round(historicalRisk(similars) * 100)}%)`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : 'No open item resembles past trouble. Good sign.';
}

/** 5. Retrospective of the last closed sprint. */
export async function actSprintRetro(payload) {
  const boardId = boardIdFromContextOrInput(payload);
  if (!boardId) return 'No board specified.';
  const { retro } = await learnBoard(String(boardId));
  if (!retro) return 'No closed sprint found on this board yet.';
  return renderRetro(retro);
}

/** 6. Preflight: GO / NO-GO before the sprint (or mid-sprint). */
export async function actPreflight(payload) {
  const boardId = boardIdFromContextOrInput(payload);
  if (!boardId) return 'No board specified.';
  const { summary } = await learnBoard(String(boardId));
  const pf = summary.preflight;
  const lines = [`🚦 Preflight: ${pf.verdict}`];
  for (const r of pf.reasons) lines.push(`- ${r}`);
  if (pf.riskyItems.length) lines.push(`Risky items: ${pf.riskyItems.join(', ')}.`);
  return lines.join('\n');
}

/** 7. (CREATE) Turn a lesson/finding into a follow-up task. */
export async function actDraftLessonTask(payload) {
  const parentKey = payload?.parentIssueKey || payload?.context?.jira?.issueKey;
  if (!parentKey) return 'No parent issue specified.';
  const findings = [];
  try {
    if (payload?.findingsJson) findings.push(...JSON.parse(payload.findingsJson));
  } catch { /* tolerate malformed JSON */ }
  const description = [
    `Created by Blackbox for: ${payload?.findingCode || payload?.riskSignal || 'general lesson'}`,
    '',
    ...(findings.length ? findings.map((f) => `- [${f.severity || '?'}] ${f.code || f.signal || JSON.stringify(f).slice(0, 120)}`) : ['(no structured findings provided)']),
    '',
    'Review and adjust before starting work.',
  ];
  const result = await createSubtask(parentKey, payload?.summary || 'Follow-up from history', description);
  if (result.error) return `Could not create subtask: ${result.error}`;
  return `Created follow-up subtask ${result.key} under ${parentKey}.`;
}

/** 8. (UPDATE) Post the examination as a comment on the issue. */
export async function actAnnotateIssue(payload) {
  const keyOrId = payload?.issueKeyOrId || payload?.context?.jira?.issueKey;
  if (!keyOrId) return 'No issue specified.';
  const r = await examineIssue(String(keyOrId));
  if (r.error) return r.error;
  const bulletLines = r.findings.map((f) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `${f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🟢'} ${f.code} — ${f.evidence}` }],
  }));
  const similarLine = r.similar.length
    ? { type: 'paragraph', content: [{ type: 'text', text: `Déjà-vu: ${r.similar.map((s) => `${s.key} (${s.outcome || 'resolved'})`).join(', ')}.` }] }
    : null;
  const adf = {
    type: 'doc', version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `📼 Blackbox examination — forensic score ${r.score}` }] },
      ...bulletLines,
      ...(similarLine ? [similarLine] : []),
      { type: 'paragraph', content: [{ type: 'text', text: 'Ask the Blackbox agent to draft a follow-up task for any finding.' }] },
    ],
  };
  const result = await postComment(String(keyOrId), adf);
  if (result.error) return `Could not post comment: ${result.error}`;
  return `Examination posted as a comment on ${r.issue.key}.`;
}
