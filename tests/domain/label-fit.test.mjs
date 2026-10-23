// The "label is getting tight" check of Settings → Labels (v3.27.25):
// src/domain/label-fit.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeLabelFit, LABEL_FIT } from '../../src/domain/label-fit.js';

const ok = { codeFontIn: 0.4, secFontIn: 0.2, hasSecondary: true, blockIn: 1.0, heightIn: 1.25 };

test('a roomy label has no problem', () => {
  assert.deepEqual(judgeLabelFit(ok), { ok: true, problems: [] });
});

test('a name that shrinks under 0.13 in is flagged, with its size in points', () => {
  const r = judgeLabelFit({ ...ok, secFontIn: 0.11 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.map(p => p.key), ['name-small']);
  assert.match(r.problems[0].text, /8 pt/);
  assert.equal(judgeLabelFit({ ...ok, secFontIn: LABEL_FIT.minNameIn }).ok, true, 'exactly the limit is fine');
});

test('no name line, no name problem', () => {
  assert.equal(judgeLabelFit({ ...ok, secFontIn: 0, hasSecondary: false }).ok, true);
});

test('a code under 0.2 in is flagged', () => {
  assert.deepEqual(judgeLabelFit({ ...ok, codeFontIn: 0.14 }).problems.map(p => p.key), ['code-small']);
});

test('a block taller than 92% of the label is flagged, at the limit it is not', () => {
  assert.equal(judgeLabelFit({ ...ok, blockIn: 1.25 * 0.92 }).ok, true);
  const r = judgeLabelFit({ ...ok, blockIn: 1.2 });
  assert.deepEqual(r.problems.map(p => p.key), ['too-tall']);
  assert.match(r.problems[0].text, /1\.20 in tall on a 1\.25 in label, which leaves almost no margin/);
  assert.match(judgeLabelFit({ ...ok, blockIn: 1.4 }).problems[0].text, /cut off/);
});

test('several problems come back together, in a stable order', () => {
  const r = judgeLabelFit({ codeFontIn: 0.1, secFontIn: 0.1, hasSecondary: true, blockIn: 2, heightIn: 1.25 });
  assert.deepEqual(r.problems.map(p => p.key), ['name-small', 'code-small', 'too-tall']);
});
