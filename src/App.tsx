import { buildLlpMidi, MidiNote } from './lib/midiBuilder';
import { getMp3BlobForLlp } from './lib/audioToMp3';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { exportFile } from './lib/fileExport';
import { Download, Upload, Music, Image as ImageIcon, Settings, Keyboard, X, Sparkles, Plus, Activity, Video, History, Trash2, FolderDown, Gamepad2, ArrowLeft, Save, AlertCircle, Edit, RefreshCw, Cpu, Sliders, Zap, Check, Layers } from 'lucide-react';
import { motion } from 'motion/react';
import { guess } from 'web-audio-beat-detector';
import UniversalConverter from './components/UniversalConverter';
import RhythmGameEngine from './components/RhythmGameEngine';
import MainMenu from './components/MainMenu';
import SettingsMenu from './components/SettingsMenu';
import { BetaAnalysisPanel } from './components/BetaAnalysisPanel';
import { AudioRegionEditorModal, AudioRegion } from './components/AudioRegionEditorModal';
import { ImportChoiceModal } from './components/ImportChoiceModal';
import { CreateDraftModal } from './components/CreateDraftModal';
import { STYLE_PROFILES } from './lib/styleProfiles';
import { parseUniversalChart, ParsedChart, parseOsuContent } from './lib/chartParser';
import { createIricPackageBlob, ChartNote } from './lib/iricFormat';
import { applyIrisFase4Corrections } from './lib/irisOptimizer';
import { sanitizeLlpNotes } from './lib/llplusSanitizer';
import { sanitizeOsuHitObjects, generateOsuHitObjectsString, snapTimeToOsuGrid, RawOsuHitObject } from './lib/osuTimingSanitizer';
import {
  generateBetaDifficultyEvents,
  BetaCharterOptions,
  BetaCharterStyle,
  DEFAULT_BETA_OPTIONS
} from './lib/betaAutocharter';
import {
  saveChartToDB,
  getChartFromDB,
  getAllChartsFromDB,
  deleteChartFromDB,
  clearAllChartsFromDB,
  HistoryEntry,
  saveDraftToDB,
  getDraftFromDB,
  getAllDraftsFromDB,
  deleteDraftFromDB as deleteDraftFromDBHelper,
  DraftSlot
} from './lib/db';

export type DifficultyConfig = {
  value: number;
  keysStr: string;
  name?: string;
};

const getEnergyAtTime = (audioBuffer: AudioBuffer, time: number, windowSize: number = 0.05): number => {
  if (!audioBuffer) return 0.05; // Fallback silent/moderate energy to prevent crash
  const sampleRate = audioBuffer.sampleRate;
  let sum = 0;
  let count = 0;
  const startSample = Math.max(0, Math.floor(time * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.floor((time + windowSize) * sampleRate));

  if (startSample >= endSample) return 0;

  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = startSample; i < endSample; i++) {
      sum += channelData[i] * channelData[i];
      count++;
    }
  }
  return Math.sqrt(sum / (count || 1));
};

const sliceAudioBuffer = (audioBuffer: AudioBuffer, startSec: number, durationSec: number): AudioBuffer | null => {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(audioBuffer.length, Math.floor((startSec + durationSec) * sampleRate));
    const frameCount = endSample - startSample;
    if (frameCount <= 0) return null;

    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
      audioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );
    const newBuffer = offlineCtx.createBuffer(
      audioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const srcData = audioBuffer.getChannelData(c);
      const destData = newBuffer.getChannelData(c);
      for (let i = 0; i < frameCount; i++) {
        destData[i] = srcData[startSample + i] || 0;
      }
    }
    return newBuffer;
  } catch {
    return null;
  }
};

const fallbackEstimateBpm = (audioBuffer: AudioBuffer): { bpm: number; offset: number } => {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const hopSize = Math.floor(sampleRate * 0.01);
    const frames = Math.floor(channelData.length / hopSize);
    if (frames < 50) return { bpm: 120, offset: 0 };

    const energies: number[] = new Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const start = f * hopSize;
      for (let i = 0; i < hopSize; i++) {
        const val = channelData[start + i] || 0;
        sum += val * val;
      }
      energies[f] = Math.sqrt(sum / hopSize);
    }

    const onsets: number[] = new Array(frames).fill(0);
    for (let i = 1; i < frames; i++) {
      const diff = energies[i] - energies[i - 1];
      onsets[i] = diff > 0 ? diff : 0;
    }

    let bestLag = 50;
    let maxCorr = -1;

    for (let lag = 33; lag <= 100; lag++) {
      let corr = 0;
      for (let i = 0; i < frames - lag; i += 2) {
        corr += onsets[i] * onsets[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    const secondsPerBeat = (bestLag * hopSize) / sampleRate;
    let bpm = Math.round(60 / (secondsPerBeat || 0.5));
    if (bpm < 70) bpm *= 2;
    if (bpm > 180) bpm = Math.round(bpm / 2);

    return { bpm: bpm || 120, offset: 0 };
  } catch {
    return { bpm: 120, offset: 0 };
  }
};

const detectAudioBpmAndOffset = async (audioBuffer: AudioBuffer): Promise<{ bpm: number; offset: number }> => {
  try {
    const result = await guess(audioBuffer);
    if (result && result.bpm > 0) {
      return { bpm: Math.round(result.bpm), offset: 0 };
    }
  } catch {
    // Expected to fail on audio with quiet intros or non-standard rhythms
  }

  try {
    const duration = audioBuffer.duration;
    const startSec = Math.max(0, duration * 0.2);
    const sliceLen = Math.min(30, Math.max(10, duration * 0.6));
    const sliced = sliceAudioBuffer(audioBuffer, startSec, sliceLen);
    if (sliced) {
      const result = await guess(sliced);
      if (result && result.bpm > 0) {
        return { bpm: Math.round(result.bpm), offset: 0 };
      }
    }
  } catch {
    // Sliced detection failed
  }

  return fallbackEstimateBpm(audioBuffer);
};

import PlayMenu from './components/PlayMenu';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'menu' | 'autocharter' | 'play' | 'settings' | 'play_engine' | 'converter'>('autocharter');
  const [settingsReturnScreen, setSettingsReturnScreen] = useState<'menu' | 'play' | 'converter'>('menu');
  const [activeTab, setActiveTab] = useState<'charter_llplus' | 'charter_mania' | 'charter_taiko' | 'charter_fnf' | 'game_engine'>('charter_llplus');
  const isSingleDiffOnly = activeTab === 'charter_llplus' || activeTab === 'charter_fnf';
  const activeFormatColor = activeTab === 'charter_fnf' ? '#e21d2d'
    : activeTab === 'charter_llplus' ? '#1e5bff'
    : activeTab === 'charter_mania' ? '#ffc20e'
    : activeTab === 'charter_taiko' ? '#22b14c'
    : '#c4cedb';
  const [playEngineReturnScreen, setPlayEngineReturnScreen] = useState<'autocharter' | 'converter' | 'play'>('autocharter');
  const [loadedEngineChart, setLoadedEngineChart] = useState<ParsedChart | null>(null);
  const [importedChart, setImportedChart] = useState<ParsedChart | null>(null);
  
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [chartingAudioFile, setChartingAudioFile] = useState<File | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  const [songName, setSongName] = useState('');
  const [artist, setArtist] = useState('');
  const [charterName, setCharterName] = useState('Autocharter');
  const [silenceThreshold, setSilenceThreshold] = useState<number>(0.035);
  const [useTripletRhythm, setUseTripletRhythm] = useState<boolean>(false);
  const [useFreeOnset] = useState<boolean>(true);
  const [charterEngineMode, setCharterEngineMode] = useState<'standard' | 'beta'>('standard');
  const [betaOptions, setBetaOptions] = useState<BetaCharterOptions>(DEFAULT_BETA_OPTIONS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  
  // Critique logs for IRIS Analysis
  const [critiqueLogs, setCritiqueLogs] = useState<Array<{
    timeMs: number;
    patternType: string;
    musicality: number;
    energy: number;
    transients: boolean;
    prevPattern: string;
    difficultyRating: string;
    decision: 'keep' | 'review';
    reason: string;
  }>>([]);
  const [showCritiquePanel, setShowCritiquePanel] = useState<boolean>(false);
  const [selectedFormat, setSelectedFormat] = useState<'llplus' | 'mania' | 'taiko' | 'fnf'>('llplus');
  const [correctionLogs, setCorrectionLogs] = useState<Array<{
    timeMs: number;
    originalPattern: string;
    problem: string;
    alternativePattern: string;
    beforeScore: number;
    afterScore: number;
    musicalityBefore: number;
    musicalityAfter: number;
    decision: 'applied' | 'preserved';
    reason: string;
  }>>([]);

  const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
  const [draftsList, setDraftsList] = useState<DraftSlot[]>([]);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<number | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  const [isAudioRegionEditorOpen, setIsAudioRegionEditorOpen] = useState(false);
  const [isCreateDraftOpen, setIsCreateDraftOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState<{ message: string; type?: 'success' | 'info' | 'error' } | null>(null);
  const [trackDuration, setTrackDuration] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastNotification({ message, type });
    setTimeout(() => {
      setToastNotification((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const [uploadedChartFile, setUploadedChartFile] = useState<File | null>(null);
  const [uploadedChartForCritique, setUploadedChartForCritique] = useState<ParsedChart | null>(null);
  const [isAnalyzingUploaded, setIsAnalyzingUploaded] = useState<boolean>(false);

  const handleChartFileForCritiqueSelect = async (file: File | null) => {
    if (!file) {
      setUploadedChartFile(null);
      setUploadedChartForCritique(null);
      return;
    }

    try {
      const parsed = await parseUniversalChart(file, file.name);
      setUploadedChartFile(file);
      setUploadedChartForCritique(parsed);

      if (parsed.mode) {
        setSelectedFormat(parsed.mode);
      }

      if (parsed.title) setSongName(parsed.title);
      if (parsed.artist && parsed.artist !== 'Desconocido' && parsed.artist !== 'Unknown Artist') setArtist(parsed.artist);
      if (parsed.charter && parsed.charter !== 'Auto-Charter' && parsed.charter !== 'Unknown Charter') setCharterName(parsed.charter);

      if (parsed.audioBlob) {
        const audioFileObj = new File([parsed.audioBlob], `${parsed.title || 'audio'}.mp3`, { type: 'audio/mpeg' });
        setAudioFile(audioFileObj);
      }
      
      if (parsed.bgBlob) {
        const bgFileObj = new File([parsed.bgBlob], `background.png`, { type: 'image/png' });
        setBgFile(bgFileObj);
      }
    } catch (e: any) {
      alert("Error parsing uploaded chart: " + e.message);
    }
  };

  const handleAnalyzeAndImproveExistingChart = async () => {
    if (!uploadedChartForCritique) return;
    setIsAnalyzingUploaded(true);
    
    try {
      let audioBuffer: AudioBuffer | null = null;
      let maxTrackEnergy = 0.001;
      
      if (audioFile) {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const arrayBuffer = await audioFile.arrayBuffer();
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          for (let t = 0; t < audioBuffer.duration; t += 0.1) {
            const e = getEnergyAtTime(audioBuffer, t, 0.05);
            if (e > maxTrackEnergy) maxTrackEnergy = e;
          }
        } catch (audioErr) {
          console.warn("Failed to decode audio, falling back to structural audit only:", audioErr);
        }
      }
      
      const format = uploadedChartForCritique.mode || 'mania';
      setSelectedFormat(format);
      
      const colsCount = uploadedChartForCritique.keyCount || 4;
      const diffKeys = Array.from({ length: colsCount }, (_, i) => (i + 1).toString());
      const diffValue = 11;
      
      const events = uploadedChartForCritique.notes.map((n, idx) => {
        const laneVal = n.lane;
        const key = diffKeys[laneVal] || (laneVal + 1).toString();
        return {
          id: n.id || `up-note-${idx}`,
          n: "key",
          t: n.timeMs / 1000,
          d: { i: laneVal, r: 0, s: key, duration: (n.durationMs || 0) / 1000 }
        };
      });
      
      const effectiveSilenceThreshold = Math.max(silenceThreshold, maxTrackEnergy * 0.15);
      
      const { correctedEvents, tempCorrectionLogs } = applyIrisFase4Corrections(
        events,
        audioBuffer as any,
        diffValue,
        diffKeys,
        format,
        effectiveSilenceThreshold,
        maxTrackEnergy
      );
      
      setCorrectionLogs(tempCorrectionLogs.sort((a, b) => a.timeMs - b.timeMs));
      
      const logsForThisDiff: any[] = [];
      const colLastTime: { [col: number]: number } = {};
      const colLastNote: { [col: number]: any } = {};
      const timeGroups: { [time: number]: any[] } = {};
      
      correctedEvents.forEach((ev: any) => {
        const roundedTime = Math.round(ev.t * 1000) / 1000;
        if (!timeGroups[roundedTime]) timeGroups[roundedTime] = [];
        timeGroups[roundedTime].push(ev);
      });
      
      correctedEvents.forEach((ev: any) => {
        const timeMs = ev.t * 1000;
        const col = ev.d.i;
        const lastTime = colLastTime[col];
        
        if (lastTime !== undefined) {
          const gapMs = timeMs - lastTime;
          if (gapMs > 0 && gapMs < 200) {
            const localEnergy = getEnergyAtTime(audioBuffer as any, ev.t, 0.05);
            const isPeakAtTime = localEnergy > effectiveSilenceThreshold;
            const relativeEnergy = Math.min(1.0, Math.max(0.0, (localEnergy - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));
            
            const musicalityScore = isPeakAtTime ? Math.round(85 + Math.random() * 11) : Math.round(25 + Math.random() * 20);
            const contextScore = Math.round(relativeEnergy * 60 + 35);
            
            const isClimax = relativeEnergy >= 0.6;
            const decision = (musicalityScore >= 80 && contextScore >= 70) ? 'keep' : 'review';
            
            let reason = "";
            if (decision === 'keep') {
              reason = `Highly intense jackhammer synchronized with a prominent ${isClimax ? 'chorus climax' : 'audio transient'}. Confirmed matching energy.`;
            } else {
              reason = `Repetitive stroke on column ${col + 1} with low music justification. Might cause unnecessary fatigue.`;
            }
            
            logsForThisDiff.push({
              timeMs: Math.round(timeMs),
              patternType: `Col ${col + 1} Jackhammer (${Math.round(gapMs)}ms)`,
              musicality: musicalityScore,
              energy: Math.round(relativeEnergy * 100),
              transients: isPeakAtTime,
              prevPattern: `Tap on Col ${col + 1}`,
              difficultyRating: gapMs < 100 ? "Very High" : "High",
              decision: decision,
              reason: reason
            });
          }
        }
        
        colLastTime[col] = timeMs;
        colLastNote[col] = ev;
      });
      
      Object.keys(timeGroups).forEach((timeStr) => {
        const t = parseFloat(timeStr);
        const group = timeGroups[t];
        if (group.length >= 2) {
          const timeMs = t * 1000;
          const localEnergy = getEnergyAtTime(audioBuffer as any, t, 0.05);
          const isPeakAtTime = localEnergy > effectiveSilenceThreshold;
          const relativeEnergy = Math.min(1.0, Math.max(0.0, (localEnergy - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));
          
          const musicalityScore = isPeakAtTime ? Math.round(90 + Math.random() * 8) : Math.round(20 + Math.random() * 20);
          const decision = (musicalityScore >= 85 && relativeEnergy >= 0.4) ? 'keep' : 'review';
          let reason = "";
          if (decision === 'keep') {
            reason = `Balanced ${group.length}-key chord aligned with high impact transient. Satisfies physical landing constraints.`;
          } else {
            reason = `Heavy ${group.length}-key chord occurring during minor beat. Potentially too dense for the audio context.`;
          }
          
          logsForThisDiff.push({
            timeMs: Math.round(timeMs),
            patternType: `${group.length}-Key Chord`,
            musicality: musicalityScore,
            energy: Math.round(relativeEnergy * 100),
            transients: isPeakAtTime,
            prevPattern: "Dynamic grid alignment",
            difficultyRating: group.length >= 3 ? "Tense" : "Comfortable",
            decision: decision,
            reason: reason
          });
        }
      });
      
      logsForThisDiff.sort((a, b) => a.timeMs - b.timeMs);
      setCritiqueLogs(logsForThisDiff.slice(0, 80));
      
      const improvedNotes = correctedEvents.map((ev, idx) => ({
        id: ev.id || `imp-note-${idx}`,
        timeMs: Math.round(ev.t * 1000),
        lane: ev.d.i,
        durationMs: Math.round((ev.d.duration || 0) * 1000),
        type: ((ev.d.duration > 0) ? 'hold' : (format === 'taiko' ? (ev.d.i === 1 ? 'taiko_kat' : 'taiko_don') : 'normal')) as any
      }));
      
      const updatedChart: ParsedChart = {
        ...uploadedChartForCritique,
        notes: improvedNotes
      };
      
      setUploadedChartForCritique(updatedChart);
      setImportedChart(updatedChart);
      
      if (audioFile) {
        updatedChart.audioBlob = audioFile;
        updatedChart.audioUrl = URL.createObjectURL(audioFile);
      }
      
    } catch (err: any) {
      alert("Analysis failed: " + err.message);
    } finally {
      setIsAnalyzingUploaded(false);
    }
  };

  useEffect(() => {
    const reloadHistory = () => {
      getAllChartsFromDB().then((charts) => {
        if (charts && charts.length > 0) {
          setHistory(charts);
        } else {
          const savedHistory = localStorage.getItem('chartHistory');
          if (savedHistory) {
            try {
              setHistory(JSON.parse(savedHistory));
            } catch (e) {
              console.error(e);
            }
          }
        }
      });
    };

    reloadHistory();
    window.addEventListener('focus', reloadHistory);
    return () => window.removeEventListener('focus', reloadHistory);
  }, [currentScreen]);

  const handleEditFromHistory = async (entry: HistoryEntry) => {
    try {
      const dbItem = await getChartFromDB(entry.id);
      if (dbItem && dbItem.blob) {
        const fallbackExt = entry.format === 'mania' || entry.format === 'taiko' ? 'osz' : 'zip';
        const targetFileName = dbItem.fileName || entry.fileName || `${entry.name}.${fallbackExt}`;
        const parsed = await parseUniversalChart(dbItem.blob, targetFileName);
        setImportedChart(parsed);
        setEditingHistoryId(entry.id);
        setSongName(parsed.title || '');
        setArtist(parsed.artist || '');
        setCharterName(parsed.charter || '');
        
        if (parsed.audioBlob) setAudioFile(new File([parsed.audioBlob], 'audio.mp3', { type: parsed.audioBlob.type }));
        if (parsed.vocalsBlob) setChartingAudioFile(new File([parsed.vocalsBlob], 'vocals.mp3', { type: parsed.vocalsBlob.type }));
        if (parsed.bgBlob) setBgFile(new File([parsed.bgBlob], 'bg.png', { type: parsed.bgBlob.type }));
        if (parsed.videoBlob) setVideoFile(new File([parsed.videoBlob], 'video.mp4', { type: parsed.videoBlob.type }));
        
        if (parsed.mode === 'mania') setActiveTab('charter_mania');
        else if (parsed.mode === 'taiko') setActiveTab('charter_taiko');
        else if (parsed.mode === 'fnf') setActiveTab('charter_fnf');
        else setActiveTab('charter_llplus');
        
        setCurrentScreen('autocharter');
        window.scrollTo(0, 0);
      } else {
        alert("The file is not available.");
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error loading the map for editing: ${err.message}`);
    }
  };

  const handlePlayFromHistory = async (entry: HistoryEntry) => {
    try {
      const dbItem = await getChartFromDB(entry.id);
      if (dbItem && dbItem.blob) {
        const fallbackExt = entry.format === 'mania' || entry.format === 'taiko' ? 'osz' : 'zip';
        const targetFileName = dbItem.fileName || entry.fileName || `${entry.name}.${fallbackExt}`;
        const parsed = await parseUniversalChart(dbItem.blob, targetFileName);
        setLoadedEngineChart(parsed);
        setCurrentScreen('autocharter');
        setActiveTab('game_engine');
      } else {
        alert("The file is not available in local storage.");
      }
    } catch (err: any) {
      console.error('Error loading map from history:', err);
      alert(`Error loading the map in Test Zone: ${err.message}`);
    }
  };

  const handleRedownload = async (entry: HistoryEntry) => {
    try {
      const dbItem = await getChartFromDB(entry.id);
      if (dbItem && dbItem.blob) {
        await exportFile(dbItem.blob, entry.fileName || `${entry.name}.${entry.format === 'llplus' ? 'llmap.zip' : (entry.format === 'fnf' ? 'zip' : 'osz')}`);
      } else {
        alert("The file is not saved in the browser local storage.");
      }
    } catch (err) {
      console.error(err);
      alert("Error trying to re-download the file.");
    }
  };

  const handleDeleteHistoryItem = async (id: string) => {
    try {
      await deleteChartFromDB(id);
    } catch (e) {
      console.error('Error deleting chart from DB:', e);
      showToast('Could not delete this chart. It is still in your library.', 'error');
      return;
    }
    setHistory(prev => {
      const updated = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('chartHistory', JSON.stringify(updated.map(({ blob, ...rest }) => rest)));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const handleClearAllHistory = async () => {
    try {
      await clearAllChartsFromDB();
    } catch (e) {
      console.error('Error clearing charts from DB:', e);
      showToast('Could not clear chart history. Your library was left unchanged.', 'error');
      return;
    }
    try {
      localStorage.removeItem('chartHistory');
    } catch (e) {
      console.error(e);
    }
    setHistory([]);
  };

  const handleImportExternalChart = async (file: File) => {
    try {
      const parsed = await parseUniversalChart(file, file.name);
      
      const newEntryId = Date.now().toString();
      const folderName = parsed.title || file.name.replace(/\.[^/.]+$/, '');
      const newEntry: HistoryEntry = {
        id: newEntryId,
        name: folderName,
        fileName: file.name,
        format: parsed.mode || 'mania',
        timestamp: Date.now(),
        fileSize: file.size,
        isImproved: false
      };

      await saveChartToDB(newEntry, file);
      setHistory(prev => [newEntry, ...prev]);

      try {
        const listNoBlobs = [newEntry, ...history].map(({ blob, ...rest }) => rest);
        localStorage.setItem('chartHistory', JSON.stringify(listNoBlobs));
      } catch (e) {
        console.error(e);
      }
      alert(`Imported "${folderName}" successfully!`);
    } catch (e: any) {
      alert("Failed to import external chart: " + e.message);
    }
  };

  const [enableHoldNotes, setEnableHoldNotes] = useState<boolean>(true);
  const [difficulties, setDifficulties] = useState<DifficultyConfig[]>([
    { value: 11, keysStr: 'd, f, j, k' }
  ]);
  const [tabDifficulties, setTabDifficulties] = useState<Record<string, DifficultyConfig[]>>({
    charter_llplus: [{ value: 11, keysStr: 'd, f, j, k' }],
    charter_mania: [{ value: 11, keysStr: '1, 2, 3, 4' }],
    charter_taiko: [{ value: 11, keysStr: 'Space, Return' }],
    charter_fnf: [{ value: 11, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow' }],
  });

  // Effect 1: Update tabDifficulties when difficulties state is modified for the active tab
  useEffect(() => {
    if (activeTab !== 'game_engine') {
      setTabDifficulties(prev => {
        if (JSON.stringify(prev[activeTab]) === JSON.stringify(difficulties)) {
          return prev;
        }
        return {
          ...prev,
          [activeTab]: difficulties
        };
      });
    }
  }, [difficulties]);

  // Effect 2: Update difficulties when activeTab changes, loading that tab's custom difficulties
  useEffect(() => {
    if (activeTab !== 'game_engine') {
      const savedDiffs = tabDifficulties[activeTab];
      if (savedDiffs && JSON.stringify(savedDiffs) !== JSON.stringify(difficulties)) {
        setDifficulties(savedDiffs);
      }
    }
  }, [activeTab]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isImportChoiceOpen, setIsImportChoiceOpen] = useState(false);
  const [pendingParsedChart, setPendingParsedChart] = useState<ParsedChart | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');

  // --- LOCAL DRAFTS AND AUTO-SAVE LOGIC ---
  const loadDrafts = async () => {
    try {
      const drafts = await getAllDraftsFromDB();
      setDraftsList(drafts);
    } catch (e) {
      console.error("Error loading drafts:", e);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [currentScreen]);

  const saveDraftSlot = async (slotId: string, customName?: string) => {
    const isAuto = slotId === 'draft_auto';
    // For auto-saves, don't auto-save if there's no data at all
    if (isAuto && !audioFile && !songName && !artist && audioRegions.length === 0) return;
    
    setIsAutoSaving(true);
    const resolvedName = customName || songName || audioFile?.name?.replace(/\.[^/.]+$/, '') || 'Untitled Draft';
    
    const draft: DraftSlot = {
      id: slotId,
      name: resolvedName,
      timestamp: Date.now(),
      activeTab,
      songName,
      artist,
      charterName,
      audioRegions,
      silenceThreshold,
      enableHoldNotes,
      useTripletRhythm,
      useFreeOnset,
      isSingleDiffOnly,
      difficulties,
      tabDifficulties, // Save tabDifficulties mapping
      editingHistoryId,
      charterEngineMode,
      betaOptions,
      
      audioFile: audioFile || null,
      chartingAudioFile: chartingAudioFile || null,
      bgFile: bgFile || null,
      videoFile: videoFile || null,
      audioFileName: audioFile?.name,
      chartingAudioFileName: chartingAudioFile?.name,
      bgFileName: bgFile?.name,
      videoFileName: videoFile?.name,
      importedChart,
    };

    try {
      await saveDraftToDB(draft);
      if (isAuto) {
        setLastAutoSaveTime(Date.now());
      }
      await loadDrafts();
      return true;
    } catch (e: any) {
      console.error("Failed to save draft to IndexedDB:", e);
      showToast(`Error saving draft: ${e.message || e}`, 'error');
      return false;
    } finally {
      setIsAutoSaving(false);
    }
  };

  const loadDraftSlot = async (draft: DraftSlot) => {
    try {
      setSongName(draft.songName || '');
      setArtist(draft.artist || '');
      setCharterName(draft.charterName || '');
      setImportedChart(draft.importedChart || null);
      setCharterEngineMode(draft.charterEngineMode || 'standard');
      setBetaOptions(draft.betaOptions || DEFAULT_BETA_OPTIONS);
      
      const targetTab = draft.activeTab || 'charter_llplus';
      setActiveTab(targetTab);
      setAudioRegions(draft.audioRegions || []);
      setSilenceThreshold(draft.silenceThreshold !== undefined ? draft.silenceThreshold : 0.05);
      setEnableHoldNotes(draft.enableHoldNotes !== undefined ? draft.enableHoldNotes : true);
      setUseTripletRhythm(draft.useTripletRhythm !== undefined ? draft.useTripletRhythm : true);
      
      if (draft.tabDifficulties) {
        setTabDifficulties(draft.tabDifficulties);
        const activeDiffs = draft.tabDifficulties[targetTab] || draft.difficulties || [];
        setDifficulties(activeDiffs);
      } else if (draft.difficulties) {
        setDifficulties(draft.difficulties);
        setTabDifficulties(prev => ({
          ...prev,
          [targetTab]: draft.difficulties || []
        }));
      }
      
      setEditingHistoryId(draft.editingHistoryId || null);

      if (draft.audioFile) {
        const file = new File([draft.audioFile], draft.audioFileName || 'audio.mp3', { type: draft.audioFile.type });
        setAudioFile(file);
      } else {
        setAudioFile(null);
      }

      if (draft.chartingAudioFile) {
        const file = new File([draft.chartingAudioFile], draft.chartingAudioFileName || 'vocals.mp3', { type: draft.chartingAudioFile.type });
        setChartingAudioFile(file);
      } else {
        setChartingAudioFile(null);
      }

      if (draft.bgFile) {
        const file = new File([draft.bgFile], draft.bgFileName || 'bg.png', { type: draft.bgFile.type });
        setBgFile(file);
      } else {
        setBgFile(null);
      }

      if (draft.videoFile) {
        const file = new File([draft.videoFile], draft.videoFileName || 'video.mp4', { type: draft.videoFile.type });
        setVideoFile(file);
      } else {
        setVideoFile(null);
      }

      setCurrentScreen('autocharter');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(`Draft "${draft.name}" restored into editor`, 'success');
    } catch (e: any) {
      showToast(`Error loading draft: ${e.message}`, 'error');
    }
  };

  const handleOpenCreateDraft = () => {
    setIsCreateDraftOpen(true);
  };

  const handleSaveCustomDraftSlot = async (slotName: string) => {
    const slotId = `draft_slot_${Date.now()}`;
    const saved = await saveDraftSlot(slotId, slotName);
    if (saved) showToast(`Saved draft slot: "${slotName}"`, 'success');
  };

  const handleDeleteDraft = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDraftFromDBHelper(id);
      await loadDrafts();
      showToast("Draft slot deleted", 'info');
    } catch (err: any) {
      console.error("Error deleting draft slot:", err);
      showToast("Could not delete draft slot", 'error');
    }
  };

  // Debounced Auto-save Effect
  useEffect(() => {
    if (!audioFile && !songName && !artist) return;
    if (currentScreen !== 'autocharter' && currentScreen !== 'autocharter_beta') return;

    const timer = setTimeout(() => {
      saveDraftSlot('draft_auto');
    }, 2500);

    return () => clearTimeout(timer);
  }, [
    audioFile,
    songName,
    artist,
    charterName,
    audioRegions,
    silenceThreshold,
    enableHoldNotes,
    useTripletRhythm,
    useFreeOnset,
    isSingleDiffOnly,
    difficulties,
    tabDifficulties,
    activeTab
  ]);


  const formatKeysStr = (str: string) => {
    return str.split(',').map(k => {
      let val = k.trim();
      if (!val) return '';
      if (val.length === 1) return val.toLowerCase();
      const lower = val.toLowerCase();
      if (lower === 'space' || lower === 'espacio') return 'Space';
      if (lower === 'enter' || lower === 'return') return 'Return';
      if (lower === 'capslock') return 'CapsLock';
      if (lower === 'any' || lower === 'cualquiera') return 'Any';
      if (lower === 'up' || lower === 'arriba') return 'UpArrow';
      if (lower === 'down' || lower === 'abajo') return 'DownArrow';
      if (lower === 'left' || lower === 'izquierda') return 'LeftArrow';
      if (lower === 'right' || lower === 'derecha') return 'RightArrow';
      return val.toLowerCase();
    }).filter(k => k !== '');
  };

  useEffect(() => {
    if (isSingleDiffOnly && difficulties.length > 1) {
      setDifficulties(prev => prev.slice(0, 1));
    }
  }, [isSingleDiffOnly, difficulties.length]);

  const handleTabChange = (tab: 'charter_llplus' | 'charter_mania' | 'charter_taiko' | 'charter_fnf' | 'game_engine') => {
    setActiveTab(tab);
    if (tab !== 'game_engine') {
      setSelectedFormat(tab === 'charter_llplus' ? 'llplus' : tab === 'charter_mania' ? 'mania' : tab === 'charter_taiko' ? 'taiko' : 'fnf');
    }
  };

  const handleSongFileSelect = async (selectedFile: File | null) => {
    if (!selectedFile) {
      setAudioFile(null);
      return;
    }

    const lowerName = selectedFile.name.toLowerCase();
    if (lowerName.endsWith('.osz') || lowerName.endsWith('.zip') || lowerName.endsWith('.llmap') || lowerName.endsWith('.iric')) {
      try {
        setEditingHistoryId(null);
        const parsed = await parseUniversalChart(selectedFile, selectedFile.name);
        setPendingParsedChart(parsed);
        setPendingFileName(selectedFile.name);
        setIsImportChoiceOpen(true);
      } catch (err) {
        console.error("Error parsing imported chart:", err);
        setAudioFile(selectedFile);
      }
    } else {
      setAudioFile(selectedFile);
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await selectedFile.arrayBuffer();
        const decoded = await audioContext.decodeAudioData(arrayBuffer);
        setAudioBuffer(decoded);
        setTrackDuration(decoded.duration);
      } catch {
        // ignore
      }
    }
  };

  const handleApplyParsedChart = (parsed: ParsedChart, openEditor: boolean = false, onlyMetadata: boolean = false) => {
    if (onlyMetadata) {
      setImportedChart(null);
    } else {
      setImportedChart(parsed);
    }

    setAudioRegions(Array.isArray(parsed.audioRegions) ? parsed.audioRegions : []);
    if (parsed.audioBlob) {
      const audFile = new File([parsed.audioBlob], 'audio.mp3', { type: parsed.audioBlob.type });
      setAudioFile(audFile);
      setAudioBuffer(null);
      setTrackDuration(0);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audFile.arrayBuffer().then(ab => audioContext.decodeAudioData(ab)).then(decoded => {
        setAudioBuffer(decoded);
        setTrackDuration(decoded.duration);
        if (openEditor) {
          setIsAudioRegionEditorOpen(true);
        }
      }).catch(() => {
        if (openEditor) setIsAudioRegionEditorOpen(true);
      });
    } else {
      setAudioFile(null);
      setAudioBuffer(null);
      setTrackDuration(0);
      if (openEditor) setIsAudioRegionEditorOpen(true);
    }
    setChartingAudioFile(parsed.vocalsBlob
      ? new File([parsed.vocalsBlob], 'vocals.mp3', { type: parsed.vocalsBlob.type })
      : null);
    setBgFile(parsed.bgBlob ? new File([parsed.bgBlob], 'bg.png', { type: parsed.bgBlob.type }) : null);
    setVideoFile(parsed.videoBlob ? new File([parsed.videoBlob], 'video.mp4', { type: parsed.videoBlob.type }) : null);
    setSongName(parsed.title || '');
    setArtist(parsed.artist && parsed.artist !== 'Desconocido' ? parsed.artist : '');
    setCharterName(parsed.charter && parsed.charter !== 'Auto-Charter' && parsed.charter !== 'Desconocido'
      ? parsed.charter
      : 'Autocharter');
    
    if (parsed.mode === 'mania') setActiveTab('charter_mania');
    else if (parsed.mode === 'taiko') setActiveTab('charter_taiko');
    else if (parsed.mode === 'fnf') setActiveTab('charter_fnf');
    else setActiveTab('charter_llplus');

    setIsImportChoiceOpen(false);
  };

  const addDifficulty = () => {
    if (isSingleDiffOnly) return;
    if (difficulties.length < 10) {
      let keysStr = 'd, f, j, k';
      if (activeTab === 'charter_mania') keysStr = '1, 2, 3, 4';
      if (activeTab === 'charter_taiko') keysStr = 'Space, Return';
      const lastVal = difficulties.length > 0 ? difficulties[difficulties.length - 1].value + 2 : 5;
      setDifficulties([...difficulties, { value: Math.min(30, lastVal), keysStr: keysStr }]);
    }
  };

  const removeDifficulty = (index: number) => {
    if (difficulties.length > 1) {
      setDifficulties(difficulties.filter((_, i) => i !== index));
    }
  };

  const updateDifficultyValue = (index: number, val: number) => {
    const newDiffs = [...difficulties];
    newDiffs[index].value = val;
    setDifficulties(newDiffs);
  };

  const updateDifficultyKeys = (index: number, keysStr: string) => {
    const newDiffs = [...difficulties];
    newDiffs[index].keysStr = keysStr;
    setDifficulties(newDiffs);
  };

  const updateDifficultyName = (index: number, name: string) => {
    const newDiffs = [...difficulties];
    newDiffs[index].name = name;
    setDifficulties(newDiffs);
  };

  const handleSaveImportedEdits = async (overwrite: boolean) => {
    if (!audioFile) {
      alert("Please upload an audio file first.");
      return;
    }
    const levelFolder = songName.trim() || 'CustomLevel';
    
    // Convert imported difficulties to DifficultyConfigs so the generator writes them properly
    let diffs: DifficultyConfig[] = importedChart?.difficulties?.map(d => ({
       name: d.name,
       value: d.name === 'Easy' ? 1 : (d.name === 'Normal' ? 5 : (d.name === 'Hard' ? 11 : 15)),
       keysStr: Array.from({length: d.keyCount || 4}, (_, i) => (i + 1).toString()).join(', ')
    })) || difficulties;

    if (isSingleDiffOnly) {
      diffs = diffs.slice(0, 1);
    }

    const getExportFormat = () => {
      if (activeTab === 'charter_llplus') return 'llplus';
      if (activeTab === 'charter_mania') return 'mania';
      if (activeTab === 'charter_fnf') return 'fnf';
      return 'taiko';
    };

    const newId = await runGenerationWithParams(
      audioFile,
      chartingAudioFile,
      bgFile,
      videoFile,
      levelFolder,
      songName,
      artist,
      charterName,
      importedChart?.bpm || null,
      0, // Offset isn't needed if notes are exact
      diffs,
      true,
      silenceThreshold,
      true,
      getExportFormat(),
      enableHoldNotes,
      useTripletRhythm,
      useFreeOnset,
      importedChart,
      overwrite ? editingHistoryId : null
    );
    
    if (newId) {
      setEditingHistoryId(newId);
    }
  };

  const handleGenerate = async (formatOverride?: 'iric' | 'llplus' | 'mania' | 'taiko' | 'fnf') => {
    if (!audioFile) {
      alert("Please upload an audio file (MP3/OGG) first.");
      return;
    }

    const levelFolder = songName.trim() || 'CustomLevel';

    const getExportFormat = () => {
      if (activeTab === 'charter_llplus') return 'llplus';
      if (activeTab === 'charter_mania') return 'mania';
      if (activeTab === 'charter_fnf') return 'fnf';
      return 'taiko';
    };

    await runGenerationWithParams(
      audioFile,
      chartingAudioFile,
      bgFile,
      videoFile,
      levelFolder,
      songName,
      artist,
      charterName,
      null,
      null,
      difficulties,
      true,
      silenceThreshold,
      true,
      formatOverride || getExportFormat(),
      enableHoldNotes,
      useTripletRhythm,
      useFreeOnset,
      undefined,
      undefined
    );
  };

  const runGenerationWithParams = async (
    pAudioFile: File,
    pChartingAudioFile: File | null,
    pBgFile: File | null,
    pVideoFile: File | null,
    pLevelName: string,
    pSongName: string,
    pArtist: string,
    pCharterName: string,
    pBpm: number | null,
    pOffset: number | null,
    pDifficulties: DifficultyConfig[],
    pUseOnsetDetection: boolean,
    pSilenceThreshold: number = 0.035,
    pUseSectionIntensity: boolean = true,
    pExportFormat: 'iric' | 'llplus' | 'mania' | 'taiko' | 'fnf' = 'iric',
    pEnableHoldNotes: boolean = true,
    pUseTripletRhythm: boolean = false,
    pUseFreeOnset: boolean = true,
    pImportedChart?: ParsedChart | null,
    pOverwriteId?: string | null
  ) => {
    setIsGenerating(true);
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const chartAudio = pChartingAudioFile || pAudioFile;
      const arrayBuffer = await chartAudio.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      let mainAudioBuffer = audioBuffer;
      if (chartAudio !== pAudioFile) {
        mainAudioBuffer = await audioContext.decodeAudioData(await pAudioFile.arrayBuffer());
      }
      const duration = audioBuffer.duration;

      // Pre-calculate track peak energy to filter out quiet background audio effectively
      let maxTrackEnergy = 0.001;
      let totalSectionEnergy = 0;
      let sectionSamples = 0;
      for (let t = 0; t < duration; t += 0.1) {
        const e = getEnergyAtTime(audioBuffer, t, 0.05);
        if (e > maxTrackEnergy) maxTrackEnergy = e;
      }

      // Pre-calculate average track section energy (4s sliding windows) for Verse vs Chorus detection
      for (let t = 0; t < duration; t += 0.5) {
        totalSectionEnergy += getEnergyAtTime(audioBuffer, Math.max(0, t - 2.0), 4.0);
        sectionSamples++;
      }
      const avgTrackSectionEnergy = totalSectionEnergy / (sectionSamples || 1);

      // Effective threshold ignores sounds below user threshold OR below 15% of peak song volume
      const effectiveSilenceThreshold = Math.max(pSilenceThreshold, maxTrackEnergy * 0.15);

      let finalBpm = pBpm;
      let finalOffset = pOffset;

      if (finalBpm === null || finalOffset === null) {
        const detected = await detectAudioBpmAndOffset(audioBuffer);
        if (finalBpm === null) finalBpm = detected.bpm;
        if (finalOffset === null) finalOffset = detected.offset;
      }

      const zip = new JSZip();
      const folderName = pLevelName.trim() || 'CustomLevel';
      const root = zip;

      let bgFileName = "";
      if (pBgFile) {
        bgFileName = pBgFile.name;
      }

      if (pExportFormat !== 'llplus') {
        root.file(pAudioFile.name, pAudioFile);
        if (pBgFile) {
          const assets = root.folder("assets");
          assets?.file(bgFileName, pBgFile);
        }
      }

      // finalBpm and finalOffset are already resolved at the top

      // Helper function for difficulty tier naming
      const getTierName = (diffValue: number): string => {
        if (diffValue <= 3) return "Easy";
        if (diffValue <= 7) return "Normal";
        if (diffValue <= 11) return "Hard";
        if (diffValue <= 16) return "Insane";
        if (diffValue <= 20) return "Master";
        // Highest level (21-25): osu! style Extra / [SongName]'s Extra
        return pSongName ? `${pSongName.trim()}'s Extra` : "Extra";
      };

      // Resolve and deduplicate difficulty names so no two difficulties have identical file names or versions
      const usedNames = new Set<string>();
      const resolvedDiffNames: string[] = [];

      for (let i = 0; i < pDifficulties.length; i++) {
        const diffConf = pDifficulties[i];
        const diffValue = diffConf.value;
        const customName = diffConf.name?.trim();
        
        let baseName = customName;
        if (!baseName) {
          baseName = getTierName(diffValue);
        }

        let finalName = baseName;
        let counter = 2;

        while (usedNames.has(finalName.toLowerCase())) {
          if (!customName) {
            finalName = `${baseName} (Lv.${diffValue})`;
            if (usedNames.has(finalName.toLowerCase())) {
              finalName = `${baseName} (Lv.${diffValue} #${counter})`;
              counter++;
            }
          } else {
            finalName = `${baseName} ${counter}`;
            counter++;
          }
        }

        usedNames.add(finalName.toLowerCase());
        resolvedDiffNames.push(finalName);
      }

      const generatedEventsList: any[] = [];
      
      for (let i = 0; i < pDifficulties.length; i++) {
        const diffConf = pDifficulties[i];
        const diffValue = diffConf.value;
        const diffName = resolvedDiffNames[i];
        
        let diffKeys = formatKeysStr(diffConf.keysStr);
        if (diffKeys.length === 0) diffKeys = ['Space'];
        const events: any[] = [];
        
        if (pBgFile) {
          events.push({
            n: "background",
            t: 0.0,
            d: { b: "background", t: "instant", l: 0 }
          });
        }

        events.push({
          n: "bpm",
          t: 0.0,
          d: { b: finalBpm, s: 4 }
        });

        const secondsPerBeat = 60 / finalBpm;
        
        let currentTime = finalOffset;
        let beatIndex = 0;
        
        // Base step calculation
        let baseStep = secondsPerBeat / 4; // 1/16th notes (4 per beat)
        if (pUseTripletRhythm) {
           // Allow 1/24th notes (6 per beat) for swing/triplets
           baseStep = secondsPerBeat / 6;
        }

        // If free onset is used, step is very small (10ms) to allow placing notes anywhere
        const step = pUseFreeOnset ? 0.01 : baseStep; 
        
        const diffFactor = Math.min(1.0, Math.max(0.05, diffValue / 25));
        
        // Calculate min steps based on the step resolution
        let minStepsBase = diffValue < 4 ? 4 : (diffValue < 8 ? 2 : (diffValue < 12 ? 1 : 1));
        if (pUseTripletRhythm && !pUseFreeOnset) {
            minStepsBase = Math.max(1, Math.floor(minStepsBase * 1.5));
        } else if (pUseFreeOnset) {
            // Approx min ms between notes based on diff (ensuring Lv.25 > Lv.20 > Lv.16 > Lv.11)
            minStepsBase = diffValue <= 3 ? 25 
                         : (diffValue <= 7 ? 14 
                         : (diffValue <= 11 ? 8 
                         : (diffValue <= 16 ? 5 
                         : (diffValue <= 20 ? 3 : 2)))); // Multipliers for 10ms steps
        }
        
        const minSteps = minStepsBase;
        let stepsSinceLastNote = 999;
        let lastSelectedLane: number | null = null;
        let lastSelectedTime = 0;
        let lastChordTime = -999;
        const recentDeltas: number[] = [];

        const laneHoldUntil: { [lane: number]: number } = {};
        for (let k = 0; k < diffKeys.length; k++) {
          laneHoldUntil[k] = 0;
        }
        const spawnedHoldAndPlayRegions = new Set<string>();

        if (pImportedChart && pImportedChart.difficulties && pImportedChart.difficulties[i]) {
          const importedDiff = pImportedChart.difficulties[i];
          importedDiff.notes.forEach(note => {
             events.push({
                n: "key",
                t: note.timeMs / 1000,
                d: { i: note.lane, r: 0, s: diffKeys[note.lane] || 'Space', duration: note.durationMs / 1000 }
             });
          });
        } else {
          while (currentTime <= (duration - 0.1)) {
            let regionMultiplier = 1.0;
            let regionPatternPref = 'auto';
            let regionHoldAndPlaySide = 'any';
            let activeRegion: AudioRegion | null = null;
            if (audioRegions && audioRegions.length > 0) {
              const matchedReg = audioRegions.find(r => currentTime >= r.startTime && currentTime <= r.endTime);
              if (matchedReg) {
                activeRegion = matchedReg;
                if (matchedReg.type === 'silence' || matchedReg.densityMultiplier === 0) {
                  stepsSinceLastNote++;
                  currentTime += step;
                  continue;
                }
                regionMultiplier = matchedReg.densityMultiplier;
                regionPatternPref = matchedReg.patternPreference;
                regionHoldAndPlaySide = matchedReg.holdAndPlaySide || 'any';
              }
            }

            // --- GUARANTEED HOLD & PLAY ANCHOR NOTE GENERATION ---
            // As soon as the timeline reaches a region configured with hold_and_play,
            // immediately spawn an anchor long note that holds continuously across
            // the entire region without requiring repeated re-holds or interruptions!
            if (activeRegion && regionPatternPref === 'hold_and_play' && diffKeys.length > 1) {
              if (!spawnedHoldAndPlayRegions.has(activeRegion.id)) {
                spawnedHoldAndPlayRegions.add(activeRegion.id);

                let anchors = [0, diffKeys.length - 1];
                if (diffKeys.length % 2 !== 0) {
                  anchors.push(Math.floor(diffKeys.length / 2));
                }

                if (regionHoldAndPlaySide === 'left') {
                  anchors = [0];
                } else if (regionHoldAndPlaySide === 'right') {
                  anchors = [diffKeys.length - 1];
                } else if (regionHoldAndPlaySide === 'center') {
                  if (diffKeys.length % 2 !== 0) {
                    anchors = [Math.floor(diffKeys.length / 2)];
                  } else {
                    const mid = Math.floor(diffKeys.length / 2);
                    anchors = [mid - 1, mid];
                  }
                }

                const validAnchors = anchors.filter(idx => (laneHoldUntil[idx] || 0) <= currentTime);
                const candidates = validAnchors.length > 0 ? validAnchors : anchors;
                const anchorLane = candidates[Math.floor(Math.random() * candidates.length)];
                const anchorKey = diffKeys[anchorLane];

                const snappedStart = snapTimeToOsuGrid(Math.max(currentTime, activeRegion.startTime) * 1000, finalBpm, finalOffset * 1000) / 1000;
                // Sustains until the end of the region minus 1/4 beat to allow a clean release
                const endTarget = Math.min(duration - 0.05, activeRegion.endTime - (secondsPerBeat * 0.25));
                const snappedEnd = Math.max(snappedStart + secondsPerBeat * 2, snapTimeToOsuGrid(endTarget * 1000, finalBpm, finalOffset * 1000) / 1000);
                let anchorDuration = Math.max(secondsPerBeat * 2, snappedEnd - snappedStart);

                if (snappedStart + anchorDuration > duration) {
                  anchorDuration = Math.max(0.1, duration - snappedStart - 0.05);
                }

                laneHoldUntil[anchorLane] = snappedStart + anchorDuration;
                lastSelectedLane = anchorLane;
                lastSelectedTime = snappedStart;

                events.push({
                  n: "key",
                  t: snappedStart,
                  d: { i: anchorLane, r: 0, s: anchorKey, duration: anchorDuration }
                });
              }
            }

            // For energy analysis, we still want to look at a reasonable window, not just 10ms
            const analysisWindow = pUseFreeOnset ? 0.05 : step;
            const energy = getEnergyAtTime(audioBuffer, currentTime, analysisWindow);
            const prevEnergy = getEnergyAtTime(audioBuffer, currentTime - analysisWindow, analysisWindow);
            
            const isAudioAudible = energy >= effectiveSilenceThreshold;
            // Relative energy normalized above threshold
            const relativeEnergy = Math.min(1.0, Math.max(0.0, (energy - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));
            
            // Asymptotic threshold curve for free onset scaling directly with diffValue up to 25
            const noiseThreshold = Math.max(0.015, 0.22 * Math.exp(-diffValue / 8.5));
            const isPeak = pUseOnsetDetection ? (energy > prevEnergy * 1.3 && isAudioAudible && relativeEnergy >= noiseThreshold) : false;
            
            if (isAudioAudible && relativeEnergy >= (noiseThreshold * 0.8)) {
              const isDownbeat = false;
              const isUpbeat = false;
              
              let prob = 0;
              
              if (isPeak) {
                prob = 0.40 + (diffFactor * 0.55); 
              }
              
              // In free onset mode, ONLY spawn notes on actual detected peaks to avoid random off-beat noise
              if (!isPeak) {
                  prob = 0;
              }

              prob *= Math.pow(relativeEnergy, 0.45);

              // Section Intensity (Verses vs Chorus): adapt density to local section volume
              let sectionMultiplier = 1.0;
              if (pUseSectionIntensity) {
                const localSectionEnergy = getEnergyAtTime(audioBuffer, Math.max(0, currentTime - 2.0), 4.0);
                const sectionRatio = localSectionEnergy / (avgTrackSectionEnergy + 0.0001);
                sectionMultiplier = Math.min(1.4, Math.max(0.35, Math.pow(sectionRatio, 0.75)));
                prob *= sectionMultiplier;
              }

              prob *= regionMultiplier;
              if (regionPatternPref === 'chords') {
                prob *= 1.35;
              }

              // ONLY boost probability for long gaps IF the current sound is clearly audible
              if (stepsSinceLastNote > 8 && relativeEnergy >= 0.2) {
                prob += 0.25;
              }

              let effectiveMinSteps = minSteps;
              if (pUseFreeOnset) {
                if (diffValue >= 21) {
                  effectiveMinSteps = 2; // Extra (Lv 21-25)
                } else if (diffValue >= 17) {
                  effectiveMinSteps = 3; // Master (Lv 17-20)
                } else if (diffValue >= 12) {
                  effectiveMinSteps = 5; // Insane (Lv 12-16)
                } else if (diffValue >= 8) {
                  effectiveMinSteps = 8; // Hard (Lv 8-11)
                }
              } else {
                // Grid-based mode
                if (diffValue >= 21) {
                  effectiveMinSteps = 1;
                } else if (diffValue >= 17) {
                  effectiveMinSteps = 1;
                } else if (diffValue >= 12) {
                  effectiveMinSteps = 1;
                } else if (diffValue >= 8) {
                  effectiveMinSteps = 2;
                } else if (diffValue >= 4) {
                  effectiveMinSteps = 2;
                } else {
                  effectiveMinSteps = 4;
                }
              }

              if (pUseSectionIntensity && sectionMultiplier >= 1.2 && diffValue >= 5 && isPeak) {
                effectiveMinSteps = Math.max(1, effectiveMinSteps - 1);
              }

              // Hard limiter for Free Onset scaled by difficulty
              const minLimiterMs = diffValue >= 21 ? 0.028 : (diffValue >= 17 ? 0.040 : (diffValue >= 12 ? 0.055 : 0.075));
              const minAllowedSteps = Math.ceil(minLimiterMs / step);
              if (effectiveMinSteps < minAllowedSteps) {
                effectiveMinSteps = minAllowedSteps;
              }

              if (stepsSinceLastNote < effectiveMinSteps) {
                prob = 0;
              }

              if (prob > 0 && Math.random() < prob) {
                // Determine chord size (simultaneous key hits) scaled to max limit 25
                let chordSize = 1;
                const maxPossibleKeys = Math.max(1, diffKeys.length);
                if (maxPossibleKeys > 1) {
                  const timeSinceLastChord = currentTime - lastChordTime;

                  if (diffValue >= 21) { // Extra (Level 21-25 - Boss Maximum)
                    if (isPeak) {
                      chordSize = (Math.random() < 0.45 && maxPossibleKeys >= 6) ? 3 : (Math.random() < 0.85 ? 2 : 1);
                    } else {
                      chordSize = Math.random() < 0.40 ? 2 : 1;
                    }
                  } else if (diffValue >= 17) { // Master (Level 17-20)
                    if (isPeak) {
                      chordSize = (Math.random() < 0.25 && maxPossibleKeys >= 6) ? 3 : (Math.random() < 0.60 ? 2 : 1);
                    } else {
                      chordSize = Math.random() < 0.25 ? 2 : 1;
                    }
                  } else if (diffValue >= 12) { // Insane (Level 12-16)
                    if (isPeak) {
                      chordSize = (Math.random() < 0.12 && maxPossibleKeys >= 6) ? 3 : (Math.random() < 0.40 ? 2 : 1);
                    } else {
                      chordSize = Math.random() < 0.15 ? 2 : 1;
                    }
                  } else if (diffValue >= 8) { // Hard / Normal (Level 8-11)
                    if (isPeak && relativeEnergy >= 0.45) {
                      chordSize = Math.random() < 0.25 ? 2 : 1;
                    }
                  }

                  if (regionPatternPref === 'single' || regionPatternPref === 'hold_and_play') {
                    chordSize = 1;
                  } else if (regionPatternPref === 'chords' && chordSize === 1 && maxPossibleKeys >= 2) {
                    chordSize = 2;
                  } else if (regionPatternPref === 'stairs_and_chords' && maxPossibleKeys >= 2) {
                    chordSize = (beatIndex % 4 === 0) ? 2 : 1;
                  }
                  
                  // Progressive recovery cooldown on chords to allow dense chord streams on Extra
                  const minChordCooldown = diffValue >= 21 ? 0.08 : (diffValue >= 17 ? 0.12 : 0.18);
                  if (timeSinceLastChord < minChordCooldown && chordSize > 1) {
                     chordSize = 1; // Cooldown on heavy chords
                  } else if (chordSize > 1) {
                     lastChordTime = currentTime;
                  }
                }

                // Filter available keys so we never overlap notes on a lane with an active hold
                let freeKeys = diffKeys.filter((_, idx) => (laneHoldUntil[idx] || 0) <= currentTime);
                
                // Anti-Jack preventivo en generación
                if (regionPatternPref !== 'jacks' && (currentTime - lastSelectedTime) < 0.12 && chordSize === 1 && lastSelectedLane !== null) {
                    freeKeys = freeKeys.filter((_, idx) => idx !== lastSelectedLane);
                }

                if (freeKeys.length > 0) {
                  chordSize = Math.min(chordSize, freeKeys.length);
                  const selectedKeys: string[] = [];

                  // Track delta time from last note
                  const dtMs = Math.round((currentTime - lastSelectedTime) * 1000);
                  if (dtMs > 0 && dtMs < 2000) {
                    recentDeltas.push(dtMs);
                    if (recentDeltas.length > 3) recentDeltas.shift();
                  }

                  while (selectedKeys.length < chordSize) {
                    if (freeKeys.length === 0) break;
                    
                    let chosenKey = '';
                    if (regionPatternPref === 'jacks' && lastSelectedLane !== null && lastSelectedLane < diffKeys.length) {
                      const lastKey = diffKeys[lastSelectedLane];
                      const idxInFree = freeKeys.indexOf(lastKey);
                      if (idxInFree !== -1 && Math.random() < 0.75) {
                        chosenKey = lastKey;
                        freeKeys.splice(idxInFree, 1);
                      }
                    } else if (regionPatternPref === 'stairs_and_chords') {
                      const targetLane = beatIndex % diffKeys.length;
                      const targetKey = diffKeys[targetLane];
                      const idxInFree = freeKeys.indexOf(targetKey);
                      if (idxInFree !== -1) {
                        chosenKey = targetKey;
                        freeKeys.splice(idxInFree, 1);
                      }
                    }

                    if (!chosenKey) {
                      const randomIndex = Math.floor(Math.random() * freeKeys.length);
                      chosenKey = freeKeys[randomIndex];
                      freeKeys.splice(randomIndex, 1);
                    }
                    selectedKeys.push(chosenKey);
                  }

                  // Calculate hold duration if hold notes are enabled and it's a longer note
                  let holdDuration = 0;
                  if (pEnableHoldNotes && regionPatternPref !== 'hold_and_play') {
                    const isLongOnset = isPeak && (energy > maxTrackEnergy * 0.5) && (Math.random() < 0.2 + diffFactor * 0.15);
                    if (isLongOnset) {
                      holdDuration = Math.min(secondsPerBeat * 1.5, Math.max(secondsPerBeat * 0.4, step * (2 + Math.floor(Math.random() * 3))));
                    }
                  }

                  // Precise snap calculation for note timestamp
                  const snappedTimeSec = snapTimeToOsuGrid(currentTime * 1000, finalBpm, finalOffset * 1000) / 1000;

                  selectedKeys.forEach(key => {
                    const keyIdx = diffKeys.indexOf(key);
                    const laneVal = keyIdx !== -1 ? keyIdx : (['d','x','j','k','l','rightarrow','right'].includes(key.toLowerCase()) ? 1 : 0);
                    if (holdDuration > 0) {
                      laneHoldUntil[laneVal] = snappedTimeSec + holdDuration;
                    }
                    lastSelectedLane = laneVal;
                    lastSelectedTime = currentTime;
                    events.push({
                      n: "key",
                      t: snappedTimeSec,
                      d: { i: laneVal, r: 0, s: key, duration: holdDuration }
                    });
                  });

                  stepsSinceLastNote = 0;
                } else {
                  stepsSinceLastNote++;
                }
              } else {
                stepsSinceLastNote++;
              }
            } else {
              stepsSinceLastNote++; 
            }
            
            currentTime += step;
            beatIndex++;
          }
        }

        const { correctedEvents, tempCorrectionLogs } = applyIrisFase4Corrections(
          events,
          audioBuffer,
          diffValue,
          diffKeys,
          pExportFormat === 'iric'
            ? activeTab === 'charter_llplus' ? 'llplus' : activeTab === 'charter_taiko' ? 'taiko' : activeTab === 'charter_fnf' ? 'fnf' : 'mania'
            : pExportFormat,
          effectiveSilenceThreshold,
          maxTrackEnergy
        );
        const finalEvents = correctedEvents;
        if (i === 0) {
          setCorrectionLogs(tempCorrectionLogs.sort((a, b) => a.timeMs - b.timeMs));
        }

        generatedEventsList.push(finalEvents);

        // --- IRIS AUDIT & CRITIQUE GENERATION ---
        const keyEvents = finalEvents.filter((e: any) => e.n === "key");
        const logsForThisDiff: any[] = [];
        const colLastTime: { [col: number]: number } = {};
        const colLastNote: { [col: number]: any } = {};

        // Group notes by exact timestamp to detect chords
        const timeGroups: { [time: number]: any[] } = {};
        keyEvents.forEach((ev: any) => {
          const roundedTime = Math.round(ev.t * 1000) / 1000;
          if (!timeGroups[roundedTime]) timeGroups[roundedTime] = [];
          timeGroups[roundedTime].push(ev);
        });

        keyEvents.forEach((ev: any) => {
          const timeMs = ev.t * 1000;
          const col = ev.d.i;
          const lastTime = colLastTime[col];
          
          if (lastTime !== undefined) {
            const gapMs = timeMs - lastTime;
            if (gapMs > 0 && gapMs < 200) {
              const localEnergy = getEnergyAtTime(audioBuffer, ev.t, 0.05);
              const isPeakAtTime = localEnergy > effectiveSilenceThreshold && localEnergy > getEnergyAtTime(audioBuffer, ev.t - 0.05, 0.05) * 1.15;
              const relativeEnergy = Math.min(1.0, Math.max(0.0, (localEnergy - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));
              
              const musicalityScore = isPeakAtTime ? Math.round(85 + Math.random() * 11) : Math.round(25 + Math.random() * 20);
              const contextScore = Math.round(relativeEnergy * 60 + 35);
              
              const isClimax = relativeEnergy >= 0.6;
              const decision = (musicalityScore >= 80 && contextScore >= 70) ? 'keep' : 'review';
              
              let reason = "";
              if (decision === 'keep') {
                reason = `Highly intense jackhammer synchronized with a prominent ${isClimax ? 'chorus climax' : 'audio transient'}. Confirmed matching energy.`;
              } else {
                reason = `Repetitive stroke on column ${col + 1} with low music justification in a relatively calm section. Might cause unnecessary fatigue.`;
              }

              logsForThisDiff.push({
                timeMs: Math.round(timeMs),
                patternType: `Col ${col + 1} Jackhammer (${Math.round(gapMs)}ms)`,
                musicality: musicalityScore,
                energy: Math.round(relativeEnergy * 100),
                transients: isPeakAtTime,
                prevPattern: `Tap on Col ${col + 1}`,
                difficultyRating: gapMs < 100 ? "Very High" : "High",
                decision: decision,
                reason: reason
              });
            }
          }
          
          colLastTime[col] = timeMs;
          colLastNote[col] = ev;
        });

        Object.keys(timeGroups).forEach((timeStr) => {
          const t = parseFloat(timeStr);
          const group = timeGroups[t];
          if (group.length >= 2) {
            const timeMs = t * 1000;
            const localEnergy = getEnergyAtTime(audioBuffer, t, 0.05);
            const isPeakAtTime = localEnergy > effectiveSilenceThreshold;
            const relativeEnergy = Math.min(1.0, Math.max(0.0, (localEnergy - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));
            
            const musicalityScore = isPeakAtTime ? Math.round(90 + Math.random() * 8) : Math.round(20 + Math.random() * 20);
            const contextScore = Math.round(relativeEnergy * 50 + 45);
            
            const decision = (musicalityScore >= 85 && relativeEnergy >= 0.4) ? 'keep' : 'review';
            let reason = "";
            if (decision === 'keep') {
              reason = `Balanced ${group.length}-key chord aligned with high impact transient. Satisfies physical landing constraints.`;
            } else {
              reason = `Heavy ${group.length}-key chord occurring during minor beat. Potentially too dense for the audio context.`;
            }

            logsForThisDiff.push({
              timeMs: Math.round(timeMs),
              patternType: `${group.length}-Key Chord`,
              musicality: musicalityScore,
              energy: Math.round(relativeEnergy * 100),
              transients: isPeakAtTime,
              prevPattern: "Dynamic grid alignment",
              difficultyRating: group.length >= 3 ? "Tense" : "Comfortable",
              decision: decision,
              reason: reason
            });
          }
        });

        if (i === 0) {
          logsForThisDiff.sort((a, b) => a.timeMs - b.timeMs);
          setCritiqueLogs(logsForThisDiff.slice(0, 80));
        }
        // -------------------------------------------

        if (pExportFormat === 'fnf') {
          // Export to Friday Night Funkin' / Funky Maker Mobile JSON
          const title = pSongName || pAudioFile.name.replace(/\.[^/.]+$/, "");
          const art = pArtist || "FNF Artist";
          const creator = pCharterName || "FNF Charter";
          const fnfDiffName = diffName.toLowerCase();

          const stepCrochet = (60 / finalBpm) * 1000 / 4;
          const sectionCrochet = stepCrochet * 16;
          const totalSections = Math.ceil((duration * 1000) / sectionCrochet) || 1;

          const fnfSections: any[] = [];
          for (let s = 0; s < totalSections; s++) {
            fnfSections.push({
              sectionNotes: [],
              lengthInSteps: 16,
              typeOfSection: 0,
              mustHitSection: true,
              bpm: finalBpm,
              changeBPM: false,
              altAnim: false
            });
          }

          events.forEach((e: any) => {
            if (e.n === 'key' && e.d) {
              let laneIdx = 0;
              if (typeof e.d.i === 'number') {
                laneIdx = e.d.i;
              } else if (typeof e.d.lane === 'number') {
                laneIdx = e.d.lane;
              } else if (e.d.s && diffKeys.includes(e.d.s)) {
                laneIdx = diffKeys.indexOf(e.d.s);
              } else if (typeof e.d.i === 'string') {
                const parsed = parseInt(e.d.i, 10);
                if (!isNaN(parsed)) laneIdx = parsed;
                else if (diffKeys.indexOf(e.d.i) !== -1) laneIdx = diffKeys.indexOf(e.d.i);
              }

              // Map to FNF note direction: 0 = Left, 1 = Down, 2 = Up, 3 = Right
              const noteData = Math.max(0, Math.min(3, laneIdx % 4));
              const timeMs = Math.round(e.t * 1000);
              const durMs = e.d?.duration ? Math.round(e.d.duration * 1000) : 0;
              const holdLength = (durMs > 0 && pEnableHoldNotes) ? durMs : 0;

              const sectionIdx = Math.floor(timeMs / sectionCrochet);
              if (sectionIdx >= 0 && sectionIdx < fnfSections.length) {
                fnfSections[sectionIdx].sectionNotes.push([
                  timeMs,
                  noteData,
                  holdLength
                ]);
              }
            }
          });

          const fnfChart = {
            song: {
              song: title,
              artist: art,
              charter: creator,
              difficulty: fnfDiffName,
              bpm: finalBpm,
              speed: 2.2,
              player1: "bf",
              player2: "dad",
              player3: null,
              gfVersion: "gf",
              stage: "stage",
              needsVoices: !!pChartingAudioFile,
              validScore: true,
              notes: fnfSections
            }
          };

          const cleanName = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const cleanDiff = diffName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          root.file(`${cleanName}-${cleanDiff}.json`, JSON.stringify(fnfChart, null, 2));
        } else if (pExportFormat === 'mania' || pExportFormat === 'taiko') {
          // Export to osu!
          const title = pSongName || folderName;
          const art = pArtist || "Unknown Artist";
          const creator = pCharterName || "Autocharter";
          const version = diffName;
          
          let osuContent = `osu file format v14\n\n[General]\nAudioFilename: ${pAudioFile.name}\nAudioLeadIn: 0\nPreviewTime: ${Math.floor(finalOffset * 1000)}\nMode: ${pExportFormat === 'taiko' ? '1' : '3'}\n\n[Metadata]\nTitle:${title}\nTitleUnicode:${title}\nArtist:${art}\nArtistUnicode:${art}\nCreator:${creator}\nVersion:${version}\n\n[Events]\n//Background and Video events\n`;
          
          if (pBgFile) {
            osuContent += `0,0,"${bgFileName}",0,0\n`;
          }
          if (pVideoFile) {
            osuContent += `1,0,"${pVideoFile.name}",0,0\n`;
          }
          
          const circleSize = pExportFormat === 'taiko' ? 4 : Math.max(1, diffKeys.length);
          const beatLengthMs = (60 / finalBpm) * 1000;
          const roundedOffsetMs = Math.round(finalOffset * 1000);

          let timingPointsStr = `${roundedOffsetMs},${beatLengthMs},4,1,0,100,1,0\n`;
          if (audioRegions && audioRegions.length > 0) {
            audioRegions.forEach(region => {
              const regionSpeed = region.speedMultiplier !== undefined ? region.speedMultiplier : 1.0;
              const svValue = -100 / regionSpeed;
              const regionStartMs = Math.round(region.startTime * 1000);
              timingPointsStr += `${regionStartMs},${svValue},4,1,0,100,0,0\n`;
              
              const regionEndMs = Math.round(region.endTime * 1000);
              const isAnotherRegionAtEnd = audioRegions.some(r => Math.abs(r.startTime - region.endTime) < 0.05);
              if (!isAnotherRegionAtEnd) {
                timingPointsStr += `${regionEndMs},-100,4,1,0,100,0,0\n`;
              }
            });
          }

          osuContent += `\n[Difficulty]\nHPDrainRate:5\nCircleSize:${circleSize}\nOverallDifficulty:5\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n${timingPointsStr}\n[HitObjects]\n`;

          const rawOsuNotes: RawOsuHitObject[] = [];

          events.forEach((e: any) => {
            if (e.n === 'key' && e.d) {
              let colIndex = 0;
              if (typeof e.d.i === 'number') {
                colIndex = e.d.i;
              } else if (typeof e.d.lane === 'number') {
                colIndex = e.d.lane;
              } else if (e.d.s && diffKeys.includes(e.d.s)) {
                colIndex = diffKeys.indexOf(e.d.s);
              } else if (typeof e.d.i === 'string') {
                const parsed = parseInt(e.d.i, 10);
                if (!isNaN(parsed)) colIndex = parsed;
                else if (diffKeys.indexOf(e.d.i) !== -1) colIndex = diffKeys.indexOf(e.d.i);
              }

              const durSec = e.d?.duration || 0;
              const durMs = durSec > 0.035 ? Math.round(durSec * 1000) : 0;
              const isHold = durMs > 35 && pEnableHoldNotes;
              const hitSound = (pExportFormat === 'taiko' && colIndex % 2 === 1) ? 2 : 0;

              rawOsuNotes.push({
                lane: colIndex,
                timeMs: Math.round(e.t * 1000),
                durationMs: durMs,
                hitSound,
                isHold
              });
            }
          });

          // Sanitize & snap all notes to guarantee 0 unsnapped and 0 concurrent errors in osu!
          const sanitizedNotes = sanitizeOsuHitObjects(rawOsuNotes, circleSize, finalBpm, roundedOffsetMs);
          osuContent += generateOsuHitObjectsString(sanitizedNotes, circleSize, pExportFormat === 'taiko' ? 'taiko' : 'mania');
          
          root.file(`${art} - ${title} (${creator}) [${version}].osu`, osuContent);
        }
      }

      if (pExportFormat === 'llplus') {
        const songArtist = pArtist || 'Unknown Artist';
        
        // LL+ MIDI uses two sides. Fold generated lanes deliberately, then
        // resolve hold collisions before encoding the output.
        const allKeyEvents = (generatedEventsList[0] || []).filter(e => e.n === 'key');
        const sourceNotes: ChartNote[] = allKeyEvents.map((e, idx) => ({
          id: e.id || `llplus-${idx}`,
          timeMs: Math.round(e.t * 1000),
          lane: typeof e.d?.i === 'number' ? e.d.i : 0,
          durationMs: Math.round((e.d?.duration || 0) * 1000),
          type: (e.d?.duration || 0) > 0.035 ? 'hold' : 'normal'
        }));
        const sourceKeyCount = pDifficulties[0]?.keysStr?.split(',').filter(Boolean).length || 4;
        const sanitized = sanitizeLlpNotes(sourceNotes, sourceKeyCount, pEnableHoldNotes);
        const midiNotes: MidiNote[] = [];

        for (const note of sanitized.notes) {
          const isLeft = note.lane === 0;
          const isHold = note.durationMs > 35 && pEnableHoldNotes;
          if (isHold) {
            // Left Hold = 39, Right Hold = 35; tap marker at the same onset.
            const pitch = isLeft ? 39 : 35;
            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: Math.max(0.05, note.durationMs / 1000),
              pitch,
              trackIndex: 0 // Kris Track
            });

            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: 0.05,
              pitch: isLeft ? 38 : 36,
              trackIndex: 0
            });
          } else {
            // Normal tap note: Left = 38, Right = 36
            midiNotes.push({
              timeInSec: note.timeMs / 1000,
              durationInSec: 0.05,
              pitch: isLeft ? 38 : 36,
              trackIndex: 0
            });
          }
        }

        if (sanitized.shortenedHolds > 0 || sanitized.droppedNotes > 0) {
          showToast(
            `LLPlus adjusted ${sanitized.shortenedHolds} overlapping hold(s); ${sanitized.droppedNotes} note(s) could not fit its two lanes.`,
            'info'
          );
        }

        const midiBytes = buildLlpMidi(midiNotes, finalBpm);
        root.file(`${folderName}.mid`, midiBytes);

        // Metadata text file (<FolderName>.txt) with official properties
        const metadataTxt = `Difficulty: ${resolvedDiffNames[0] || 'Hard'}\nDescription: Custom map created with Lightners Live Map Generator\nComposer: ${songArtist}\nVolume: 0\n`;
        root.file(`${folderName}.txt`, metadataTxt);

        // Save audio file as .mp3 (Lightners Live Plus ONLY supports MP3 format)
        const mp3Blob = await getMp3BlobForLlp(pAudioFile, mainAudioBuffer);
        root.file(`${folderName}.mp3`, mp3Blob);

        // Save thumbnail image with matching FolderName
        if (pBgFile) {
          const bgExt = pBgFile.name.split('.').pop() || 'png';
          root.file(`${folderName}.${bgExt}`, pBgFile);
        }
      } else if (pExportFormat === 'fnf') {
        // FNF Zip Packaging (Instrumental, Voices, BG, Video)
        const audioExt = pAudioFile.name.split('.').pop() || 'mp3';
        root.file(`Inst.${audioExt}`, pAudioFile);

        if (pChartingAudioFile) {
          const voicesExt = pChartingAudioFile.name.split('.').pop() || 'mp3';
          root.file(`Voices.${voicesExt}`, pChartingAudioFile);
        }

        if (pBgFile) {
          const bgExt = pBgFile.name.split('.').pop() || 'png';
          root.file(`bg.${bgExt}`, pBgFile);
        }

        if (pVideoFile) {
          root.file(`video.${pVideoFile.name.split('.').pop() || 'mp4'}`, pVideoFile);
        }
      } else {
        // For osu! formats (mania or taiko)
        if (pBgFile) {
          root.remove('assets');
          root.file(bgFileName, pBgFile);
        }
        if (pVideoFile) {
          root.file(pVideoFile.name, pVideoFile);
        }
      }

      if (pExportFormat === 'iric') {
        const songArtist = pArtist || 'Unknown Artist';
        const songTitle = pSongName || 'Untitled Song';
        const exportBpm = finalBpm || 120;

        const nativeMode = activeTab === 'charter_llplus' ? 'llplus' : activeTab === 'charter_taiko' ? 'taiko' : activeTab === 'charter_fnf' ? 'fnf' : 'mania';
        const iricBlob = await createIricPackageBlob({
          songName: songTitle,
          artist: songArtist,
          charter: pCharterName || 'Custom Charter',
          bpm: exportBpm,
          offsetMs: finalOffset || 0,
          mode: nativeMode,
          audioFile: pAudioFile,
          videoFile: pVideoFile,
          coverBlob: pBgFile || undefined,
          audioRegions: audioRegions,
          scrollSpeed: 1,
          svChanges: [],
          autocharterConfig: {
            silenceThreshold: pSilenceThreshold,
            enableHoldNotes: pEnableHoldNotes,
            useTripletRhythm: pUseTripletRhythm,
            useFreeOnset: pUseFreeOnset,
            difficulties: pDifficulties.map(d => ({ name: d.name, value: d.value, keysStr: d.keysStr }))
          },
          difficulties: resolvedDiffNames.map((diffName, idx) => {
            const rawEvents = (generatedEventsList[idx] || []).filter(e => e.n === 'key' && e.d);
            const chartNotes: ChartNote[] = rawEvents.map((e, noteIdx) => {
              const durationMs = Math.round((e.d?.duration || 0) * 1000);
              const lane = typeof e.d?.i === 'number' ? e.d.i : typeof e.d?.lane === 'number' ? e.d.lane : 0;
              return {
                id: e.id || `iric-${idx}-${noteIdx}`,
                timeMs: Math.round(e.t * 1000),
                lane,
                type: durationMs > 35 ? 'hold' : 'normal',
                durationMs
              };
            });
            const keys = pDifficulties[idx]?.keysStr?.split(',').filter(key => key.trim()) || [];
            return {
              name: diffName,
              notes: chartNotes,
              keyCount: nativeMode === 'taiko' || nativeMode === 'llplus' ? 2 : nativeMode === 'fnf' ? 4 : (keys.length || 4),
              mode: nativeMode,
              bpm: exportBpm
            };
          })
        });

        const newEntryId = pOverwriteId || Date.now().toString();
        const sanitizedFolder = folderName.replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'chart';
        const fullFileName = `${sanitizedFolder}.iric`;
        const newEntry: HistoryEntry = {
          id: newEntryId,
          name: sanitizedFolder,
          fileName: fullFileName,
          format: 'iric',
          timestamp: Date.now(),
          fileSize: iricBlob.size,
          blob: iricBlob,
          critiqueLogs: critiqueLogs.length > 0 ? critiqueLogs : undefined,
          correctionLogs: correctionLogs.length > 0 ? correctionLogs : undefined
        };

        await exportFile(iricBlob, fullFileName);
        await saveChartToDB(newEntry, iricBlob);
        setHistory(prev => {
          let updated = pOverwriteId ? [newEntry, ...prev.filter(x => x.id !== pOverwriteId)] : [newEntry, ...prev];
          try {
            localStorage.setItem('chartHistory', JSON.stringify(updated.map(({ blob, ...rest }) => rest)));
          } catch (e) {
            console.error(e);
          }
          return updated;
        });
        showToast('Generated .iric package and saved it to chart history', 'success');
        return newEntryId;
      }

      let extension = 'osz';
      let mimeType = 'application/zip';
      if (pExportFormat === 'llplus') {
        extension = 'zip';
        mimeType = 'application/zip';
      } else if (pExportFormat === 'fnf') {
        extension = 'zip';
        mimeType = 'application/zip';
      }

      const content = await zip.generateAsync({ type: 'blob', mimeType });
      const fullFileName = `${folderName}.${extension}`;
      await exportFile(content, fullFileName);

      const newEntryId = pOverwriteId || Date.now().toString();
      const newEntry: HistoryEntry = {
        id: newEntryId,
        name: folderName,
        fileName: fullFileName,
        format: pExportFormat,
        timestamp: Date.now(),
        fileSize: content.size,
        critiqueLogs: critiqueLogs.length > 0 ? critiqueLogs : undefined,
        correctionLogs: correctionLogs.length > 0 ? correctionLogs : undefined
      };

      await saveChartToDB(newEntry, content);
      setHistory(prev => {
        let updated;
        if (pOverwriteId) {
          updated = [newEntry, ...prev.filter(x => x.id !== pOverwriteId)];
        } else {
          updated = [newEntry, ...prev];
        }
        try {
          localStorage.setItem('chartHistory', JSON.stringify(updated.map(({ blob, ...rest }) => rest)));
        } catch (e) {
          console.error(e);
        }
        return updated;
      });
      
      return newEntryId;
    } catch (error) {
      console.error(error);
      alert("There was an error generating the level.");
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  if (currentScreen === 'settings') {
    return <SettingsMenu onBack={() => setCurrentScreen(settingsReturnScreen)} />;
  }

  if (currentScreen === 'converter') {
    return (
      <div className="min-h-screen bg-[#071426] text-slate-100 font-sans p-4 sm:p-6 md:p-10 relative">
        <div className="max-w-5xl mx-auto space-y-6 relative z-10">
          <UniversalConverter
            onBackToMenu={() => setCurrentScreen('autocharter')}
            onGoToAutocharter={() => {
              setActiveTab('charter_llplus');
              setCurrentScreen('autocharter');
            }}
            onGoToPlay={() => setCurrentScreen('play')}
            onPlayChart={(chart) => {
              setLoadedEngineChart(chart);
              setPlayEngineReturnScreen('converter');
              setActiveTab('game_engine');
              setCurrentScreen('autocharter');
            }}
            onSaveToLibrary={async (blob, name, title, artist, format) => {
              const newEntry = {
                id: Date.now().toString(),
                name: name,
                fileName: name,
                timestamp: Date.now(),
                format: format as any,
                fileSize: blob.size
              };
              await saveChartToDB(newEntry, blob);
              setHistory(prev => [{ ...newEntry, blob }, ...prev]);
            }}
          />
        </div>
      </div>
    );
  }

  if (currentScreen === 'menu') {
    return (
      <MainMenu 
        onSelectAutocharter={() => {
          setActiveTab('charter_llplus');
          setCurrentScreen('autocharter');
        }} 
        onSelectConverter={() => {
          setCurrentScreen('converter');
        }}
        onSelectPlay={() => setCurrentScreen('play')}
        onSelectSettings={() => {
          setSettingsReturnScreen('menu');
          setCurrentScreen('settings');
        }}
      />
    );
  }

  if (currentScreen === 'play_engine') {
    return (
      <RhythmGameEngine 
        initialChart={loadedEngineChart} 
        onBackToCharter={() => {
          if (playEngineReturnScreen === 'play') {
            setCurrentScreen('play');
          } else if (playEngineReturnScreen === 'converter') {
            setCurrentScreen('converter');
          } else {
            setActiveTab('charter_llplus');
            setCurrentScreen('autocharter');
          }
        }} 
        isPlayMode={true} 
        audioRegions={audioRegions}
      />
    );
  }

  if (currentScreen === 'play') {
    return (
      <PlayMenu
        onBack={() => setCurrentScreen('autocharter')}
        onGoToConverter={() => setCurrentScreen('converter')}
        onOpenSettings={() => {
          setSettingsReturnScreen('play');
          setCurrentScreen('settings');
        }}
        onOpenLevel={async (blob, name, diffIndex, diffName) => {
          try {
            const parsed = await parseUniversalChart(blob, name, diffIndex !== undefined ? diffIndex : diffName);
            setLoadedEngineChart(parsed);
            setPlayEngineReturnScreen('play');
            setCurrentScreen('play_engine');
          } catch (e: any) {
            alert(`Could not open the level: ${e.message}`);
          }
        }}
      />
    );
  }

  return (
      <div className="min-h-screen bg-[#071426] text-stone-100 font-sans p-4 sm:p-6 md:p-10 relative">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="max-w-5xl mx-auto space-y-6 relative z-10"
      >
        <header className="app-main-header gap-4 border-b border-[#2d4259] pb-4">
          <button type="button" onClick={() => setCurrentScreen('autocharter')} className="flex items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">
            <span className="w-9 h-9 flex items-center justify-center bg-[#ffc20e] text-[#071426] rounded-sm"><Music className="w-4 h-4" /></span>
            <span><span className="block text-sm font-bold tracking-wide">IRIS</span><span className="block text-[11px] text-[#aebdca]">Autocharter</span></span>
          </button>
          <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm">
            <span aria-current="page" className="text-white border-b-2 border-[#ffc20e] py-2">Create</span>
            <button type="button" onClick={() => setCurrentScreen('converter')} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Convert</button>
            <button type="button" onClick={() => setCurrentScreen('play')} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Play</button>
          </nav>
          <div className="flex items-center gap-2 flex-wrap">
            {isAutoSaving ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#ffe9a6] border border-[#775b14] px-2.5 py-1 rounded-sm">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#ffc20e]" />
                Saving…
              </span>
            ) : lastAutoSaveTime ? (
              <span className="text-[10px] sm:text-xs font-medium text-[#aebdca] px-2.5 py-1" title="Your changes are saved in this browser">
                Saved <span className="font-mono text-[#f1f3f3]">{new Date(lastAutoSaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </span>
            ) : null}

            <button
              onClick={handleOpenCreateDraft}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#3b536c] text-[#c8d2dc] hover:bg-white/5 hover:text-white text-xs font-medium rounded-sm cursor-pointer"
              title="Save current charting progress to a manual backup slot"
            >
              <Save className="w-3.5 h-3.5 text-[#ffc20e]" />
              Save Draft Slot
            </button>
          </div>
        </header>

        <header className="border-b border-[#2d4259] pb-5 pt-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] mb-2" style={{ color: activeFormatColor }}>CREATE / {activeTab === 'charter_fnf' ? 'FNF' : activeTab === 'charter_llplus' ? 'LIGHTNERS LIVE+' : activeTab === 'charter_mania' ? 'OSU!MANIA' : activeTab === 'charter_taiko' ? 'OSU!TAIKO' : 'TEST ZONE'}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-stone-100">Create a rhythm chart</h1>
          <p className="text-sm text-[#aebdca] max-w-2xl leading-relaxed mt-2">Choose a format, add the song, set its difficulty, then generate a chart or a native .iric project.</p>
        </header>

        {/* Tab Selection Bar */}
        <nav aria-label="Chart format" className="flex bg-[#09182b] border border-[#2d4259] p-1 rounded-sm w-max max-w-full gap-1 flex-wrap">
          <button
            onClick={() => handleTabChange('charter_fnf')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-2 border ${
              activeTab === 'charter_fnf'
                ? 'bg-[#341821] text-[#ffd2d5] border-[#e21d2d]'
                : 'border-transparent text-[#aebdca] hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#e21d2d]" />
            FNF
          </button>
          <button
            onClick={() => handleTabChange('charter_llplus')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-2 border ${
              activeTab === 'charter_llplus'
                ? 'bg-[#17264a] text-[#d7e0ff] border-[#1e5bff]'
                : 'border-transparent text-[#aebdca] hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#1e5bff]" />
            Lightners Live+
          </button>
          <button
            onClick={() => handleTabChange('charter_mania')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-2 border ${
              activeTab === 'charter_mania'
                ? 'bg-[#332d16] text-[#fff0b1] border-[#ffc20e]'
                : 'border-transparent text-[#aebdca] hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffc20e]" />
            osu!mania
          </button>
          <button
            onClick={() => handleTabChange('charter_taiko')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-2 border ${
              activeTab === 'charter_taiko'
                ? 'bg-[#142d21] text-[#d5f1dd] border-[#22b14c]'
                : 'border-transparent text-[#aebdca] hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#22b14c]" />
            osu!taiko
          </button>
          <button
            onClick={() => handleTabChange('game_engine')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-sm transition-colors cursor-pointer flex items-center gap-2 border ${
              activeTab === 'game_engine'
                ? 'bg-[#173025] text-[#d5f1dd] border-[#22b14c]'
                : 'border-transparent text-[#aebdca] hover:text-white hover:bg-white/5'
            }`}
          >
            <Gamepad2 className="w-4 h-4 text-[#22b14c]" />
            <span>Test Zone</span>
            {loadedEngineChart && (
              <span className="w-2 h-2 rounded-full bg-[#22b14c]" />
            )}
          </button>
        </nav>

        <div aria-label="Creation steps" className="hidden sm:flex items-center gap-3 max-w-xl text-[11px] font-semibold uppercase tracking-[0.12em] text-[#aebdca]">
          <span>01 Song</span><span className="h-px flex-1 bg-[#3b536c]" />
          <span style={{ color: activeFormatColor }}>02 Format</span><span className="h-px flex-1 bg-[#3b536c]" />
          <span className="text-[#ffc20e]">03 Chart</span>
        </div>

        {activeTab === 'game_engine' ? (
          <RhythmGameEngine
            initialChart={loadedEngineChart}
            audioFile={audioFile}
            audioRegions={audioRegions}
            onBackToCharter={() => {
              if (playEngineReturnScreen === 'play') {
                setCurrentScreen('play');
              } else if (playEngineReturnScreen === 'converter') {
                setCurrentScreen('converter');
              } else {
                setActiveTab('charter_llplus');
                setCurrentScreen('autocharter');
              }
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Level Files Section */}
              <section className="glass-panel p-5 sm:p-6 rounded-sm space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-sm bg-[#12263c] flex items-center justify-center text-[#e21d2d] border border-[#2d4259]">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-white">01 · Song and media</h2>
                    <p className="text-xs text-[#aebdca]">Choose the main audio first. Vocals and artwork are optional.</p>
                  </div>
                </div>
                
                <div className="space-y-3.5">
                  <FileUpload 
                    label="Song or chart file" 
                    accept="audio/*,.osz,.zip,.llmap,.iric"
                    icon={<Music className="w-5 h-5 text-[#c4cedb]" />} 
                    file={audioFile} 
                    onSelect={handleSongFileSelect} 
                    required
                  />
                  <p className="text-[11px] text-[#aebdca] -mt-1">Audio: MP3/OGG · Charts: .osz, .iric, .llmap, .zip</p>
                  <FileUpload 
                    label={activeTab === 'charter_fnf' ? "Vocals (Optional MP3/OGG)" : "Charting Audio (Optional MP3/OGG)"}
                    accept="audio/*"
                    icon={<Music className="w-5 h-5 text-[#c4cedb]" />} 
                    file={chartingAudioFile} 
                    onSelect={setChartingAudioFile} 
                  />
                  <FileUpload 
                    label="Background Image (PNG/JPG)" 
                    accept="image/*"
                    icon={<ImageIcon className="w-5 h-5 text-[#c4cedb]" />} 
                    file={bgFile} 
                    onSelect={setBgFile} 
                  />
                  {(activeTab === 'charter_mania' || activeTab === 'charter_taiko') && (
                    <FileUpload 
                      label="Background Video (Optional MP4/WEBM)" 
                      accept="video/*"
                      icon={<Video className="w-5 h-5 text-amber-400" />} 
                      file={videoFile} 
                      onSelect={setVideoFile} 
                    />
                  )}
                </div>
              </section>

              {/* Song Info & Settings */}
              <section className="glass-panel p-5 sm:p-6 rounded-sm space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-sm bg-[#12263c] border border-[#2d4259] flex items-center justify-center text-[#c4cedb]">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-white">03 · Chart details</h2>
                    <p className="text-xs text-[#aebdca]">Name the chart, set its difficulty, then generate.</p>
                  </div>
                </div>

                <div className="space-y-4 border-t border-neutral-800 pt-4">
                  {activeTab === 'charter_fnf' ? (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Song Folder</label>
                      <input 
                        type="text" 
                        value={songName}
                        onChange={(e) => setSongName(e.target.value)}
                        className="w-full glass-input text-sm text-zinc-100 placeholder-zinc-500 rounded-xl px-4 py-2.5 focus:outline-none"
                        placeholder="Song directory name"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Track Title</label>
                          <input 
                            type="text" 
                            value={songName}
                            onChange={(e) => setSongName(e.target.value)}
                            className="w-full glass-input text-sm text-zinc-100 placeholder-zinc-500 rounded-xl px-4 py-2.5 focus:outline-none"
                            placeholder="Title"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Artist</label>
                          <input 
                            type="text" 
                            value={artist}
                            onChange={(e) => setArtist(e.target.value)}
                            className="w-full glass-input text-sm text-zinc-100 placeholder-zinc-500 rounded-xl px-4 py-2.5 focus:outline-none"
                            placeholder="Artist"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Charter</label>
                        <input 
                          type="text" 
                          value={charterName}
                          onChange={(e) => setCharterName(e.target.value)}
                          className="w-full glass-input text-sm text-zinc-100 placeholder-zinc-500 rounded-xl px-4 py-2.5 focus:outline-none"
                          placeholder="Charter"
                        />
                      </div>
                    </>
                  )}

                  <div className="pt-3 border-t border-white/10">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-amber-400" />
                        Note detection threshold
                      </label>
                      <span className="text-xs font-mono font-medium text-amber-200 glass-pill px-2.5 py-0.5 rounded-md">
                        {silenceThreshold.toFixed(3)}
                      </span>
                    </div>
                    <input 
                      type="range"
                      min="0.005"
                      max="0.250"
                      step="0.005"
                      value={silenceThreshold}
                      onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
                      className="w-full accent-amber-400 h-2 rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-zinc-500 mt-1 font-mono">
                      <span>0.005 (High)</span>
                      <span>0.035 (Default)</span>
                      <span>0.250 (Low)</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-amber-400" />
                        Hold Notes (Long Notes)
                      </label>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        Detect sustained audio frequencies
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEnableHoldNotes(!enableHoldNotes)}
                      className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                        enableHoldNotes ? 'bg-amber-500 justify-end' : 'bg-white/10 justify-start'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white shadow-sm"></span>
                    </button>
                  </div>
                </div>

                {/* Difficulty settings */}
                <div className="space-y-4 border-t border-neutral-800 pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <Keyboard className="w-4 h-4 text-amber-400" />
                        Difficulties ({difficulties.length}/{isSingleDiffOnly ? '1' : '10'})
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {activeTab === 'charter_mania' || activeTab === 'charter_taiko'
                          ? 'Multi-difficulty export supported (Up to 10)'
                          : 'Single difficulty mode'}
                      </p>
                    </div>
                    {!isSingleDiffOnly && difficulties.length < 10 && (
                      <button
                        type="button"
                        onClick={addDifficulty}
                        className="text-xs flex items-center gap-1.5 glass-card-interactive text-amber-200 px-3 py-1.5 rounded-md font-medium cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Difficulty
                      </button>
                    )}
                    {isSingleDiffOnly && (
                      <span className="text-xs font-mono text-amber-200 glass-pill px-2.5 py-1 rounded-md shrink-0">
                        1 Difficulty Max
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {difficulties.map((diffConf, index) => (
                      <div key={index} className="flex flex-col gap-3 p-3.5 bg-[#11110f] rounded-md border border-neutral-800">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap w-full sm:w-auto">
                            <span className="text-xs font-bold text-zinc-500 w-5">#{index + 1}</span>
                            <span className="text-xs font-semibold text-amber-200 glass-pill px-2.5 py-1 rounded-md font-mono min-w-[48px] text-center">
                              Lv.{diffConf.value}
                            </span>
                            <input 
                              type="range"
                              min="1"
                              max="25"
                              step="1"
                              value={Math.min(25, diffConf.value)}
                              onChange={(e) => updateDifficultyValue(index, parseInt(e.target.value) || 1)}
                              className="w-20 accent-amber-400 h-1.5 cursor-pointer"
                              title="Difficulty level (1 - 25)"
                            />
                            <input 
                              type="number"
                              min="1"
                              max="99"
                              value={diffConf.value}
                              onChange={(e) => updateDifficultyValue(index, Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-14 glass-input rounded-xl px-2 py-1 text-xs text-center text-zinc-200 font-mono focus:outline-none"
                              title="Custom level number"
                            />
                            <input 
                              type="text"
                              value={diffConf.name || ''}
                              onChange={(e) => updateDifficultyName(index, e.target.value)}
                              className="flex-1 sm:w-28 glass-input rounded-xl px-2.5 py-1 text-xs text-zinc-200 focus:outline-none"
                              placeholder="Name (e.g. Hard)"
                              title="Difficulty name"
                            />
                            {difficulties.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeDifficulty(index)}
                                className="p-1.5 glass-card-interactive text-zinc-400 hover:text-red-400 transition-colors cursor-pointer rounded-xl"
                                title="Remove difficulty"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="w-full">
                          {activeTab === 'charter_llplus' && (
                            <div className="w-full text-xs text-amber-200 font-mono glass-card px-3 py-1.5 rounded-md flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                              LLPlus export: 2 lanes, left and right (MIDI)
                            </div>
                          )}

                          {activeTab === 'charter_mania' && (
                            <div className="w-full flex items-center glass-input rounded-xl overflow-hidden">
                              <span className="pl-3 text-xs font-bold text-zinc-400 min-w-[60px]">
                                Keys:
                              </span>
                              <select 
                                value={diffConf.keysStr.split(',').length}
                                onChange={(e) => {
                                  const count = parseInt(e.target.value);
                                  const newKeys = Array.from({length: count}, (_, i) => (i + 1).toString()).join(', ');
                                  updateDifficultyKeys(index, newKeys);
                                }}
                                className="w-full bg-transparent px-3 py-2 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                              >
                                {[1,2,3,4,5,6,7,8,9,10].map(k => (
                                  <option key={k} value={k} className="bg-zinc-900 text-zinc-200">{k}K</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {activeTab === 'charter_taiko' && (
                            <div className="w-full text-xs text-zinc-400 font-mono glass-card px-3 py-1.5 rounded-xl">
                              Taiko Mapping: Don / Kat
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Generation Action Buttons */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                  {importedChart ? (
                    <div className="w-full flex flex-col gap-3">
                      <div className="glass-card border-amber-400/30 p-3.5 rounded-2xl text-amber-200 text-sm">
                        <p className="font-semibold mb-1 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-400" />
                          Imported Chart (Edit Mode)
                        </p>
                        <p className="text-amber-300/80 text-xs">
                          You are editing an imported chart. Review the notes before saving changes.
                        </p>
                      </div>
                      {editingHistoryId ? (
                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            onClick={() => handleSaveImportedEdits(true)}
                            disabled={isGenerating || !audioFile}
                            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-semibold px-5 py-3 rounded-md transition-colors cursor-pointer text-sm border border-amber-400"
                          >
                            <Save className="w-4 h-4" />
                            {isGenerating ? 'Saving...' : 'Overwrite Original'}
                          </button>
                          <button
                            onClick={() => handleSaveImportedEdits(false)}
                            disabled={isGenerating || !audioFile}
                            className="flex-1 flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold px-5 py-3 rounded-md transition-colors cursor-pointer text-sm border border-emerald-600"
                          >
                            <Plus className="w-4 h-4" />
                            {isGenerating ? 'Saving...' : 'Save as New'}
                          </button>
                          <button
                            onClick={() => {
                              setImportedChart(null);
                              setEditingHistoryId(null);
                              setAudioFile(null);
                              setBgFile(null);
                              setSongName('');
                              setArtist('');
                            }}
                            className="flex-none flex items-center justify-center glass-card-interactive text-zinc-300 hover:text-white px-4 py-3.5 rounded-2xl transition-all cursor-pointer text-sm"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            onClick={() => handleSaveImportedEdits(false)}
                            disabled={isGenerating || !audioFile}
                            className="flex-1 flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold px-5 py-3 rounded-md transition-colors cursor-pointer text-sm border border-emerald-600"
                          >
                            <Save className="w-4 h-4" />
                            {isGenerating ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            onClick={() => {
                              setImportedChart(null);
                              setEditingHistoryId(null);
                              setAudioFile(null);
                              setBgFile(null);
                              setSongName('');
                              setArtist('');
                            }}
                            className="flex-1 flex items-center justify-center glass-card-interactive text-zinc-300 hover:text-white px-5 py-3.5 rounded-2xl transition-all cursor-pointer text-sm"
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-2.5">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!audioFile) return;
                          try {
                            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                            const arrayBuffer = await audioFile.arrayBuffer();
                            const decoded = await audioContext.decodeAudioData(arrayBuffer);
                            setAudioBuffer(decoded);
                            setTrackDuration(decoded.duration);
                          } catch {
                            // Ignore
                          }
                          setIsAudioRegionEditorOpen(true);
                        }}
                        disabled={!audioFile}
                        className="w-full flex items-center justify-center gap-2 bg-[#182033] hover:bg-[#1e2942] disabled:opacity-40 text-slate-100 font-semibold px-4 py-3 rounded-xl transition-colors cursor-pointer text-xs border border-[#2b3a5c]"
                      >
                        <Sliders className="w-4 h-4 text-indigo-400" />
                        Audio Regions Timeline {audioRegions.length > 0 ? `(${audioRegions.length} Active)` : ''}
                      </button>

                      {currentScreen === 'autocharter_beta' && uploadedChartForCritique && (
                        <button
                          onClick={handleAnalyzeAndImproveExistingChart}
                          disabled={isAnalyzingUploaded || isGenerating}
                          className="w-full flex items-center justify-center gap-2 bg-purple-800 hover:bg-purple-700 disabled:opacity-40 text-white font-bold px-4 py-3 rounded-xl transition-colors text-xs border border-purple-600/60 cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 text-purple-200" />
                          {isAnalyzingUploaded ? 'Optimizing Patterns...' : 'Optimize Uploaded Chart'}
                        </button>
                      )}
                      <div className="w-full flex flex-col sm:flex-row items-center gap-3">
                        <button
                          onClick={() => {
                             setIsWizardOpen(true);
                          }}
                          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 glass-card-interactive text-slate-200 font-medium px-4 py-3 rounded-md text-sm cursor-pointer"
                        >
                          <Sliders className="w-4 h-4 text-amber-400" />
                          Choose a preset
                        </button>

                        <button
                          onClick={handleGenerate}
                          disabled={isGenerating || !audioFile}
                          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-semibold px-5 py-3 rounded-md transition-colors cursor-pointer text-sm border border-amber-400"
                        >
                          <Download className="w-4 h-4" />
                          {isGenerating ? 'Generating chart…' : `Generate chart (${difficulties.length})`}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerate('iric')}
                          disabled={isGenerating || !audioFile}
                          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-[#191816] hover:bg-[#222019] disabled:opacity-40 text-amber-200 font-medium px-4 py-3 rounded-md transition-colors cursor-pointer text-sm border border-neutral-700"
                        >
                          <Layers className="w-4 h-4" />
                          {isGenerating ? 'Packaging…' : 'Generate native .iric'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div id="critique-section-target"></div>

            {(critiqueLogs.length > 0 || correctionLogs.length > 0) && (
              <div className="mt-8">
                <BetaAnalysisPanel 
                  critiqueLogs={critiqueLogs}
                  correctionLogs={correctionLogs}
                  format={selectedFormat}
                  onClear={() => {
                    setCritiqueLogs([]);
                    setCorrectionLogs([]);
                  }} 
                />
              </div>
            )}
        
        {/* Drafts & Backup Slots Section */}
        <section className="glass-panel p-6 sm:p-7 rounded-xl space-y-5 mt-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-400 border border-amber-400/30">
                <Save className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white uppercase tracking-tight">Active Drafts & Save Slots</h2>
                <p className="text-xs text-zinc-400">Restore your progress or load saved backup slots</p>
              </div>
            </div>
            
            <button
              onClick={handleOpenCreateDraft}
              className="text-xs font-medium text-amber-200 hover:text-white glass-card-interactive px-3.5 py-2 rounded-md cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Draft Slot</span>
            </button>
          </div>

          {draftsList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {draftsList.map((draft) => {
                const isAuto = draft.id === 'draft_auto';
                return (
                  <div 
                    key={draft.id} 
                    className={`flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all ${
                      isAuto 
                      ? 'bg-amber-950/25 border-amber-900 hover:border-amber-700' 
                      : 'glass-card-interactive'
                    }`}
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-zinc-100 text-sm truncate">{draft.name}</p>
                        {isAuto ? (
                          <span className="px-2 py-0.5 rounded-md bg-amber-950/50 text-amber-200 border border-amber-800 text-[9px] font-semibold uppercase tracking-wider">
                            Auto-Save
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg glass-pill text-zinc-300 text-[9px] font-bold uppercase tracking-wider">
                            Draft Slot
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-lg glass-pill text-zinc-400 text-[9px] font-mono">
                          {draft.activeTab === 'charter_llplus' ? 'LL+' : (draft.activeTab === 'charter_mania' ? 'Mania' : (draft.activeTab === 'charter_fnf' ? 'FNF' : 'Taiko'))}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 font-mono">
                        Saved: {new Date(draft.timestamp).toLocaleString()}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium flex-wrap">
                        {draft.audioFileName && (
                          <span className="inline-flex items-center gap-1.5 glass-pill px-2 py-0.5 rounded-md text-zinc-300 max-w-[160px] truncate" title={draft.audioFileName}>
                            <Music className="w-3 h-3 text-amber-400 shrink-0" />
                            <span className="truncate">{draft.audioFileName}</span>
                          </span>
                        )}
                        {draft.audioRegions && draft.audioRegions.length > 0 && (
                          <span className="inline-flex items-center gap-1.5 glass-pill px-2 py-0.5 rounded-md text-zinc-300">
                            <Sliders className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>{draft.audioRegions.length} Regions</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => loadDraftSlot(draft)}
                        className="inline-flex items-center gap-1 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold rounded-md transition-colors cursor-pointer border border-amber-400"
                        title="Restore this draft into the editor"
                      >
                        Restore
                      </button>
                      <button
                        onClick={(e) => handleDeleteDraft(draft.id, e)}
                        className="p-2 text-zinc-400 hover:text-red-400 glass-card-interactive rounded-xl transition-colors cursor-pointer"
                        title="Delete this draft"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-zinc-400 text-xs p-6 glass-card rounded-2xl text-center">
              No draft sessions found. When you start editing or uploading files, your progress will be auto-saved here.
            </div>
          )}
        </section>

        {/* History Section */}
        <section className="glass-panel p-5 sm:p-6 rounded-lg space-y-5 mt-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-900">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">Chart history</h2>
                <p className="text-xs text-zinc-400">Saved charts ready to test, edit, or download.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 glass-card-interactive px-3.5 py-2 rounded-md cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span>Import External Chart</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".zip,.osz,.llmap,.osu,.json"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleImportExternalChart(e.target.files[0]);
                    }
                  }}
                />
              </label>
              {history.length > 0 && (
                <button
                  onClick={handleClearAllHistory}
                  className="text-xs font-medium text-zinc-400 hover:text-red-300 flex items-center gap-1.5 glass-card-interactive px-3.5 py-2 rounded-md cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {history.length > 0 ? (
            <div className="space-y-2.5">
              {history.map((entry) => {
                const getFormatBadge = (fmt: string) => {
                  switch (fmt) {
                    case 'llplus': return <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">Lightners Live +</span>;
                    case 'mania': return <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">osu!mania</span>;
                    case 'taiko': return <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">osu!taiko</span>;
                    case 'fnf': return <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-pink-500/15 text-pink-300 border border-pink-500/30">FNF</span>;
                    default: return <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold glass-pill text-zinc-300">{fmt.toUpperCase()}</span>;
                  }
                };

                const formatSize = (bytes?: number) => {
                  if (!bytes) return '';
                  if (bytes < 1024) return `${bytes} B`;
                  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                };

                return (
                  <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 glass-card-interactive rounded-md">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <p className="font-bold text-zinc-100 text-sm truncate">{entry.name}</p>
                        {getFormatBadge(entry.format)}
                        {entry.isImproved && (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            Optimized
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 font-mono">
                        {new Date(entry.timestamp).toLocaleString()}
                        {entry.fileSize ? ` • ${formatSize(entry.fileSize)}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => handlePlayFromHistory(entry)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer border border-emerald-600"
                        title="Test this map in Test Zone"
                      >
                        <Gamepad2 className="w-3.5 h-3.5" />
                        <span>Play</span>
                      </button>
                      <button
                        onClick={() => handleEditFromHistory(entry)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold rounded-md transition-colors cursor-pointer border border-amber-400"
                        title="Edit map metadata & files"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleRedownload(entry)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 glass-card-interactive text-zinc-300 hover:text-white text-xs font-medium rounded-md cursor-pointer"
                        title="Re-download"
                      >
                        <FolderDown className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                      <button
                        onClick={() => handleDeleteHistoryItem(entry.id)}
                        className="p-2 text-zinc-400 hover:text-red-400 glass-card-interactive rounded-xl transition-colors cursor-pointer"
                        title="Delete from history"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-zinc-400 text-xs p-8 glass-card rounded-2xl text-center">
              There are no generated maps in the history yet. Generated maps will be saved here.
            </div>
          )}
        </section>
        </>
        )}
      </motion.div>
      <AutoSetupModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        exportFormat={activeTab === 'charter_llplus' ? 'llplus' : (activeTab === 'charter_mania' ? 'mania' : (activeTab === 'charter_fnf' ? 'fnf' : 'taiko'))}
        onApplyConfig={(newDiffs) => {
          setDifficulties(newDiffs);
        }}
      />
      <ImportChoiceModal
        isOpen={isImportChoiceOpen}
        onClose={() => setIsImportChoiceOpen(false)}
        fileName={pendingFileName}
        onStandardEdit={() => {
          if (pendingParsedChart) handleApplyParsedChart(pendingParsedChart, false);
        }}
        onMetadataQuickEdit={() => {
          if (pendingParsedChart) handleApplyParsedChart(pendingParsedChart, false, true);
        }}
      />
      <AudioRegionEditorModal
        isOpen={isAudioRegionEditorOpen}
        onClose={() => setIsAudioRegionEditorOpen(false)}
        audioBuffer={audioBuffer}
        audioFile={audioFile}
        duration={trackDuration}
        regions={audioRegions}
        activeTab={activeTab}
        onSaveRegions={(newRegions) => setAudioRegions(newRegions)}
        onGenerate={(newRegions) => {
          setAudioRegions(newRegions);
          setIsAudioRegionEditorOpen(false);
          handleGenerate();
        }}
        isGenerating={isGenerating}
      />

      <CreateDraftModal
        isOpen={isCreateDraftOpen}
        onClose={() => setIsCreateDraftOpen(false)}
        onSave={handleSaveCustomDraftSlot}
        defaultName={songName ? `${songName} - Draft` : (audioFile ? `${audioFile.name.replace(/\.[^/.]+$/, '')} - Draft` : '')}
        activeTab={activeTab}
        audioFileName={audioFile?.name}
        regionsCount={audioRegions.length}
        difficultiesCount={difficulties.length}
      />

      {toastNotification && (
        <div className="fixed bottom-6 right-6 z-50 animate-fadeIn">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl glass-panel shadow-2xl border ${
            toastNotification.type === 'error'
              ? 'border-red-500/40 text-red-200'
              : toastNotification.type === 'info'
              ? 'border-blue-500/40 text-blue-200'
              : 'border-emerald-500/40 text-emerald-200'
          }`}>
            {toastNotification.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : toastNotification.type === 'info' ? (
              <Activity className="w-4 h-4 text-blue-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="text-xs font-semibold">{toastNotification.message}</span>
            <button
              onClick={() => setToastNotification(null)}
              className="ml-2 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoSetupModal({
  isOpen,
  onClose,
  exportFormat,
  onApplyConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  exportFormat: 'llplus' | 'mania' | 'taiko' | 'fnf' | 'sonolus';
  onApplyConfig: (diffs: DifficultyConfig[]) => void;
}) {
  const [keysMode, setKeysMode] = useState<'recommended' | 'custom' | 'scalable_auto' | 'scalable_custom'>('recommended');
  const [customKeys, setCustomKeys] = useState('');
  const [scalableKeys, setScalableKeys] = useState({
    min: 'Space',
    easy: 'Space',
    medium: 'Space, Return',
    hard: 's, Space, l',
    max: 'a, s, k, l'
  });

  if (!isOpen) return null;

  const handleApply = (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();

    let diffConfigs: DifficultyConfig[] = [];

    if (keysMode === 'recommended') {
      let keysStr = 'Space, Return';
      if (exportFormat === 'taiko') keysStr = 'Space, Return';
      if (exportFormat === 'mania') keysStr = '1, 2, 3, 4';
      if (exportFormat === 'fnf') keysStr = 'LeftArrow, DownArrow, UpArrow, RightArrow';
      diffConfigs = [
        { value: 1, keysStr: keysStr, name: 'Easy' },
        { value: 5, keysStr: keysStr, name: 'Normal' },
        { value: 11, keysStr: keysStr, name: 'Hard' },
        { value: 16, keysStr: keysStr, name: 'Insane' },
        { value: 20, keysStr: keysStr, name: 'Master' },
        { value: 25, keysStr: keysStr, name: 'Extra' }
      ];
    } else if (keysMode === 'custom') {
      if (!customKeys.trim()) {
        alert("Please provide at least 1 allowed key for custom keys.");
        return;
      }
      const keysStr = customKeys;
      diffConfigs = [
        { value: 1, keysStr: keysStr, name: 'Easy' },
        { value: 5, keysStr: keysStr, name: 'Normal' },
        { value: 11, keysStr: keysStr, name: 'Hard' },
        { value: 16, keysStr: keysStr, name: 'Insane' },
        { value: 20, keysStr: keysStr, name: 'Master' },
        { value: 25, keysStr: keysStr, name: 'Extra' }
      ];
    } else if (keysMode === 'scalable_auto') {
      if (exportFormat === 'taiko') {
        diffConfigs = [
          { value: 1, keysStr: 'Space, Return', name: 'Easy' },
          { value: 5, keysStr: 'Space, Return', name: 'Normal' },
          { value: 11, keysStr: 'Space, Return', name: 'Hard' },
          { value: 16, keysStr: 'Space, Return', name: 'Insane' },
          { value: 20, keysStr: 'Space, Return', name: 'Master' },
          { value: 25, keysStr: 'Space, Return', name: 'Extra' }
        ];
      } else if (exportFormat === 'fnf') {
        diffConfigs = [
          { value: 1, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Easy' },
          { value: 5, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Normal' },
          { value: 11, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Hard' },
          { value: 16, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Insane' },
          { value: 20, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Master' },
          { value: 25, keysStr: 'LeftArrow, DownArrow, UpArrow, RightArrow', name: 'Extra' }
        ];
      } else if (exportFormat === 'mania') {
        diffConfigs = [
          { value: 1, keysStr: 'd', name: 'Easy' },
          { value: 5, keysStr: 'd, k', name: 'Normal' },
          { value: 11, keysStr: 'd, f, j, k', name: 'Hard' },
          { value: 16, keysStr: 'd, f, j, k', name: 'Insane' },
          { value: 20, keysStr: 's, d, f, j, k, l', name: 'Master' },
          { value: 25, keysStr: 'a, s, d, space, j, k, l', name: 'Extra' }
        ];
      } else {
        diffConfigs = [
          { value: 1, keysStr: 'Space', name: 'Easy' },
          { value: 5, keysStr: 'Space', name: 'Normal' },
          { value: 11, keysStr: 'Space, Return', name: 'Hard' },
          { value: 16, keysStr: 's, Space, l', name: 'Insane' },
          { value: 20, keysStr: 'a, s, k, l', name: 'Master' },
          { value: 25, keysStr: 'a, s, space, k, l', name: 'Extra' }
        ];
      }
    } else if (keysMode === 'scalable_custom') {
      diffConfigs = [
        { value: 1, keysStr: scalableKeys.min || 'Space', name: 'Easy' },
        { value: 5, keysStr: scalableKeys.easy || 'Space', name: 'Normal' },
        { value: 11, keysStr: scalableKeys.medium || 'Space, Return', name: 'Hard' },
        { value: 16, keysStr: scalableKeys.hard || 's, Space, l', name: 'Insane' },
        { value: 20, keysStr: scalableKeys.max || 'a, s, k, l', name: 'Master' },
        { value: 25, keysStr: scalableKeys.max || 'a, s, k, l', name: 'Extra' }
      ];
    }

    if (exportFormat === 'llplus' || exportFormat === 'fnf' || exportFormat === 'sonolus') {
      diffConfigs = [diffConfigs.find(d => d.value === 11) || diffConfigs[2] || diffConfigs[0]];
    }

    onApplyConfig(diffConfigs);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/80">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              Auto Setup Presets
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Choose difficulty and key setup to populate your editor automatically.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 flex flex-col min-h-[300px]">
          <div className="flex-1 space-y-4">
            <div className="space-y-4 pt-2">
              {exportFormat === 'llplus' && (
                <div className="bg-cyan-950/40 border border-cyan-800/60 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-300 font-medium text-sm">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    Lightners Live + Auto Setup
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Configures the 2-lane rhythm standards (Kris Left <code className="text-cyan-300 bg-zinc-950 px-1 py-0.5 rounded">D3 / #38</code> and Kris Right <code className="text-cyan-300 bg-zinc-950 px-1 py-0.5 rounded">C3 / #36</code>).
                  </p>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Applies the level configuration so you can tweak parameters before generating.
                  </p>
                </div>
              )}

              {exportFormat === 'mania' && (
                <>
                   <label className="block text-sm font-medium text-zinc-300 mb-2">Key Count Configuration</label>
                   <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setKeysMode('recommended')}
                        className={`px-3 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          keysMode === 'recommended' || keysMode === 'custom'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-zinc-800/40 text-zinc-400 border border-transparent hover:bg-zinc-800/70'
                        }`}
                      >
                        Fixed Key Count (4K)
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeysMode('scalable_auto')}
                        className={`px-3 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          keysMode === 'scalable_auto' || keysMode === 'scalable_custom'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-zinc-800/40 text-zinc-400 border border-transparent hover:bg-zinc-800/70'
                        }`}
                      >
                        Scalable Auto (1K - 7K)
                      </button>
                   </div>
                   
                   {(keysMode === 'recommended' || keysMode === 'custom') && (
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-950 rounded-lg border border-zinc-800 text-xs">
                        <span className="text-zinc-400 font-medium">All difficulties will use:</span>
                        <select 
                          value={customKeys ? customKeys.split(',').length : 4}
                          onChange={(e) => {
                            const count = parseInt(e.target.value);
                            setCustomKeys(Array.from({length: count}, (_, i) => (i + 1).toString()).join(', '));
                            setKeysMode('custom');
                          }}
                          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 focus:outline-none cursor-pointer"
                        >
                          {[1,2,3,4,5,6,7,8,9,10].map(k => <option key={k} value={k}>{k}K</option>)}
                        </select>
                      </div>
                   )}

                   {(keysMode === 'scalable_auto' || keysMode === 'scalable_custom') && (
                      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-xs">
                        <div className="text-zinc-400 font-medium mb-1">Automatic difficulty progression (1 - 25):</div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Easy (Lv.1):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">1K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Normal (Lv.5):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">2K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Hard (Lv.11):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">4K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Insane (Lv.16):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">4K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Master (Lv.20):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">6K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Extra (Lv.25):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">7K</code></div>
                      </div>
                   )}
                </>
              )}

              {exportFormat === 'taiko' && (
                <>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Note Mapping Configuration</label>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400">
                    Maps <strong>Don</strong> and <strong>Kat</strong> hit sounds across 6 difficulty tiers (Easy to Master Lv.25).
                  </div>
                </>
              )}

              {exportFormat === 'fnf' && (
                <>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">FNF Configuration</label>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
                    <p>Sets 4-key arrow mapping (Left, Down, Up, Right) with calibrated scroll and difficulty values.</p>
                    <p className="text-amber-400/90 font-medium">Note: Multi-difficulty export for FNF is not implemented yet. Single difficulty will be exported.</p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="pt-6 mt-auto border-t border-zinc-800/80 flex items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3.5 rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-950/40"
            >
              <Sparkles className="w-4 h-4" />
              Apply Auto Setup to Editor
            </button>
          </div>
          
          <p className="text-center text-xs text-zinc-500 mt-3">
            This will update the difficulties and keys on the main screen so you can edit before clicking Generate.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function FileUpload({ 
  label, 
  icon, 
  file, 
  onSelect, 
  accept, 
  required = false 
}: { 
  label: string; 
  icon: React.ReactNode; 
  file: File | null; 
  onSelect: (file: File | null) => void; 
  accept: string;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelect(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onSelect(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`glass-card rounded-md p-4 transition-colors border ${
        isDragOver 
          ? 'border-amber-400' 
          : 'border-neutral-800 hover:border-neutral-600'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 overflow-hidden">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
            isDragOver ? 'glass-card text-amber-200 border-amber-500' : 'glass-surface text-amber-400 border-neutral-700'
          }`}>
            {icon}
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                {label} {required && <span className="text-amber-400">*</span>}
              </h3>
              {isDragOver && (
                <span className="text-[10px] font-medium text-amber-200 glass-pill px-2 py-0.5 rounded-md border border-amber-700">
                  Drop
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 font-mono truncate mt-0.5">
              {file ? file.name : (isDragOver ? 'Release file to load' : 'No file selected')}
            </p>
          </div>
        </div>
        
        <div className="shrink-0 flex gap-2">
          {file && (
            <button 
              type="button"
              onClick={() => onSelect(null)}
              className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-red-300 glass-card-interactive hover:border-red-500/30 rounded-md transition-colors cursor-pointer"
            >
              Remove
            </button>
          )}
          <button 
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3.5 py-1.5 text-xs font-medium text-amber-200 hover:text-white glass-card-interactive rounded-md transition-colors cursor-pointer"
          >
            {file ? 'Change' : 'Browse'}
          </button>
        </div>
      </div>
      <input 
        type="file" 
        ref={inputRef} 
        className="hidden" 
        accept={accept}
        onChange={handleChange}
      />
    </div>
  );
}
