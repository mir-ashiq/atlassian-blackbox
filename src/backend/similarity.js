/**
 * Atlassian Blackbox — similarity engine.
 *
 * PURE. Given a target issue (raw text) and a corpus of past issues with
 * known outcomes, rank which past issues are most similar — the "we have
 * seen this before" memory. Tokenizes, stems lightly, and scores with a
 * TF-weighted cosine similarity. No ML services: deterministic, testable,
 * explainable.
 */

const STOP = new Set('a an the and or but if then else for to of in on at by with from as is are was were be been being it its this that these those we you they i he she not no do does did done have has had will would can could should shall may might must about into over under again further once here there when where why how all any both each few more most other some such only own same so than too very s t just don now'.split(' '));

/** Tokenize + light-stem text (lowercase, strip punctuation, drop stops, plural-fold). */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.endsWith('ses') ? t.slice(0, -2) : t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/** Term-frequency map. */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Cosine similarity between two TF maps (L1-normalized). */
export function cosine(tfA, tfB) {
  let dot = 0;
  const [small, big] = tfA.size <= tfB.size ? [tfA, tfB] : [tfB, tfA];
  for (const [t, c] of small) {
    const o = big.get(t);
    if (o) dot += c * o;
  }
  const norm = (m) => Math.sqrt([...m.values()].reduce((s, c) => s + c * c, 0));
  const d = norm(tfA) * norm(tfB);
  return d ? dot / d : 0;
}

/**
 * Rank similar past issues.
 * target: { summary, description } (description may be ADF or plain).
 * corpus: [{ key, summary, description, outcome: 'breach'|'escalation'|'on-time'|null, resolved }]
 * Returns [{ key, summary, score, outcome, why: [shared terms] }].
 */
export function rankSimilar(target, corpus, limit = 5) {
  const targetText = `${target.summary || ''} ${adfToText(target.description) || ''}`;
  const targetTokens = tokenize(targetText);
  const targetTf = termFreq(targetTokens);
  const ranked = [];
  for (const item of corpus) {
    const itemText = `${item.summary || ''} ${adfToText(item.description) || ''}`;
    const tf = termFreq(tokenize(itemText));
    const score = cosine(targetTf, tf);
    if (score <= 0) continue;
    const why = [...targetTf.keys()].filter((t) => tf.has(t)).slice(0, 4);
    ranked.push({ key: item.key, summary: item.summary, score: Number(score.toFixed(3)), outcome: item.outcome || null, resolved: Boolean(item.resolved), why });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Flatten an ADF doc (or return the string unchanged). */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (!Array.isArray(node.content)) return '';
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
      if (Array.isArray(n.content)) walk(n.content);
    }
  };
  walk(node.content);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Outcome-predicted risk: given the ranked similar issues, weigh their
 * outcomes into a 0..1 "this looks like past trouble" score.
 * breach counts 1.0, escalation 0.7, unresolved 0.4, on-time 0.
 */
export function historicalRisk(similars) {
  if (!similars.length) return 0;
  let num = 0;
  let den = 0;
  for (const s of similars) {
    const w = 0.2 + s.score; // similarity-weighted
    let badness = 0;
    if (s.outcome === 'breach') badness = 1;
    else if (s.outcome === 'escalation') badness = 0.7;
    else if (!s.resolved) badness = 0.4;
    num += w * badness;
    den += w;
  }
  return den ? Number((num / den).toFixed(3)) : 0;
}
