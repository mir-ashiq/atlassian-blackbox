# Devpost submission draft — Atlassian Blackbox (win-grade, ready to paste)

## Title
Blackbox — the AI flight recorder for software teams

## Elevator pitch (≤ 200 chars; 199 chars)
Every sprint is a flight. Blackbox records what actually happened, learns from the crashes, spots today's work resembling past incidents (déjà-vu), and Monte-Carlo forecasts whether you'll land on time.

## Inspiration
Airplanes crash far less often than software projects, and the reason is the flight recorder: every incident is reconstructed from data, the lesson enters the manual, and the whole industry inherits it. Software teams have the same data — every status change, estimate edit, reassignment and escalation is sitting in Jira's changelog — but nobody reads it. The retro happens in a meeting, from memory, and the lessons evaporate before the next planning. I built Blackbox to be the flight recorder teams never had: it replays the history, classifies the crashes, near-misses and wins, and then watches the next sprint for anything that resembles a past incident.

## What it does
- **Forensics**: every issue gets a flight recording — its full changelog replayed as a timeline, with silence windows (≥3 working days of zero activity), late scope churn, estimate creep, handoff churn, escalations, and due-date breaches. Each finding carries its evidence.
- **Déjà-vu**: a similarity engine ranks which past issues today's work resembles (TF-weighted cosine over summaries and descriptions) and weighs their actual outcomes into a historical risk score. "This looks like PROJ-12, which breached its due date" is the core moment of the app.
- **Monte-Carlo forecast**: replays the team's own daily throughput distribution thousands of times (seeded PRNG — reproducible) to produce an on-time probability and p50/p85/p95 completion durations in working days.
- **Evidence-based retros**: the last closed sprint is classified into crashed / near-misses / wins, with repeating patterns extracted as lessons that carry occurrence counts.
- **Preflight**: GO / GO-WITH-CAUTION / NO-GO for the commit decision, combining the forecast and the déjà-vu risks, with every reason cited to an issue key.
- **One-click demo history**: on a brand-new empty site, one click seeds three closed sprints of realistic history (crashes, near-misses, wins) plus a live sprint engineered to resemble the past crashes — every surface lights up in a minute.

## How I built it
Forge (UI Kit global page + issue panel, resolver, triggers, scheduled jobs), one Rovo agent with 8 actions and 2 skill playbooks (preflight, sprint-retro) that keep it disciplined, one MCP server exposing all 8 tools, Jira REST v3 (changelogs with pagination, agile sprints including closed ones, issue search, subtasks, ADF comments). Four pure engines — forensics, similarity, forecast, retro — with 57 unit tests including an integration test that runs the whole learn pipeline over mocked history. The Monte-Carlo uses a seeded PRNG so every forecast is reproducible.

## Challenges I ran into
The changelog is the app's fuel and its trap: pagination, ADF descriptions, and the fact that `item.toString` on a normalized object is the inherited `Object.prototype.toString` function — one wrong read and every timeline silently breaks (my own test suite caught exactly that). Closed-sprint data is the other trap: most APIs surface the active sprint, but the memory only exists in the closed ones, so the history client walks them deliberately. And the disk-full sandbox during development taught me that a 1.6 GB node_modules is a build hazard, not a badge of honor.

## Accomplishments I'm proud of
The déjà-vu moment: when the demo seeds and Blackbox says the new "payment gateway retry storm" item resembles the "payment gateway 502s" issue that breached its due date two sprints ago — with shared terms, similarity score and outcome — judges see a memory, not a dashboard. And the forecast refuses to guess: no history, no number — it says so instead of inventing one.

## What I learned
That "learning from history" can be fully deterministic. No ML service, no training loop: cosine similarity, changelog forensics and a Monte-Carlo replay of your own throughput produce explanations a team can actually check — every number traces back to issue keys and dates a human can open.

## What's next for Blackbox
Cross-team memory (a sister team's crashes teach yours), Slack/Teams morning briefings with the preflight verdict, Jira automation-rule hooks so NO-GO blocks sprint-commit events, and graph-based similarity (people + components, not just text).

## Built with (tags)
forge, atlassian, jira, rovo, mcp, ai-agents, monte-carlo, retrospective, forensics, developer-tools, react, nodejs, kvs

## Try it out link
https://github.com/mir-ashiq/atlassian-blackbox

## Testing instructions (Step 3 field)
1) Click the installation link and approve the app (works on free sites). 2) Open Jira → Apps → Blackbox. EMPTY SITE? Click "Generate demo history" — one click creates three closed sprints of realistic history (crashes, near-misses, wins) plus a live sprint whose items resemble the past crashes — then click "Learn this board". 3) Watch the Learn tab: preflight verdict, on-time probability meter, p50/p85/p95 forecast chart, and the déjà-vu list (open items that resemble past troubled work, with the issue they resemble). 4) Open any issue — the Blackbox panel shows its flight recording: forensic findings, silence windows, déjà-vu matches, one-click follow-up. 5) The Retro tab reconstructs the last closed sprint from evidence. 6) Rovo Chat → Browse agents → Blackbox → "Learn my board" / "Forecast this sprint" / "What does history say about [issue]?" / "Run the retro" / "Preflight: should we commit?". Note: if Rovo chat is not visible on a free site, all UI surfaces work fully. Read-only by default; writes only on explicit user action.

## Technology requirement (Step 3 field)
Blackbox is one Forge app: manifest.yml declares jira:globalPage, jira:issuePanel, a rovo:agent with 8 actions, 2 rovo:skill playbooks (preflight, sprint-retro), a rovo:mcp server exposing 8 tools, trigger and scheduledTrigger modules. It integrates deeply with Jira: changelog pagination, closed-sprint history, agile boards/sprints, issue search with legacy fallback, subtasks, ADF comments. Four pure engines (forensics, similarity, forecast, retro) with 57 unit tests including a full-pipeline integration test over mocked history.

## Category + bonus
- Category: Apps for Software Teams
- Why this track: Blackbox lives where software teams feel pain — the sprint that repeats last sprint's failure. It turns Jira's own changelog into the flight recorder the team never had, inside the tools they already use.
- Bonus prize: Best Agents — Rovo/Assignable agents

## Forge experience / AI tools (Step 3 fields)
- Forge experience: The manifest-first model is excellent for an app this shape — 8 actions, 2 skills, MCP and triggers in one declarative file. KVS makes the memory snapshots trivial. Friction: the changelog API paginates in surprising ways; closed-sprint data needs deliberate fetching; and normalized objects make `toString` a landmine my tests caught.
- AI tools used: An AI coding agent (GLM via z.ai) for scaffolding, implementation, unit tests and documentation; Atlassian developer documentation and the Forge CLI for API verification and deployment planning.
