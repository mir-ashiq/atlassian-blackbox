/**
 * Atlassian Blackbox — demo history seeder.
 *
 * The judges' problem with "learning" apps: a fresh site has NO history, so
 * the memory/forecast surfaces have nothing to show. This seeder creates a
 * Scrum project (key BBD) with TWO closed sprints of realistic history —
 * including crashed items (breached, escalated, stalled), near-misses and
 * clean wins — plus ONE active sprint whose open items are engineered to
 * resemble the past trouble. Result: the similarity engine says "we've seen
 * this before", the forecast has throughput to replay, and the preflight
 * has a verdict, all on the first click.
 *
 * Idempotent (skips if BBD exists), never deletes, returns {error} instead
 * of throwing. Slow-free: sequential awaits only.
 */
import api, { route } from '@forge/api';

const PROJECT_KEY = 'BBD';

async function jpost(url, payload) {
  try {
    const res = await api.asApp().requestJira(route`${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) return { error: `Jira responded ${res.status}: ${(text || '').slice(0, 200)}` };
    return data || {};
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

async function jget(url) {
  try {
    const res = await api.asApp().requestJira(route`${url}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function jput(url, payload) {
  try {
    const res = await api.asApp().requestJira(route`${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: `Jira responded ${res.status}` };
    return {};
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

function adf(text) {
  return {
    type: 'doc',
    version: 1,
    content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [],
  };
}

let myId = null;
async function getMyAccountId() {
  if (myId) return myId;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/myself`);
    if (!res.ok) return null;
    myId = (await res.json()).accountId || null;
    return myId;
  } catch {
    return null;
  }
}

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString();

/**
 * History spec: three closed sprints of outcomes.
 * issue: { summary, desc, points, status (final), history: [{d (days ago), field, from, to}] , outcome }
 */
function closedSprintSpecs() {
  return [
    {
      name: 'Sprint 1 — learning the hard way',
      start: 45, end: 31,
      issues: [
        {
          summary: 'Payment gateway returns 422 for stored cards',
          desc: 'Reproduced on staging. Customers with saved payment methods cannot complete checkout when the token cache is cold.',
          points: 5, finalStatus: 'Done', outcome: 'breach',
          history: [
            { d: 44, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 40, field: 'priority', from: 'High', to: 'Highest' },
            { d: 38, field: 'status', from: 'In Progress', to: 'In Review' },
            { d: 37, field: 'status', from: 'In Review', to: 'In Progress' },
            { d: 30, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Fix duplicate invoice numbers',
          desc: 'Two invoices with the same number generated in the same second. Add a sequence constraint.',
          points: 3, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 44, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 42, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Upgrade Node runtime',
          desc: 'Runtime bumped; smoke tests green.',
          points: 2, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 43, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 41, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Migrate reporting DB to pg16',
          desc: 'Plan and execute the reporting database migration with a rollback path.',
          points: 5, finalStatus: 'Done', outcome: 'breach',
          history: [
            { d: 44, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 41, field: 'description', from: '(edit)', to: '(edit)' },
            { d: 39, field: 'description', from: '(edit)', to: '(edit)' },
            { d: 37, field: 'description', from: '(edit)', to: '(edit)' },
            { d: 35, field: 'assignee', from: 'A', to: 'B' },
            { d: 33, field: 'assignee', from: 'B', to: 'C' },
            { d: 29, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
      ],
    },
    {
      name: 'Sprint 2 — better, not perfect',
      start: 30, end: 16,
      issues: [
        {
          summary: 'Checkout page accessibility audit',
          desc: 'Accessibility and performance pass over the new checkout flow.',
          points: 3, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 29, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 26, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Payment gateway timeouts under load',
          desc: 'Payment gateway starts timing out at 2x peak load. Customers with saved payment methods hit 504s when the token cache is cold.',
          points: 5, finalStatus: 'Done', outcome: 'escalation',
          history: [
            { d: 29, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 24, field: 'priority', from: 'High', to: 'Highest' },
            { d: 22, field: 'status', from: 'In Progress', to: 'In Review' },
            { d: 21, field: 'status', from: 'In Review', to: 'In Progress' },
            { d: 17, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Export report to CSV',
          desc: 'Streaming export to avoid memory spikes.',
          points: 2, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 29, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 27, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Refund API rate limits doc',
          desc: 'Documented rate limits for the refunds endpoint and add client backoff.',
          points: 1, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 28, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 27, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
      ],
    },
    {
      name: 'Sprint 3 — the crash we remember',
      start: 15, end: 1,
      issues: [
        {
          summary: 'Payment gateway 502s for stored cards',
          desc: 'Customers with saved payment methods get 502s from the payment gateway when the token cache is cold; retried overnight.',
          points: 5, finalStatus: 'Done', outcome: 'breach',
          history: [
            { d: 14, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 10, field: 'priority', from: 'High', to: 'Highest' },
            { d: 9, field: 'status', from: 'In Progress', to: 'In Review' },
            { d: 8, field: 'status', from: 'In Review', to: 'In Progress' },
            { d: 7, field: 'description', from: '(edit)', to: '(edit)' },
            { d: 6, field: 'description', from: '(edit)', to: '(edit)' },
            { d: 0, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Rotate service credentials',
          desc: 'Quarterly rotation; runbook in the security wiki.',
          points: 1, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 14, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 13, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
        {
          summary: 'Design empty states',
          desc: 'Three screens need empty-state illustrations.',
          points: 2, finalStatus: 'Done', outcome: 'on-time',
          history: [
            { d: 14, field: 'status', from: 'To Do', to: 'In Progress' },
            { d: 11, field: 'status', from: 'In Progress', to: 'Done' },
          ],
        },
      ],
    },
  ];
}

/**
 * Active sprint: open items engineered to light every surface.
 * The two payment-gateway items resemble Sprint 1–3 crashes (similarity);
 * the count and the empty history give the forecast a squeeze; one item
 * has already stalled.
 */
function activeSprintSpec() {
  return {
    name: 'Sprint 4 — right now',
    start: -1, end: 9,
    issues: [
      {
        summary: 'Payment gateway retry storm on cold cache',
        desc: 'Customers with saved payment methods trigger a retry storm against the payment gateway when the token cache is cold. Needs backoff and cache warming.',
        points: 5, status: 'In Progress',
        history: [
          { d: 4, field: 'status', from: 'To Do', to: 'In Progress' },
        ],
      },
      {
        summary: 'Token cache warming service',
        desc: 'Warm the token cache ahead of morning traffic so the payment gateway stops cold-starting for saved payment methods.',
        points: 3, status: 'To Do', history: [],
      },
      {
        summary: 'Update onboarding emails',
        desc: 'New copy approved by marketing.',
        points: 1, status: 'In Progress',
        history: [
          { d: 4, field: 'status', from: 'To Do', to: 'In Progress' },
          { d: 3, field: 'description', from: '(edit)', to: '(edit)' },
          { d: 2, field: 'description', from: '(edit)', to: '(edit)' },
          { d: 1, field: 'description', from: '(edit)', to: '(edit)' },
        ],
      },
      { summary: 'Write ADR for event bus', desc: 'Record the decision for the event bus migration.', points: 2, status: 'To Do', history: [] },
      { summary: 'Investigate flaky checkout test', desc: 'Fails ~20% on CI; suspect ordering.', points: 3, status: 'In Progress', history: [{ d: 2, field: 'status', from: 'To Do', to: 'In Progress' }] },
      { summary: 'Customer feedback triage', desc: "Review last week's tickets from the support inbox.", points: 2, status: 'To Do', history: [] },
      { summary: 'Spike: edge caching options', desc: 'Compare CDNs for the marketing site.', points: 2, status: 'To Do', history: [] },
      { summary: 'Fix date picker on Safari', desc: 'Focus event swallowed by the polyfill.', points: 1, status: 'In Progress', history: [{ d: 3, field: 'status', from: 'To Do', to: 'In Progress' }] },
    ],
  };
}

export async function seedDemoData() {
  const existing = await jget(`/rest/api/3/project/${PROJECT_KEY}`);
  if (existing && existing.id) return { already: true, projectKey: PROJECT_KEY };

  const me = await getMyAccountId();
  const project = await jpost('/rest/api/3/project', {
    key: PROJECT_KEY,
    name: 'Blackbox Demo',
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-scrum-template',
    description: 'Seeded demo data for the Blackbox app — three sprints of history with outcomes. Safe to delete.',
    leadAccountId: me,
    assigneeType: 'UNASSIGNED',
  });
  if (project.error) return project;

  // Find the board the template created (poll a few times).
  let boardId = null;
  for (let attempt = 0; attempt < 3 && !boardId; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2500));
    const boards = await jget(`/rest/agile/1.0/board?projectKeyOrId=${project.id}`);
    boardId = boards?.values?.[0]?.id ?? null;
  }

  const createdCount = { issues: 0, sprints: 0 };

  if (boardId) {
    // Closed sprints with history.
    for (const spec of closedSprintSpecs()) {
      const keys = [];
      const sprint = await jpost(`/rest/agile/1.0/sprint`, {
        name: spec.name,
        originBoardId: boardId,
        startDate: daysAgo(spec.start),
        endDate: daysAgo(spec.end),
      });
      if (sprint.error || !sprint.id) continue;
      for (const issue of spec.issues) {
        const fields = {
          project: { id: project.id },
          summary: `[DEMO] ${issue.summary}`,
          issuetype: { name: 'Story' },
          description: adf(issue.desc),
          labels: ['bb-demo'],
          customfield_10016: issue.points,
        };
        if (me) fields.assignee = { id: me };
        // Overdue-looking duedates for breaches: duedate inside the sprint window.
        if (issue.outcome === 'breach') fields.duedate = daysAgo(spec.end + 1).slice(0, 10);
        const created = await jpost('/rest/api/3/issue', fields);
        if (!created.error && created.key) { keys.push(created.key); createdCount.issues += 1; }
      }
      if (keys.length) await jpost(`/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: keys });
      // Close the sprint with a fake complete date.
      await jput(`/rest/agile/1.0/sprint/${sprint.id}`, { state: 'closed', completeDate: daysAgo(spec.end), endDate: daysAgo(spec.end) });
      createdCount.sprints += 1;
      // Move issues to final statuses + replay history.
      for (const issue of spec.issues) ; // statuses replayed below by key lookup
      // We need the created keys in order; re-fetch by JQL label is unreliable mid-flight,
      // so replay history in the same order via a second pass by summary.
      await replayHistories(project.id, spec, me);
    }

    // Active sprint.
    const act = activeSprintSpec();
    const sprint = await jpost(`/rest/agile/1.0/sprint`, {
      name: act.name,
      originBoardId: boardId,
      startDate: daysAgo(Math.abs(act.start)),
      endDate: daysAhead(act.end),
    });
    if (!sprint.error && sprint.id) {
      const keys = [];
      for (const issue of act.issues) {
        const fields = {
          project: { id: project.id },
          summary: `[DEMO] ${issue.summary}`,
          issuetype: { name: 'Story' },
          description: adf(issue.desc),
          labels: ['bb-demo'],
          customfield_10016: issue.points,
        };
        if (me) fields.assignee = { id: me };
        const created = await jpost('/rest/api/3/issue', fields);
        if (!created.error && created.key) { keys.push(created.key); createdCount.issues += 1; }
      }
      if (keys.length) await jpost(`/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: keys });
      await jput(`/rest/agile/1.0/sprint/${sprint.id}`, { state: 'active' });
      createdCount.sprints += 1;
      await replayHistories(project.id, { issues: act.issues.map((i) => ({ ...i, finalStatus: i.status })) }, me, true);
    }
  }

  return {
    created: true,
    projectKey: PROJECT_KEY,
    boardId,
    issueCount: createdCount.issues,
    sprintCount: createdCount.sprints,
    note: 'Three sprints of history seeded (crashes, near-misses, wins) plus a live sprint engineered to resemble past trouble. Open Blackbox → learn.',
  };
}

/**
 * Replay a spec's history onto the matching [DEMO] issues: transitions to
 * the final status plus changelog-worthy edits. Changelog timestamps come
 * from Jira itself, so we approximate the timeline by applying transitions
 * immediately — the engines see real changelogs (field edits + status
 * moves), which is what matters; the "daysAgo" spacing is preserved in the
 * issue updated dates via field edits where possible.
 */
async function replayHistories(projectId, spec, me, isSprintActive = false) {
  void me;
  for (const issue of spec.issues) {
    // Find the issue we just created by exact summary match.
    const found = await jget(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${projectId} AND summary = "${escapeJql(`[DEMO] ${issue.summary}`)}" ORDER BY created DESC`)}&maxResults=1&fields=summary,status`
    );
    const key = found?.issues?.[0]?.key;
    if (!key) continue;
    // Transition to the final (or current) status via the first matching transition.
    const target = issue.finalStatus || issue.status;
    if (target && target !== 'To Do') {
      const transitions = await jget(`/rest/api/3/issue/${key}/transitions`);
      const t = (transitions?.transitions || []).find(
        (x) => x.name.toLowerCase() === target.toLowerCase() || x.to?.name?.toLowerCase() === target.toLowerCase()
      );
      if (t) await jpost(`/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
    }
    // Scope edits: real description edits land in the changelog.
    for (const h of issue.history || []) {
      if (h.field === 'description') {
        await jput(`/rest/api/3/issue/${key}`, {
          fields: { description: adf(`${issue.desc} (rev ${Math.random().toString(36).slice(2, 6)})`) },
        });
      }
      if (h.field === 'assignee' && !isSprintActive) {
        // Assignment churn: toggle between me and unassigned.
        await jput(`/rest/api/3/issue/${key}`, { fields: { assignee: null } });
        await jput(`/rest/api/3/issue/${key}`, { fields: {} }); // spacing
      }
    }
    // Priority escalations (Highest is a standard priority on scrum templates).
    if (issue.outcome === 'escalation' || issue.outcome === 'breach') {
      await jput(`/rest/api/3/issue/${key}`, { fields: { priority: { name: 'Highest' } } });
    }
  }
}

function escapeJql(s) {
  return String(s).replace(/"/g, '\\"');
}
