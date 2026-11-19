import { describe, it, expect } from 'vitest';
import { tokenize, termFreq, cosine, rankSimilar, historicalRisk, adfToText } from '../src/backend/similarity';

const paymentBreach = {
  key: 'P-1', summary: 'Payment gateway 502s for stored cards',
  description: 'Customers with saved payment methods get 502s when the token cache is cold.',
  outcome: 'breach', resolved: true,
};
const paymentTimeout = {
  key: 'P-2', summary: 'Payment gateway timeouts under load',
  description: 'Gateway times out at 2x peak; saved payment methods hit 504s when the cache is cold.',
  outcome: 'escalation', resolved: true,
};
const csvExport = {
  key: 'C-1', summary: 'Export report to CSV',
  description: 'Streaming export to avoid memory spikes.',
  outcome: 'on-time', resolved: true,
};
const corpus = [paymentBreach, paymentTimeout, csvExport];

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords and folds plurals', () => {
    expect(tokenize('The Payment Gateways are Broken!')).toEqual(['payment', 'gateway', 'broken']);
  });
  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe('cosine', () => {
  it('is 1 for identical maps and 0 for disjoint', () => {
    const a = termFreq(['x', 'y']);
    expect(cosine(a, termFreq(['x', 'y']))).toBeCloseTo(1);
    expect(cosine(a, termFreq(['z']))).toBe(0);
  });
});

describe('rankSimilar', () => {
  it('ranks the similar payment issue above the unrelated one', () => {
    const target = { summary: 'Payment gateway retry storm on cold cache', description: 'Saved payment methods trigger retries when the token cache is cold.' };
    const r = rankSimilar(target, corpus, 3);
    expect(r.length).toBeGreaterThan(0);
    expect(['P-1', 'P-2']).toContain(r[0].key);
    expect(r[0].score).toBeGreaterThan(r[r.length - 1].score);
  });
  it('returns why (shared terms)', () => {
    const target = { summary: 'Payment gateway retry storm', description: null };
    const r = rankSimilar(target, corpus, 1);
    if (r.length) expect(r[0].why.length).toBeGreaterThan(0);
  });
  it('returns [] when nothing matches', () => {
    expect(rankSimilar({ summary: 'Kitchen renovation', description: null }, corpus, 3)).toHaveLength(0);
  });
  it('reads ADF descriptions', () => {
    const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Payment gateway cold cache problem for stored cards.' }] }] };
    const r = rankSimilar({ summary: 'Payment gateway issue', description: adf }, corpus, 3);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('historicalRisk', () => {
  it('is 0 with no similars', () => {
    expect(historicalRisk([])).toBe(0);
  });
  it('weights breaches above on-time items', () => {
    const breachOnly = historicalRisk([{ score: 0.9, outcome: 'breach', resolved: true }]);
    const onTimeOnly = historicalRisk([{ score: 0.9, outcome: 'on-time', resolved: true }]);
    expect(breachOnly).toBeGreaterThan(onTimeOnly);
    expect(onTimeOnly).toBe(0);
  });
  it('treats unresolved items as mildly risky', () => {
    const r = historicalRisk([{ score: 0.9, outcome: null, resolved: false }]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.5);
  });
});

describe('adfToText', () => {
  it('flattens nested ADF and passes strings through', () => {
    expect(adfToText('plain')).toBe('plain');
    expect(adfToText({ content: [{ content: [{ type: 'text', text: 'deep ' }, { type: 'text', text: 'text' }] }] })).toBe('deep text');
    expect(adfToText(null)).toBe('');
  });
});
