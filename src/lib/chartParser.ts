import JSZip from 'jszip';
import { parseIricPackage } from './iricFormat';

export interface ChartNote {
  id: string;
  timeMs: number;
  lane: number;
  durationMs: number;
  type?: 'normal' | 'hold' | 'taiko_don' | 'taiko_kat' | 'taiko_drumroll';
  isOpponent?: boolean;
}

export interface DifficultyOption {
  name: string;
  notes: ChartNote[];
  keyCount: number;
  mode: 'mania' | 'taiko' | 'fnf' | 'llplus';
  bpm: number;
  scrollSpeed?: number;
  svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
}

export interface ParsedChart {
  title: string;
  artist: string;
  charter: string;
  version?: string;
  bpm: number;
  offsetMs?: number;
  keyCount: number;
  mode: 'mania' | 'taiko' | 'fnf' | 'llplus';
  notes: ChartNote[];
  difficulties?: DifficultyOption[];
  activeDifficultyIndex?: number;
  audioBlob?: Blob;
  audioUrl?: string;
  vocalsBlob?: Blob;
  vocalsUrl?: string;
  bgUrl?: string;
  bgBlob?: Blob;
  videoUrl?: string;
  videoBlob?: Blob;
  audioRegions?: any[];
  scrollSpeed?: number;
  svChanges?: any[];
  autocharterConfig?: any;
  isIricPackage?: boolean;
}

/**
 * Universal Chart Parser
 * Supports: .iric (Iris Package), Lightners Live + (.mid, .zip), .osu (Mania, Taiko, Standard), FNF (.json), .osz
 */
export async function parseUniversalChart(file: File | Blob, fileName?: string, targetDifficulty?: number | string): Promise<ParsedChart> {
  const name = fileName || (file instanceof File ? file.name : 'chart');
  const lowerName = name.toLowerCase();

  // If it's an official Iris Container (.iric)
  if (lowerName.endsWith('.iric')) {
    return parseIricPackage(file, name, targetDifficulty);
  }

  // If it's a ZIP / OSZ / LLMAP archive
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.osz') || lowerName.endsWith('.llmap')) {
    return parseZipArchive(file, name, targetDifficulty);
  }

  // If it's a MIDI file (.mid / .midi for Lightners Live +)
  if (lowerName.endsWith('.mid') || lowerName.endsWith('.midi')) {
    const arrayBuffer = await file.arrayBuffer();
    return parseMidiContent(arrayBuffer, name);
  }

  // If it's a JSON file (FNF or LLPlus map-info.json / map-0.json)
  if (lowerName.endsWith('.json')) {
    const text = await file.text();
    return parseJsonContent(text, name);
  }

  // If it's an .osu file
  if (lowerName.endsWith('.osu') || lowerName.endsWith('.txt')) {
    const text = await file.text();
    return parseOsuContent(text, name);
  }

  throw new Error(`Unsupported file format: ${name}`);
}

/**
 * Parse Standard MIDI File (.mid) for Lightners Live +
 * Handles official Deltarune: Lightners Live + MIDI specification (Type 0 / Type 1)
 */
export function parseMidiContent(arrayBuffer: ArrayBuffer, fileName: string): ParsedChart {
  const data = new DataView(arrayBuffer);
  let offset = 0;

  if (data.byteLength < 14) {
    throw new Error('MIDI file too short');
  }

  // Look for 'MThd' header
  let foundMThd = false;
  while (offset + 14 <= data.byteLength) {
    if (data.getUint32(offset) === 0x4d546864) { // 'MThd'
      foundMThd = true;
      break;
    }
    offset++;
  }

  if (!foundMThd) {
    throw new Error('Invalid MIDI file (missing MThd header)');
  }

  offset += 4; // Skip 'MThd'
  const headerLen = data.getUint32(offset);
  offset += 4;
  const format = data.getUint16(offset);
  offset += 2;
  const numTracks = Math.max(1, data.getUint16(offset));
  offset += 2;
  const division = data.getUint16(offset) || 480; // PPQ ticks per quarter note
  offset += 2;

  // Advance past any remaining header bytes
  if (headerLen > 6) {
    offset += (headerLen - 6);
  }

  let tempoUs = 500000; // Default 120 BPM (500,000 microseconds per quarter note)
  const tempoChanges: Array<{ tick: number; tempoUs: number }> = [{ tick: 0, tempoUs }];

  interface TempNote {
    pitch: number;
    startTick: number;
    track: number;
  }
  const pendingNotes: TempNote[] = [];
  interface RawTickNote {
    startTick: number;
    endTick: number;
    lane: number;
    isHold: boolean;
    pitch: number;
  }
  interface ParsedMidiNote {
    timeMs: number;
    lane: number;
    durationMs: number;
    isHold: boolean;
    pitch: number;
  }
  const rawTickNotes: RawTickNote[] = [];

  function readVarInt(): number {
    let result = 0;
    while (offset < data.byteLength) {
      const byte = data.getUint8(offset++);
      result = (result << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return result;
  }

  // Iterate over all tracks
  for (let trackIdx = 0; trackIdx < numTracks; trackIdx++) {
    if (offset + 8 > data.byteLength) break;

    // Find next 'MTrk' chunk
    let foundMTrk = false;
    while (offset + 8 <= data.byteLength) {
      if (data.getUint32(offset) === 0x4d54726b) { // 'MTrk'
        foundMTrk = true;
        break;
      }
      offset++;
    }

    if (!foundMTrk) break;

    offset += 4; // Skip 'MTrk'
    const trackLen = data.getUint32(offset);
    offset += 4;
    const trackEnd = Math.min(data.byteLength, offset + trackLen);

    let currentTick = 0;
    let runningStatus = 0;

    while (offset < trackEnd && offset < data.byteLength) {
      const delta = readVarInt();
      currentTick += delta;

      if (offset >= trackEnd) break;
      let status = data.getUint8(offset);

      if (status >= 0x80) {
        if (status < 0xf0) {
          runningStatus = status;
        } else {
          runningStatus = 0; // SysEx and Meta events DO NOT set running status
        }
        offset++;
      } else {
        if (runningStatus === 0) {
          offset++;
          continue;
        }
        status = runningStatus;
      }

      const eventType = status & 0xf0;

      if (eventType === 0x90 || eventType === 0x80) {
        // Note On (0x90) or Note Off (0x80)
        if (offset + 1 > data.byteLength) break;
        const pitch = data.getUint8(offset++);
        const velocity = data.getUint8(offset++);

        const isNoteOn = eventType === 0x90 && velocity > 0;

        if (isNoteOn) {
          pendingNotes.push({ pitch, startTick: currentTick, track: trackIdx });
        } else {
          // Note Off
          const matchIdx = pendingNotes.findIndex(p => p.pitch === pitch && p.track === trackIdx);
          if (matchIdx !== -1) {
            const startNote = pendingNotes.splice(matchIdx, 1)[0];
            const durationTicks = Math.max(1, currentTick - startNote.startTick);

            // Resolve Lightners Live + Kris Lane (0 = Left, 1 = Right)
            // Official LLP Pitches: 38 (Kris L), 39 (Kris L Hold), 36 (Kris R), 35 (Kris R Hold)
            // Alternate / Octave shift support: 50/51 (L), 48/47 (R)
            let lane = 0;
            let isHold = false;
            const p = startNote.pitch;

            if (p === 38 || p === 50) {
              lane = 0;
              isHold = durationTicks > (division * 0.4);
            } else if (p === 39 || p === 51) {
              lane = 0;
              isHold = true;
            } else if (p === 36 || p === 48) {
              lane = 1;
              isHold = durationTicks > (division * 0.4);
            } else if (p === 35 || p === 47) {
              lane = 1;
              isHold = true;
            } else if (p % 12 === 2 || p % 12 === 3) {
              // Any D / D# note -> Left
              lane = 0;
              isHold = p % 12 === 3 || durationTicks > (division * 0.4);
            } else if (p % 12 === 0 || p % 12 === 11) {
              // Any C / B note -> Right
              lane = 1;
              isHold = p % 12 === 11 || durationTicks > (division * 0.4);
            } else {
              // Generic fallback (e.g. if made in other DAW)
              lane = p % 2;
              isHold = durationTicks > (division * 0.4);
            }

            rawTickNotes.push({
              startTick: startNote.startTick,
              endTick: currentTick,
              lane,
              isHold,
              pitch: p
            });
          }
        }
      } else if (eventType === 0xa0 || eventType === 0xb0 || eventType === 0xe0) {
        offset += 2;
      } else if (eventType === 0xc0 || eventType === 0xd0) {
        offset += 1;
      } else if (status === 0xff) {
        // Meta Event
        if (offset >= trackEnd) break;
        const metaType = data.getUint8(offset++);
        const metaLen = readVarInt();

        if (metaType === 0x51 && metaLen === 3 && offset + 2 < data.byteLength) {
          // Set Tempo (3 bytes microseconds per quarter note)
          tempoUs = (data.getUint8(offset) << 16) | (data.getUint8(offset + 1) << 8) | data.getUint8(offset + 2);
          tempoChanges.push({ tick: currentTick, tempoUs });
        } else if (metaType === 0x2f) {
          // End of Track
          offset += metaLen;
          break;
        }
        offset += metaLen;
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx Event
        const sysexLen = readVarInt();
        offset += sysexLen;
      }
    }

    // Flush any pending notes at track boundary
    while (pendingNotes.length > 0) {
      const startNote = pendingNotes.pop()!;
      const p = startNote.pitch;
      const lane = (p === 38 || p === 39 || p === 50 || p === 51 || p % 12 === 2 || p % 12 === 3) ? 0 : 1;
      const isHold = p === 39 || p === 35 || p === 51 || p === 47;
      rawTickNotes.push({
        startTick: startNote.startTick,
        endTick: Math.max(startNote.startTick + division / 4, currentTick),
        lane,
        isHold,
        pitch: p
      });
    }

    offset = trackEnd;
  }

  // Collapse tempo events on the same tick, then convert each note through the
  // elapsed tempo segments instead of multiplying absolute ticks by final BPM.
  const sortedTempoChanges = [...tempoChanges]
    .filter(change => Number.isFinite(change.tick) && change.tick >= 0 && change.tempoUs > 0)
    .sort((a, b) => a.tick - b.tick);
  const tempoMap: Array<{ tick: number; tempoUs: number }> = [];
  for (const change of sortedTempoChanges) {
    const previous = tempoMap[tempoMap.length - 1];
    if (previous?.tick === change.tick) previous.tempoUs = change.tempoUs;
    else tempoMap.push({ ...change });
  }
  if (tempoMap[0]?.tick !== 0) tempoMap.unshift({ tick: 0, tempoUs: 500000 });

  const tickToMs = (targetTick: number) => {
    let previousTick = 0;
    let currentTempoUs = tempoMap[0]?.tempoUs || 500000;
    let elapsedMicroseconds = 0;
    for (const change of tempoMap) {
      if (change.tick === 0) {
        currentTempoUs = change.tempoUs;
        continue;
      }
      if (change.tick >= targetTick) break;
      elapsedMicroseconds += ((change.tick - previousTick) / division) * currentTempoUs;
      previousTick = change.tick;
      currentTempoUs = change.tempoUs;
    }
    elapsedMicroseconds += ((targetTick - previousTick) / division) * currentTempoUs;
    return Math.round(elapsedMicroseconds / 1000);
  };

  const rawNotes: ParsedMidiNote[] = rawTickNotes.map(note => {
    const timeMs = tickToMs(note.startTick);
    const endMs = tickToMs(Math.max(note.startTick, note.endTick));
    return {
      timeMs,
      lane: note.lane,
      durationMs: note.isHold ? Math.max(80, endMs - timeMs) : 0,
      isHold: note.isHold,
      pitch: note.pitch
    };
  });

  // Sort raw notes chronologically
  rawNotes.sort((a, b) => a.timeMs - b.timeMs);

  // Check if standard Kris pitches exist (35, 36, 38, 39)
  // A chart can mix the documented octave-shifted Kris pitches (47/48/50/51)
  // with the original pitches.  Filtering on only the original octave used to
  // silently discard the shifted lane notes as soon as one original note was
  // present.
  const krisPitches = [35, 36, 38, 39, 47, 48, 50, 51];
  const hasKrisPitches = rawNotes.some(n => krisPitches.includes(n.pitch));
  const filteredRawNotes = hasKrisPitches
    ? rawNotes.filter(n => krisPitches.includes(n.pitch))
    : rawNotes;

  // D:LLP Note Consolidation: Merge simultaneous tap + hold notes on the same lane
  const notes: ChartNote[] = [];
  // Only a tap and its same-timestamp hold marker should be consolidated.
  // A 40ms window incorrectly ate legitimate fast repeated notes in one lane.
  const MERGE_WINDOW_MS = 0;

  for (const raw of filteredRawNotes) {
    const existing = notes.find(n => n.lane === raw.lane && Math.abs(n.timeMs - raw.timeMs) <= MERGE_WINDOW_MS);

    if (existing) {
      if (raw.durationMs > existing.durationMs) {
        existing.durationMs = raw.durationMs;
        existing.type = 'hold';
      }
    } else {
      notes.push({
        id: `midi-llp-${notes.length}`,
        timeMs: raw.timeMs,
        lane: raw.lane,
        durationMs: raw.durationMs,
        type: raw.durationMs > 0 ? 'hold' : 'normal'
      });
    }
  }

  notes.sort((a, b) => a.timeMs - b.timeMs);
  const bpm = Math.max(20, Math.min(400, Math.round(60000000 / (tempoUs || 500000))));

  return {
    title: fileName.replace(/\.mid(i)?$/i, ''),
    artist: 'Lightners Live +',
    charter: 'Composer',
    bpm,
    keyCount: 2,
    mode: 'llplus',
    notes
  };
}

/**
 * Parse ZIP/OSZ/LLMAP archives containing charts, audio, videos, and multiple difficulties
 */
async function parseZipArchive(file: File | Blob, archiveName: string, targetDifficulty?: number | string): Promise<ParsedChart> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  let audioBlob: Blob | undefined;
  let vocalsBlob: Blob | undefined;
  let bgBlob: Blob | undefined;
  let videoBlob: Blob | undefined;

  let extractedTitle = '';
  let extractedArtist = '';
  let extractedCharter = '';

  const diffs: DifficultyOption[] = [];
  const mapInfoDiffNames: Record<string, string> = {};

  // 1. Find audio, video, image, txt, and metadata files
  for (const rel in loadedZip.files) {
    const zipEntry = loadedZip.files[rel];
    if (zipEntry.dir || rel.toLowerCase().includes('__macosx') || rel.split('/').pop()?.startsWith('._')) continue;

    const lower = rel.toLowerCase();

    // Audio matching
    if (lower.includes('voices') || lower.includes('vocals')) {
      vocalsBlob = await zipEntry.async('blob');
    } else if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) {
      if (!audioBlob || lower.includes('inst') || lower.includes('audio')) {
        audioBlob = await zipEntry.async('blob');
      }
    }

    // Video matching
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mkv')) {
      videoBlob = await zipEntry.async('blob');
    }

    // Background Image matching
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      if (!bgBlob) {
        bgBlob = await zipEntry.async('blob');
      }
    }

    // Metadata text file for Lightners Live +
    if (lower.endsWith('.txt') && !lower.includes('license') && !lower.includes('readme')) {
      const txt = await zipEntry.async('text');
      txt.split(/\r?\n/).forEach(line => {
        if (line.startsWith('Composer:')) extractedArtist = line.replace('Composer:', '').trim();
        if (line.startsWith('Difficulty:')) extractedCharter = line.replace('Difficulty:', '').trim();
      });
    }
  }

  // 2. Parse all chart files (.osu, .mid, .json) inside the zip
  for (const rel in loadedZip.files) {
    const zipEntry = loadedZip.files[rel];
    if (zipEntry.dir) continue;

    const lower = rel.toLowerCase();
    const fileName = rel.split('/').pop() || rel;

    if (zipEntry.dir || lower.includes('__macosx') || fileName.startsWith('._')) continue;

    // Filter metadata / config json files so they are not registered as fake difficulties
    if (
      lower.endsWith('map-info.json') ||
      lower.endsWith('info.json') ||
      lower.endsWith('metadata.json') ||
      lower.endsWith('config.json') ||
      lower.endsWith('package.json')
    ) {
      try {
        const txt = await zipEntry.async('text');
        const metaJson = JSON.parse(txt);
        if (metaJson.metadata?.title || metaJson.songName || metaJson.title) {
          extractedTitle = metaJson.metadata?.title || metaJson.songName || metaJson.title;
        }
        if (metaJson.metadata?.artist || metaJson.artist) {
          extractedArtist = metaJson.metadata?.artist || metaJson.artist;
        }
        if (metaJson.metadata?.charter || metaJson.charter) {
          extractedCharter = metaJson.metadata?.charter || metaJson.charter;
        }
        const rawDiffs = metaJson.difficulties || metaJson.difficultiesList;
        if (Array.isArray(rawDiffs)) {
          rawDiffs.forEach((d: any) => {
            if (d.file && d.name) {
              const normFile = String(d.file).toLowerCase().replace(/\\/g, '/');
              const fileOnly = normFile.split('/').pop() || normFile;
              const baseName = fileOnly.replace(/\.[^/.]+$/, '');
              mapInfoDiffNames[normFile] = d.name;
              mapInfoDiffNames[fileOnly] = d.name;
              mapInfoDiffNames[baseName] = d.name;
            }
          });
        }
      } catch {
        // ignore metadata parse error
      }
      continue;
    }

    if (lower.endsWith('.osu')) {
      const chartText = await zipEntry.async('text');
      const parsedOsu = parseOsuContent(chartText, rel);
      
      if (!extractedTitle && parsedOsu.title && parsedOsu.title !== rel.replace(/\\.osu$/i, '')) extractedTitle = parsedOsu.title;
      if (!extractedArtist && parsedOsu.artist && parsedOsu.artist !== 'Desconocido') extractedArtist = parsedOsu.artist;
      if (!extractedCharter && parsedOsu.charter && parsedOsu.charter !== 'Desconocido') extractedCharter = parsedOsu.charter;
      
      if (parsedOsu.notes.length > 0) {
        const baseName = fileName.replace(/\\.osu$/i, '');
        const diffName = mapInfoDiffNames[lower] || mapInfoDiffNames[fileName] || mapInfoDiffNames[baseName] || parsedOsu.version || 'Normal';
        diffs.push({
          name: diffName,
          notes: parsedOsu.notes,
          keyCount: parsedOsu.keyCount,
          mode: parsedOsu.mode,
          bpm: parsedOsu.bpm
        });
      }
    } else if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
      // Lightners Live + MIDI file inside zip
      const midiBuffer = await zipEntry.async('arraybuffer');
      try {
        const parsedMidi = parseMidiContent(midiBuffer, rel);
        
        if (!extractedTitle && parsedMidi.title && parsedMidi.title !== rel.replace(/\\.mid(i)?$/i, '')) extractedTitle = parsedMidi.title;
        if (!extractedArtist && parsedMidi.artist && parsedMidi.artist !== 'Lightners Live +') extractedArtist = parsedMidi.artist;
        if (!extractedCharter && parsedMidi.charter && parsedMidi.charter !== 'Composer') extractedCharter = parsedMidi.charter;

        if (parsedMidi.notes.length > 0) {
          const baseName = fileName.replace(/\.mid(i)?$/i, '');
          const diffName = mapInfoDiffNames[lower] || mapInfoDiffNames[fileName] || mapInfoDiffNames[baseName] || parsedMidi.version || baseName || 'Normal';
          diffs.push({
            name: diffName,
            notes: parsedMidi.notes,
            keyCount: parsedMidi.keyCount,
            mode: parsedMidi.mode,
            bpm: parsedMidi.bpm
          });
        }
      } catch (e: any) {
        console.error('Error parsing MIDI file in ZIP:', rel, e);
      }
    } else if (lower.endsWith('.json')) {
      const chartText = await zipEntry.async('text');
      try {
        const parsedJson = parseJsonContent(chartText, rel);
        if (parsedJson.title && !extractedTitle) extractedTitle = parsedJson.title;
        if (parsedJson.artist && parsedJson.artist !== 'Desconocido' && parsedJson.artist !== 'FNF Artist' && !extractedArtist) {
          extractedArtist = parsedJson.artist;
        }
        if (parsedJson.charter && parsedJson.charter !== 'Auto-Charter' && parsedJson.charter !== 'FNF Charter' && !extractedCharter) {
          extractedCharter = parsedJson.charter;
        }

        if (parsedJson.notes.length > 0) {
          const baseName = fileName.replace(/\.json$/i, '');
          const diffName = mapInfoDiffNames[lower] || mapInfoDiffNames[fileName] || mapInfoDiffNames[baseName] || parsedJson.version || parsedJson.title || baseName || 'Normal';
          diffs.push({
            name: diffName,
            notes: parsedJson.notes,
            keyCount: parsedJson.keyCount,
            mode: parsedJson.mode,
            bpm: parsedJson.bpm
          });
        }
      } catch (e) {
        // ignore non-chart jsons
      }
    }
  }

  if (diffs.length === 0) {
    const filesFound = Object.keys(loadedZip.files)
      .filter(f => !loadedZip.files[f].dir && !f.includes('__MACOSX'))
      .map(f => f.split('/').pop())
      .filter(Boolean)
      .join(', ');
    throw new Error(`No playable map file (.mid, .osu or .json) with notes found inside the ZIP package. Files in ZIP: [${filesFound || 'empty'}]`);
  }

  // Sort diffs by note count (so difficulty order matches PlayMenu)
  diffs.sort((a, b) => a.notes.length - b.notes.length);

  let chosenIndex = 0;
  if (typeof targetDifficulty === 'number' && targetDifficulty >= 0 && targetDifficulty < diffs.length) {
    chosenIndex = targetDifficulty;
  } else if (typeof targetDifficulty === 'string' && targetDifficulty) {
    const foundIdx = diffs.findIndex(d => d.name.toLowerCase() === targetDifficulty.toLowerCase());
    if (foundIdx !== -1) chosenIndex = foundIdx;
  }

  const selectedDiff = diffs[chosenIndex] || diffs[0];

  const result: ParsedChart = {
    title: extractedTitle || archiveName.replace(/\.(zip|osz|llmap)$/i, ''),
    artist: extractedArtist || 'Desconocido',
    charter: extractedCharter || 'Auto-Charter',
    bpm: selectedDiff.bpm,
    keyCount: selectedDiff.keyCount,
    mode: selectedDiff.mode,
    notes: selectedDiff.notes,
    difficulties: diffs,
    activeDifficultyIndex: chosenIndex
  };

  if (audioBlob) {
    result.audioBlob = audioBlob;
    result.audioUrl = URL.createObjectURL(audioBlob);
  }

  if (vocalsBlob) {
    result.vocalsBlob = vocalsBlob;
    result.vocalsUrl = URL.createObjectURL(vocalsBlob);
  }

  if (bgBlob) {
    result.bgBlob = bgBlob;
    result.bgUrl = URL.createObjectURL(bgBlob);
  }

  if (videoBlob) {
    result.videoBlob = videoBlob;
    result.videoUrl = URL.createObjectURL(videoBlob);
  }

  return result;
}

/**
 * Parse .osu file content
 */
export function parseOsuContent(content: string, fileName: string): ParsedChart {
  const lines = content.split(/\r?\n/);

  let title = fileName.replace(/\.osu$/i, '');
  let artist = 'Desconocido';
  let charter = 'Desconocido';
  let version = '';
  let modeNum = 3; // default mania
  let circleSize = 4; // key count
  let bpm = 120;

  let currentSection = '';
  const timingPoints: Array<{ time: number; msPerBeat: number }> = [];
  const rawHitObjects: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (currentSection === 'General') {
      if (trimmed.startsWith('Mode:')) {
        modeNum = parseInt(trimmed.split(':')[1].trim(), 10) || 0;
      }
    } else if (currentSection === 'Metadata') {
      if (trimmed.startsWith('Title:')) title = trimmed.split(':').slice(1).join(':').trim() || title;
      if (trimmed.startsWith('TitleUnicode:')) {
        const val = trimmed.split(':').slice(1).join(':').trim();
        if (val) title = val;
      }
      if (trimmed.startsWith('Artist:')) artist = trimmed.split(':').slice(1).join(':').trim() || artist;
      if (trimmed.startsWith('ArtistUnicode:')) {
        const val = trimmed.split(':').slice(1).join(':').trim();
        if (val) artist = val;
      }
      if (trimmed.startsWith('Creator:')) charter = trimmed.split(':').slice(1).join(':').trim() || charter;
      if (trimmed.startsWith('Version:')) version = trimmed.split(':').slice(1).join(':').trim() || version;
    } else if (currentSection === 'Difficulty') {
      if (trimmed.startsWith('CircleSize:')) {
        circleSize = Math.max(1, Math.round(parseFloat(trimmed.split(':')[1].trim()) || 4));
      }
    } else if (currentSection === 'TimingPoints') {
      const parts = trimmed.split(',');
      if (parts.length >= 2) {
        const time = parseFloat(parts[0]);
        const msPerBeat = parseFloat(parts[1]);
        if (msPerBeat > 0) {
          timingPoints.push({ time, msPerBeat });
        }
      }
    } else if (currentSection === 'HitObjects') {
      rawHitObjects.push(trimmed);
    }
  }

  if (!version) {
    const bracketMatch = fileName.match(/\[(.*?)\]/);
    if (bracketMatch) version = bracketMatch[1];
  }

  let offsetMs = 0;
  if (timingPoints.length > 0) {
    offsetMs = Math.round(timingPoints[0].time);
    bpm = 60000 / timingPoints[0].msPerBeat;
  }

  let mode: 'mania' | 'taiko' | 'llplus' = 'mania';
  if (modeNum === 1) mode = 'taiko';
  else if (modeNum === 3) mode = 'mania';

  const notes: ChartNote[] = [];

  rawHitObjects.forEach((objLine, idx) => {
    const parts = objLine.split(',');
    if (parts.length < 4) return;

    const x = parseInt(parts[0], 10);
    const timeMs = parseInt(parts[2], 10);
    const typeBit = parseInt(parts[3], 10);

    let durationMs = 0;
    // Only mania holds use bit 128.  Treating every sixth field as an end time
    // made non-mania objects (and malformed extra fields) become false holds.
    const isManiaHold = modeNum === 3 && (typeBit & 128) !== 0;
    if (isManiaHold && parts.length >= 6 && parts[5]) {
      const endParts = parts[5].split(':');
      const endTimeMs = parseInt(endParts[0], 10);
      if (!isNaN(endTimeMs) && endTimeMs > timeMs) {
        durationMs = endTimeMs - timeMs;
      }
    }

    if (mode === 'taiko') {
      // Taiko mode hitSound mapping: Bit 1 (2 Whistle) or Bit 3 (8 Clap) -> Kat (Blue, Lane 1)
      const hitSound = parseInt(parts[4], 10) || 0;
      const isKat = (hitSound & 2) !== 0 || (hitSound & 8) !== 0;
      notes.push({
        id: `note-${idx}`,
        timeMs,
        lane: isKat ? 1 : 0,
        durationMs,
        type: isKat ? 'taiko_kat' : 'taiko_don'
      });
    } else {
      // Mania / Key mode lane mapping
      const keyCount = circleSize || 4;
      const lane = Math.min(keyCount - 1, Math.max(0, Math.floor((x * keyCount) / 512)));

      notes.push({
        id: `note-${idx}`,
        timeMs,
        lane,
        durationMs,
        type: durationMs > 0 ? 'hold' : 'normal'
      });
    }
  });

  return {
    title,
    artist,
    charter,
    version: version || 'Normal',
    bpm: Math.round(bpm * 100) / 100,
    offsetMs,
    keyCount: mode === 'taiko' ? 2 : (circleSize || 4),
    mode,
    notes
  };
}

function parseLane(rawLane: any, maxKeys: number = 4): number {
  if (typeof rawLane === 'number') {
    if (rawLane === 38 || rawLane === 39) return 0; // Kris Left (38) / Left Hold (39)
    if (rawLane === 36 || rawLane === 35) return 1; // Kris Right (36) / Right Hold (35)
    return Math.max(0, Math.min(maxKeys - 1, Math.floor(rawLane)));
  }
  if (typeof rawLane === 'string') {
    const s = rawLane.toLowerCase().trim();
    // Direct integer string
    const parsed = parseInt(s, 10);
    if (!isNaN(parsed)) {
      return parseLane(parsed, maxKeys);
    }
    // Direction names.  In a 2-key LLPlus chart, right must be lane 1 (not
    // lane 3); the old order returned 3 before the 2-key mapping was reached.
    if (s.includes('left') || s === 'left_arrow' || s === 'leftarrow') return 0;
    if (s.includes('right') || s === 'right_arrow' || s === 'rightarrow') return Math.min(maxKeys - 1, maxKeys === 2 ? 1 : 3);
    if (s.includes('down') || s === 'd_arrow' || s === 'downarrow') return Math.min(maxKeys - 1, 1);
    if (s.includes('up') || s === 'u_arrow' || s === 'uparrow') return Math.min(maxKeys - 1, 2);

    // Standard 4K/6K/7K keyboard letters
    const keyMap4K = ['d', 'f', 'j', 'k'];
    const keyMapWASD = ['a', 's', 'w', 'd'];
    const keyMapQWER = ['q', 'w', 'e', 'r'];
    const keyMap6K = ['s', 'd', 'f', 'j', 'k', 'l'];
    const keyMap7K = ['s', 'd', 'f', 'space', 'j', 'k', 'l'];

    if (maxKeys === 2) {
      if (['d', 'a', 'left', 'z', 'x', 'l'].includes(s)) return 0;
      if (['k', 'right', 'c', 'v', 'r'].includes(s)) return 1;
    }

    if (keyMap4K.includes(s)) return keyMap4K.indexOf(s);
    if (keyMapWASD.includes(s)) return keyMapWASD.indexOf(s);
    if (keyMapQWER.includes(s)) return keyMapQWER.indexOf(s);
    if (keyMap6K.includes(s)) return Math.min(maxKeys - 1, keyMap6K.indexOf(s));
    if (keyMap7K.includes(s)) return Math.min(maxKeys - 1, keyMap7K.indexOf(s));
  }
  return 0;
}

/**
 * Parse JSON content (FNF song JSON or LLPlus / TypoJam JSON)
 */
export function parseJsonContent(text: string, fileName: string): ParsedChart {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }

  // Case 1: Friday Night Funkin' (FNF) JSON
  // Detected by having `song.notes` or `notes` containing section objects with `sectionNotes`
  const isFnfFormat = !!(
    (json.song && (json.song.notes || json.song.bpm)) ||
    json.sectionNotes ||
    (Array.isArray(json.notes) && json.notes.length > 0 && Array.isArray(json.notes[0]?.sectionNotes))
  );

  if (isFnfFormat) {
    const songObj = json.song || json;
    const title = songObj.song || songObj.title || fileName.replace(/\.json$/i, '');
    const artist = songObj.artist || json.artist || 'FNF Artist';
    const charter = songObj.charter || json.charter || 'FNF Charter';
    const bpm = songObj.bpm || 120;
    const notesSections = songObj.notes || json.notes || [];

    const notes: ChartNote[] = [];
    let noteIdx = 0;

    notesSections.forEach((sec: any) => {
      const mustHitSection = sec.mustHitSection ?? true;
      const secNotes = sec.sectionNotes || [];

      secNotes.forEach((n: any) => {
        if (!Array.isArray(n) || n.length < 2) return;
        const timeMs = Math.round(n[0]);
        const rawNoteData = typeof n[1] === 'number' ? n[1] : parseInt(n[1], 10);
        if (isNaN(rawNoteData) || rawNoteData < 0) return;
        const durationMs = Math.max(0, Math.round(n[2] || 0));

        // FNF 4-direction mapping: 0=Left, 1=Down, 2=Up, 3=Right
        // noteData < 4 is the primary singer of this section
        const rawLane = Math.floor(rawNoteData) % 4;
        const isPlayerNote = rawNoteData < 4 ? mustHitSection : !mustHitSection;

        notes.push({
          id: `fnf-${noteIdx++}`,
          timeMs,
          lane: rawLane,
          durationMs,
          type: durationMs > 0 ? 'hold' : 'normal',
          isOpponent: !isPlayerNote
        });
      });
    });

    notes.sort((a, b) => a.timeMs - b.timeMs);

    return {
      title,
      artist,
      charter,
      bpm,
      keyCount: 4,
      mode: 'fnf',
      notes
    };
  }

  // Case 2: Lightners Live + / TypoJam JSON (events or notes or difficulties)
  if (json.events || json.notes || json.difficulties || json.metadata) {
    const title = json.metadata?.title || json.songName || fileName.replace(/\.json$/i, '');
    const artist = json.metadata?.artist || json.artist || 'Desconocido';
    const charter = json.metadata?.charter || json.charter || 'Auto-Charter';
    const version = json.difficultyName || json.difficulty || json.version || json.name || '';
    const bpm = json.bpm || json.metadata?.bpm || 120;

    const notes: ChartNote[] = [];

    if (json.events && Array.isArray(json.events)) {
      const eventLanes = json.events.filter((e: any) => e.n === 'key' && e.d)
        .map((e: any) => e.d.i ?? e.d.lane ?? e.d.k ?? e.d.key ?? e.d.p ?? e.d.s ?? 0);
      // Infer two lanes only for unambiguous left/right names. Numeric and
      // keyboard-based legacy charts retain their existing four-lane parsing.
      const directionsOnly = eventLanes.length > 0 && eventLanes.every((lane: any) =>
        typeof lane === 'string' && /^(left|right|left_arrow|right_arrow|leftarrow|rightarrow)$/i.test(lane.trim()));
      const declaredKeys = Number(json.keyCount ?? json.metadata?.keyCount);
      const eventKeyCount = Number.isInteger(declaredKeys) && declaredKeys > 0 ? declaredKeys : (directionsOnly ? 2 : 4);
      json.events.forEach((e: any, idx: number) => {
        if (e.n === 'key' && e.d) {
          const rawLane = e.d.i ?? e.d.lane ?? e.d.k ?? e.d.key ?? e.d.p ?? e.d.s ?? 0;
          const lane = parseLane(rawLane, eventKeyCount);
          const durationMs = Math.round((e.d.duration || e.d.d || 0) * 1000);
          notes.push({
            id: `llp-evt-${idx}`,
            timeMs: Math.round((e.t || 0) * 1000),
            lane,
            durationMs,
            type: durationMs > 0 ? 'hold' : 'normal'
          });
        }
      });
    } else {
      const rawNotes = json.notes || (json.difficulties && json.difficulties[0]?.notes) || [];
      rawNotes.forEach((n: any, idx: number) => {
        const rawLane = n.lane ?? n.k ?? n.key ?? n.i ?? n.p ?? 0;
        const lane = parseLane(rawLane, 4);
        const durationMs = Math.max(0, n.durationMs || n.holdMs || (n.d ? n.d * 1000 : 0) || 0);
        notes.push({
          id: `llp-${idx}`,
          timeMs: Math.round(n.timeMs || (n.time ? n.time * 1000 : 0) || (n.t ? n.t * 1000 : 0) || 0),
          lane,
          durationMs,
          type: durationMs > 0 ? 'hold' : 'normal'
        });
      });
    }

    const maxLane = notes.reduce((max, n) => Math.max(max, n.lane), 0);
    const keyCount = Math.max(2, maxLane + 1);

    notes.sort((a, b) => a.timeMs - b.timeMs);

    return {
      title,
      artist,
      charter,
      version: version ? String(version) : undefined,
      bpm,
      keyCount,
      mode: keyCount === 2 ? 'llplus' : 'mania',
      notes
    };
  }

  throw new Error('Unrecognized JSON structure (expected FNF or Lightners Live+).');
}
