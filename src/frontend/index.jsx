/**
 * Atlassian Blackbox — UI Kit frontend.
 * One resource, three surfaces:
 *  - jira:globalPage  → Flight Deck (Learn tab + Retro tab + Memory tab)
 *  - jira:issuePanel  → Black Box (issue's recording + déjà-vu)
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Heading, Stack, Inline, Button, Lozenge, SectionMessage, Spinner,
  Link, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const RISK_COLOR = (p) => (p >= 0.66 ? '#DE350B' : p >= 0.33 ? '#FF991F' : '#36B37E');

/** Probability bar: 0..1 rendered as a filled horizontal meter. */
function ProbBar({ value, label }) {
  if (value === null || value === undefined) return <Text size="small">{label}: unknown (no history yet)</Text>;
  const pct = Math.round(value * 100);
  return (
    <Inline space="space.100" blockAlign="center">
      <Text size="small" weight="medium">{label}:</Text>
      <svg width="180" height="16" style={{ verticalAlign: 'middle' }} aria-label={`${pct}%`}>
        <rect x="0" y="2" width="180" height="12" rx="3" fill="#dfe1e6" />
        <rect x="0" y="2" width={String(Math.max(2, pct * 1.8))} height="12" rx="3" fill={RISK_COLOR(1 - value)} />
      </svg>
      <Text size="small" weight="semibold">{pct}%</Text>
    </Inline>
  );
}

/** Mini histogram of Monte-Carlo completion durations. */
function ForecastChart({ percentiles }) {
  if (!percentiles) return null;
  const max = Math.max(percentiles.p95, 1);
  const bar = (v, w) => (v / max) * 160;
  return (
    <svg width="200" height="70" style={{ verticalAlign: 'middle' }} aria-label="forecast">
      <text x="0" y="10" fontSize="9" fill="#42526E">completion forecast (working days)</text>
      <rect x="0" y="16" width={bar(percentiles.p50)} height="12" fill="#36B37E" />
      <text x={bar(percentiles.p50) + 4} y="26" fontSize="9" fill="#42526E">p50 {percentiles.p50}d</text>
      <rect x="0" y="32" width={bar(percentiles.p85)} height="12" fill="#FF991F" />
      <text x={bar(percentiles.p85) + 4} y="42" fontSize="9" fill="#42526E">p85 {percentiles.p85}d</text>
      <rect x="0" y="48" width={bar(percentiles.p95)} height="12" fill="#DE350B" />
      <text x={bar(percentiles.p95) + 4} y="58" fontSize="9" fill="#42526E">p95 {percentiles.p95}d</text>
    </svg>
  );
}

const VERDICT_APPEARANCE = { GO: 'success', 'GO-WITH-CAUTION': 'new', 'NO-GO': 'removed' };

function LearnTab() {
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState(null);

  const loadBoards = () => {
    invoke('getBoards').then((r) => {
      setBoards(r.boards || []);
      if (r.boards?.length) setBoardId(String(r.boards[0].id));
    });
  };
  useEffect(loadBoards, []);
  useEffect(() => {
    if (boardId) invoke('getBoardState', { boardId }).then(setState);
  }, [boardId]);

  const seedDemo = async () => {
    setSeeding(true); setSeedMsg(null);
    try {
      const r = await invoke('seedDemo');
      if (r.error) setSeedMsg(`Seeding failed: ${r.error}`);
      else if (r.already) setSeedMsg('Demo project already exists — pick the "Blackbox Demo" board.');
      else setSeedMsg(`Created ${r.issueCount} issues across ${r.sprintCount} sprints (3 sprints of history + a live one). Selecting the new board…`);
      setBoardId(null); loadBoards();
      setTimeout(loadBoards, 4000); setTimeout(loadBoards, 9000); setTimeout(loadBoards, 15000);
    } finally { setSeeding(false); }
  };

  const learn = async () => {
    setBusy(true);
    const r = await invoke('learn', { boardId });
    setState((s) => ({ ...s, latest: { at: r.learnedAt, summary: r.summary } }));
    setBusy(false);
  };

  const s = state?.latest?.summary;
  return (
    <Stack space="space.250">
      <Inline space="space.100" wrap="wrap">
        {boards.map((b) => (
          <Button key={b.id} appearance={String(b.id) === boardId ? 'primary' : 'default'} spacing="compact" onClick={() => setBoardId(String(b.id))}>{b.name}</Button>
        ))}
      </Inline>
      {boardId && <Button appearance="primary" isDisabled={busy} onClick={learn}>{busy ? 'Learning… (fetching history)' : 'Learn this board'}</Button>}
      {boards.length === 0 && !state && (
        <SectionMessage appearance="warning" title="Nothing to learn from yet">
          <Text as="p">Blackbox needs history. One click seeds a demo project with <Text weight="semibold">three sprints of realistic history</Text> — crashed items, near-misses, clean wins — plus a live sprint engineered to resemble the past trouble. Every surface (memory, forecast, déjà-vu, retro) lights up.</Text>
          <Button appearance="primary" isDisabled={seeding} onClick={seedDemo}>{seeding ? 'Seeding demo history…' : 'Generate demo history'}</Button>
          {seedMsg && <Text as="p" size="small">{seedMsg}</Text>}
        </SectionMessage>
      )}
      {!s && state && boards.length > 0 && (
        <SectionMessage appearance="information" title="No memory yet">
          <Text as="p">Click “Learn this board” — Blackbox reads past sprints, replays their outcomes and builds the memory. First run takes a few seconds per sprint of history.</Text>
        </SectionMessage>
      )}
      {s && (
        <Stack space="space.200">
          <Inline space="space.200" blockAlign="center">
            <Lozenge appearance={VERDICT_APPEARANCE[s.preflight?.verdict] || 'default'}>{s.preflight?.verdict || '—'}</Lozenge>
            <Text>sprint “{s.sprint?.name || '—'}” · {s.openCount} open · memory: {s.corpusSize} completed items</Text>
          </Inline>
          <ProbBar value={s.onTimeProbability} label="On-time probability" />
          <ForecastChart percentiles={s.forecast?.percentiles} />
          {s.preflight?.reasons?.length > 0 && (
            <Stack space="space.050">
              <Text weight="medium">Preflight reasons</Text>
              {s.preflight.reasons.map((r, i) => <Text key={i} size="small" as="p">• {r}</Text>)}
            </Stack>
          )}
          {s.topHistoricalRisk?.length > 0 && (
            <Stack space="space.050">
              <Text weight="medium">👀 Déjà-vu — open items that resemble past trouble</Text>
              {s.topHistoricalRisk.map((t) => (
                <Inline key={t.key} space="space.100" blockAlign="center">
                  <Lozenge appearance="new">{Math.round(t.risk * 100)}%</Lozenge>
                  <Link href={`/browse/${t.key}`}><Text weight="medium">{t.key}</Text></Link>
                  {t.similar && <Text size="small">← resembles {t.similar}</Text>}
                </Inline>
              ))}
            </Stack>
          )}
          {s.topForensic?.length > 0 && (
            <Stack space="space.050">
              <Text weight="medium">📼 Heaviest recordings</Text>
              {s.topForensic.map((t) => (
                <Inline key={t.key} space="space.100" blockAlign="center">
                  <Lozenge appearance={t.score >= 5 ? 'removed' : 'new'}>{t.score}</Lozenge>
                  <Link href={`/browse/${t.key}`}><Text weight="medium">{t.key}</Text></Link>
                  <Text size="small" as="em">{t.signals.join(', ')}</Text>
                </Inline>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function RetroTab() {
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null);
  const [retroText, setRetroText] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke('getBoards').then((r) => {
      setBoards(r.boards || []);
      if (r.boards?.length) setBoardId(String(r.boards[0].id));
    });
  }, []);

  const runRetro = async () => {
    setBusy(true);
    const r = await invoke('learn', { boardId });
    setRetroText(r.retroText || 'No closed sprint found on this board yet.');
    setBusy(false);
  };

  return (
    <Stack space="space.200">
      <Inline space="space.100" wrap="wrap">
        {boards.map((b) => (
          <Button key={b.id} appearance={String(b.id) === boardId ? 'primary' : 'default'} spacing="compact" onClick={() => setBoardId(String(b.id))}>{b.name}</Button>
        ))}
      </Inline>
      {boardId && <Button appearance="primary" isDisabled={busy} onClick={runRetro}>{busy ? 'Reconstructing…' : 'Run the retro'}</Button>}
      {retroText && (
        <Stack space="space.050" xcss={{ backgroundColor: 'elevation.surface.sunken', padding: 'space.200', borderRadius: '3px' }}>
          {retroText.split('\n').map((line, i) => (
            <Text key={i} size={line.startsWith('Sprint retro') ? 'medium' : 'small'} weight={line.startsWith('Sprint retro') ? 'semibold' : 'normal'}>{line || ' '}</Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function MemoryTab() {
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null);
  const [state, setState] = useState(null);

  useEffect(() => {
    invoke('getBoards').then((r) => {
      setBoards(r.boards || []);
      if (r.boards?.length) setBoardId(String(r.boards[0].id));
    });
  }, []);
  useEffect(() => {
    if (boardId) invoke('getBoardState', { boardId }).then(setState);
  }, [boardId]);

  const trend = state?.trend || [];
  return (
    <Stack space="space.200">
      <Inline space="space.100" wrap="wrap">
        {boards.map((b) => (
          <Button key={b.id} appearance={String(b.id) === boardId ? 'primary' : 'default'} spacing="compact" onClick={() => setBoardId(String(b.id))}>{b.name}</Button>
        ))}
      </Inline>
      {trend.length === 0 && <Text size="small">No memory snapshots yet — “Learn this board” on the Learn tab, or wait for the hourly refresh.</Text>}
      {trend.length > 0 && (
        <Stack space="space.050">
          <Text weight="medium">Memory trend ({trend.length} snapshots)</Text>
          {trend.slice(-10).map((t, i) => (
            <Inline key={i} space="space.150" blockAlign="center">
              <Text size="small">{String(t.at).slice(0, 16).replace('T', ' ')}</Text>
              <Lozenge>{t.openCount} open</Lozenge>
              <Text size="small">corpus {t.corpusSize}</Text>
              {t.onTimeProbability !== null && t.onTimeProbability !== undefined && (
                <Text size="small" as="em">on-time {Math.round(t.onTimeProbability * 100)}%</Text>
              )}
            </Inline>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function FlightDeck() {
  const [tab, setTab] = useState('learn');
  return (
    <Stack space="space.250">
      <Inline space="space.200" blockAlign="center" grow="fill">
        <Heading as="h2">🔭 Blackbox — flight deck</Heading>
        <Inline space="space.050">
          <Button appearance={tab === 'learn' ? 'primary' : 'default'} spacing="compact" onClick={() => setTab('learn')}>🚦 Learn</Button>
          <Button appearance={tab === 'retro' ? 'primary' : 'default'} spacing="compact" onClick={() => setTab('retro')}>📼 Retro</Button>
          <Button appearance={tab === 'memory' ? 'primary' : 'default'} spacing="compact" onClick={() => setTab('memory')}>🧠 Memory</Button>
        </Inline>
      </Inline>
      {tab === 'learn' ? <LearnTab /> : tab === 'retro' ? <RetroTab /> : <MemoryTab />}
      <SectionMessage appearance="information" title="Talk to the agent">
        <Text as="p">In Rovo chat, ask Blackbox: “Learn my board”, “Forecast this sprint”, “What does history say about PROJ-1?”, “Run the retro”, or “Preflight: should we commit to this sprint?” — the same engines, on demand. All tools are also exposed over MCP.</Text>
      </SectionMessage>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Issue panel: the black box recording of one issue
// ---------------------------------------------------------------------------
function BlackBoxPanel({ issueKey }) {
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { invoke('examine', { issueKeyOrId: issueKey }).then(setReport); }, [issueKey]);
  if (!report) return <Spinner size="medium" label="Replaying the recording…" />;
  if (report.error) return <SectionMessage appearance="warning" title="Examination unavailable"><Text as="p">{report.error}</Text></SectionMessage>;

  const draft = async (f) => {
    const res = await invoke('draftFollowUp', {
      parentIssueKey: issueKey,
      summary: `Address ${f.code} on ${issueKey}`,
      riskSignal: f.code,
      findingsJson: JSON.stringify([f]),
    });
    setMsg(res);
  };

  return (
    <Stack space="space.200">
      <Inline space="space.100" blockAlign="center" grow="fill">
        <Text size="large" weight="semibold">📼 Forensic score {report.score}</Text>
        <Text size="small">{report.findings.length} findings · {report.timeline.length} events</Text>
      </Inline>
      {report.findings.length === 0 && <SectionMessage appearance="success" title="Clean recording"><Text as="p">No forensic findings. Ship with confidence.</Text></SectionMessage>}
      {report.findings.map((f) => (
        <Stack key={f.code} space="space.050" xcss={{ backgroundColor: 'elevation.surface.sunken', padding: 'space.150', borderRadius: '3px' }}>
          <Inline space="space.100" blockAlign="center">
            <Lozenge appearance={f.severity === 'high' ? 'removed' : f.severity === 'medium' ? 'new' : 'default'}>{f.severity}</Lozenge>
            <Text weight="medium">{f.code}</Text>
          </Inline>
          <Text size="small" as="p">{f.evidence}</Text>
          <Button appearance="primary" spacing="compact" onClick={() => draft(f)}>Draft follow-up</Button>
        </Stack>
      ))}
      {report.similar?.length > 0 && (
        <Stack space="space.050">
          <Text weight="medium">👀 Déjà-vu</Text>
          {report.similar.map((s) => (
            <Inline key={s.key} space="space.100" blockAlign="center">
              <Lozenge appearance={s.outcome === 'breach' ? 'removed' : s.outcome === 'escalation' ? 'new' : 'default'}>{s.outcome || 'resolved'}</Lozenge>
              <Link href={`/browse/${s.key}`}><Text weight="medium">{s.key}</Text></Link>
              <Text size="small" as="em">similarity {s.score} · shared: {s.why.join(', ')}</Text>
            </Inline>
          ))}
          <Text size="small" as="p">Historical risk from these matches: {Math.round(report.historicalRisk * 100)}%.</Text>
        </Stack>
      )}
      {report.stalls?.length > 0 && (
        <Stack space="space.050">
          <Text weight="medium">⛔ Silence windows</Text>
          {report.stalls.map((s, i) => (
            <Text key={i} size="small" as="p">{s.days} working days of silence ({String(s.from).slice(0, 10)} → {String(s.to).slice(0, 10)})</Text>
          ))}
        </Stack>
      )}
      {msg && (
        <SectionMessage appearance="info" title="Action">
          <Text as="p">{typeof msg === 'object' && msg.key ? <>Created <Link href={`/browse/${msg.key}`}>{msg.key}</Link>.</> : String(msg)}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

function App() {
  const context = useProductContext();
  const type = context?.type || '';
  if (type.startsWith('jira:issuePanel')) {
    const issueKey = context?.extension?.issue?.key;
    return (
      <Stack space="space.200">
        <Heading as="h4">🔭 Blackbox</Heading>
        <Text size="small" as="p">The flight recording of this issue — forensic findings, silence windows and déjà-vu from your own history. Open Apps → Blackbox for the flight deck.</Text>
        {issueKey ? <BlackBoxPanel issueKey={issueKey} /> : <Text>Open on an issue to examine it.</Text>}
      </Stack>
    );
  }
  return <FlightDeck />;
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
