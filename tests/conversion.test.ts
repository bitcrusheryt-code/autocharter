import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertChartNotes, fnfNoteData } from '../src/lib/chartConversion';
import { parseJsonContent } from '../src/lib/chartParser';
import { generateOsuHitObjectsString, sanitizeOsuHitObjects } from '../src/lib/osuTimingSanitizer';
import type { ChartNote } from '../src/lib/chartParser';

const note = (lane: number, extra: Partial<ChartNote> = {}): ChartNote => ({
  id: `n-${lane}`, lane, timeMs: 2000, durationMs: 0, ...extra
});

test('FNF keeps simultaneous notes from both singers', () => {
  const result = convertChartNotes([note(0), note(0, { id: 'opponent', isOpponent: true })], 4, 'fnf', 4);
  assert.equal(result.length, 2);
});

test('FNF round trip preserves ownership in mustHitSection=true sections', () => {
  const original = [note(0), note(3, { isOpponent: true })];
  const chart = parseJsonContent(JSON.stringify({ song: { bpm: 120, notes: [{
    mustHitSection: true,
    sectionNotes: original.map(n => [n.timeMs, fnfNoteData(n), n.durationMs])
  }] } }), 'test.json');
  assert.deepEqual(chart.notes.map(n => !!n.isOpponent), [false, true]);
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 3]);
});

test('taiko export honors explicit hitSound rather than lane parity', () => {
  const text = generateOsuHitObjectsString([
    { lane: 0, timeMs: 1000, hitSound: 2 },
    { lane: 1, timeMs: 1500, hitSound: 0 }
  ], 4, 'taiko');
  assert.deepEqual(text.trim().split('\n').map(line => Number(line.split(',')[4])), [2, 0]);
});

test('conversion preserves taiko colors when source has 4 lanes', () => {
  const result = convertChartNotes([note(0, { type: 'taiko_don' }), note(1, { timeMs: 2250, type: 'taiko_kat' })], 4, 'taiko', 4);
  assert.deepEqual(result.map(n => n.type), ['taiko_don', 'taiko_kat']);
});

test('millisecond holds near song start must not be multiplied by 1000', () => {
  const [result] = sanitizeOsuHitObjects([{ lane: 0, timeMs: 500, durationMs: 62.5, isHold: true }], 4, 120);
  assert.equal(result.durationMs, 63);
});

test('mania 4K preserves columns and hold lengths', () => {
  const input = [0, 1, 2, 3].map((lane, i) => note(lane, { timeMs: 2000 + i * 250, durationMs: i === 2 ? 125 : 0 }));
  const result = convertChartNotes(input, 4, 'mania', 4);
  assert.deepEqual(result.map(n => n.lane), [0, 1, 2, 3]);
  assert.equal(result[2].durationMs, 125);
});

test('LLPlus 4K fold retains left and right', () => {
  const result = convertChartNotes([0, 1, 2, 3].map((lane, i) => note(lane, { timeMs: 2000 + i * 250 })), 4, 'llplus', 2);
  assert.deepEqual(result.map(n => n.lane), [0, 0, 1, 1]);
});

test('taiko preview lanes agree with Don/Kat colors after a 4K conversion', () => {
  const result = convertChartNotes([0, 1, 2, 3].map((lane, i) => note(lane, { timeMs: 2000 + i * 250 })), 4, 'taiko', 4);
  assert.deepEqual(result.map(n => n.lane), [1, 0, 0, 1]);
  assert.ok(result.every(n => (n.lane === 1) === (n.type === 'taiko_kat')));
});
