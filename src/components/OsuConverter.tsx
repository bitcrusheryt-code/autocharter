import { convertOsuToLlpFolder } from '../lib/llpConverter';
import { sanitizeOsuHitObjects, generateOsuHitObjectsString, RawOsuHitObject } from '../lib/osuTimingSanitizer';
import React, { useState } from 'react';
import JSZip from 'jszip';
import { exportFile } from '../lib/fileExport';
import { Upload, Download, RefreshCw, AlertCircle, Music, Layers } from 'lucide-react';
import { motion } from 'motion/react';

export default function OsuConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [maxDetectedKeys, setMaxDetectedKeys] = useState<number | null>(null);

  
  const [inputFormat, setInputFormat] = useState<'typo' | 'osu' | 'fnf' | null>(null);
  const [targetFormat, setTargetFormat] = useState<'typo' | 'mania' | 'taiko' | 'fnf'>('mania');

  const [available4KDiffs, setAvailable4KDiffs] = useState<Array<{ version: string; fileKey: string }>>([]);
  const [selected4KDiff, setSelected4KDiff] = useState<string>('');

  const addLog = (msg: string) => {
    setLog(prev => [...prev, msg]);
  };

  const handleConvert = async () => {
    if (!file || !inputFormat) return;
    setIsProcessing(true);
    setLog([]);
    addLog(`Starting conversion: ${inputFormat} -> ${targetFormat}`);
    
    try {
      if (inputFormat === 'fnf') {
        await convertFnfToOsu(file, audioFile);
      } else if (inputFormat === 'typo') {
        if (targetFormat === 'typo') {
          addLog('Source and target are both Lightners Live + (.llmap / .zip). Nothing to convert.');
        } else if (targetFormat === 'fnf') {
          await convertOsuToFnf(file, selected4KDiff);
        } else {
          await convertTypoToOsu(file, targetFormat);
        }
      } else if (inputFormat === 'osu') {
        if (targetFormat === 'typo') {
          await convertOsuToTypo(file);
        } else if (targetFormat === 'fnf') {
          await convertOsuToFnf(file, selected4KDiff);
        } else {
          await convertOsuToOsu(file, targetFormat);
        }
      } else if (inputFormat === 'sonolus') {
        addLog('Sonolus level files are output-only.');
      }
      addLog('[SUCCESS] Conversion completed successfully!');
    } catch (e: any) {
      console.error(e);
      addLog(`[ERROR] Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const convertFnfToOsu = async (fnfFile: File, songAudio: File | null) => {
    let fnfText = '';
    if (fnfFile.name.toLowerCase().endsWith('.json')) {
      fnfText = await fnfFile.text();
    } else {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(fnfFile);
      for (const rel in loadedZip.files) {
        if (rel.toLowerCase().endsWith('.json') && !rel.toLowerCase().includes('package')) {
          fnfText = await loadedZip.files[rel].async('text');
          break;
        }
      }
    }

    if (!fnfText) {
      throw new Error("Could not read FNF JSON chart file.");
    }

    let fnfJson: any;
    try {
      fnfJson = JSON.parse(fnfText);
    } catch (e) {
      throw new Error("Invalid FNF JSON format.");
    }

    const songObj = fnfJson.song || fnfJson;
    const title = songObj.song || fnfFile.name.replace(/\.[^/.]+$/, "");
    const bpm = songObj.bpm || 120;
    const notesSections = songObj.notes || [];

    const rawOsuNotes: Array<{ x: number; time: number; holdMs: number }> = [];

    notesSections.forEach((sec: any) => {
      const secNotes = sec.sectionNotes || [];
      secNotes.forEach((n: any) => {
        if (!Array.isArray(n) || n.length < 2) return;
        const timeMs = Math.round(n[0]);
        const rawNoteData = Math.floor(n[1]);
        if (isNaN(rawNoteData) || rawNoteData < 0) return;

        const noteData = rawNoteData % 4; // 0=Left, 1=Down, 2=Up, 3=Right
        const holdMs = Math.round(n[2] || 0);

        // Map noteData 0..3 directly to 4K osu!mania x positions: 64, 192, 320, 448
        const x = Math.floor((noteData * 512) / 4) + 64;
        rawOsuNotes.push({ x, time: timeMs, holdMs: holdMs > 20 ? holdMs : 0 });
      });
    });

    rawOsuNotes.sort((a, b) => a.time - b.time || b.holdMs - a.holdMs);

    // Filter out duplicate sub-notes that fall inside hold notes on the same column
    const osuNotes: Array<{ x: number; time: number; holdMs: number }> = [];
    const activeHoldUntilByCol: { [x: number]: number } = {};

    rawOsuNotes.forEach((n) => {
      const lastHoldEnd = activeHoldUntilByCol[n.x] || 0;
      if (lastHoldEnd > 0 && n.time > lastHoldEnd - (n.holdMs > 0 ? n.holdMs : 0) && n.time < lastHoldEnd - 20) {
        // Skip sub-note inside an existing hold
        return;
      }

      const isDuplicate = osuNotes.some(existing => existing.x === n.x && Math.abs(existing.time - n.time) < 10);
      if (isDuplicate) return;

      if (n.holdMs > 20) {
        activeHoldUntilByCol[n.x] = Math.max(activeHoldUntilByCol[n.x] || 0, n.time + n.holdMs);
      }

      osuNotes.push(n);
    });

    const audioName = songAudio ? songAudio.name : 'audio.mp3';

    let osuContent = `osu file format v14\n\n[General]\nAudioFilename: ${audioName}\nAudioLeadIn: 0\nPreviewTime: 0\nMode: 3\n\n[Metadata]\nTitle:${title}\nTitleUnicode:${title}\nArtist:FNF\nArtistUnicode:FNF\nCreator:Auto-Charter AI\nVersion:4K FNF\n\n[Events]\n//Background and Video events\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:5\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n0,${(60000 / bpm).toFixed(2)},4,1,0,100,1,0\n\n[HitObjects]\n`;

    osuNotes.forEach((n) => {
      if (n.holdMs > 20) {
        osuContent += `${n.x},192,${n.time},128,0,${n.time + n.holdMs}:0:0:0:\n`;
      } else {
        osuContent += `${n.x},192,${n.time},1,0,0:0:0:0:\n`;
      }
    });

    const oszZip = new JSZip();
    const cleanName = title.toLowerCase().replace(/[^a-z0-9]/g, '_');
    oszZip.file(`${cleanName} [4K FNF].osu`, osuContent);

    if (songAudio) {
      oszZip.file(audioName, await songAudio.arrayBuffer());
      addLog(`Attached song audio: ${songAudio.name}`);
    } else {
      addLog(`[WARNING] No audio file attached. (You can select an MP3/WAV/OGG above)`);
    }

    const content = await oszZip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    await exportFile(content, `${cleanName}.osz`);
    addLog(`[SUCCESS] Exported 4K osu!mania mapset: ${cleanName}.osz`);
  };



  const convertTypoToOsu = async (zipFile: File, targetOsuMode: 'mania' | 'taiko') => {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(zipFile);
    
    // Find map-info.json
    let mapInfoFile = null;
    let rootPath = '';
    
    for (const relativePath in loadedZip.files) {
      if (relativePath.endsWith('map-info.json')) {
        mapInfoFile = loadedZip.files[relativePath];
        rootPath = relativePath.replace('map-info.json', '');
        break;
      }
    }
    
    if (!mapInfoFile) throw new Error("Could not find map-info.json in the zip file.");
    
    const mapInfoText = await mapInfoFile.async('text');
    const mapInfo = JSON.parse(mapInfoText);
    
    addLog(`Found Lightners Live + level: ${mapInfo.songInfo?.title || 'Unknown'}`);
    
    // We already parsed keys in onChange, but we'll use targetOsuMode directly
    const oszZip = new JSZip();
    let audioExt = mapInfo.audioFile ? mapInfo.audioFile.split('.').pop() : 'mp3';
    let audioFileName = `audio.${audioExt}`;
    
    // Copy audio
    if (mapInfo.audioFile) {
      const audioFileData = loadedZip.files[rootPath + mapInfo.audioFile];
      if (audioFileData) {
        oszZip.file(audioFileName, await audioFileData.async('blob'));
        addLog(`Copied audio file: ${mapInfo.audioFile}`);
      }
    }
    
    // Copy bg
    let bgFileName = '';
    if (mapInfo.backgrounds && mapInfo.backgrounds.length > 0) {
      const bgPath = mapInfo.backgrounds[0].file;
      const bgFileData = loadedZip.files[rootPath + bgPath];
      if (bgFileData) {
        bgFileName = bgPath.split('/').pop() || 'bg.jpg';
        oszZip.file(bgFileName, await bgFileData.async('blob'));
        addLog(`Copied background: ${bgPath}`);
      }
    }
    
    // Convert difficulties
    for (const diff of mapInfo.difficulties) {
      const diffFileData = loadedZip.files[rootPath + diff.file];
      if (!diffFileData) continue;
      
      const diffDataText = await diffFileData.async('text');
      const diffData = JSON.parse(diffDataText);
      
      const title = mapInfo.songInfo?.title || 'Unknown';
      const artist = mapInfo.songInfo?.artist || 'Unknown';
      const creator = 'Lightners Live + Converter';
      const version = diff.name || `Diff ${diff.difficulty}`;
      
      let osuContent = `osu file format v14

[General]
AudioFilename: ${audioFileName}
AudioLeadIn: 0
PreviewTime: ${Math.floor((mapInfo.previewTime || 0) * 1000)}
Mode: ${targetOsuMode === 'taiko' ? '1' : '3'}

[Metadata]
Title:${title}
TitleUnicode:${title}
Artist:${artist}
ArtistUnicode:${artist}
Creator:${creator}
Version:${version}

[Events]
//Background and Video events
0,0,"${bgFileName}",0,0

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,1,0,100,1,0

[HitObjects]
`;

      // Extract unique keys to map them to columns
      const events = diffData.events || [];
      const keys = new Set<string>();
      events.forEach((e: any) => {
        if (e.n === 'key' && e.d && e.d.i) keys.add(e.d.i);
      });
      const keysArray = Array.from(keys);
      const colCount = Math.max(1, keysArray.length);
      
      // Update CircleSize (Key count)
      osuContent = osuContent.replace('CircleSize:4', `CircleSize:${colCount}`);
      
      const rawOsuNotes: RawOsuHitObject[] = [];
      events.forEach((e: any) => {
        if (e.n === 'key' && e.d && e.d.i) {
          const colIndex = keysArray.indexOf(e.d.i);
          const durSec = e.d?.duration || 0;
          const durMs = durSec > 0.035 ? Math.round(durSec * 1000) : 0;
          const hitSound = (colIndex % 2 === 1) ? 2 : 0;
          rawOsuNotes.push({
            lane: colIndex,
            timeMs: Math.round(e.t * 1000),
            durationMs: durMs,
            hitSound,
            isHold: durMs > 35
          });
        }
      });
      
      const sanitized = sanitizeOsuHitObjects(rawOsuNotes, colCount, 120, 0);
      osuContent += generateOsuHitObjectsString(sanitized, colCount, targetOsuMode === 'taiko' ? 'taiko' : 'mania');
      
      const osuFileName = `${artist} - ${title} (${creator}) [${version}].osu`;
      oszZip.file(osuFileName, osuContent);
      addLog(`Converted difficulty ${version} (${sanitized.length} notes, ${colCount} keys)`);
    }
    
    const content = await oszZip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    const finalName = `${mapInfo.songInfo?.artist || 'Unknown'} - ${mapInfo.songInfo?.title || 'IrisLevel'}.osz`;
    await exportFile(content, finalName);
  };

  const convertOsuToTypo = async (oszFile: File) => {
    const llpZip = await convertOsuToLlpFolder(oszFile, addLog);
    const content = await llpZip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    const rootName = oszFile.name.replace(/\.(osz|zip)$/i, '');
    await exportFile(content, `${rootName}.zip`);
  };

  const convertOsuToOsu = async (oszFile: File, targetOsuMode: 'mania' | 'taiko') => {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(oszFile);
    const newZip = new JSZip();

    for (const relativePath in loadedZip.files) {
      if (!relativePath.endsWith('.osu')) {
        newZip.file(relativePath, await loadedZip.files[relativePath].async('blob'));
      }
    }

    let count = 0;
    for (const relativePath in loadedZip.files) {
      if (relativePath.endsWith('.osu')) {
        const osuText = await loadedZip.files[relativePath].async('text');
        const diffInfo = parseOsuFile(osuText);
        
        let osuContent = `osu file format v14\n\n[General]\nAudioFilename: ${diffInfo.audioFile}\nAudioLeadIn: 0\nPreviewTime: 0\nMode: ${targetOsuMode === 'taiko' ? '1' : '3'}\n\n[Metadata]\nTitle:${diffInfo.title}\nTitleUnicode:${diffInfo.title}\nArtist:${diffInfo.artist}\nArtistUnicode:${diffInfo.artist}\nCreator:${diffInfo.creator}\nVersion:${diffInfo.version} (${targetOsuMode})\n\n[Events]\n//Background and Video events\n`;
        if (diffInfo.bgFile) {
          osuContent += `0,0,"${diffInfo.bgFile}",0,0\n`;
        }
        
        const outCircleSize = targetOsuMode === 'taiko' ? 4 : diffInfo.circleSize;
        osuContent += `\n[Difficulty]\nHPDrainRate:5\nCircleSize:${outCircleSize}\nOverallDifficulty:5\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n0,500,4,1,0,100,1,0\n\n[HitObjects]\n`;

        const rawNotes: RawOsuHitObject[] = diffInfo.notes.map((note: any) => {
          let hitSound = 0;
          let lane = 0;
          if (targetOsuMode === 'taiko') {
            if (diffInfo.mode === 1) {
              hitSound = note.hitSound;
            } else {
              const col = Math.min(diffInfo.circleSize - 1, Math.max(0, Math.floor((note.x * diffInfo.circleSize) / 512)));
              hitSound = (col % 2 === 1) ? 2 : 0;
            }
          } else {
            if (diffInfo.mode === 1) {
              const isKat = (note.hitSound & 2) || (note.hitSound & 8);
              lane = isKat ? 1 : 0;
            } else {
              lane = Math.min(outCircleSize - 1, Math.max(0, Math.floor((note.x * outCircleSize) / 512)));
            }
          }
          return {
            lane,
            timeMs: note.time,
            durationMs: note.endTime ? (note.endTime - note.time) : 0,
            hitSound,
            isHold: !!note.endTime && note.endTime > note.time
          };
        });

        const sanitized = sanitizeOsuHitObjects(rawNotes, outCircleSize, diffInfo.bpm || 120, diffInfo.offset || 0);
        osuContent += generateOsuHitObjectsString(sanitized, outCircleSize, targetOsuMode === 'taiko' ? 'taiko' : 'mania');
        
        newZip.file(relativePath.replace('.osu', `_${targetOsuMode}.osu`), osuContent);
        count++;
        addLog(`Converted difficulty: ${diffInfo.version} -> ${targetOsuMode}`);
      }
    }
    
    if (count === 0) throw new Error("No .osu files found to convert.");
    
    const content = await newZip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    await exportFile(content, oszFile.name.replace('.osz', `_${targetOsuMode}.osz`));
  };

  const convertOsuToFnf = async (oszFile: File, chosenDiffVersion?: string) => {
    let osuTextToProcess = '';
    let titleToUse = 'Song';
    let versionToUse = 'Normal';

    if (oszFile.name.toLowerCase().endsWith('.osu')) {
      osuTextToProcess = await oszFile.text();
      const diffInfo = parseOsuFile(osuTextToProcess);
      titleToUse = diffInfo.title || 'Song';
      versionToUse = diffInfo.version || 'Normal';
    } else {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(oszFile);

      let foundEntry = null;
      for (const relativePath in loadedZip.files) {
        if (relativePath.toLowerCase().endsWith('.osu')) {
          const text = await loadedZip.files[relativePath].async('text');
          const diffInfo = parseOsuFile(text);

          if (chosenDiffVersion && diffInfo.version === chosenDiffVersion) {
            osuTextToProcess = text;
            titleToUse = diffInfo.title || 'Song';
            versionToUse = diffInfo.version || 'Normal';
            foundEntry = relativePath;
            break;
          }

          if (!foundEntry && (!diffInfo.circleSize || diffInfo.circleSize === 4)) {
            osuTextToProcess = text;
            titleToUse = diffInfo.title || 'Song';
            versionToUse = diffInfo.version || 'Normal';
            foundEntry = relativePath;
          }
        }
      }
    }

    if (!osuTextToProcess) {
      throw new Error("No 4K difficulty found in this file.");
    }

    const diffInfo = parseOsuFile(osuTextToProcess);
    const cleanName = titleToUse.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const diffVersion = versionToUse.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const songBpm = diffInfo.bpm || 120;
    const colCount = 4;
    const stepCrochet = (60 / songBpm) * 1000 / 4;
    const sectionCrochet = stepCrochet * 16;

    const fnfSections: any[] = [];
    const totalTimeMs = diffInfo.notes.length > 0 ? diffInfo.notes[diffInfo.notes.length - 1].time + 5000 : 180000;
    const totalSections = Math.ceil(totalTimeMs / sectionCrochet) || 1;

    for (let s = 0; s < totalSections; s++) {
      fnfSections.push({
        sectionNotes: [],
        lengthInSteps: 16,
        typeOfSection: 0,
        mustHitSection: true,
        bpm: songBpm,
        changeBPM: false,
        altAnim: false
      });
    }

    // Direct 1:1 note conversion with duplicate sub-note filtering
    const activeHoldUntilByCol: { [col: number]: number } = {};
    const sortedNotes = [...diffInfo.notes].sort((a: any, b: any) => a.time - b.time);

    sortedNotes.forEach((note: any) => {
      const colIndex = Math.min(3, Math.max(0, Math.floor((note.x * colCount) / 512)));
      const noteData = colIndex; // 0=Left, 1=Down, 2=Up, 3=Right
      const timeMs = Math.round(note.time);
      const holdMs = note.endTime ? Math.round(note.endTime - note.time) : 0;

      const lastHoldEnd = activeHoldUntilByCol[colIndex] || 0;
      if (lastHoldEnd > 0 && timeMs > lastHoldEnd - (holdMs > 0 ? holdMs : 0) && timeMs < lastHoldEnd - 20) {
        // Skip sub-note falling inside active hold
        return;
      }

      if (holdMs > 20) {
        activeHoldUntilByCol[colIndex] = Math.max(activeHoldUntilByCol[colIndex] || 0, timeMs + holdMs);
      }

      const sectionIdx = Math.floor(timeMs / sectionCrochet);
      if (sectionIdx >= 0 && sectionIdx < fnfSections.length) {
        fnfSections[sectionIdx].sectionNotes.push([timeMs, noteData, holdMs > 20 ? holdMs : 0]);
      }
    });

    const fnfChart = {
      song: {
        song: titleToUse,
        bpm: songBpm,
        speed: 2.2,
        player1: "bf",
        player2: "dad",
        player3: null,
        gfVersion: "gf",
        stage: "stage",
        needsVoices: false,
        validScore: true,
        notes: fnfSections
      }
    };

    const jsonBlob = new Blob([JSON.stringify(fnfChart, null, 2)], { type: 'application/json' });
    const fileName = `${cleanName}_${diffVersion}.json`;
    await exportFile(jsonBlob, fileName);
    addLog(`[SUCCESS] Exported FNF JSON chart: ${fileName}`);
  };

  const parseOsuFile = (text: string) => {
    const lines = text.split('\n');
    const diffInfo: any = {
      title: 'Unknown',
      artist: 'Unknown',
      creator: 'Unknown',
      version: 'Normal',
      audioFile: '',
      bgFile: '',
      circleSize: 4,
      mode: 3,
      bpm: undefined,
      notes: []
    };
    
    let currentSection = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      
      if (trimmed.startsWith('[')) {
        currentSection = trimmed;
        continue;
      }
      
      if (currentSection === '[General]') {
        if (trimmed.startsWith('AudioFilename:')) diffInfo.audioFile = trimmed.split(':')[1].trim();
        else if (trimmed.startsWith('Mode:')) diffInfo.mode = parseInt(trimmed.split(':')[1].trim());
      } else if (currentSection === '[Metadata]') {
        if (trimmed.startsWith('Title:')) diffInfo.title = trimmed.split(':')[1].trim();
        else if (trimmed.startsWith('Artist:')) diffInfo.artist = trimmed.split(':')[1].trim();
        else if (trimmed.startsWith('Creator:')) diffInfo.creator = trimmed.split(':')[1].trim();
        else if (trimmed.startsWith('Version:')) diffInfo.version = trimmed.split(':')[1].trim();
      } else if (currentSection === '[Events]') {
        if (trimmed.startsWith('0,0,') || trimmed.startsWith('0, 0,')) {
          const parts = trimmed.split(',');
          if (parts.length >= 3) diffInfo.bgFile = parts[2].replace(/"/g, '');
        }
      } else if (currentSection === '[Difficulty]') {
        if (trimmed.startsWith('CircleSize:')) diffInfo.circleSize = parseInt(trimmed.split(':')[1].trim());
      } else if (currentSection === '[TimingPoints]') {
        const parts = trimmed.split(',');
        if (parts.length >= 2) {
          const beatLength = parseFloat(parts[1]);
          if (beatLength > 0 && !diffInfo.bpm) {
            diffInfo.offset = parseFloat(parts[0]) || 0;
            diffInfo.bpm = Math.round(60000 / beatLength);
          }
        }
      } else if (currentSection === '[HitObjects]') {
        const parts = trimmed.split(',');
        if (parts.length >= 3) {
          const x = parseInt(parts[0]);
          const y = parseInt(parts[1]);
          const time = parseInt(parts[2]);
          const type = parseInt(parts[3] || '1');
          const hitSound = parseInt(parts[4] || '0');
          let endTime: number | undefined = undefined;

          // Check if hold note (osu!mania hitobject type bit 128 set)
          const isHold = (type & 128) !== 0;
          if (isHold && parts.length >= 6) {
            const endVal = parseInt(parts[5].split(':')[0]);
            if (!isNaN(endVal) && endVal > time) {
              endTime = endVal;
            }
          }

          diffInfo.notes.push({
            x,
            y,
            time,
            type,
            hitSound,
            endTime
          });
        }
      }
    }
    
    return diffInfo;
  };

  return (
    <div className="glass-panel p-6 md:p-8 rounded-3xl space-y-8">
      <div className="space-y-1.5">
        <h2 className="text-xl sm:text-2xl font-bold text-zinc-100 flex items-center gap-3 uppercase tracking-tight">
          <RefreshCw className="w-5 h-5 text-indigo-400" />
          Format Converter
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400">
          Convert levels between Lightners Live + (.llmap / .zip), osu!mania (.osz), and osu!taiko (.osz).
        </p>
      </div>

      <div className="space-y-6">
        <div className="glass-card p-6 rounded-2xl border-dashed border-white/20">
          <label className="flex flex-col items-center justify-center cursor-pointer space-y-3">
            <div className="w-12 h-12 glass-card rounded-2xl flex items-center justify-center text-indigo-400">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-center">
              <span className="text-zinc-200 font-semibold block text-sm">
                {file ? file.name : 'Upload Lightners Live + (.llmap / .zip) or osu! (.osz)'}
              </span>
              <span className="text-zinc-400 text-xs mt-1 block">
                {inputFormat ? `Detected format: ${inputFormat === 'typo' ? 'Lightners Live +' : 'osu!'}` : 'Click to browse or drop file'}
              </span>
            </div>
            <input 
              type="file" 
              className="hidden" 
              accept=".zip,.osz,.osu,.json,.scp,.llmap"
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  const f = e.target.files[0];
                  const lowerName = f.name.toLowerCase();
                  setFile(f);
                  setAudioFile(null);
                  setLog([]);
                  setMaxDetectedKeys(null);
                  setAvailable4KDiffs([]);
                  setSelected4KDiff('');

                  if (lowerName.endsWith('.json')) {
                    setInputFormat('fnf');
                    setTargetFormat('mania');
                  } else if (lowerName.endsWith('.osu')) {
                    setInputFormat('osu');
                    setTargetFormat('fnf');
                    try {
                      const text = await f.text();
                      const diffInfo = parseOsuFile(text);
                      if (!diffInfo.circleSize || diffInfo.circleSize === 4) {
                        const item = { version: diffInfo.version || 'Normal', fileKey: f.name };
                        setAvailable4KDiffs([item]);
                        setSelected4KDiff(item.version);
                      }
                    } catch (err) {
                      console.error('Error parsing .osu:', err);
                    }
                  } else if (lowerName.endsWith('.osz') || lowerName.endsWith('.zip')) {
                    try {
                      const zip = new JSZip();
                      const loadedZip = await zip.loadAsync(f);
                      let hasMapInfo = false;
                      let hasLevelData = false;
                      let isFnfZip = false;
                      const found4K: Array<{ version: string; fileKey: string }> = [];

                      for (const relativePath in loadedZip.files) {
                        const relLower = relativePath.toLowerCase();
                        if (relLower.endsWith('map-info.json')) hasMapInfo = true;
                        if (relLower.endsWith('leveldata.json')) hasLevelData = true;
                        if (relLower.endsWith('.json') && !relLower.includes('package') && !hasMapInfo && !hasLevelData) {
                          isFnfZip = true;
                        }

                        if (relLower.endsWith('.osu')) {
                          const text = await loadedZip.files[relativePath].async('text');
                          const diffInfo = parseOsuFile(text);
                          if (!diffInfo.circleSize || diffInfo.circleSize === 4) {
                            found4K.push({
                              version: diffInfo.version || relativePath.replace('.osu', ''),
                              fileKey: relativePath
                            });
                          }
                        }
                      }

                      if (hasMapInfo) {
                        setInputFormat('typo');
                        setTargetFormat('mania');
                      } else if (hasLevelData) {
                        setInputFormat('sonolus');
                        setTargetFormat('mania');
                      } else if (isFnfZip && found4K.length === 0) {
                        setInputFormat('fnf');
                        setTargetFormat('mania');
                      } else {
                        setInputFormat('osu');
                        setTargetFormat('mania');
                        setAvailable4KDiffs(found4K);
                        if (found4K.length > 0) {
                          setSelected4KDiff(found4K[0].version);
                        }
                      }
                    } catch (err) {
                      console.error('Zip parse error:', err);
                      setInputFormat('osu');
                      setTargetFormat('fnf');
                    }
                  } else {
                    setInputFormat(null);
                  }
                }
              }}
            />
          </label>
        </div>

        {inputFormat === 'fnf' && (
          <div className="glass-card p-4 rounded-2xl space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Music className="w-4 h-4 text-indigo-400" />
              Audio Track (.mp3, .ogg, .wav) [Required for .osz]:
            </label>
            <input 
              type="file" 
              accept=".mp3,.ogg,.wav"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30 cursor-pointer"
            />
          </div>
        )}

        {inputFormat === 'osu' && targetFormat === 'fnf' && (
          <div>
            {available4KDiffs.length > 1 ? (
              <div className="glass-card p-4 rounded-2xl space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  Select 4K Difficulty to convert:
                </label>
                <select
                  value={selected4KDiff}
                  onChange={(e) => setSelected4KDiff(e.target.value)}
                  className="w-full glass-input text-zinc-200 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none"
                >
                  {available4KDiffs.map((d) => (
                    <option key={d.version} value={d.version} className="bg-zinc-900 text-zinc-200">
                      {d.version} (4K)
                    </option>
                  ))}
                </select>
              </div>
            ) : available4KDiffs.length === 1 ? (
              <div className="glass-card p-3.5 rounded-xl text-xs text-indigo-300 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                4K Difficulty detected: <strong>{available4KDiffs[0].version}</strong>
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                No 4K difficulties detected in this beatmap.
              </div>
            )}
          </div>
        )}

        {inputFormat && (
          <div className="glass-card p-5 rounded-2xl space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Output Format Options
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <button
                onClick={() => setTargetFormat('fnf')}
                className={`py-3 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer border ${targetFormat === 'fnf' ? 'bg-indigo-600/90 text-white border-white/20 shadow-md' : 'glass-card-interactive text-zinc-300'}`}
              >
                FNF (.json)
              </button>
              <button
                onClick={() => setTargetFormat('typo')}
                className={`py-3 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer border ${targetFormat === 'typo' ? 'bg-indigo-600/90 text-white border-white/20 shadow-md' : 'glass-card-interactive text-zinc-300'}`}
              >
                Lightners Live + (.llmap / .zip)
              </button>
              <button
                onClick={() => setTargetFormat('mania')}
                className={`py-3 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer border ${targetFormat === 'mania' ? 'bg-indigo-600/90 text-white border-white/20 shadow-md' : 'glass-card-interactive text-zinc-300'}`}
              >
                osu!mania (.osz)
              </button>
              <button
                onClick={() => setTargetFormat('taiko')}
                className={`py-3 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer border ${targetFormat === 'taiko' ? 'bg-indigo-600/90 text-white border-white/20 shadow-md' : 'glass-card-interactive text-zinc-300'}`}
              >
                osu!taiko (.osz)
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleConvert}
          disabled={!file || !inputFormat || isProcessing}
          className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-semibold text-sm rounded-md flex justify-center items-center gap-2 transition-colors cursor-pointer border border-amber-400"
        >
          {isProcessing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Convert & Download</span>
            </>
          )}
        </button>

        {log.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="glass-card rounded-2xl p-4 overflow-hidden"
          >
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2.5">Conversion Log</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-xs text-zinc-300">
              {log.map((msg, i) => (
                <div key={i} className={`${msg.startsWith('[ERROR]') ? 'text-red-400' : msg.startsWith('[SUCCESS]') ? 'text-emerald-400' : msg.startsWith('[WARNING]') ? 'text-amber-400' : ''}`}>
                  {msg}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <div className="glass-card p-4 rounded-2xl flex items-center gap-3 text-zinc-400 text-xs">
        <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0" />
        <p>Conversions preserve original audio and backgrounds across supported formats.</p>
      </div>
    </div>
  );
}
