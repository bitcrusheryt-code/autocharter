import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  Music, 
  ArrowRight, 
  Sparkles, 
  Play, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Sliders, 
  Layers, 
  FolderArchive,
  Gamepad2,
  HelpCircle,
  Clock,
  ShieldCheck,
  Disc3,
  SlidersHorizontal,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { exportFile, canShareFile, shareFile } from '../lib/fileExport';
import { parseUniversalChart, ParsedChart, DifficultyOption, ChartNote } from '../lib/chartParser';
import { createIricPackageBlob } from '../lib/iricFormat';
import { applyIrisFase4Corrections } from '../lib/irisOptimizer';
import { sanitizeOsuHitObjects, generateOsuHitObjectsString, RawOsuHitObject } from '../lib/osuTimingSanitizer';
import { buildLlpMidi, MidiNote } from '../lib/midiBuilder';
import { convertAudioBufferToMp3 } from '../lib/audioToMp3';
import { convertChartNotes, fnfNoteData, type TargetExportFormat } from '../lib/chartConversion';
import { sanitizeLlpNotes } from '../lib/llplusSanitizer';

interface UniversalConverterProps {
  onBackToMenu: () => void;
  onGoToAutocharter: () => void;
  onGoToPlay: () => void;
  onPlayChart?: (chart: ParsedChart) => void;
  onSaveToLibrary?: (blob: Blob, name: string, title: string, artist: string, format: string) => Promise<void>;
}

export type { TargetExportFormat } from '../lib/chartConversion';

const targetFormats: { id: TargetExportFormat; label: string; ext: string; badge: string; color: string }[] = [
  { id: 'iric', label: 'Iris Package', ext: '.iric', badge: 'Native', color: '#c4cedb' },
  { id: 'llplus', label: 'Lightners Live +', ext: '.llmap / .zip', badge: 'Deltarune', color: '#1e5bff' },
  { id: 'mania', label: 'osu!mania', ext: '.osz', badge: '4K / 7K', color: '#ffc20e' },
  { id: 'taiko', label: 'osu!taiko', ext: '.osz', badge: 'Don/Kat', color: '#22b14c' },
  { id: 'fnf', label: 'Friday Night Funkin', ext: '.json / .zip', badge: 'Psych', color: '#e21d2d' }
];

const formatNames: Record<string, string> = {
  iric: 'Iris Package',
  llplus: 'Lightners Live+',
  mania: 'osu!mania',
  taiko: 'osu!taiko',
  fnf: 'Friday Night Funkin'
};

export default function UniversalConverter({
  onBackToMenu,
  onGoToAutocharter,
  onGoToPlay,
  onPlayChart,
  onSaveToLibrary
}: UniversalConverterProps) {
  // Source State
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsedChart, setParsedChart] = useState<ParsedChart | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Conversion Settings
  const [targetFormat, setTargetFormat] = useState<TargetExportFormat>('llplus');
  const [targetKeyCount, setTargetKeyCount] = useState<number>(4); // For mania: 4K, 7K, etc.
  const [selectedDiffIndices, setSelectedDiffIndices] = useState<number[]>([]);
  const [enableIrisOptimizer, setEnableIrisOptimizer] = useState<boolean>(true);
  const [enableHoldNotes, setEnableHoldNotes] = useState<boolean>(true);
  const [customSongTitle, setCustomSongTitle] = useState<string>('');
  const [customArtist, setCustomArtist] = useState<string>('');
  const [customCharter, setCustomCharter] = useState<string>('');
  
  // Output / Progress
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [conversionSuccess, setConversionSuccess] = useState<{
    fileName: string;
    downloadUrl: string;
    blob: Blob;
    format: TargetExportFormat;
    diffsCount: number;
    notesCount: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Handle File Input
  const handleFileDrop = async (file: File) => {
    setError(null);
    setConversionSuccess(null);
    setParsedChart(null);
    setIsLoading(true);
    setStatusMessage('Analyzing and parsing chart structure...');

    try {
      setSourceFile(file);
      const parsed = await parseUniversalChart(file);
      setParsedChart(parsed);
      setCustomSongTitle(parsed.title || file.name.replace(/\.[^/.]+$/, ''));
      setCustomArtist(parsed.artist || 'Unknown Artist');
      setCustomCharter(parsed.charter || 'Universal Converter');

      // Auto-tune default target format based on source
      let autoTarget: TargetExportFormat = 'llplus';
      if (parsed.mode === 'llplus') {
        autoTarget = 'mania';
      } else if (parsed.mode === 'mania') {
        autoTarget = 'llplus';
      } else if (parsed.mode === 'fnf') {
        autoTarget = 'mania';
      } else if (parsed.mode === 'taiko') {
        autoTarget = 'llplus';
      }
      setTargetFormat(autoTarget);

      // Select initial difficulties (1 for single-diff targets like LLPlus/FNF, or all for multi-diff)
      if (parsed.difficulties && parsed.difficulties.length > 0) {
        if ((autoTarget as string) === 'llplus' || (autoTarget as string) === 'fnf') {
          setSelectedDiffIndices([0]);
        } else {
          setSelectedDiffIndices(parsed.difficulties.map((_, i) => i));
        }
      } else {
        setSelectedDiffIndices([0]);
      }

      setStatusMessage('');
    } catch (err: any) {
      console.error('Error parsing file:', err);
      setError(err?.message || 'Failed to parse the provided chart file.');
      setParsedChart(null);
    } finally {
      setIsLoading(false);
    }
  };

  const isSingleDiffTarget = targetFormat === 'llplus' || targetFormat === 'fnf';
  const selectedTarget = targetFormats.find(format => format.id === targetFormat) || targetFormats[0];
  const sourceFormatLabel = parsedChart ? (formatNames[parsedChart.mode] || parsedChart.mode || 'Chart file') : 'Choose a source chart';

  useEffect(() => {
    if (isSingleDiffTarget && selectedDiffIndices.length > 1) {
      setSelectedDiffIndices([selectedDiffIndices[0] ?? 0]);
    }
  }, [targetFormat, isSingleDiffTarget]);

  const toggleDifficultySelection = (index: number) => {
    if (isSingleDiffTarget) {
      setSelectedDiffIndices([index]);
    } else {
      setSelectedDiffIndices(prev => 
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    }
  };

  const selectAllDifficulties = () => {
    if (!parsedChart?.difficulties) return;
    if (isSingleDiffTarget) {
      setSelectedDiffIndices([0]);
    } else {
      setSelectedDiffIndices(parsedChart.difficulties.map((_, i) => i));
    }
  };

  const deselectAllDifficulties = () => {
    setSelectedDiffIndices([]);
  };

  const convertNotesToTarget = (
    notes: ChartNote[], sourceKeyCount: number,
    targetMode: TargetExportFormat, targetKeys: number
  ) => convertChartNotes(notes, sourceKeyCount, targetMode, targetKeys, enableHoldNotes);

  // Perform Complete Conversion and Packaging
  const handleExecuteConversion = async () => {
    if (!parsedChart || selectedDiffIndices.length === 0) {
      setError('Please select at least one difficulty to convert.');
      return;
    }

    setIsExporting(true);
    setStatusMessage('Building converted package & assets...');
    setError(null);

    try {
      const zip = new JSZip();
      const title = customSongTitle.trim() || parsedChart.title || 'Converted Song';
      const artist = customArtist.trim() || parsedChart.artist || 'Unknown Artist';
      const charter = customCharter.trim() || parsedChart.charter || 'Iris Universal Converter';
      const bpm = parsedChart.bpm || 120;
      const offsetMs = parsedChart.offsetMs || 0;
      const folderName = `${artist} - ${title}`.replace(/[/\\?%*:|"<>]/g, '_');

      // Audio Asset
      let audioBlob = parsedChart.audioBlob;
      let audioFileName = 'audio.mp3';

      if (parsedChart.audioBlob) {
        audioBlob = parsedChart.audioBlob;
        audioFileName = `audio.${parsedChart.audioBlob.type.includes('ogg') ? 'ogg' : 'mp3'}`;
      }

      // Background / Video Asset
      if (parsedChart.bgBlob) {
        const bgExt = parsedChart.bgBlob.type.includes('png') ? 'png' : 'jpg';
        zip.file(`bg.${bgExt}`, parsedChart.bgBlob);
      }

      const diffList: DifficultyOption[] = parsedChart.difficulties && parsedChart.difficulties.length > 0
        ? selectedDiffIndices.map(idx => parsedChart.difficulties![idx])
        : [{
            name: parsedChart.version || 'Converted',
            notes: parsedChart.notes,
            keyCount: parsedChart.keyCount || 4,
            mode: parsedChart.mode,
            bpm: bpm
          }];

      let totalExportedNotes = 0;
      let exportWarning = '';

      // 0. IRIS PACKAGE EXPORT (.iric)
      if (targetFormat === 'iric') {
        totalExportedNotes = diffList.reduce((acc, d) => acc + (d.notes?.length || 0), 0);
        const generatedBlob = await createIricPackageBlob({
          songName: title,
          artist: artist,
          charter: charter,
          bpm: bpm,
          offsetMs: offsetMs,
          mode: parsedChart.mode || 'mania',
          scrollSpeed: parsedChart.scrollSpeed,
          svChanges: parsedChart.svChanges,
          audioFile: audioBlob || null,
          videoFile: parsedChart.videoBlob,
          coverBlob: parsedChart.bgBlob,
          audioRegions: parsedChart.audioRegions,
          autocharterConfig: parsedChart.autocharterConfig,
          difficulties: diffList.map(d => ({
            name: d.name,
            notes: d.notes || [],
            keyCount: d.keyCount,
            mode: d.mode || 'mania',
            bpm: d.bpm || bpm,
            scrollSpeed: d.scrollSpeed ?? parsedChart.scrollSpeed,
            svChanges: d.svChanges ?? parsedChart.svChanges
          }))
        });
        const finalFileName = `${folderName}.iric`;
        await exportFile(generatedBlob, finalFileName);
        setConversionSuccess({
          fileName: finalFileName,
          downloadUrl: URL.createObjectURL(generatedBlob),
          blob: generatedBlob,
          format: targetFormat,
          diffsCount: diffList.length,
          notesCount: totalExportedNotes
        });
        if (onSaveToLibrary) {
          await onSaveToLibrary(generatedBlob, finalFileName, title, artist, targetFormat);
        }
        setIsExporting(false);
        setStatusMessage('Successfully converted and exported .iric package!');
        return;
      }

      // 1. LIGHTNERS LIVE + EXPORT (.zip / .llmap)
      if (targetFormat === 'llplus') {
        const primaryDiff = diffList[0];
        const sanitized = sanitizeLlpNotes(primaryDiff.notes, primaryDiff.keyCount, enableHoldNotes);
        const convertedNotes = sanitized.notes;
        totalExportedNotes = convertedNotes.length;

        // Build MIDI notes for LL+ (D:LLP Specification)
        const midiNotes: MidiNote[] = [];
        for (const note of convertedNotes) {
          let isLeft = note.lane === 0;
          const durSec = note.durationMs / 1000;
          const isHold = durSec > 0.15 && enableHoldNotes;

          if (isHold) {
            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: Math.max(0.18, durSec),
              pitch: isLeft ? 39 : 35, // Left Hold = 39, Right Hold = 35
              trackIndex: 0
            });
            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: 0.05,
              pitch: isLeft ? 38 : 36, // Left Tap = 38, Right Tap = 36
              trackIndex: 0
            });
          } else {
            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: 0.05,
              pitch: isLeft ? 38 : 36,
              trackIndex: 0
            });
          }
        }

        if (sanitized.shortenedHolds > 0 || sanitized.droppedNotes > 0) {
          exportWarning = `LLPlus kept ${convertedNotes.length} notes; shortened ${sanitized.shortenedHolds} overlapping holds and skipped ${sanitized.droppedNotes} notes that could not fit its two lanes.`;
        }

        const midiBytes = buildLlpMidi(midiNotes, bpm);
        zip.file(`${folderName}.mid`, midiBytes);

        // Metadata
        const metadataTxt = `Difficulty: ${primaryDiff.name || 'Hard'}\nDescription: Converted with Iris Universal Converter\nComposer: ${artist}\nVolume: 0\n`;
        zip.file(`${folderName}.txt`, metadataTxt);

        if (audioBlob) {
          const isMp3 = /audio\/(mpeg|mp3)/i.test(audioBlob.type);
          let llplusAudio = audioBlob;
          if (!isMp3) {
            const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextConstructor();
            try {
              const decodedAudio = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
              llplusAudio = await convertAudioBufferToMp3(decodedAudio);
            } finally {
              await audioContext.close();
            }
          }
          zip.file(`${folderName}.mp3`, llplusAudio);
        }
        if (parsedChart.bgBlob) {
          const bgExt = parsedChart.bgBlob.type.includes('png') ? 'png' : 'jpg';
          zip.file(`${folderName}.${bgExt}`, parsedChart.bgBlob);
        }
      }

      // 2. OSU!MANIA & OSU!TAIKO EXPORT (.osz)
      else if (targetFormat === 'mania' || targetFormat === 'taiko') {
        const circleSize = targetFormat === 'taiko' ? 4 : targetKeyCount;
        const beatLengthMs = (60 / bpm) * 1000;

        if (audioBlob) {
          zip.file(audioFileName, audioBlob);
        }

        diffList.forEach((diff) => {
          const convertedNotes = convertNotesToTarget(diff.notes, diff.keyCount, targetFormat, circleSize);
          totalExportedNotes += convertedNotes.length;

          let osuContent = `osu file format v14\n\n[General]\nAudioFilename: ${audioFileName}\nAudioLeadIn: 0\nPreviewTime: ${Math.floor(offsetMs)}\nMode: ${targetFormat === 'taiko' ? '1' : '3'}\n\n[Metadata]\nTitle:${title}\nTitleUnicode:${title}\nArtist:${artist}\nArtistUnicode:${artist}\nCreator:${charter}\nVersion:${diff.name}\n\n[Events]\n`;

          if (parsedChart.bgBlob) {
            const bgExt = parsedChart.bgBlob.type.includes('png') ? 'png' : 'jpg';
            osuContent += `0,0,"bg.${bgExt}",0,0\n`;
          }

          osuContent += `\n[Difficulty]\nHPDrainRate:5\nCircleSize:${circleSize}\nOverallDifficulty:5\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n${Math.round(offsetMs)},${beatLengthMs},4,1,0,100,1,0\n\n[HitObjects]\n`;

          const rawNotes: RawOsuHitObject[] = convertedNotes.map(n => ({
            lane: n.lane,
            timeMs: Math.round(n.timeMs),
            durationMs: enableHoldNotes ? Math.round(n.durationMs) : 0,
            hitSound: targetFormat === 'taiko' ? (n.type === 'taiko_kat' ? 2 : 0) : 0,
            isHold: enableHoldNotes && n.durationMs > 35
          }));

          const sanitized = sanitizeOsuHitObjects(rawNotes, circleSize, bpm, offsetMs);
          osuContent += generateOsuHitObjectsString(sanitized, circleSize, targetFormat === 'taiko' ? 'taiko' : 'mania');

          zip.file(`${artist} - ${title} (${charter}) [${diff.name}].osu`, osuContent);
        });
      }

      // 3. FRIDAY NIGHT FUNKIN' EXPORT (.json / .zip)
      else if (targetFormat === 'fnf') {
        const stepMs = ((60 / bpm) * 1000) / 4;
        if (audioBlob) {
          zip.file('Inst.mp3', audioBlob);
        }

        diffList.forEach(diff => {
          const convertedNotes = convertNotesToTarget(diff.notes, diff.keyCount, 'fnf', 4);
          totalExportedNotes += convertedNotes.length;

          // Split notes into 16-step FNF sections
          const sectionLengthMs = stepMs * 16;
          const maxTime = convertedNotes.length > 0 ? convertedNotes[convertedNotes.length - 1].timeMs + 5000 : 60000;
          const sectionCount = Math.ceil(maxTime / sectionLengthMs);

          const fnfSections: any[] = [];
          for (let s = 0; s < sectionCount; s++) {
            const secStart = s * sectionLengthMs;
            const secEnd = (s + 1) * sectionLengthMs;
            const secNotes = convertedNotes
              .filter(n => n.timeMs >= secStart && n.timeMs < secEnd)
              .map(n => [
                Math.round(n.timeMs),
                fnfNoteData(n),
                enableHoldNotes ? Math.round(n.durationMs) : 0
              ]);

            fnfSections.push({
              sectionNotes: secNotes,
              lengthInSteps: 16,
              mustHitSection: true,
              bpm: bpm,
              changeBPM: false
            });
          }

          const fnfChart = {
            song: {
              song: title,
              notes: fnfSections,
              bpm: bpm,
              needsVoices: false,
              player1: 'bf',
              player2: 'dad',
              gfVersion: 'gf',
              stage: 'stage',
              speed: 2.5
            }
          };

          const cleanName = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const cleanDiff = diff.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          zip.file(`${cleanName}-${cleanDiff}.json`, JSON.stringify(fnfChart, null, 2));
        });
      }

      // Generate final Blob and Download URL
      const extension = targetFormat === 'llplus' ? 'zip' : (targetFormat === 'fnf' ? 'zip' : 'osz');
      const finalFileName = `${folderName}.${extension}`;
      const generatedBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
      const downloadUrl = URL.createObjectURL(generatedBlob);

      setConversionSuccess({
        fileName: finalFileName,
        downloadUrl,
        blob: generatedBlob,
        format: targetFormat,
        diffsCount: diffList.length,
        notesCount: totalExportedNotes
      });

      if (onSaveToLibrary) {
        await onSaveToLibrary(generatedBlob, finalFileName, title, artist, targetFormat);
      }

      setStatusMessage(exportWarning || 'Conversion completed successfully!');
    } catch (err: any) {
      console.error('Error during conversion:', err);
      setError(err?.message || 'An error occurred during chart compilation.');
    } finally {
      setIsExporting(false);
    }
  };

  // Launch Playtest directly from converted chart (auto-saves package to library if not converted yet)
  const handleInstantPlaytest = async () => {
    if (!parsedChart || !onPlayChart) return;

    // Auto-convert & save to Library first so work is never lost
    if (!conversionSuccess) {
      await handleExecuteConversion();
    }

    const primaryIndex = selectedDiffIndices[0] || 0;
    const diff = parsedChart.difficulties ? parsedChart.difficulties[primaryIndex] : null;

    const convertedNotes = convertNotesToTarget(
      diff ? diff.notes : parsedChart.notes,
      diff ? diff.keyCount : parsedChart.keyCount,
      targetFormat,
      targetFormat === 'mania' ? targetKeyCount : (targetFormat === 'llplus' ? 2 : 4)
    );

    const testChart: ParsedChart = {
      title: customSongTitle || parsedChart.title,
      artist: customArtist || parsedChart.artist,
      charter: customCharter || parsedChart.charter,
      bpm: parsedChart.bpm,
      offsetMs: parsedChart.offsetMs,
      keyCount: targetFormat === 'llplus' ? 2 : (targetFormat === 'mania' ? targetKeyCount : 4),
      mode: targetFormat,
      notes: convertedNotes,
      audioBlob: parsedChart.audioBlob,
      audioUrl: parsedChart.audioUrl,
      bgUrl: parsedChart.bgUrl,
      bgBlob: parsedChart.bgBlob
    };

    onPlayChart(testChart);
  };

  return (
      <div className="space-y-6 max-w-5xl mx-auto text-zinc-100 pb-16">
      <header className="app-main-header gap-4 border-b border-[#2d4259] pb-4">
        <button type="button" onClick={onBackToMenu} className="flex items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">
          <span className="w-9 h-9 flex items-center justify-center bg-[#ffc20e] text-[#071426] rounded-sm"><Music className="w-4 h-4" /></span>
          <span><span className="block text-sm font-bold tracking-wide">IRIS</span><span className="block text-[11px] text-[#aebdca]">Autocharter</span></span>
        </button>
        <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm">
          <button type="button" onClick={onGoToAutocharter} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Create</button>
          <span aria-current="page" className="text-white border-b-2 border-[#1e5bff] py-2">Convert</span>
          <button type="button" onClick={onGoToPlay} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Play</button>
        </nav>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[#c8d2dc]">
          <RefreshCw className="w-4 h-4 text-[#1e5bff]" />
          Universal Converter
        </span>
      </header>

      {/* Main Grid: Upload & Analysis / Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: File Drop & Metadata (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <section className="glass-panel p-5 sm:p-6 rounded-sm space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-sm bg-[#12263c] flex items-center justify-center text-[#e21d2d] border border-[#2d4259]">
                  <Upload className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                  Source Chart / Pack
                </h3>
              </div>
              {parsedChart && (
                <button
                  type="button"
                  onClick={() => {
                    setParsedChart(null);
                    setSourceFile(null);
                    setConversionSuccess(null);
                  }}
                  className="text-xs text-zinc-400 hover:text-rose-400 transition-colors"
                >
                  Clear File
                </button>
              )}
            </div>

            {/* Drag & Drop Area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileDrop(e.dataTransfer.files[0]);
                }
              }}
              className={`border border-dashed rounded-sm p-6 text-center cursor-pointer transition-colors ${
                parsedChart 
                  ? 'border-[#22b14c] bg-[#22b14c]/5' 
                  : 'border-[#3b536c] hover:border-[#ffc20e] hover:bg-white/[0.025]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".iric,.osu,.osz,.zip,.llmap,.mid,.midi,.json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileDrop(e.target.files[0]);
                  }
                }}
              />
              
              {isLoading ? (
                <div className="py-4 space-y-3">
                  <RefreshCw className="w-8 h-8 text-[#1e5bff] animate-spin mx-auto" />
                  <p className="text-xs font-semibold text-zinc-300">{statusMessage}</p>
                </div>
              ) : parsedChart ? (
                <div className="space-y-2 py-2">
                  <div className="w-10 h-10 rounded-full bg-[#22b14c]/10 text-[#22b14c] flex items-center justify-center mx-auto border border-[#22b14c]/40">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-sm text-zinc-100 truncate">{parsedChart.title || sourceFile?.name}</div>
                  <p className="text-xs text-zinc-400">
                    Format: <span className="text-[#ffc20e] uppercase font-semibold">{formatNames[parsedChart.mode] || parsedChart.mode}</span> • {parsedChart.difficulties?.length || 1} difficulties
                  </p>
                  <p className="text-[11px] text-zinc-500">Click or drop another file to replace</p>
                </div>
              ) : (
                <div className="space-y-2.5 py-4">
                  <FolderArchive className="w-9 h-9 text-zinc-500 mx-auto" />
                  <div>
                    <span className="text-xs font-bold text-[#ffc20e]">Click to upload</span>
                    <span className="text-xs text-zinc-400"> or drag & drop</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed max-w-xs mx-auto">
                    Supports <strong className="text-[#c8d2dc]">.iric</strong> (Iris Package), <strong className="text-[#c8d2dc]">.osz</strong> (osu!), <strong className="text-[#c8d2dc]">.llmap / .zip</strong> (Lightners Live+), <strong className="text-[#c8d2dc]">.json</strong> (FNF) and <strong className="text-[#c8d2dc]">.mid</strong>
                  </p>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div role="alert" className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-2.5 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Chart Summary Meta */}
            {parsedChart && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Song Title</label>
                  <input
                    type="text"
                    value={customSongTitle}
                    onChange={(e) => setCustomSongTitle(e.target.value)}
                    className="w-full glass-input rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Artist</label>
                    <input
                      type="text"
                      value={customArtist}
                      onChange={(e) => setCustomArtist(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Charter</label>
                    <input
                      type="text"
                      value={customCharter}
                      onChange={(e) => setCustomCharter(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-[#2d4259] pt-3 text-xs text-[#aebdca]">
                  <span className="flex items-center gap-1.5"><Disc3 className="w-3.5 h-3.5 text-[#1e5bff]" /> BPM: {Math.round(parsedChart.bpm || 120)}</span>
                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#ffc20e]" /> Key count: {parsedChart.keyCount || 4}K</span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Target Selection, Diff Inspector & Execution (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <section className="glass-panel p-5 sm:p-6 rounded-sm space-y-6">
            
            {/* Target Format Switcher */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-[#1e5bff]" />
                  Target Output Format
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-y border-[#2d4259] py-3 text-xs">
                <span className="min-w-0 max-w-[38%] truncate text-[#c8d2dc]" title={sourceFile?.name || sourceFormatLabel}>From · {sourceFile?.name || sourceFormatLabel}</span>
                <span aria-hidden="true" className="h-px min-w-4 flex-1" style={{ backgroundColor: selectedTarget.color }} />
                <span className="truncate font-medium" style={{ color: selectedTarget.color }}>To · {selectedTarget.label}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {targetFormats.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setTargetFormat(fmt.id as TargetExportFormat)}
                    style={targetFormat === fmt.id ? { borderColor: fmt.color, backgroundColor: `${fmt.color}20` } : undefined}
                    className={`p-3 rounded-sm border text-left transition-colors cursor-pointer flex flex-col justify-between ${
                      targetFormat === fmt.id
                        ? 'text-white'
                        : 'glass-card-interactive text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider inline-block mb-1.5" style={{ color: fmt.color }}>
                        {fmt.badge}
                      </span>
                      <div className="font-bold text-xs leading-snug">{fmt.label}</div>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono mt-2">{fmt.ext}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Format specific configurations */}
            {targetFormat === 'mania' && (
              <div className="p-4 glass-card rounded-sm space-y-3">
                <label className="text-xs font-bold text-zinc-300 flex items-center justify-between">
                  <span>Target Key Amount (CircleSize)</span>
                  <span className="text-[#ffc20e] font-mono font-bold">{targetKeyCount}K</span>
                </label>
                <div className="flex gap-2">
                  {[4, 5, 6, 7, 8].map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTargetKeyCount(k)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-sm border transition-colors cursor-pointer ${
                        targetKeyCount === k
                          ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                          : 'glass-card-interactive text-zinc-400'
                      }`}
                    >
                      {k}K
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Difficulties to Convert */}
            {parsedChart && parsedChart.difficulties && parsedChart.difficulties.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[#1e5bff]" />
                      Detected Difficulties ({parsedChart.difficulties.length})
                    </h4>
                    {isSingleDiffTarget && (
                      <p className="text-[11px] text-amber-400/90 font-medium mt-0.5">
                        {targetFormat === 'llplus' ? 'Lightners Live+' : 'FNF'} supports 1 difficulty per package. Pick 1 difficulty to convert.
                      </p>
                    )}
                  </div>
                  {!isSingleDiffTarget && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <button 
                        type="button" 
                        onClick={selectAllDifficulties}
                        className="text-[#1e5bff] hover:underline cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-zinc-600">•</span>
                      <button 
                        type="button" 
                        onClick={deselectAllDifficulties}
                        className="text-zinc-400 hover:underline cursor-pointer"
                      >
                        Deselect
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {parsedChart.difficulties.map((diff, index) => {
                    const isSelected = selectedDiffIndices.includes(index);
                    return (
                      <div
                        key={index}
                        onClick={() => toggleDifficultySelection(index)}
                        className={`p-3 rounded-sm border flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#1e5bff]/10 border-[#1e5bff] text-zinc-100'
                            : 'glass-card text-zinc-400 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-sm border flex items-center justify-center ${
                            isSelected ? 'bg-[#1e5bff] border-[#1e5bff] text-white' : 'border-zinc-700'
                          }`}>
                            {isSelected && <CheckCircle2 className="w-3 h-3" />}
                          </div>
                          <div>
                            <span className="font-bold text-xs text-zinc-200">{diff.name}</span>
                            <span className="text-[11px] text-zinc-500 ml-2 font-mono">
                              ({diff.notes.length} notes, {diff.keyCount}K)
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded glass-pill text-zinc-400">
                          {diff.mode}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Smart IRIS Options */}
            <div className="p-4 glass-card rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#22b14c]" />
                  <div>
                    <div className="text-xs font-bold text-zinc-200">IRIS Ergo Optimizer</div>
                    <div className="text-[11px] text-zinc-500">Auto-fix jack overloads & chord balance</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enableIrisOptimizer}
                  onChange={(e) => setEnableIrisOptimizer(e.target.checked)}
                  className="w-4 h-4 rounded-sm border-zinc-700 accent-[#ffc20e] focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <div className="text-xs font-bold text-zinc-200">Preserve Hold Notes</div>
                <input
                  type="checkbox"
                  checked={enableHoldNotes}
                  onChange={(e) => setEnableHoldNotes(e.target.checked)}
                  className="w-4 h-4 rounded-sm border-zinc-700 accent-[#ffc20e] focus:ring-0 cursor-pointer"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                disabled={!parsedChart || selectedDiffIndices.length === 0 || isExporting}
                onClick={handleExecuteConversion}
                className="flex-1 py-3 px-5 bg-[#ffc20e] hover:bg-[#ffda65] disabled:opacity-40 text-[#071426] font-bold text-xs rounded-sm border border-[#ffc20e] flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing Package...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Convert & Export Package</span>
                  </>
                )}
              </button>

              {onPlayChart && parsedChart && (
                <button
                  type="button"
                  onClick={handleInstantPlaytest}
                  className="py-3 px-4 bg-[#22b14c] hover:bg-[#2ac35a] text-[#071426] font-bold text-xs rounded-sm border border-[#22b14c] flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Gamepad2 className="w-4 h-4" />
                  <span>Play Test</span>
                </button>
              )}
            </div>

            {/* Success Download Card */}
            <AnimatePresence>
              {conversionSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-5 glass-card border-[#22b14c]/50 rounded-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#22b14c] font-bold text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      Ready for Download & Play
                    </div>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-[#22b14c]/15 text-[#7ee39a] rounded-sm">
                      {conversionSuccess.format.toUpperCase()}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300">
                    Compiled <strong className="text-[#7ee39a]">{conversionSuccess.diffsCount} difficulties</strong> ({conversionSuccess.notesCount} total notes) into <code className="text-[#ffc20e] font-mono">{conversionSuccess.fileName}</code>.
                  </p>

                  <div className="flex items-center gap-3 pt-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => exportFile(conversionSuccess.blob, conversionSuccess.fileName)}
                      className="px-4 py-2.5 bg-[#22b14c] hover:bg-[#2ac35a] text-[#071426] text-xs font-bold rounded-sm inline-flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download {conversionSuccess.fileName}
                    </button>
                    {canShareFile(conversionSuccess.fileName, conversionSuccess.blob) && (
                      <button
                        type="button"
                        onClick={() => shareFile(conversionSuccess.blob, conversionSuccess.fileName, `Rhythm Chart: ${conversionSuccess.fileName}`)}
                        className="px-3.5 py-2.5 glass-card-interactive text-zinc-200 text-xs font-bold rounded-xl shadow-md inline-flex items-center gap-2 cursor-pointer transition-all hover:scale-105 active:scale-95"
                        title="Share directly to game app or files"
                      >
                        <Share2 className="w-3.5 h-3.5 text-[#1e5bff]" />
                        Share / Open with...
                      </button>
                    )}
                    {onPlayChart && (
                      <button
                        type="button"
                        onClick={handleInstantPlaytest}
                        className="px-4 py-2.5 bg-[#1e5bff] hover:bg-[#3e70ff] text-white text-xs font-bold rounded-sm inline-flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <Gamepad2 className="w-3.5 h-3.5 text-white" />
                        Play in Test Zone
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </div>
    </div>
  );
}
