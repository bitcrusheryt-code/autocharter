import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonContent, parseMidiContent, parseOsuContent } from '../src/lib/chartParser.ts';

function midiVarInt(value: number): number[] {
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function midiWithNotes(notes: Array<{ pitch: number; start: number; length?: number }>): ArrayBuffer {
  const events: number[] = [];
  let tick = 0;
  for (const note of notes) {
    events.push(...midiVarInt(note.start - tick), 0x90, note.pitch, 100);
    tick = note.start;
    const length = note.length ?? 1;
    events.push(...midiVarInt(length), 0x80, note.pitch, 0);
    tick += length;
  }
  events.push(0, 0xff, 0x2f, 0);
  const bytes = new Uint8Array(14 + 8 + events.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4d546864);
  view.setUint32(4, 6);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  view.setUint16(12, 480);
  view.setUint32(14, 0x4d54726b);
  view.setUint32(18, events.length);
  bytes.set(events, 22);
  return bytes.buffer;
}

function midiWithTempoChange(): ArrayBuffer {
  const events = [
    0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    ...midiVarInt(480), 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40,
    0, 0x90, 38, 100,
    ...midiVarInt(480), 0x80, 38, 0,
    0, 0xff, 0x2f, 0
  ];
  const bytes = new Uint8Array(22 + events.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4d546864);
  view.setUint32(4, 6);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  view.setUint16(12, 480);
  view.setUint32(14, 0x4d54726b);
  view.setUint32(18, events.length);
  bytes.set(events, 22);
  return bytes.buffer;
}

test('FNF preserves player/opponent lanes for both halves of sectionNotes', () => {
  const chart = parseJsonContent(JSON.stringify({ song: { song: 'Test', bpm: 150, notes: [
    { mustHitSection: true, sectionNotes: [[100, 0, 0], [100, 4, 0], [200, 3, 25], [200, 7, 25]] }
  ] } }), 'test.json');
  assert.deepEqual(chart.notes.map(n => [n.timeMs, n.lane, n.isOpponent, n.durationMs]), [
    [100, 0, false, 0], [100, 0, true, 0], [200, 3, false, 25], [200, 3, true, 25]
  ]);
});

test('taiko maps whistle/clap to kat without false mania holds', () => {
  const chart = parseOsuContent([
    'osu file format v14', '[General]', 'Mode: 1', '[Difficulty]', 'CircleSize:4',
    '[HitObjects]', '64,192,100,1,0', '192,192,200,1,2', '320,192,300,8,8,600:1:0:0:0:0'
  ].join('\n'), 'taiko.osu');
  assert.equal(chart.mode, 'taiko');
  assert.deepEqual(chart.notes.map(n => [n.lane, n.durationMs, n.type]), [
    [0, 0, 'taiko_don'], [1, 0, 'taiko_kat'], [1, 0, 'taiko_kat']
  ]);
});

test('LLPlus directional names stay in two lanes', () => {
  const chart = parseJsonContent(JSON.stringify({ metadata: { title: 'LLP' }, events: [
    { n: 'key', t: 1, d: { i: 'left' } },
    { n: 'key', t: 2, d: { i: 'right' } }
  ] }), 'map.json');
  assert.equal(chart.mode, 'llplus');
  assert.equal(chart.keyCount, 2);
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 1]);
});

test('mania only treats bit-128 objects as holds', () => {
  const chart = parseOsuContent([
    'osu file format v14', '[General]', 'Mode: 3', '[Difficulty]', 'CircleSize:4',
    '[HitObjects]', '0,192,100,1,0,999:0:0:0:0:0', '256,192,200,128,0,450:0:0:0:0:0'
  ].join('\n'), 'mania.osu');
  assert.deepEqual(chart.notes.map(n => [n.lane, n.durationMs, n.type]), [
    [0, 0, 'normal'], [2, 250, 'hold']
  ]);
});

test('LLPlus keeps octave-shifted notes and rapid repeated notes', () => {
  const chart = parseMidiContent(midiWithNotes([
    { pitch: 38, start: 0 }, { pitch: 50, start: 20 }
  ]), 'rapid.mid');
  assert.equal(chart.notes.length, 2);
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 0]);
  assert.deepEqual(chart.notes.map(n => n.timeMs), [0, 21]);
});

test('mixed-octave MIDI retains the right side alongside original left pitches', () => {
  const chart = parseMidiContent(midiWithNotes([
    { pitch: 38, start: 0 }, { pitch: 48, start: 240 }
  ]), 'both-sides.mid');
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 1]);
});

test('rapid repetitions in the original MIDI octave are not merged', () => {
  const chart = parseMidiContent(midiWithNotes([
    { pitch: 38, start: 0 }, { pitch: 38, start: 20 }
  ]), 'rapid-original.mid');
  assert.equal(chart.notes.length, 2);
});

test('simultaneous MIDI tap and hold markers still consolidate', () => {
  const chart = parseMidiContent(midiWithNotes([
    { pitch: 38, start: 0, length: 0 }, { pitch: 39, start: 0, length: 240 }
  ]), 'hold.mid');
  assert.equal(chart.notes.length, 1);
  assert.equal(chart.notes[0].durationMs, 250);
});

test('MIDI note times and holds integrate tempo changes across tick segments', () => {
  const chart = parseMidiContent(midiWithTempoChange(), 'tempo-change.mid');
  assert.equal(chart.notes.length, 1);
  assert.equal(chart.notes[0].timeMs, 500);
  assert.equal(chart.notes[0].durationMs, 1000);
  assert.equal(chart.bpm, 60);
});

test('legacy numeric events retain all four columns', () => {
  const chart = parseJsonContent(JSON.stringify({ events: [0, 1, 2, 3].map(i => ({ n: 'key', t: i, d: { i } })) }), '4k.json');
  assert.equal(chart.mode, 'mania');
  assert.equal(chart.keyCount, 4);
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 1, 2, 3]);
});

test('explicit 4K events preserve directional right as lane 3', () => {
  const chart = parseJsonContent(JSON.stringify({ keyCount: 4, events: [
    { n: 'key', t: 1, d: { i: 'left' } }, { n: 'key', t: 2, d: { i: 'right' } }
  ] }), '4k-directions.json');
  assert.deepEqual(chart.notes.map(n => n.lane), [0, 3]);
});
