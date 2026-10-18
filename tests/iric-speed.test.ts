import test from 'node:test';
import assert from 'node:assert/strict';
import { getIricScrollDistance } from '../src/lib/iricSpeed';

test('IRIC SV distance defaults to normal speed when there are no changes', () => {
  assert.equal(getIricScrollDistance(0, 1000), 1000);
});

test('IRIC SV distance integrates each segment at its active multiplier', () => {
  assert.equal(getIricScrollDistance(0, 1000, [
    { timeMs: 500, sv: 2 }
  ]), 1500);
});

test('IRIC SV distance applies a change already active at the start time', () => {
  assert.equal(getIricScrollDistance(500, 1000, [
    { timeMs: 0, sv: 1.5 },
    { timeMs: 750, sv: 2 }
  ]), 875);
});

test('IRIC SV distance supports notes before and after the current time', () => {
  const changes = [{ timeMs: 500, sv: 2 }];
  assert.equal(getIricScrollDistance(500, 0, changes), -500);
  assert.equal(getIricScrollDistance(0, 1000, changes), 1500);
});

test('invalid and negative SV changes are ignored', () => {
  assert.equal(getIricScrollDistance(0, 1000, [
    { timeMs: 250, sv: Number.NaN },
    { timeMs: 500, sv: -3 },
    { timeMs: 750, sv: 1.5 }
  ]), 1125);
});
