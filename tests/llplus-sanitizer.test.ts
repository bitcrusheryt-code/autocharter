import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLlpNotes } from '../src/lib/llplusSanitizer.ts';
import type { ChartNote } from '../src/lib/chartParser.ts';

const note = (timeMs: number, lane: number, durationMs = 0, id = `${timeMs}-${lane}`): ChartNote => ({
  id,
  timeMs,
  lane,
  durationMs,
  type: durationMs > 35 ? 'hold' : 'normal'
});

test('LLPlus uses the free side when a folded note lands inside an active hold', () => {
  const result = sanitizeLlpNotes([
    note(1000, 0, 1000, 'hold-left'),
    note(1000, 3, 1100, 'hold-right'),
    note(1100, 1, 0, 'tap-during-holds'),
    note(1200, 2, 0, 'second-tap-during-holds')
  ], 4);

  const taps = result.notes.filter(n => n.id.startsWith('tap') || n.id === 'second-tap-during-holds');
  assert.equal(taps.length, 2);
  assert.equal(result.droppedNotes, 0);
  assert.ok(result.shortenedHolds >= 1);
  assert.ok(taps.some(n => n.timeMs === 1100 && n.lane === 0));

  const byLane = new Map<number, ChartNote[]>();
  for (const item of result.notes) byLane.set(item.lane, [...(byLane.get(item.lane) || []), item]);
  for (const laneNotes of byLane.values()) {
    laneNotes.sort((a, b) => a.timeMs - b.timeMs);
    for (let i = 1; i < laneNotes.length; i++) {
      const previous = laneNotes[i - 1];
      assert.ok(previous.timeMs + previous.durationMs <= laneNotes[i].timeMs,
        `note ${laneNotes[i].id} overlaps ${previous.id}`);
    }
  }
});

test('LLPlus retains early notes rather than silently dropping the first 1.5 seconds', () => {
  const result = sanitizeLlpNotes([
    note(100, 0),
    note(600, 1),
    note(1700, 2)
  ], 4);

  assert.deepEqual(result.notes.map(n => n.timeMs), [100, 600, 1700]);
  assert.deepEqual(result.notes.map(n => n.lane), [0, 0, 1]);
  assert.equal(result.droppedNotes, 0);
});
