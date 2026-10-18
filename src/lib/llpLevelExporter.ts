import { buildLlpMidi, MidiNote } from './midiBuilder';

export function createLlpLevelFiles({
  songTitle,
  artist,
  audioFileName,
  audioFile,
  bgFileName,
  bgFile,
  bpm,
  difficultyName = 'Hard',
  description = '',
  notes,
}: {
  songTitle: string;
  artist: string;
  audioFileName: string;
  audioFile: Blob | File;
  bgFileName?: string;
  bgFile?: Blob | File | null;
  bpm: number;
  offset?: number;
  difficultyName?: string;
  description?: string;
  notes: { timeInSec: number; durationInSec?: number; lane?: number; pitch?: number; trackIndex?: number }[];
}) {
  // Official pitch mapping for Lightners Live Plus:
  // Kris Left: 38 (D3)
  // Kris Right: 36 (C3)
  // Kris Left Hold: 39 (D#3)
  // Kris Right Hold: 35 (B2)
  const midiNotes: MidiNote[] = notes.map((n, idx) => {
    let pitch = n.pitch;
    if (pitch === undefined) {
      const isLeft = (n.lane !== undefined ? n.lane % 2 === 0 : idx % 2 === 0);
      const isHold = (n.durationInSec ?? 0.1) > 0.15;
      if (isHold) {
        pitch = isLeft ? 39 : 35;
      } else {
        pitch = isLeft ? 38 : 36;
      }
    }
    return {
      timeInSec: n.timeInSec,
      durationInSec: n.durationInSec ?? 0.1,
      pitch,
      trackIndex: n.trackIndex ?? 0,
    };
  });

  const midiBytes = buildLlpMidi(midiNotes, bpm);

  const folderName = songTitle.trim();
  const audioExt = audioFileName.split('.').pop() || 'mp3';
  const bgExt = bgFileName ? bgFileName.split('.').pop() : 'png';

  const metadataTxt = `Difficulty: ${difficultyName}\nDescription: ${description || 'Custom map created for Lightners Live +'}\nComposer: ${artist || 'Unknown Artist'}\nVolume: 0\nOrder: 320\nInheritScoreFromID: 67c13a1da41b8e59e6f06ad12637421b\n`;

  return {
    midiFileName: `${folderName}.mid`,
    midiBytes,
    metadataFileName: `${folderName}.txt`,
    metadataTxt,
    audioFileName: `${folderName}.${audioExt}`,
    audioFile,
    bgFileName: `${folderName}.${bgExt}`,
    bgFile,
  };
}
