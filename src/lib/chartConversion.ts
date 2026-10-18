import type { ChartNote } from './chartParser';

export type TargetExportFormat = 'iric' | 'llplus' | 'mania' | 'taiko' | 'fnf';

export function convertChartNotes(
  notes: ChartNote[],
  sourceKeyCount: number,
  targetMode: TargetExportFormat,
  targetKeys: number,
  enableHoldNotes = true
): ChartNote[] {
    let resultNotes: ChartNote[] = [];

    notes.forEach(note => {
      let targetLane = 0;
      let noteType: ChartNote['type'] = (note.durationMs > 35 && enableHoldNotes) ? 'hold' : 'normal';

      if (targetMode === 'llplus') {
        // Lightners Live + uses 2 lanes: 0 (Kris Left) and 1 (Kris Right)
        if (sourceKeyCount <= 2) {
          targetLane = note.lane % 2;
        } else if (sourceKeyCount === 4) {
          // Left hand (0, 1) -> Left (0), Right hand (2, 3) -> Right (1)
          targetLane = note.lane < 2 ? 0 : 1;
        } else {
          // Multi-lane fold
          targetLane = note.lane % 2;
        }
      } else if (targetMode === 'taiko') {
        // Preserve explicit colors when converting an existing taiko chart.
        if (note.type === 'taiko_don' || note.type === 'taiko_kat') {
          targetLane = note.type === 'taiko_kat' ? 1 : 0;
          noteType = note.type;
        } else if (sourceKeyCount === 4) {
          targetLane = note.lane;
          noteType = (note.lane === 1 || note.lane === 2) ? 'taiko_don' : 'taiko_kat';
        } else {
          targetLane = note.lane % 4;
          noteType = (note.lane % 2 === 0) ? 'taiko_don' : 'taiko_kat';
        }
        // The player uses lane 0 for Don and lane 1 for Kat.
        targetLane = noteType === 'taiko_kat' ? 1 : 0;
      } else if (targetMode === 'fnf') {
        // FNF: 4 lanes (Left, Down, Up, Right)
        if (sourceKeyCount === 4) {
          targetLane = note.lane;
        } else {
          targetLane = note.lane % 4;
        }
      } else {
        // Mania (targetKeys)
        if (sourceKeyCount === targetKeys) {
          targetLane = note.lane;
        } else if (sourceKeyCount > targetKeys) {
          // Fold down cleanly
          targetLane = Math.floor((note.lane / sourceKeyCount) * targetKeys);
        } else {
          // Spread up
          targetLane = Math.floor((note.lane / Math.max(1, sourceKeyCount)) * targetKeys);
        }
        targetLane = Math.max(0, Math.min(targetKeys - 1, targetLane));
      }

      resultNotes.push({
        id: note.id || Math.random().toString(),
        timeMs: note.timeMs,
        lane: targetLane,
        durationMs: enableHoldNotes ? note.durationMs : 0,
        type: noteType,
        isOpponent: note.isOpponent
      });
    });

    // Remove direct duplicate collisions at the exact same millisecond and lane
    const seen = new Set<string>();
    resultNotes = resultNotes.filter(n => {
      const singer = targetMode === 'fnf' ? `_${!!n.isOpponent}` : '';
      const key = `${Math.round(n.timeMs / 10)}_${n.lane}${singer}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return resultNotes.sort((a, b) => a.timeMs - b.timeMs);
}

/** FNF lanes 0–3 belong to the section's primary singer. */
export function fnfNoteData(note: Pick<ChartNote, 'lane' | 'isOpponent'>): number {
  return (note.lane % 4) + (note.isOpponent ? 4 : 0);
}
