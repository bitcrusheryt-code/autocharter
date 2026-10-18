import type { ChartNote } from './chartParser';

export interface LlpSanitizationResult {
  notes: ChartNote[];
  droppedNotes: number;
  shortenedHolds: number;
}

/**
 * Lightners Live+ has two lanes. When a wider source chart is folded to two
 * lanes, notes can collide with holds that were valid on separate source lanes.
 * This pass assigns the preferred side from the source lane, tries the other
 * side when needed, and shortens the earliest active hold only as a last resort.
 */
export function sanitizeLlpNotes(
  sourceNotes: ChartNote[],
  sourceKeyCount: number,
  enableHoldNotes = true
): LlpSanitizationResult {
  const MIN_HOLD_MS = 150;
  const sourceLanes = Math.max(1, Math.floor(sourceKeyCount) || 1);
  const holdsUntil = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const holdNoteIndex = [-1, -1];
  const occupiedAtTime = new Map<number, Set<number>>();
  const notes: ChartNote[] = [];
  let droppedNotes = 0;
  let shortenedHolds = 0;

  const ordered = [...sourceNotes].sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);

  for (const sourceNote of ordered) {
    if (!Number.isFinite(sourceNote.timeMs) || !Number.isFinite(sourceNote.lane)) {
      droppedNotes++;
      continue;
    }

    const sourceLane = Math.max(0, Math.floor(sourceNote.lane));
    const preferredLane = sourceLanes <= 2
      ? sourceLane % 2
      : Math.min(1, Math.floor((sourceLane / sourceLanes) * 2));
    const timeMs = Math.round(sourceNote.timeMs);
    const occupied = occupiedAtTime.get(timeMs) || new Set<number>();
    occupiedAtTime.set(timeMs, occupied);

    const isAvailable = (lane: number) => !occupied.has(lane) && timeMs >= holdsUntil[lane];
    let targetLane = isAvailable(preferredLane)
      ? preferredLane
      : isAvailable(1 - preferredLane)
        ? 1 - preferredLane
        : -1;

    if (targetLane < 0) {
      const earliestLane = holdsUntil[0] <= holdsUntil[1] ? 0 : 1;
      const priorIndex = holdNoteIndex[earliestLane];
      const priorNote = priorIndex >= 0 ? notes[priorIndex] : undefined;

      if (priorNote && timeMs > priorNote.timeMs) {
        const remainingDuration = timeMs - priorNote.timeMs;
        priorNote.durationMs = remainingDuration > MIN_HOLD_MS ? remainingDuration : 0;
        priorNote.type = priorNote.durationMs > 35 ? 'hold' : 'normal';
        holdsUntil[earliestLane] = timeMs;
        holdNoteIndex[earliestLane] = -1;
        shortenedHolds++;
        targetLane = earliestLane;
      }
    }

    if (targetLane < 0 || occupied.has(targetLane)) {
      droppedNotes++;
      continue;
    }

    const durationMs = enableHoldNotes && sourceNote.durationMs > MIN_HOLD_MS
      ? Math.round(sourceNote.durationMs)
      : 0;
    const note: ChartNote = {
      ...sourceNote,
      timeMs,
      lane: targetLane,
      durationMs,
      type: durationMs > 0 ? 'hold' : 'normal'
    };
    notes.push(note);
    occupied.add(targetLane);

    if (durationMs > 0) {
      holdsUntil[targetLane] = timeMs + durationMs;
      holdNoteIndex[targetLane] = notes.length - 1;
    }
  }

  return { notes, droppedNotes, shortenedHolds };
}
