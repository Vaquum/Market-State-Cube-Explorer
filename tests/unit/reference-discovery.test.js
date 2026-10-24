"use strict";
// Oracle: literal UI labels and the documented measurement/action meanings. Search must
// reach the appropriate semantic topic, including fields rendered only in article tables.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../../src/reference.js');
const cases = [
  ['Since (UTC)', 'window'], ['Last year', 'window'], ['45d', 'window'],
  ['Invalid input', 'state-glossary'], ['No coarser parent', 'state-glossary'],
  ['Hidden in replay', 'state-glossary'], ['−∞', 'state-glossary'], ['precision', 'feature-rules'],
  ['90% interval', 'features'], ['TPR', 'feature-rules'], ['FPR', 'feature-rules'],
  ['Cell counts', 'context-reading'], ['Zero-trade cells', 'context-reading'],
  ['Data through', 'metadata'], ['Canonical through', 'metadata'],
  ['Share investigation', 'query'], ['cube-analysis:', 'query'], ['Restore previous capture', 'query'],
  ['Retry save', 'compare'], ['Against', 'comparison-math'],
  ['Buyer-initiated count share', 'comparison-math'], ['Moves with it', 'features'],
  ['Max pullback', 'rally-rules'], ['Confirming reversal', 'rally-rules'],
  ['Developing daily POC', 'poc-value'], ['Golden and death crosses', 'average-rules'],
  ['12 and 28 EMA · 3.75m', 'average-rules'], ['Asia session VWAP', 'vwap-rules'],
  ['Show Since (UTC)', 'window'], ['Show axes settings', 'columns'],
  ['Manual domain', 'scales'], ['Current axis', 'profiles'],
  ['Frozen', 'columns'], ['ISO A', 'columns'], ['Eligibility upper bound', 'columns'], ['Calibrated on', 'scales'], ['At the endpoint', 'scales'], ['Fit the price range', 'window'], ['45 days', 'window'], ['Row volume versus mean traded row', 'rows'], ['Actual measured bounds', 'query'], ['Independent axes · Auto', 'profiles'], ['Continue →', 'measures'], ['Loaded period POC', 'comparison-math'], ['Keyboard shortcuts', 'system'],
];
for (const [term, id] of cases) test(`reference search: ${term} reaches ${id}`, () => {
  assert.ok(search(term).some(topic => topic.id === id), `${term} must reach ${id}`);
});
test('search preserves phrase meaning while normalizing UI punctuation, case and whitespace', () => {
  for (const term of ['  SINCE   (UTC) ', 'No coarser parent', '12 and 28 EMA - 3.75m']) assert.ok(search(term).length);
  assert.equal(search('a nonexisting control term').length, 0);
  assert.equal(search('').length, 60);
});
test('new field explanations specify denominators and workflow limits', () => {
  const text = id => { const t = search('').find(topic => topic.id === id); return JSON.stringify(t); };
  assert.match(text('feature-rules'), /fraction of flagged bars that were marked/);
  assert.match(text('feature-rules'), /fraction of unmarked bars/);
  assert.match(text('window'), /preserves locked levels/);
  assert.match(text('window'), /UTC midnight/);
  assert.match(text('query'), /requires an opened captured investigation and a live source/);
  assert.match(text('columns'), /Comparison lock freezes axes/);
  assert.match(text('comparison-math'), /POC distance is the nonnegative gap/);
  assert.match(text('comparison-math'), /separate context reading/);
});
