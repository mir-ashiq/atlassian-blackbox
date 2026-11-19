/**
 * Atlassian Blackbox — retrospective engine.
 *
 * PURE. Turns a finished sprint's issues + forensic findings into a
 * structured retro: what crashed (breached/escalated), what nearly crashed
 * (high finding scores but on time), and what went well (clean + on time).
 * The "team memory" the agent recalls in the next sprint's planning.
 */

/**
 * @param {Array} issues  normalized: [{ key, summary, statusCategory, duedate, statusName }]
 * @param {Object} findingScoresByIssue  { [issueKey]: number } from forensicScore()
 * @param {Object} options { now }
 */
export function buildRetro(issues, findingScoresByIssue, { now = new Date().toISOString() } = {}) {
  const crashed = [];
  const nearMisses = [];
  const wins = [];

  for (const i of issues) {
    const score = findingScoresByIssue[i.key] || 0;
    const done = i.statusCategory === 'done';
    const breached = i.duedate && new Date(i.duedate).getTime() < new Date(now).getTime() && !done;
    const lateDone = done && i.duedate && new Date(i.duedate).getTime() < new Date(now).getTime() && lateCompletion(i);

    if (breached || lateDone) {
      crashed.push({ key: i.key, summary: i.summary, score, why: breached ? 'due-date breach' : 'completed late', patterns: i.patterns || [] });
    } else if (score >= 4) {
      nearMisses.push({ key: i.key, summary: i.summary, score, why: 'high forensic load, still landed', patterns: i.patterns || [] });
    } else if (done && score === 0) {
      wins.push({ key: i.key, summary: i.summary, score, why: 'clean and on time', patterns: i.patterns || [] });
    }
  }

  crashed.sort((a, b) => b.score - a.score);
  nearMisses.sort((a, b) => b.score - a.score);

  return {
    generatedAt: now,
    counts: { crashed: crashed.length, nearMisses: nearMisses.length, wins: wins.length, total: issues.length },
    crashed,
    nearMisses,
    wins,
    lessons: deriveLessons(crashed, nearMisses),
  };
}

/** Late completion detection placeholder — resolved issues with a duedate
 * in the past count as late unless we can see they closed before it; the
 * caller passes resolution dates via issue.resolvedAt when available. */
function lateCompletion(issue) {
  if (issue.resolvedAt && issue.duedate) {
    return new Date(issue.resolvedAt).getTime() > new Date(issue.duedate).getTime();
  }
  return true; // no resolution date: assume late (conservative)
}

/**
 * Deterministic lesson extraction: patterns that repeat across crashed
 * items become "lessons" the agent cites next sprint.
 */
export function deriveLessons(crashed, nearMisses) {
  const lessons = [];
  const all = [...crashed, ...nearMisses];
  if (!all.length) return lessons;

  // Lesson shape: "X of the Y items that missed had <pattern>".
  // Patterns come from the caller via item.patterns (string[]); see
  // index.js which maps forensic codes to human phrases.
  const counts = new Map();
  for (const item of all) {
    for (const p of item.patterns || []) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  for (const [pattern, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    // A pattern becomes a lesson only when it REPEATED across troubled
    // items — one coincidence teaches nothing.
    if (n >= 2) {
      lessons.push({ pattern, occurrences: n, share: Number((n / all.length).toFixed(2)) });
    }
  }
  return lessons.slice(0, 5);
}

/** Render a retro to text for the agent / comments. */
export function renderRetro(retro) {
  const lines = [`Sprint retro — ${String(retro.generatedAt).slice(0, 10)}`];
  lines.push(`${retro.counts.crashed} crashed · ${retro.counts.nearMisses} near-misses · ${retro.counts.wins} wins (${retro.counts.total} items)`);
  if (retro.crashed.length) {
    lines.push('Crashed:');
    for (const c of retro.crashed.slice(0, 5)) lines.push(`  🔴 ${c.key}: ${c.summary} (${c.why})`);
  }
  if (retro.nearMisses.length) {
    lines.push('Near misses:');
    for (const nm of retro.nearMisses.slice(0, 5)) lines.push(`  🟡 ${nm.key}: ${nm.summary} (${nm.why})`);
  }
  if (retro.wins.length) {
    lines.push('Wins:');
    for (const w of retro.wins.slice(0, 3)) lines.push(`  🟢 ${w.key}: ${w.summary}`);
  }
  if (retro.lessons.length) {
    lines.push('Lessons for next sprint:');
    for (const l of retro.lessons) lines.push(`  → ${l.pattern} appeared in ${l.occurrences} troubled item(s) (${Math.round(l.share * 100)}%)`);
  } else {
    lines.push('No repeating patterns detected across troubled items.');
  }
  return lines.join('\n');
}

/**
 * Preflight check: run BEFORE the sprint starts. Combines the similarity
 * engine's historical risk per open item with the forecast's on-time
 * probability into a go/no-go with cited evidence.
 */
export function preflight({ openIssues, historicalRiskByIssue, onTimeProb, threshold = 0.5 }) {
  const risky = Object.entries(historicalRiskByIssue || {})
    .map(([key, risk]) => ({ key, risk }))
    .filter((x) => x.risk >= threshold)
    .sort((a, b) => b.risk - a.risk);

  let verdict = 'GO';
  if (onTimeProb !== null && onTimeProb < 0.5) verdict = 'NO-GO';
  else if (onTimeProb !== null && onTimeProb < 0.8) verdict = 'GO-WITH-CAUTION';
  if (risky.length >= 3) verdict = 'NO-GO';
  else if (risky.length >= 1 && verdict === 'GO') verdict = 'GO-WITH-CAUTION';

  const reasons = [];
  if (onTimeProb !== null) reasons.push(`Monte-Carlo on-time probability: ${Math.round(onTimeProb * 100)}% (from your own throughput history).`);
  if (risky.length) reasons.push(`${risky.length} open item(s) resemble past troubled work: ${risky.map((r) => `${r.key} (${Math.round(r.risk * 100)}%)`).join(', ')}.`);
  if (!reasons.length) reasons.push('No history to learn from yet — run a scan after this sprint to build the memory.');

  return { verdict, reasons, riskyItems: risky.map((r) => r.key) };
}
