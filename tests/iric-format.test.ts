import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createIricPackageBlob, parseIricPackage } from '../src/lib/iricFormat.ts';
import { parseUniversalChart } from '../src/lib/chartParser.ts';

const chartNote = (id: string, timeMs: number, lane: number) => ({
  id,
  timeMs,
  lane,
  durationMs: 0,
  type: 'normal' as const
});

async function makeTwoDifficultyIric(): Promise<Blob> {
  const zip = new JSZip();
  zip.file('unrelated.png', 'wrong-cover');
  zip.file('cover.png', 'manifest-cover');
  zip.file('charts/easy.json', JSON.stringify({
    difficultyName: 'Easy', keyCount: 4, mode: 'mania', bpm: 120,
    scrollSpeed: 1, svChanges: [], notes: [chartNote('easy-note', 500, 1)]
  }));
  zip.file('charts/hard.json', JSON.stringify({
    difficultyName: 'Hard', keyCount: 7, mode: 'mania', bpm: 180,
    scrollSpeed: 2, svChanges: [{ timeMs: 700, sv: 1.5, bpm: 180 }],
    notes: [chartNote('hard-note', 900, 6)]
  }));
  zip.file('iric_manifest.json', JSON.stringify({
    format: 'IRIC_CONTAINER_V1', version: '1.0', generator: 'test', createdAt: new Date(0).toISOString(),
    song: {
      title: 'Native Test', artist: 'Composer', charter: 'Tester', bpm: 120,
      offsetMs: 20, mode: 'mania', audioFilename: 'audio.mp3', coverFilename: 'cover.png',
      scrollSpeed: 1, svChanges: []
    },
    autocharterConfig: { useFreeOnset: false, betaOptions: { density: 5 } },
    audioRegions: [],
    difficulties: [
      { id: 'easy', name: 'Easy', file: 'charts/easy.json', noteCount: 1, keyCount: 4, mode: 'mania', bpm: 120, scrollSpeed: 1, svChanges: [] },
      { id: 'hard', name: 'Hard', file: 'charts/hard.json', noteCount: 1, keyCount: 7, mode: 'mania', bpm: 180, scrollSpeed: 2, svChanges: [{ timeMs: 700, sv: 1.5, bpm: 180 }] }
    ]
  }));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

test('IRIC opens the selected difficulty with its BPM, key count and SV settings', async () => {
  const blob = await makeTwoDifficultyIric();
  const chart = await parseIricPackage(blob, 'two-difficulty.iric', 1);
  assert.equal(chart.activeDifficultyIndex, 1);
  assert.equal(chart.notes[0].id, 'hard-note');
  assert.equal(chart.keyCount, 7);
  assert.equal(chart.bpm, 180);
  assert.equal(chart.scrollSpeed, 2);
  assert.deepEqual(chart.svChanges, [{ timeMs: 700, sv: 1.5, bpm: 180 }]);
  assert.equal(await chart.bgBlob?.text(), 'manifest-cover');
  assert.deepEqual(chart.autocharterConfig, { useFreeOnset: false, betaOptions: { density: 5 } });
});

test('universal parser forwards a named IRIC difficulty selection', async () => {
  const blob = await makeTwoDifficultyIric();
  const chart = await parseUniversalChart(blob, 'two-difficulty.iric', 'Hard');
  assert.equal(chart.activeDifficultyIndex, 1);
  assert.equal(chart.notes[0].id, 'hard-note');
});

test('native IRIC blob can be built and reopened without downloading it', async () => {
  const blob = await createIricPackageBlob({
    songName: 'Round Trip', artist: 'Artist', charter: 'Charter', bpm: 140,
    offsetMs: 25, mode: 'mania', audioFile: null,
    autocharterConfig: { regionPatternPref: 'stairs_and_chords' },
    difficulties: [{
      name: 'Expert', notes: [chartNote('round-trip', 1250, 5)], keyCount: 7,
      mode: 'mania', bpm: 180, scrollSpeed: 2,
      svChanges: [{ timeMs: 500, sv: 1.25, bpm: 180 }]
    }]
  });
  const chart = await parseIricPackage(blob, 'Round Trip.iric', 'Expert');
  assert.equal(chart.title, 'Round Trip');
  assert.equal(chart.notes[0].id, 'round-trip');
  assert.equal(chart.bpm, 180);
  assert.equal(chart.keyCount, 7);
  assert.equal(chart.scrollSpeed, 2);
  assert.deepEqual(chart.svChanges, [{ timeMs: 500, sv: 1.25, bpm: 180 }]);
  assert.deepEqual(chart.autocharterConfig, { regionPatternPref: 'stairs_and_chords' });
});
