import JSZip from 'jszip';
import { buildLlpMidi, MidiNote } from './midiBuilder';
import { convertAudioBufferToMp3 } from './audioToMp3';

export async function convertOsuToLlpFolder(oszFile: File, addLog: (msg: string) => void): Promise<JSZip> {
  const loadedZip = await new JSZip().loadAsync(oszFile);
  const folderName = oszFile.name.replace(/\.(osz|zip)$/i, '').trim();
  
  const llpZip = new JSZip();
  const root = llpZip;

  let songTitle = folderName;
  let artist = 'Unknown Artist';
  let audioFileName = '';
  let bgFileName = '';
  let highestDiffName = 'Hard';

  const diffs: any[] = [];
  
  for (const relativePath in loadedZip.files) {
    if (relativePath.endsWith('.osu')) {
      const text = await loadedZip.files[relativePath].async('text');
      const lines = text.split('\n');
      const diff: any = { notes: [], circleSize: 4, mode: 3 };
      let currentSec = '';

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
          currentSec = trimmed;
          return;
        }
        if (currentSec === '[General]') {
          if (trimmed.startsWith('AudioFilename:')) audioFileName = trimmed.split(':')[1].trim();
          if (trimmed.startsWith('Mode:')) diff.mode = parseInt(trimmed.split(':')[1].trim());
        } else if (currentSec === '[Metadata]') {
          if (trimmed.startsWith('Title:')) songTitle = trimmed.split(':')[1].trim();
          if (trimmed.startsWith('Artist:')) artist = trimmed.split(':')[1].trim();
          if (trimmed.startsWith('Version:')) diff.version = trimmed.split(':')[1].trim();
        } else if (currentSec === '[Events]') {
          if (trimmed.startsWith('0,0,') || trimmed.startsWith('0, 0,')) {
            const parts = trimmed.split(',');
            if (parts.length >= 3) bgFileName = parts[2].replace(/"/g, '').trim();
          }
        } else if (currentSec === '[Difficulty]') {
          if (trimmed.startsWith('CircleSize:')) diff.circleSize = parseInt(trimmed.split(':')[1].trim());
        } else if (currentSec === '[HitObjects]') {
          const parts = trimmed.split(',');
          if (parts.length >= 3) {
            const isHold = parts.length >= 6 && parts[5].includes(':');
            let holdDuration = 100;
            if (isHold) {
              const endTime = parseInt(parts[5].split(':')[0]);
              if (!isNaN(endTime) && endTime > parseInt(parts[2])) {
                holdDuration = endTime - parseInt(parts[2]);
              }
            }
            diff.notes.push({
              x: parseInt(parts[0]),
              time: parseInt(parts[2]),
              duration: holdDuration,
              isHold,
              hitSound: parseInt(parts[4] || '0')
            });
          }
        }
      });
      diffs.push(diff);
    }
  }

  if (diffs.length === 0) throw new Error("No .osu files found.");

  // Pick difficulty with most notes as main
  diffs.sort((a, b) => b.notes.length - a.notes.length);
  const mainDiff = diffs[0];
  if (mainDiff.version) highestDiffName = mainDiff.version;

  const files = Object.keys(loadedZip.files);

  // 1. Audio file - MUST BE MP3 for Lightners Live +
  let audioExt = 'mp3';
  if (audioFileName) {
    const audioMatch = files.find(f => f.toLowerCase() === audioFileName.toLowerCase());
    if (audioMatch) {
      const extMatch = audioFileName.match(/\.([a-z0-9]+)$/i);
      if (extMatch) audioExt = extMatch[1].toLowerCase();
      const audioBlob = await loadedZip.files[audioMatch].async('blob');
      
      if (audioExt === 'mp3') {
        root.file(`${folderName}.mp3`, audioBlob);
        addLog(`Extracted audio as: ${folderName}.mp3`);
      } else {
        addLog(`Converting ${audioFileName} to .mp3 format required by Lightners Live +...`);
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const mp3Blob = await convertAudioBufferToMp3(audioBuffer);
          root.file(`${folderName}.mp3`, mp3Blob);
          addLog(`Converted audio to MP3: ${folderName}.mp3`);
        } catch (err) {
          root.file(`${folderName}.${audioExt}`, audioBlob);
          addLog(`Saved audio as: ${folderName}.${audioExt}`);
        }
      }
    }
  }

  // 2. Copy background image and rename to <FolderName>.<ext>
  if (bgFileName) {
    const bgMatch = files.find(f => f.toLowerCase() === bgFileName.toLowerCase());
    if (bgMatch) {
      const extMatch = bgFileName.match(/\.([a-z0-9]+)$/i);
      const bgExt = extMatch ? extMatch[1].toLowerCase() : 'png';
      const bgBlob = await loadedZip.files[bgMatch].async('blob');
      root.file(`${folderName}.${bgExt}`, bgBlob);
      addLog(`Extracted thumbnail as: ${folderName}.${bgExt}`);
    }
  }

  // 3. Build MIDI (.mid) using official pitch values:
  // Left Note (KL): 38 (D3)
  // Right Note (KR): 36 (C3)
  // Left Hold Note: 39 (D#3)
  // Right Hold Note: 35 (B2)
  const midiNotes: MidiNote[] = mainDiff.notes.map((n: any) => {
    let lane = 0;
    if (mainDiff.mode === 1) { // Taiko
      const isKat = (n.hitSound & 2) || (n.hitSound & 8);
      lane = isKat ? 1 : 0;
    } else { // Mania
      lane = Math.min(mainDiff.circleSize - 1, Math.max(0, Math.floor((n.x * mainDiff.circleSize) / 512)));
    }

    const isLeft = (lane % 2 === 0);
    let pitch = 38; // Default Kris Left
    if (n.isHold || n.duration > 0) {
      pitch = isLeft ? 39 : 35; // Left Hold = 39, Right Hold = 35
    } else {
      pitch = isLeft ? 38 : 36; // Left = 38, Right = 36
    }

    return {
      timeInSec: n.time / 1000,
      durationInSec: Math.max(0.08, n.duration / 1000),
      pitch,
      trackIndex: 0 // Kris Track
    };
  });

  const midiBytes = buildLlpMidi(midiNotes, 120);
  root.file(`${folderName}.mid`, midiBytes);
  addLog(`Generated MIDI file: ${folderName}.mid (${midiNotes.length} notes)`);

  // 4. Create Metadata File: <FolderName>.txt
  const metadataTxt = `Difficulty: ${highestDiffName}\nDescription: Converted map for Lightners Live +\nComposer: ${artist}\nVolume: 0\nOrder: 320\nInheritScoreFromID: 67c13a1da41b8e59e6f06ad12637421b\n`;
  root.file(`${folderName}.txt`, metadataTxt);

  return llpZip;
}
