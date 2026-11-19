/**
 * Atlassian Blackbox — history client.
 *
 * The data layer that feeds the pure engines: issue changelogs (the flight
 * recording), comments, sprint velocity, and resolved-issue corpora for the
 * similarity engine. All calls defensive: failures become empty results,
 * never exceptions into the engines.
 */
import api, { route, routeFromAbsolute } from '@forge/api';

/** GET Jira REST as app; parsed JSON or null; never throws. */
export async function jget(url) {
  try {
    const target = routeFromAbsolute(new URL(url, 'https://atlassian.net').href);
    const res = await api.asApp().requestJira(target);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** GET Jira REST as user (for board/sprint lookups). */
export async function jgetAsUser(url) {
  try {
    const target = routeFromAbsolute(new URL(url, 'https://atlassian.net').href);
    const res = await api.asUser().requestJira(target);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Full changelog of one issue, normalized:
 * [{ at, author, items: [{ field, from, to }] }]
 */
export async function getChangelog(issueIdOrKey) {
  const out = [];
  let startAt = 0;
  // 3 pages max (100 each) — enough history for forensics without risk of
  // long-tail pagination loops on ancient issues.
  for (let page = 0; page < 3; page++) {
    const data = await jget(
      `/rest/api/3/issue/${issueIdOrKey}/changelog?maxResults=100&startAt=${startAt}`
    );
    if (!data || !Array.isArray(data.values)) break;
    for (const h of data.values) {
      out.push({
        at: h.created,
        author: h.author?.displayName || null,
        items: (h.items || []).map((i) => ({
          field: i.field,
          from: i.fromString,
          to: i.toString,
        })),
      });
    }
    if (!data.isLast && data.maxResults && startAt + data.values.length < data.total) {
      startAt += data.values.length;
    } else break;
  }
  return out;
}

/** Comments of one issue, normalized: [{ at, author, bodyText }] */
export async function getComments(issueIdOrKey) {
  const data = await jget(`/rest/api/3/issue/${issueIdOrKey}/comment?maxResults=50`);
  if (!data || !Array.isArray(data.comments)) return [];
  return data.comments.map((c) => ({
    at: c.created,
    author: c.author?.displayName || null,
    bodyText: adfToText(c.body),
  }));
}

/** Flatten ADF to text (comments, descriptions). */
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
      if (Array.isArray(n.content)) walk(n.content);
    }
  };
  walk(node.content);
  return out.join(' ');
}

/** The sprint currently active on a board (null between sprints). */
export async function getActiveSprint(boardId) {
  const data = await jgetAsUser(
    `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`
  );
  const sprint = data?.values?.[0] || null;
  if (!sprint) return null;
  return {
    id: String(sprint.id),
    name: sprint.name,
    startDate: sprint.startDate || null,
    endDate: sprint.endDate || null,
    state: sprint.state,
  };
}

/** Past (closed) sprints of a board, most recent first. */
export async function getPastSprints(boardId, max = 4) {
  const data = await jgetAsUser(
    `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${max}`
  );
  return (data?.values || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    startDate: s.startDate || null,
    endDate: s.endDate || null,
    completeDate: s.completeDate || null,
  }));
}

/**
 * Issues of a sprint with the fields the engines need.
 * Returns normalized: [{ key, id, summary, description(ADF), statusName,
 *   statusCategory, duedate, resolvedAt, updated, created, issuetypeName }]
 */
export async function getSprintIssues(sprintId) {
  const data = await jgetAsUser(
    `/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=100&fields=summary,description,status,assignee,updated,created,duedate,resolutiondate,issuetype,labels,customfield_10016`
  );
  return (data?.issues || []).map((raw) => {
    const f = raw.fields || {};
    return {
      id: String(raw.id ?? ''),
      key: raw.key || '',
      summary: f.summary || '',
      description: f.description || null,
      statusName: f.status?.name || '',
      statusCategory: f.status?.statusCategory?.key || '',
      issuetypeName: f.issuetype?.name || '',
      duedate: f.duedate || null,
      resolvedAt: f.resolutiondate || null,
      updated: f.updated || null,
      created: f.created || null,
      labels: f.labels || [],
    };
  });
}

/**
 * Resolved-issue corpus for the similarity engine: everything resolved in
 * the board's recent past sprints, with an outcome label derived from
 * resolution vs. duedate (and priority escalations when visible).
 */
export async function getHistoryCorpus(boardId, maxSprints = 4) {
  const sprints = await getPastSprints(boardId, maxSprints);
  const corpus = [];
  for (const s of sprints) {
    const issues = await getSprintIssues(s.id);
    for (const i of issues) {
      if (!i.resolvedAt) continue; // only completed work teaches outcomes
      const breached = i.duedate && new Date(i.resolvedAt).getTime() > new Date(i.duedate).getTime() + 86400000;
      corpus.push({
        key: i.key,
        summary: i.summary,
        description: i.description,
        resolved: true,
        outcome: breached ? 'breach' : 'on-time',
        sprint: s.name,
        resolvedAt: i.resolvedAt,
      });
    }
  }
  return corpus;
}

/** Completion timestamps of all resolved issues in recent sprints (forecast input). */
export async function getCompletionTimestamps(boardId, maxSprints = 6) {
  const sprints = await getPastSprints(boardId, maxSprints);
  const stamps = [];
  for (const s of sprints) {
    const issues = await getSprintIssues(s.id);
    for (const i of issues) if (i.resolvedAt) stamps.push(i.resolvedAt);
  }
  return stamps;
}
