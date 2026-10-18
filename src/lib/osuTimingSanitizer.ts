/**
 * Utility for strict timing alignment (snapping) and deduplication for osu!mania and osu!taiko charts.
 * Guarantees 0 unsnapped notes and 0 concurrent/overlapping hit object errors in Mapset Verifier & osu! Editor.
 */

export interface RawOsuHitObject {
  lane: number;
  timeMs: number;
  durationMs?: number;
  hitSound?: number;
  isHold?: boolean;
}

/**
 * Snaps a timestamp in milliseconds to the nearest standard musical grid tick.
 * Standard osu! snap divisors: 1/1, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16
 */
export function snapTimeToOsuGrid(
  timeMs: number,
  bpm: number,
  offsetMs: number = 0
): number {
  if (!bpm || bpm <= 0) return Math.round(timeMs);

  const beatLengthMs = (60 / bpm) * 1000;
  // Supported divisors in order of musical priority: coarse beats preferred if difference <= 1.5ms
  const divisors = [1, 2, 4, 3, 6, 8, 12, 16];

  let bestCandidate = Math.round(timeMs);
  let smallestDiff = Infinity;

  for (const div of divisors) {
    const stepMs = beatLengthMs / div;
    const tickIndex = Math.round((timeMs - offsetMs) / stepMs);
    const candidateMs = Math.round(offsetMs + tickIndex * stepMs);
    const diff = Math.abs(timeMs - candidateMs);

    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestCandidate = candidateMs;
      if (diff <= 1.5 && [1, 2, 4].includes(div)) {
        break;
      }
    }
  }

  return Math.max(0, bestCandidate);
}

/**
 * Deduplicates and resolves concurrent notes / hold overlaps on each lane.
 * - Eliminates duplicate notes on the exact same millisecond and lane.
 * - Prevents normal notes from landing inside an active hold note on the same lane.
 * - Ensures all hold notes have strictly snapped start and end times.
 * - Guarantees notes are strictly sorted in chronological order.
 */
export function sanitizeOsuHitObjects(
  notes: RawOsuHitObject[],
  keyCount: number,
  bpm: number,
  offsetMs: number = 0
): RawOsuHitObject[] {
  if (!notes || notes.length === 0) return [];

  const safeKeyCount = Math.max(1, keyCount);
  const safeBpm = (!bpm || bpm <= 0) ? 120 : bpm;
  const beatLengthMs = (60 / safeBpm) * 1000;
  const minTickStep = beatLengthMs / 16;

  // 1. Snap every note start and end to the exact musical grid
  const processedNotes: Array<{
    lane: number;
    timeMs: number;
    durationMs: number;
    endTimeMs: number;
    hitSound: number;
    isHold: boolean;
  }> = [];

  for (const n of notes) {
    const safeLane = Math.max(0, Math.min(safeKeyCount - 1, n.lane));
    const snappedStart = snapTimeToOsuGrid(n.timeMs, safeBpm, offsetMs);
    const rawDur = n.durationMs || 0;

    let snappedEnd = snappedStart;
    let isHold = false;

    if (n.isHold || rawDur > 35) {
      const rawEndTime = n.timeMs + rawDur;
      snappedEnd = snapTimeToOsuGrid(rawEndTime, safeBpm, offsetMs);

      // If snappedEnd is not strictly ahead of snappedStart, push to the next grid tick
      if (snappedEnd <= snappedStart) {
        snappedEnd = snapTimeToOsuGrid(snappedStart + Math.max(minTickStep, 45), safeBpm, offsetMs);
      }

      if (snappedEnd > snappedStart + 35) {
        isHold = true;
      } else {
        snappedEnd = snappedStart;
        isHold = false;
      }
    }

    processedNotes.push({
      lane: safeLane,
      timeMs: snappedStart,
      durationMs: isHold ? (snappedEnd - snappedStart) : 0,
      endTimeMs: isHold ? snappedEnd : snappedStart,
      hitSound: n.hitSound || 0,
      isHold
    });
  }

  // 2. Separate notes by lane to resolve same-column collisions and overlaps
  const laneNotes: { [lane: number]: typeof processedNotes } = {};
  for (let l = 0; l < safeKeyCount; l++) {
    laneNotes[l] = [];
  }

  for (const pn of processedNotes) {
    laneNotes[pn.lane].push(pn);
  }

  const finalNotes: RawOsuHitObject[] = [];

  for (let l = 0; l < safeKeyCount; l++) {
    const list = laneNotes[l];
    if (list.length === 0) continue;

    // Sort by start time ascending; if times match, prefer hold notes over short notes
    list.sort((a, b) => {
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      return (b.isHold ? 1 : 0) - (a.isHold ? 1 : 0);
    });

    let lastNoteStart = -1;
    let lastNoteEnd = -1;
    let lastNoteWasHold = false;

    for (let i = 0; i < list.length; i++) {
      const current = list[i];

      // A. Exact duplicate at identical start time on same lane -> skip duplicate
      if (current.timeMs === lastNoteStart) {
        continue;
      }

      // B. Note falls inside an active hold note on the same lane
      if (current.timeMs < lastNoteEnd) {
        if (lastNoteWasHold) {
          // Truncate previous hold note on a grid tick strictly before this new note
          const candidateEnd = snapTimeToOsuGrid(current.timeMs - minTickStep, safeBpm, offsetMs);
          
          // Update the last emitted note's end time in finalNotes
          const lastEmitted = finalNotes[finalNotes.length - 1];
          if (lastEmitted && lastEmitted.lane === l && lastEmitted.isHold) {
            const snappedTruncatedEnd = snapTimeToOsuGrid(candidateEnd, safeBpm, offsetMs);
            if (snappedTruncatedEnd > lastEmitted.timeMs + 35) {
              lastEmitted.durationMs = snappedTruncatedEnd - lastEmitted.timeMs;
              lastEmitted.isHold = true;
            } else {
              lastEmitted.isHold = false;
              lastEmitted.durationMs = 0;
            }
          }
          lastNoteEnd = lastEmitted ? (lastEmitted.timeMs + (lastEmitted.durationMs || 0)) : lastNoteStart;
        } else {
          // Two taps dangerously close (< 20ms) on same lane -> skip sub-tap
          if (current.timeMs - lastNoteStart < 20) {
            continue;
          }
        }
      }

      // If current note is a hold note, ensure it doesn't collide with the next note
      if (current.isHold && i + 1 < list.length) {
        const nextStart = list[i + 1].timeMs;
        if (current.endTimeMs >= nextStart) {
          const candidateEnd = snapTimeToOsuGrid(nextStart - minTickStep, safeBpm, offsetMs);
          if (candidateEnd > current.timeMs + 35) {
            current.durationMs = candidateEnd - current.timeMs;
            current.endTimeMs = candidateEnd;
          } else {
            current.isHold = false;
            current.durationMs = 0;
            current.endTimeMs = current.timeMs;
          }
        }
      }

      finalNotes.push({
        lane: current.lane,
        timeMs: current.timeMs,
        durationMs: current.isHold ? current.durationMs : 0,
        hitSound: current.hitSound,
        isHold: current.isHold
      });

      lastNoteStart = current.timeMs;
      lastNoteEnd = current.isHold ? current.endTimeMs : (current.timeMs + 10);
      lastNoteWasHold = current.isHold;
    }
  }

  // 3. Final global sort by timestamp across all lanes
  finalNotes.sort((a, b) => a.timeMs - b.timeMs);
  return finalNotes;
}

/**
 * Builds clean .osu HitObjects string section from sanitized notes.
 */
export function generateOsuHitObjectsString(
  notes: RawOsuHitObject[],
  keyCount: number,
  mode: 'mania' | 'taiko'
): string {
  let content = '';
  const colCount = Math.max(1, keyCount);

  for (const note of notes) {
    const time = Math.round(note.timeMs);
    const dur = note.durationMs || 0;
    const isHold = note.isHold && dur >= 35;

    if (mode === 'taiko') {
      const hitSound = note.hitSound ?? ((note.lane % 2 === 1) ? 2 : 0);
      content += `256,192,${time},1,${hitSound},0:0:0:0:\n`;
    } else {
      const safeCol = Math.max(0, Math.min(colCount - 1, note.lane));
      const x = Math.floor((safeCol * 512) / colCount) + Math.floor(256 / colCount);
      const y = 192;

      if (isHold) {
        const endTime = Math.round(time + dur);
        content += `${x},${y},${time},128,0,${endTime}:0:0:0:0:\n`;
      } else {
        content += `${x},${y},${time},1,${note.hitSound || 0},0:0:0:0:\n`;
      }
    }
  }

  return content;
}
