import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ParsedChart, ChartNote, parseUniversalChart } from '../lib/chartParser';
import { 
  Play, Pause, RotateCcw, Upload, Volume2, VolumeX, Bot, Sparkles, 
  SlidersHorizontal, Music, Flame, Keyboard, Video, Layers, ArrowLeft,
  Trophy, Award, CheckCircle2, XCircle, Skull, HeartCrack, Download,
  Maximize2, Minimize2, Smartphone, Touchpad, Zap, Activity, FastForward, Rewind, Gauge
} from 'lucide-react';
import { ScoreRecord, saveScoreRecord, calculateRank, getRankColor } from '../lib/scoreStorage';
import { hitSoundManager } from '../lib/hitsound';
import { createIricScrollDistance } from '../lib/iricSpeed';


interface RhythmGameEngineProps {
  initialChart?: ParsedChart | null;
  audioFile?: File | Blob | null;
  onBackToCharter?: () => void;
  isPlayMode?: boolean;
  audioRegions?: any[];
}

const DEFAULT_KEY_MAPS: Record<string, string[]> = {
  'game_actions': ['escape'],
  'llplus': ['d', 'k'],
  '1': ['space'],
  '2': ['d', 'k'],
  '3': ['d', 'space', 'k'],
  '4': ['d', 'f', 'j', 'k'],
  '5': ['d', 'f', 'space', 'j', 'k'],
  '6': ['s', 'd', 'f', 'j', 'k', 'l'],
  '7': ['s', 'd', 'f', 'space', 'j', 'k', 'l'],
  '8': ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'],
  '9': ['a', 's', 'd', 'f', 'space', 'j', 'k', 'l', ';'],
  'fnf': ['arrowleft', 'arrowdown', 'arrowup', 'arrowright'],
  'taiko': ['z', 'c']
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

const safeRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
};

export default function RhythmGameEngine({ initialChart, audioFile, onBackToCharter, isPlayMode = false, audioRegions = [] }: RhythmGameEngineProps) {
  const [chart, setChart] = useState<ParsedChart | null>(initialChart || null);
  
  const getRegionSpeedMult = useCallback((timeMs: number) => {
    if (!audioRegions || audioRegions.length === 0) return 1.0;
    const ts = timeMs / 1000;
    const matched = audioRegions.find(r => ts >= r.startTime && ts <= r.endTime);
    return matched ? (matched.speedMultiplier !== undefined ? matched.speedMultiplier : 1.0) : 1.0;
  }, [audioRegions]);
  
  // Audio & Media URLs (Works for ALL modes!)
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [bgVideoUrl, setBgVideoUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Countdown state before gameplay starts
  const [countdown, setCountdown] = useState<number | string | null>(null);
  const [isPreparing, setIsPreparing] = useState<boolean>(false);
  const countdownTimerRef = useRef<NodeJS.Timeout[]>([]);
  const originalResumeTimeRef = useRef<number>(0);
  const audioWarmedUpRef = useRef<boolean>(false);
  const audioStartTimeRef = useRef<number>(0);
  const leadInActiveRef = useRef<boolean>(false);
  const leadInStartTimeRef = useRef<number>(0);
  const leadInTargetTimeRef = useRef<number>(0);
  const leadInDurationRef = useRef<number>(3000);

  // Difficulty Selection (No fake density presets!)
  const [selectedDiffIndex, setSelectedDiffIndex] = useState<number>(() => initialChart?.activeDifficultyIndex ?? 0);

  // Custom Keybindings State
  const [customKeyMaps, setCustomKeyMaps] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('rhythm_engine_keymaps');
      return saved ? JSON.parse(saved) : DEFAULT_KEY_MAPS;
    } catch {
      return DEFAULT_KEY_MAPS;
    }
  });

  const [isRebindingModalOpen, setIsRebindingModalOpen] = useState(false);
  const [activeRebindIndex, setActiveRebindIndex] = useState<number | null>(null);

  // Gameplay settings
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const currentTimeMsRef = useRef<number>(0);
  const [durationMs, setDurationMs] = useState(1);
  const playbackSpeed = 1;
  const [scrollSpeed, setScrollSpeed] = useState(() => {
    const saved = localStorage.getItem('rhythm_engine_scrollSpeed');
    return saved ? parseFloat(saved) : 1.0;
  }); // Default 1.0x (Normal speed)

  // Hitsounds state
  const [hitsoundsEnabled, setHitsoundsEnabled] = useState<boolean>(() => hitSoundManager.isEnabled());
  const [hitsoundVol, setHitsoundVol] = useState<number>(() => hitSoundManager.getVolume());

  // Legacy playback modifiers are ignored so old browser settings cannot alter charts.
  useEffect(() => {
    localStorage.setItem('rhythm_engine_scrollSpeed', scrollSpeed.toString());
  }, [scrollSpeed]);
  
  const [scrollDirection, setScrollDirection] = useState<'down' | 'up'>(() => {
    return (localStorage.getItem('rhythm_engine_scrollDirection') as 'down' | 'up') || 'down';
  });
  const [audioOffset, setAudioOffset] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_audioOffset');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [autoPlay, setAutoPlay] = useState(false);
  const isAutoPlayUsedRef = useRef<boolean>(false);

  const toggleAutoBot = () => {
    setAutoPlay(prev => {
      const next = !prev;
      if (next) {
        isAutoPlayUsedRef.current = true;
      }
      return next;
    });
  };

  useEffect(() => {
    if (autoPlay) {
      isAutoPlayUsedRef.current = true;
    }
  }, [autoPlay]);

  const [instVolume, setInstVolume] = useState(0.8);
  const [vocalsVolume, setVocalsVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [bgDim, setBgDim] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_bgDim');
    return saved !== null ? parseFloat(saved) : 0.0;
  });
  const [trackOpacity, setTrackOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_trackOpacity');
    return saved !== null ? parseFloat(saved) : 0.0;
  });
  const [playfieldScale, setPlayfieldScale] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_playfieldScale');
    return saved !== null ? parseFloat(saved) : 1.0;
  });
  const [playfieldFillScreen, setPlayfieldFillScreen] = useState<boolean>(() => {
    const saved = localStorage.getItem('rhythm_engine_playfieldFillScreen');
    return saved !== null ? saved === 'true' : false;
  });
  const [showLaneDividers, setShowLaneDividers] = useState<boolean>(() => {
    const saved = localStorage.getItem('rhythm_engine_showLaneDividers');
    return saved !== null ? saved === 'true' : false;
  });
  const [coverBackground, setCoverBackground] = useState<boolean>(() => {
    const saved = localStorage.getItem('rhythm_engine_coverBackground');
    return saved !== null ? saved === 'true' : true;
  });
  const [hideGameplayUi] = useState<boolean>(true);
  const [hideCountdown] = useState<boolean>(true);

  const [fitMedia, setFitMedia] = useState(false);

  // Mobile & Touch Controls State
  const [touchControlsMode, setTouchControlsMode] = useState<'auto' | 'always' | 'never'>(() => {
    return (localStorage.getItem('rhythm_engine_touchMode') as 'auto' | 'always' | 'never') || 'auto';
  });
  const [touchPadStyle, setTouchPadStyle] = useState<'bottom_pads' | 'full_lanes'>(() => {
    return (localStorage.getItem('rhythm_engine_touchStyle') as 'bottom_pads' | 'full_lanes') || 'bottom_pads';
  });
  const [touchHaptics, setTouchHaptics] = useState<boolean>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchHaptics');
    return saved !== null ? saved === 'true' : true;
  });
  const [touchOpacity, setTouchOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchOpacity');
    return saved !== null ? parseFloat(saved) : 0.85;
  });
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(false);
  const [isPortraitOrientation, setIsPortraitOrientation] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isMobileLandscapePromptDismissed, setIsMobileLandscapePromptDismissed] = useState<boolean>(false);

  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef<Map<number, number>>(new Map()); // pointerId -> laneIndex

  // Stats & Judgements
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [health, setHealth] = useState(100);
  const [hasFailed, setHasFailed] = useState(false);
  const hasFailedRef = useRef<boolean>(false);
  const consecutiveHitsRef = useRef<number>(0);
  const [judgmentCounts, setJudgmentCounts] = useState({ perfect: 0, great: 0, bad: 0, miss: 0 });
  const [recentJudgment, setRecentJudgment] = useState<{ text: string; color: string; key: number } | null>(null);

  // Results Screen State
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [resultsData, setResultsData] = useState<{
    score: number;
    accuracy: number;
    maxCombo: number;
    rank: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'AUTO';
    perfect: number;
    great: number;
    bad: number;
    miss: number;
    isNewHighScore: boolean;
    previousHighScore: number | null;
    isAutoPlay?: boolean;
    isFailed?: boolean;
  } | null>(null);

  // Active Key States & Processed Notes
  const [pressedKeys, setPressedKeys] = useState<boolean[]>([]);
  const pressedKeysRef = useRef<boolean[]>([]);
  const processedNotesRef = useRef<Set<string>>(new Set());
  const activeHoldNotesRef = useRef<Map<string, { noteId: string; lane: number; startMs: number; endMs: number }>>(new Map());
  const particlesRef = useRef<Particle[]>([]);

  // Media Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Active Difficulty and Key States
  const activeDiff = chart?.difficulties && chart.difficulties[selectedDiffIndex] ? chart.difficulties[selectedDiffIndex] : null;
  const activeKeyCount = activeDiff?.keyCount || chart?.keyCount || 4;
  const activeMode = activeDiff?.mode || chart?.mode || 'mania';
  const activeBpm = activeDiff?.bpm || chart?.bpm || 120;
  const nativeScrollSpeed = chart?.isIricPackage
    ? (activeDiff?.scrollSpeed ?? chart.scrollSpeed ?? 1)
    : 1;
  const activeIricSvChanges = useMemo(() => {
    if (!chart?.isIricPackage) return [];
    return [...(activeDiff?.svChanges ?? chart.svChanges ?? [])]
      .filter(change => Number.isFinite(change.timeMs) && Number.isFinite(change.sv) && change.sv >= 0)
      .sort((a, b) => a.timeMs - b.timeMs);
  }, [chart, activeDiff]);
  const getIricDistance = useMemo(() => createIricScrollDistance(activeIricSvChanges), [activeIricSvChanges]);
  const effectiveScrollSpeed = scrollSpeed * nativeScrollSpeed;

  // Live NPS (Notes Per Second) and Peak Density Calculation
  const currentNps = useMemo(() => {
    if (!activeDiff?.notes || activeDiff.notes.length === 0) return 0;
    const windowStart = currentTimeMs - 500;
    const windowEnd = currentTimeMs + 500;
    return activeDiff.notes.filter(n => n.time >= windowStart && n.time <= windowEnd).length;
  }, [activeDiff, currentTimeMs]);

  const peakNps = useMemo(() => {
    if (!activeDiff?.notes || activeDiff.notes.length === 0) return 0;
    const notes = activeDiff.notes;
    let maxCount = 0;
    for (let i = 0; i < notes.length; i++) {
      const start = notes[i].time;
      const end = start + 1000;
      let count = 0;
      for (let j = i; j < notes.length && notes[j].time <= end; j++) {
        count++;
      }
      if (count > maxCount) maxCount = count;
    }
    return maxCount;
  }, [activeDiff]);

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Active Keymap for current mode & key count
  const modeKey = activeMode === 'fnf' ? 'fnf' : (activeMode === 'taiko' ? 'taiko' : (activeMode === 'llplus' ? 'llplus' : `${activeKeyCount}`));
  const currentKeyMap = customKeyMaps[modeKey] || DEFAULT_KEY_MAPS[modeKey] || (
    Array.from({ length: activeKeyCount }, (_, i) => ['a','s','d','f','g','h','j','k','l',';','q','w','e','r'][i] || `key${i+1}`)
  );

  // Save custom keymaps
  useEffect(() => {
    try {
      localStorage.setItem('rhythm_engine_keymaps', JSON.stringify(customKeyMaps));
    } catch (e) {
      console.warn("Failed to save keymaps:", e);
    }
  }, [customKeyMaps]);

  // Load Initial Audio & Media from chart
  useEffect(() => {
    if (chart) {
      setAudioUrl(chart.audioUrl || null);
      setVocalsUrl(chart.vocalsUrl || null);
      setBgImageUrl(chart.bgUrl || null);
      setBgVideoUrl(chart.videoUrl || null);
      setAudioError(null);
    } else if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      setAudioUrl(url);
      setVocalsUrl(null);
      setBgImageUrl(null);
      setBgVideoUrl(null);
      setAudioError(null);
    }
  }, [chart, audioFile]);

  useEffect(() => {
    if (initialChart) {
      setChart(initialChart);
      setSelectedDiffIndex(initialChart.activeDifficultyIndex ?? 0);
      resetGameplay();
    }
  }, [initialChart]);

  // Safety cleanup for hold sustain sounds
  useEffect(() => {
    if (!isPlaying) {
      activeHoldNotesRef.current.clear();
      hitSoundManager.stopAllHoldSounds();
    }
  }, [isPlaying, autoPlay]);

  useEffect(() => {
    return () => {
      activeHoldNotesRef.current.clear();
      hitSoundManager.stopAllHoldSounds();
    };
  }, []);

  const clearCountdownTimers = useCallback(() => {
    countdownTimerRef.current.forEach(t => clearTimeout(t));
    countdownTimerRef.current = [];
    leadInActiveRef.current = false;
    setIsPreparing(false);
    setCountdown(null);
  }, []);

  const resetGameplay = useCallback(() => {
    setIsPlaying(false);
    clearCountdownTimers();
    setIsResultsOpen(false);
    setResultsData(null);
    currentTimeMsRef.current = 0;
    setCurrentTimeMs(0);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setHealth(100);
    setHasFailed(false);
    hasFailedRef.current = false;
    consecutiveHitsRef.current = 0;
    setJudgmentCounts({ perfect: 0, great: 0, bad: 0, miss: 0 });
    setRecentJudgment(null);
    isAutoPlayUsedRef.current = autoPlay;
    processedNotesRef.current.clear();
    activeHoldNotesRef.current.clear();
    hitSoundManager.stopAllHoldSounds();
    particlesRef.current = [];

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.pause();
    }
    if (vocalsRef.current) {
      vocalsRef.current.currentTime = 0;
      vocalsRef.current.pause();
    }
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
  }, [clearCountdownTimers, autoPlay]);

  // Get active notes for currently selected difficulty
  const getActiveNotes = useCallback((): ChartNote[] => {
    if (!chart) return [];
    if (chart.difficulties && chart.difficulties[selectedDiffIndex]) {
      return chart.difficulties[selectedDiffIndex].notes;
    }
    return chart.notes;
  }, [chart, selectedDiffIndex]);

  // Level Complete / Statistics Calculation
  const handleLevelComplete = useCallback(() => {
    setIsPlaying(false);
    clearCountdownTimers();

    if (audioRef.current) audioRef.current.pause();
    if (vocalsRef.current) vocalsRef.current.pause();
    if (videoRef.current) videoRef.current.pause();

    const isAutoRun = autoPlay || isAutoPlayUsedRef.current;
    const isFailedRun = hasFailed || hasFailedRef.current;

    const activeNotes = getActiveNotes();
    const totalNotes = activeNotes.length;
    const currentTotalHits = judgmentCounts.perfect + judgmentCounts.great + judgmentCounts.bad + judgmentCounts.miss;
    const remainingMisses = Math.max(0, totalNotes - currentTotalHits);
    const finalMiss = judgmentCounts.miss + remainingMisses;
    const finalTotal = judgmentCounts.perfect + judgmentCounts.great + judgmentCounts.bad + finalMiss;

    const totalPossible = Math.max(1, (finalTotal || totalNotes || 1) * 300);
    const rawHitPoints = (judgmentCounts.perfect * 300) + (judgmentCounts.great * 200) + (judgmentCounts.bad * 100);
    const calcAcc = totalPossible > 0 ? Math.min(100, Math.max(0, (rawHitPoints / totalPossible) * 100)) : 0;
    const perfectRatio = finalTotal > 0 ? judgmentCounts.perfect / finalTotal : 0;
    const calculatedRank = calculateRank(calcAcc, finalMiss, perfectRatio);
    const finalRank = isAutoRun ? 'AUTO' : (isFailedRun ? 'F' : calculatedRank);

    const diffLabel = activeDiff?.name || chart?.version || (selectedDiffIndex + 1).toString();
    const levelTitle = chart?.title || 'IRIS Level';

    let isNewHighScore = false;
    let previousHighScore: number | null = null;

    // Do NOT save score if AutoPlay OR if Player Failed (Dead / HP 0)
    if (!isAutoRun && !isFailedRun) {
      const scoreObj: ScoreRecord = {
        levelTitle,
        difficultyName: diffLabel,
        score,
        accuracy: Number(calcAcc.toFixed(1)),
        maxCombo,
        rank: finalRank,
        perfect: judgmentCounts.perfect,
        great: judgmentCounts.great,
        bad: judgmentCounts.bad,
        miss: finalMiss,
        timestamp: Date.now()
      };

      const result = saveScoreRecord(levelTitle, diffLabel, scoreObj);
      isNewHighScore = result.isNewHighScore;
      previousHighScore = result.previousRecord ? result.previousRecord.score : null;
    }

    setResultsData({
      score,
      accuracy: Number(calcAcc.toFixed(1)),
      maxCombo,
      rank: finalRank,
      perfect: judgmentCounts.perfect,
      great: judgmentCounts.great,
      bad: judgmentCounts.bad,
      miss: finalMiss,
      isNewHighScore,
      previousHighScore,
      isAutoPlay: isAutoRun,
      isFailed: isFailedRun
    });

    setIsResultsOpen(true);
  }, [clearCountdownTimers, getActiveNotes, judgmentCounts, score, maxCombo, activeDiff, chart, selectedDiffIndex, autoPlay, hasFailed]);

  const [isStageDragOver, setIsStageDragOver] = useState(false);

  // Load a file directly (used by both input change and drag & drop)
  const processIncomingFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    
    // Check if it's a chart or zip package
    if (['osu', 'zip', 'osz', 'json', 'llmap', 'mid', 'midi'].includes(ext)) {
      try {
        const parsed = await parseUniversalChart(file);
        setChart(parsed);
        setSelectedDiffIndex(0);
        resetGameplay();
      } catch (err: any) {
        alert(`Error loading chart file: ${err.message}`);
      }
      return;
    }

    // Check if it's an audio track
    if (file.type.startsWith('audio/') || ['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      return;
    }

    // Check if it's a video
    if (file.type.startsWith('video/') || ['mp4', 'webm'].includes(ext)) {
      const url = URL.createObjectURL(file);
      setBgVideoUrl(url);
      setBgImageUrl(null);
      return;
    }

    // Check if it's an image
    if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const url = URL.createObjectURL(file);
      setBgImageUrl(url);
      setBgVideoUrl(null);
      return;
    }

    // Fallback: attempt chart parse
    try {
      const parsed = await parseUniversalChart(file);
      setChart(parsed);
      setSelectedDiffIndex(0);
      resetGameplay();
    } catch (err: any) {
      alert(`Unrecognized file format (${file.name}): ${err.message}`);
    }
  };

  // Handle local chart upload (.osu / .zip / .json / .llmap)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processIncomingFile(file);
    if (e.target) e.target.value = '';
  };

  const handleStageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsStageDragOver(true);
  };

  const handleStageDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsStageDragOver(false);
  };

  const handleStageDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsStageDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processIncomingFile(e.dataTransfer.files[0]);
    }
  };

  // Upload Custom Background Image / Video (For ALL modes!)
  const handleBgMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      setBgVideoUrl(url);
    } else {
      setBgImageUrl(url);
      setBgVideoUrl(null);
    }
  };

  // Upload Custom Audio / Music (For ALL modes!)
  const handleCustomAudioUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'inst' | 'vocals') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (type === 'inst') setAudioUrl(url);
    else setVocalsUrl(url);
  };

  // Sync Audio & Video Volume
  useEffect(() => {
    const isSilenced = isMuted;
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
      audioRef.current.volume = isSilenced ? 0 : instVolume;
      audioRef.current.muted = isSilenced;
    }
    if (vocalsRef.current) {
      vocalsRef.current.playbackRate = playbackSpeed;
      vocalsRef.current.volume = isSilenced ? 0 : vocalsVolume;
      vocalsRef.current.muted = isSilenced;
    }
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
      videoRef.current.disablePictureInPicture = true;
      if ('autoPictureInPicture' in videoRef.current) {
        (videoRef.current as any).autoPictureInPicture = false;
      }
    }
  }, [playbackSpeed, instVolume, vocalsVolume, isMuted, audioUrl, vocalsUrl]);

  // Play / Pause Sync with 3-second visual preparation countdown (audio unpauses at exact position without rewinding)
  const togglePlay = () => {
    if (isPlaying) {
      if (leadInActiveRef.current) {
        // If clicking pause while in countdown/lead-in, cancel lead-in and pause game
        leadInActiveRef.current = false;
        setIsPreparing(false);
        const target = leadInTargetTimeRef.current || originalResumeTimeRef.current;
        currentTimeMsRef.current = target;
        setCurrentTimeMs(target);
        activeHoldNotesRef.current.clear();
        hitSoundManager.stopAllHoldSounds();
        clearCountdownTimers();
        setCountdown(null);
        setIsPlaying(false);
      } else {
        // Regular pause
        audioRef.current?.pause();
        vocalsRef.current?.pause();
        videoRef.current?.pause();
        setIsPlaying(false);
        leadInActiveRef.current = false;
        setIsPreparing(false);
        activeHoldNotesRef.current.clear();
        hitSoundManager.stopAllHoldSounds();
        clearCountdownTimers();
      }
    } else {
      const targetResumeTime = currentTimeMsRef.current || currentTimeMs;
      originalResumeTimeRef.current = targetResumeTime;

      // Ensure audio and media are positioned at exact target time (stay paused during 3s wait)
      const isSilenced = isMuted;
      const targetSec = Math.max(0, targetResumeTime / 1000);
      if (audioRef.current) {
        if (Math.abs(audioRef.current.currentTime - targetSec) > 0.05) {
          audioRef.current.currentTime = targetSec;
        }
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current.volume = isSilenced ? 0 : instVolume;
        audioRef.current.muted = isSilenced;
      }
      if (vocalsRef.current) {
        if (Math.abs(vocalsRef.current.currentTime - targetSec) > 0.05) {
          vocalsRef.current.currentTime = targetSec;
        }
        vocalsRef.current.playbackRate = playbackSpeed;
        vocalsRef.current.volume = isSilenced ? 0 : vocalsVolume;
        vocalsRef.current.muted = isSilenced;
      }
      if (videoRef.current) {
        if (Math.abs(videoRef.current.currentTime - targetSec) > 0.05) {
          videoRef.current.currentTime = targetSec;
        }
        videoRef.current.playbackRate = playbackSpeed;
      }

      // Configure 3.0s (3000ms) Lead-In countdown
      const LEAD_IN_MS = 3000;
      leadInDurationRef.current = LEAD_IN_MS;
      leadInTargetTimeRef.current = targetResumeTime;
      leadInStartTimeRef.current = performance.now();
      leadInActiveRef.current = true;
      setIsPreparing(true);
      setIsPlaying(true); // Set playing state true immediately so game loop runs and pause UI hides instantly

      // Visual note runway starts 3000ms before target position so incoming notes scroll smoothly down
      const visualStartTime = targetResumeTime - LEAD_IN_MS * playbackSpeed;
      currentTimeMsRef.current = visualStartTime;

      if (!hideCountdown) {
        // Visual Countdown Mode (3... 2... 1... GO!)
        setCountdown(3);
        const step = LEAD_IN_MS / 3;
        const t1 = setTimeout(() => setCountdown(2), step);
        const t2 = setTimeout(() => setCountdown(1), step * 2);
        const t3 = setTimeout(() => setCountdown('GO!'), LEAD_IN_MS);
        const t4 = setTimeout(() => setCountdown(null), LEAD_IN_MS + 500);
        countdownTimerRef.current = [t1, t2, t3, t4];
      } else {
        setCountdown(null);
      }

      // After exactly 3 seconds, unpause music seamlessly without triggering React re-renders or loop restarts
      const startPlaybackTimer = setTimeout(() => {
        leadInActiveRef.current = false;
        setIsPreparing(false);
        currentTimeMsRef.current = targetResumeTime;
        audioStartTimeRef.current = targetSec;
        audioWarmedUpRef.current = false;

        if (audioRef.current) {
          if (Math.abs(audioRef.current.currentTime - targetSec) > 0.08) {
            audioRef.current.currentTime = targetSec;
          }
          audioRef.current.play().catch(() => {});
        }
        if (vocalsRef.current) {
          if (Math.abs(vocalsRef.current.currentTime - targetSec) > 0.08) {
            vocalsRef.current.currentTime = targetSec;
          }
          vocalsRef.current.play().catch(() => {});
        }
        if (videoRef.current) {
          if (Math.abs(videoRef.current.currentTime - targetSec) > 0.08) {
            videoRef.current.currentTime = targetSec;
          }
          videoRef.current.play().catch(() => {});
        }
      }, LEAD_IN_MS);

      countdownTimerRef.current.push(startPlaybackTimer);
    }
  };

  // Auto-pause when user leaves tab/window (unless Autobot is active)
  useEffect(() => {
    const handlePauseOnLeave = () => {
      // If autobot is active, allow the game to continue in background
      if (autoPlay) return;

      // If regular player is playing or in countdown, auto-pause
      if (isPlaying || leadInActiveRef.current || countdown !== null) {
        const target = leadInTargetTimeRef.current || originalResumeTimeRef.current;
        currentTimeMsRef.current = target;
        setCurrentTimeMs(target);
        audioRef.current?.pause();
        vocalsRef.current?.pause();
        videoRef.current?.pause();
        setIsPlaying(false);
        clearCountdownTimers();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handlePauseOnLeave();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handlePauseOnLeave);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handlePauseOnLeave);
    };
  }, [autoPlay, isPlaying, countdown, clearCountdownTimers, hideCountdown]);

  // Dedicated Key Listener for Rebinding
  useEffect(() => {
    if (!isRebindingModalOpen || activeRebindIndex === null) return;

    const handleRebindKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let newKey = e.key.toLowerCase();
      if (newKey === ' ') newKey = 'space';

      if (['shift', 'control', 'alt', 'meta', 'tab', 'capslock'].includes(newKey)) return;

      setCustomKeyMaps(prev => {
        const currentArr = [...(prev[modeKey] || DEFAULT_KEY_MAPS[modeKey] || currentKeyMap)];
        currentArr[activeRebindIndex] = newKey;
        return { ...prev, [modeKey]: currentArr };
      });
      setActiveRebindIndex(null);
    };

    window.addEventListener('keydown', handleRebindKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleRebindKeyDown, { capture: true });
    };
  }, [isRebindingModalOpen, activeRebindIndex, modeKey, currentKeyMap]);

  // Mobile Touch & Fullscreen & Orientation detection
  useEffect(() => {
    const checkTouch = () => {
      const hasTouch = 'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || window.innerWidth <= 1024;
      const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
      setIsTouchDevice(Boolean(hasTouch));
      setIsPortraitOrientation(Boolean(isPortrait));
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    checkTouch();
    window.addEventListener('resize', checkTouch);
    window.addEventListener('orientationchange', checkTouch);
    const handleFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFs);
    return () => {
      window.removeEventListener('resize', checkTouch);
      window.removeEventListener('orientationchange', checkTouch);
      document.removeEventListener('fullscreenchange', handleFs);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // In portrait orientation: automatically lock playfield scale to 2.0 (200%) and fill width for maximum touch target size
  const effectivePlayfieldScale = isPortraitOrientation ? 2.0 : playfieldScale;
  const effectivePlayfieldFill = isPortraitOrientation ? true : playfieldFillScreen;

  const showTouchControls = touchControlsMode === 'always' || (touchControlsMode === 'auto' && isTouchDevice);

  // Hit Evaluation
  const evaluateHit = useCallback((lane: number, hitTimeMs: number) => {
    const activeNotes = getActiveNotes();
    if (!activeNotes.length) return;

    const PERFECT_WIN = 45;
    const GREAT_WIN = 90;
    const BAD_WIN = 140;

    const targetLane = lane;

    const candidate = activeNotes
      .filter(n => {
        if (n.isOpponent && activeMode === 'fnf') return false;
        if (processedNotesRef.current.has(n.id)) return false;

        let nLane: number;
        if (activeMode === 'taiko') {
          const isKat = n.type === 'taiko_kat' || (n.lane % 2 === 1);
          nLane = isKat ? 1 : 0;
        } else {
          nLane = n.lane % activeKeyCount;
        }

        if (nLane !== targetLane) return false;

        const diff = Math.abs(n.timeMs - hitTimeMs);
        return diff <= BAD_WIN;
      })
      .sort((a, b) => {
        const diffA = Math.abs(a.timeMs - hitTimeMs);
        const diffB = Math.abs(b.timeMs - hitTimeMs);
        // If one is normal note (duration 0) and the other is a hold, prioritize the normal tap note
        const aIsHold = a.durationMs > 0;
        const bIsHold = b.durationMs > 0;
        if (!aIsHold && bIsHold && diffA <= diffB + 35) return -1;
        if (aIsHold && !bIsHold && diffB <= diffA + 35) return 1;
        return diffA - diffB;
      })[0];

    if (!candidate) return;

    const diff = Math.abs(candidate.timeMs - hitTimeMs);
    processedNotesRef.current.add(candidate.id); // CONSUME IMMEDIATELY!

    if (candidate.durationMs > 0) {
      activeHoldNotesRef.current.set(candidate.id, {
        noteId: candidate.id,
        lane,
        startMs: candidate.timeMs,
        endMs: candidate.timeMs + candidate.durationMs
      });
      hitSoundManager.startHoldSound(candidate.id);
    }

    let pts = 0;
    let text = 'MISS!';
    let color = '#ef4444';

    if (diff <= PERFECT_WIN) {
      text = 'PERFECT!';
      color = '#34d399';
      pts = 300;
    } else if (diff <= GREAT_WIN) {
      text = 'GREAT';
      color = '#60a5fa';
      pts = 200;
    } else {
      text = 'BAD';
      color = '#f59e0b';
      pts = 100;
    }

    registerJudgment(text, color, pts);
    spawnHitParticles(lane, color);
    hitSoundManager.playHitSound(activeMode, candidate.lane);
  }, [getActiveNotes, activeKeyCount, activeMode]);

  // Unified Lane Press and Release triggers for both Keyboard and Multi-Touch
  const triggerLanePress = useCallback((laneIndex: number) => {
    if (laneIndex < 0 || laneIndex >= activeKeyCount) return;
    pressedKeysRef.current[laneIndex] = true;
    setPressedKeys(prev => {
      const updated = [...prev];
      updated[laneIndex] = true;
      return updated;
    });

    if (touchHaptics && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(10); } catch {}
    }

    if (!autoPlay && isPlaying) {
      evaluateHit(laneIndex, currentTimeMsRef.current || currentTimeMs);
    }
  }, [activeKeyCount, touchHaptics, autoPlay, isPlaying, evaluateHit, currentTimeMs]);

  const triggerLaneRelease = useCallback((laneIndex: number) => {
    if (laneIndex < 0 || laneIndex >= activeKeyCount) return;
    pressedKeysRef.current[laneIndex] = false;
    setPressedKeys(prev => {
      const updated = [...prev];
      updated[laneIndex] = false;
      return updated;
    });

    const toDelete: string[] = [];
    activeHoldNotesRef.current.forEach((holdData, noteId) => {
      if (holdData.lane === laneIndex) {
        toDelete.push(noteId);
      }
    });
    toDelete.forEach(id => {
      activeHoldNotesRef.current.delete(id);
      hitSoundManager.stopHoldSound(id);
    });
    if (activeHoldNotesRef.current.size === 0) {
      hitSoundManager.stopAllHoldSounds();
    }
  }, [activeKeyCount]);

  // Multi-Touch Pointer Handlers
  const handleTouchDownLane = useCallback((laneIndex: number, pointerId: number, e?: React.PointerEvent | React.TouchEvent) => {
    if (e) {
      if ('preventDefault' in e) e.preventDefault();
      if ('stopPropagation' in e) e.stopPropagation();
    }
    activePointersRef.current.set(pointerId, laneIndex);
    triggerLanePress(laneIndex);
  }, [triggerLanePress]);

  const handleTouchUpLane = useCallback((pointerId: number, e?: React.PointerEvent | React.TouchEvent) => {
    if (e) {
      if ('preventDefault' in e) e.preventDefault();
      if ('stopPropagation' in e) e.stopPropagation();
    }
    const laneIndex = activePointersRef.current.get(pointerId);
    if (laneIndex !== undefined) {
      activePointersRef.current.delete(pointerId);
      let isHeldByAnother = false;
      activePointersRef.current.forEach((heldLane) => {
        if (heldLane === laneIndex) isHeldByAnother = true;
      });
      if (!isHeldByAnother) {
        triggerLaneRelease(laneIndex);
      }
    }
  }, [triggerLaneRelease]);

  // Keyboard Listeners
  useEffect(() => {
    const matchLane = (keyName: string, code: string, rawKey: string): number => {
      for (let i = 0; i < currentKeyMap.length; i++) {
        const k = (currentKeyMap[i] || '').toLowerCase();
        if (!k) continue;
        if (k === keyName) return i;
        if (k === 'space' && (code === 'space' || keyName === ' ')) return i;
        if (k === 'arrowleft' && rawKey === 'ArrowLeft') return i;
        if (k === 'arrowdown' && rawKey === 'ArrowDown') return i;
        if (k === 'arrowup' && rawKey === 'ArrowUp') return i;
        if (k === 'arrowright' && rawKey === 'ArrowRight') return i;
      }
      if (activeMode === 'fnf' || (activeKeyCount === 4 && activeMode !== 'taiko')) {
        if (rawKey === 'ArrowLeft') return 0;
        if (rawKey === 'ArrowDown') return 1;
        if (rawKey === 'ArrowUp') return 2;
        if (rawKey === 'ArrowRight') return 3;
      } else if (activeMode === 'taiko') {
        if (['z', 'x', 'f', 'j'].includes(keyName)) return 0;
        if (['c', 'v', 'd', 'k'].includes(keyName)) return 1;
      } else if (activeKeyCount === 2 || activeMode === 'llplus') {
        if (rawKey === 'ArrowLeft' || ['a', 'd', 'f'].includes(keyName)) return 0;
        if (rawKey === 'ArrowRight' || ['k', 'j', 'l'].includes(keyName)) return 1;
      }
      return -1;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !chart || isRebindingModalOpen) return;

      const keyName = e.key.toLowerCase();
      const code = e.code.toLowerCase();

      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '');

      // Spacebar toggle play/pause when in test mode or not typing
      if (e.code === 'Space' && !isInputFocused && !isPlayMode) {
        e.preventDefault();
        togglePlay();
        return;
      }

      // Check pause key from customKeyMaps['game_actions'] (default is escape)
      const pauseKey = (customKeyMaps['game_actions'] && customKeyMaps['game_actions'][0])
        ? customKeyMaps['game_actions'][0].toLowerCase()
        : 'escape';

      const isPauseKey = (
        (pauseKey === 'space' && (code === 'space' || keyName === ' ' || keyName === 'space')) ||
        (pauseKey === 'escape' && keyName === 'escape') ||
        (pauseKey === 'enter' && keyName === 'enter') ||
        (keyName === pauseKey)
      );

      if (isPauseKey && isPlayMode) {
        e.preventDefault();
        togglePlay();
        return;
      }

      // [R] Quick Instant Restart when testing (unless user is typing in an input)
      if (!isInputFocused && e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        resetGameplay();
        return;
      }

      // [Tab] Instant Toggle Bot Autoplay
      if (!isInputFocused && e.code === 'Tab') {
        e.preventDefault();
        toggleAutoBot();
        return;
      }

      const laneHit = matchLane(keyName, code, e.key);
      if (laneHit !== -1) {
        triggerLanePress(laneHit);
      } else if (!isInputFocused && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !isPlayMode) {
        // Seek ±5 seconds in workbench mode if arrow keys are not game lanes
        e.preventDefault();
        const delta = e.code === 'ArrowLeft' ? -5000 : 5000;
        const newTime = Math.max(0, Math.min(durationMs || 1000, currentTimeMsRef.current + delta));
        const newTimeSec = newTime / 1000;
        currentTimeMsRef.current = newTime;
        setCurrentTimeMs(newTime);
        if (audioRef.current) audioRef.current.currentTime = newTimeSec;
        if (vocalsRef.current) vocalsRef.current.currentTime = newTimeSec;
        if (videoRef.current) videoRef.current.currentTime = newTimeSec;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!chart || isRebindingModalOpen) return;
      const keyName = e.key.toLowerCase();
      const code = e.code.toLowerCase();

      const laneHit = matchLane(keyName, code, e.key);
      if (laneHit !== -1) {
        triggerLaneRelease(laneHit);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [chart, activeMode, activeKeyCount, currentKeyMap, customKeyMaps, isRebindingModalOpen, isPlayMode, triggerLanePress, triggerLaneRelease, togglePlay]);

  const registerJudgment = (text: string, color: string, pts: number) => {
    setRecentJudgment({ text, color, key: Date.now() });

    if (pts > 0) {
      setScore(s => s + pts);
      setCombo(c => {
        const next = c + 1;
        setMaxCombo(m => Math.max(m, next));
        return next;
      });

      // Health only recovers if player hasn't failed AND hits at least 6 notes in a row
      if (!hasFailedRef.current) {
        consecutiveHitsRef.current += 1;
        if (consecutiveHitsRef.current >= 6) {
          setHealth(h => Math.min(100, h + 2.5));
        }
      }

      if (pts === 300) setJudgmentCounts(j => ({ ...j, perfect: j.perfect + 1 }));
      else if (pts === 200) setJudgmentCounts(j => ({ ...j, great: j.great + 1 }));
      else setJudgmentCounts(j => ({ ...j, bad: j.bad + 1 }));
    } else {
      setCombo(0);
      consecutiveHitsRef.current = 0;

      if (!hasFailedRef.current) {
        setHealth(h => {
          const nextH = Math.max(0, h - 8);
          if (nextH <= 0) {
            hasFailedRef.current = true;
            setHasFailed(true);
            return 0;
          }
          return nextH;
        });
      }

      setJudgmentCounts(j => ({ ...j, miss: j.miss + 1 }));
    }
  };

  // Spawn lightweight burst particles at hit location (directly at drum circle for Taiko!)
  const spawnHitParticles = (lane: number, color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.width;
    const height = canvas.height;

    let x: number;
    let y: number;

    if (activeMode === 'taiko') {
      x = Math.max(160, Math.floor(width * 0.12)); // Exact Taiko receptor circle position!
      y = height / 2; // Exact Taiko track center!
    } else {
      const kCount = activeKeyCount;
      const laneWidth = Math.min(70, Math.floor((width - 40) / kCount));
      const totalWidth = laneWidth * kCount;
      const startX = (width - totalWidth) / 2;
      x = startX + lane * laneWidth + laneWidth / 2;
      y = scrollDirection === 'down' ? height - 90 : 90;
    }

    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: Math.random() * 5 + 2,
        life: 0,
        maxLife: Math.random() * 16 + 12
      });
    }
  };

  // Canvas Resize Listener to expand full screen width for all modes
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const targetWidth = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
      const targetHeight = typeof window !== 'undefined' ? (window.innerHeight || 800) : 800;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [activeMode, isPlayMode]);

  // Main Render Loop (60 FPS, Lag-Free)
  useEffect(() => {
    let lastTime = performance.now();
    let lastUiUpdate = 0;

    const loop = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      if (leadInActiveRef.current) {
        // Smooth visual note descent during the 3 seconds preparation wait
        const elapsed = now - leadInStartTimeRef.current;
        const duration = leadInDurationRef.current;
        const target = leadInTargetTimeRef.current;
        const progress = Math.min(1, Math.max(0, elapsed / duration));

        // Notes advance down the highway from (target - duration * playbackSpeed) up to target
        currentTimeMsRef.current = target - (1 - progress) * (duration * playbackSpeed);
      } else if (isPlaying) {
        if (audioRef.current && !isNaN(audioRef.current.currentTime)) {
          const currentAudioTime = audioRef.current.currentTime;
          
          // Check if audio has actually started moving past start time
          if (!audioWarmedUpRef.current) {
            if (currentAudioTime !== audioStartTimeRef.current && currentAudioTime > 0) {
              audioWarmedUpRef.current = true;
            }
          }

          if (!audioWarmedUpRef.current) {
            // Audio is still warming up; advance smoothly with high-res delta
            currentTimeMsRef.current += delta * playbackSpeed;
          } else {
            // Audio is warm; sync to actual audio clock with EMA smoothing
            const rawSyncedTime = (currentAudioTime * 1000) + audioOffset;
            const estimatedTime = currentTimeMsRef.current + delta * playbackSpeed;
            const diff = Math.abs(estimatedTime - rawSyncedTime);
            
            if (diff > 350) {
              // Snap to audio time on major seeking/desync
              currentTimeMsRef.current = rawSyncedTime;
            } else {
              // Apply exponential smoothing (EMA) to prevent stutters
              const base = currentTimeMsRef.current + delta * playbackSpeed;
              const nextTime = base + (rawSyncedTime - base) * 0.12;
              currentTimeMsRef.current = Math.max(currentTimeMsRef.current, nextTime);
            }
          }

          // Sync background video if present
          if (videoRef.current && Math.abs(videoRef.current.currentTime * 1000 - currentTimeMsRef.current) > 150) {
            videoRef.current.currentTime = audioRef.current.currentTime;
          }
        } else {
          currentTimeMsRef.current += delta * playbackSpeed;
        }

        // Throttle React state update for UI progress bar & timestamp labels to ~10fps (every 100ms)
        if (now - lastUiUpdate > 100) {
          lastUiUpdate = now;
          setCurrentTimeMs(currentTimeMsRef.current);
        }
      }

      renderCanvas();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, hideCountdown, chart, activeKeyCount, activeMode, scrollSpeed, scrollDirection, autoPlay, playbackSpeed, bgDim, selectedDiffIndex, bgVideoUrl, bgImageUrl, audioOffset, playfieldScale, playfieldFillScreen]);

  // Canvas Drawing
  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !chart) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear entire canvas so background image or video is FULLY VISIBLE!
    ctx.clearRect(0, 0, width, height);

    const time = currentTimeMsRef.current;
    const mode = activeMode;
    const kCount = activeKeyCount;

    if (mode === 'taiko') {
      renderTaikoStage(ctx, width, height, time);
    } else if (mode === 'fnf') {
      renderFnfStage(ctx, width, height, time);
    } else if (mode === 'llplus') {
      renderLlpStage(ctx, width, height, time);
    } else {
      renderManiaStage(ctx, width, height, time, kCount);
    }

    renderParticles(ctx);

    if (isPlaying) {
      processAutoPlayAndMisses(time);
    }
  };

  const processAutoPlayAndMisses = (timeMs: number) => {
    const activeNotes = getActiveNotes();
    if (!activeNotes.length) return;

    const MISS_THRESHOLD = 140;

    // Check active hold notes expiration and particles while holding
    const expiredIds: string[] = [];
    activeHoldNotesRef.current.forEach((holdData, noteId) => {
      if (timeMs >= holdData.endMs) {
        // Hold completed successfully
        expiredIds.push(noteId);
        spawnHitParticles(holdData.lane, '#c084fc');
      } else {
        // Continuous subtle particles while holding
        if (Math.random() < 0.35) {
          spawnHitParticles(holdData.lane, '#c084fc');
        }
      }
    });

    expiredIds.forEach(id => {
      activeHoldNotesRef.current.delete(id);
      hitSoundManager.stopHoldSound(id);
    });

    if (activeHoldNotesRef.current.size === 0) {
      hitSoundManager.stopAllHoldSounds();
    }

    activeNotes.forEach(note => {
      if (processedNotesRef.current.has(note.id)) return;

      if (autoPlay) {
        if (timeMs >= note.timeMs) {
          processedNotesRef.current.add(note.id);
          registerJudgment('PERFECT', '#38bdf8', 300);
          spawnHitParticles(note.lane, '#38bdf8');
          hitSoundManager.playHitSound(activeMode, note.lane);

          if (note.durationMs > 0) {
            activeHoldNotesRef.current.set(note.id, {
              noteId: note.id,
              lane: note.lane,
              startMs: note.timeMs,
              endMs: note.timeMs + note.durationMs
            });
            hitSoundManager.startHoldSound(note.id);
          }
        }
        return;
      }

      if (activeMode === 'fnf' && note.isOpponent) {
        if (timeMs >= note.timeMs) {
          processedNotesRef.current.add(note.id);
        }
        return;
      }

      if (timeMs - note.timeMs > MISS_THRESHOLD) {
        processedNotesRef.current.add(note.id);
        registerJudgment('MISS!', '#ef4444', 0);
      }
    });
  };

  const renderParticles = (ctx: CanvasRenderingContext2D) => {
    particlesRef.current.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;

      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1.0;
    });

    particlesRef.current = particlesRef.current.filter(p => p.life < p.maxLife);
  };

  // Mania / LLPlus Stage (Comfortable normalized speed scale)
  const renderManiaStage = (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number, kCount: number) => {
    const laneWidth = effectivePlayfieldFill ? Math.floor(width / kCount) : Math.min(70 * effectivePlayfieldScale, Math.floor((width - 40) / kCount));
    const totalWidth = laneWidth * kCount;
    const startX = effectivePlayfieldFill ? (width - totalWidth) / 2 : (width - totalWidth) / 2; // Keep centered if floor causes minor remainder


    const receptorY = scrollDirection === 'down' ? height - 90 : 90;
    const regionSpeedMult = getRegionSpeedMult(timeMs);
    const speed = effectiveScrollSpeed * 0.22 * regionSpeedMult; // Comfortable, normalized speed!

    // Track Background (Optional / Configurable Opacity)
    if (trackOpacity > 0) {
      ctx.fillStyle = `rgba(15, 15, 23, ${trackOpacity})`;
      ctx.fillRect(startX, 0, totalWidth, height);
    }

    // Lane Dividers (Optional / Configurable)
    if (showLaneDividers) {
      ctx.strokeStyle = 'rgba(63, 63, 70, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= kCount; i++) {
        const x = startX + i * laneWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Receptors
    for (let i = 0; i < kCount; i++) {
      const x = startX + i * laneWidth;
      const ry = receptorY;
      const isPressed = pressedKeysRef.current[i] || pressedKeys[i] || (autoPlay && isPlaying);

      ctx.fillStyle = isPressed ? 'rgba(99, 102, 241, 0.45)' : 'rgba(39, 39, 42, 0.85)';
      ctx.strokeStyle = isPressed ? '#818cf8' : '#52525b';
      ctx.lineWidth = isPressed ? 3 : 2;

      ctx.beginPath();
      ctx.roundRect(x + 4, ry - 15 * effectivePlayfieldScale, laneWidth - 8, 30 * effectivePlayfieldScale, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isPressed ? '#ffffff' : '#a1a1aa';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((currentKeyMap[i] || '').toUpperCase(), x + laneWidth / 2, ry + 4);
    }

    // Notes
    const activeNotes = getActiveNotes();

    activeNotes.forEach(note => {
      const isConsumed = processedNotesRef.current.has(note.id);
      const isHold = note.durationMs > 0;

      if (isConsumed && !isHold) return; // DISAPPEAR CONSUMED NORMAL NOTES IMMEDIATELY!

      const noteEndTimeMs = note.timeMs + note.durationMs;
      if (isHold && isConsumed && timeMs >= noteEndTimeMs) return;

      const timeDiff = note.timeMs - timeMs;
      const timeDistance = chart?.isIricPackage ? getIricDistance(timeMs, note.timeMs) : timeDiff;
      const yOffset = timeDistance * speed;
      let noteY = scrollDirection === 'down' ? receptorY - yOffset : receptorY + yOffset;

      const origLane = note.lane % kCount;
      const displayLane = origLane;
      let x = startX + displayLane * laneWidth;
      const noteColor = isHold ? '#c084fc' : (displayLane % 2 === 0 ? '#818cf8' : '#38bdf8');

      if (isHold && isConsumed) {
        noteY = receptorY; // Clamp head to receptor while hold is being consumed!
      }

      const alpha = 1.0;
      ctx.globalAlpha = alpha;

      if (isHold) {
        const holdTailStartMs = Math.max(timeMs, note.timeMs);
        const remainingHoldDuration = Math.max(0, noteEndTimeMs - holdTailStartMs);
        const holdTailDistance = chart?.isIricPackage
          ? Math.max(0, getIricDistance(holdTailStartMs, noteEndTimeMs))
          : remainingHoldDuration;
        const tailLength = holdTailDistance * speed;
        const tailY = scrollDirection === 'down' ? noteY - tailLength : noteY + tailLength;

        if (tailLength > 0) {
          ctx.fillStyle = 'rgba(192, 132, 252, 0.4)';
          ctx.fillRect(x + 10, Math.min(noteY, tailY), laneWidth - 20, Math.abs(tailLength));
        }
      }

      // Note Head (osu!mania style rounded pill bar with crisp high-contrast border)
      if (!isConsumed && noteY >= -50 && noteY <= height + 50) {
        ctx.fillStyle = noteColor;
        ctx.beginPath();
        ctx.roundRect(x + 6, noteY - 10 * effectivePlayfieldScale, laneWidth - 12, 20 * effectivePlayfieldScale, 4);
        ctx.fill();

        // Distinct crisp border so normal tap notes inside hold trails are clearly visible
        ctx.strokeStyle = isHold ? '#e9d5ff' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
    });
  };

  // Horizontal Taiko Stage (Larger track spanning full width, clear drum target, keybinds below)
  const renderTaikoStage = (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => {
    const trackY = height / 2;
    const trackHeight = 110 * effectivePlayfieldScale; // Taller track spanning full width
    const receptorX = Math.max(160, Math.floor(width * 0.12));
    const drumRadius = 36 * effectivePlayfieldScale; // Larger drum target circle

    // Full-width track background (0 to width)
    if (trackOpacity > 0) {
      ctx.fillStyle = `rgba(12, 12, 18, ${Math.min(0.95, trackOpacity * 0.88)})`;
      ctx.fillRect(0, trackY - trackHeight / 2, width, trackHeight);

      // Top & bottom glowing border lines extending from 0 to width
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.35, trackOpacity * 0.4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, trackY - trackHeight / 2);
      ctx.lineTo(width, trackY - trackHeight / 2);
      ctx.moveTo(0, trackY + trackHeight / 2);
      ctx.lineTo(width, trackY + trackHeight / 2);
      ctx.stroke();

      // Center guide line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, trackY);
      ctx.lineTo(width, trackY);
      ctx.stroke();
    }

    const isDonPressed = pressedKeysRef.current[0] || pressedKeys[0] || (autoPlay && isPlaying);
    const isKatPressed = pressedKeysRef.current[1] || pressedKeys[1] || (autoPlay && isPlaying);

    const rx = receptorX;
    const ry = trackY;

    // Hit pulse / Shockwave ring effect on drum receptor
    if (isDonPressed || isKatPressed) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(rx, ry, drumRadius + 14, 0, Math.PI * 2);
      ctx.strokeStyle = isDonPressed ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.8)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    }

    // Drum receptor circle
    ctx.fillStyle = isDonPressed 
      ? 'rgba(239, 68, 68, 0.9)' 
      : (isKatPressed ? 'rgba(59, 130, 246, 0.9)' : 'rgba(24, 24, 32, 0.85)');
    ctx.strokeStyle = isDonPressed ? '#f87171' : (isKatPressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.7)');
    ctx.lineWidth = 3.5;

    ctx.beginPath();
    ctx.arc(rx, ry, drumRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner target ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rx, ry, drumRadius - 6, 0, Math.PI * 2);
    ctx.stroke();

    // Text label UNDER the target circle showing key bindings (ALWAYS rendered)
    ctx.save();
    const donTxt = (currentKeyMap[0] && currentKeyMap[0] !== 'z') ? currentKeyMap[0].toUpperCase() : 'F / J';
    const katTxt = (currentKeyMap[1] && currentKeyMap[1] !== 'c') ? currentKeyMap[1].toUpperCase() : 'D / K';

    const labelY = ry + drumRadius + 22;

    // Dark high-contrast background badge pill under target circle
    ctx.fillStyle = 'rgba(8, 9, 14, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    safeRoundRect(ctx, rx - 85, labelY - 13, 170, 26, 13);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 12px monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Red DON text + Blue KAT text
    ctx.fillStyle = '#ff4d4d';
    ctx.fillText(`DON: ${donTxt}`, rx - 42, labelY);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('|', rx, labelY);

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`KAT: ${katTxt}`, rx + 42, labelY);

    ctx.restore();

    // Render incoming Taiko notes
    const regionSpeedMult = getRegionSpeedMult(timeMs);
    const speed = effectiveScrollSpeed * 0.20 * regionSpeedMult;
    const activeNotes = getActiveNotes();

    activeNotes.forEach(note => {
      if (processedNotesRef.current.has(note.id)) return;

      const timeDiff = note.timeMs - timeMs;
      const timeDistance = chart?.isIricPackage ? getIricDistance(timeMs, note.timeMs) : timeDiff;
      let noteX = receptorX + (timeDistance * speed);
      let noteY = trackY;

      const origKat = note.type === 'taiko_kat' || (note.lane % 2 === 1);
      const isKat = origKat;
      const color = isKat ? '#3b82f6' : '#ef4444';

      if (noteX < -40 || noteX > width + 80) return;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(noteX, noteY, 26 * effectivePlayfieldScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // Friday Night Funkin' Stage (Osu!/Mania engine style note rendering)
  const renderFnfStage = (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => {
    const fnfColors = ['#c084fc', '#38bdf8', '#34d399', '#f87171'];
    const fnfKeySymbols = ['←', '↓', '↑', '→'];

    const laneWidth = effectivePlayfieldFill ? Math.floor(width / 4) : Math.min(70 * effectivePlayfieldScale, Math.floor((width - 40) / 4));
    const totalWidth = laneWidth * 4;
    const startX = effectivePlayfieldFill ? (width - totalWidth) / 2 : (width - totalWidth) / 2;

    const receptorY = scrollDirection === 'down' ? height - 90 : 90;
    const regionSpeedMult = getRegionSpeedMult(timeMs);
    const speed = effectiveScrollSpeed * 0.22 * regionSpeedMult;

    // Track Background (osu! style dark track - Configurable Opacity)
    if (trackOpacity > 0) {
      ctx.fillStyle = `rgba(15, 15, 23, ${trackOpacity})`;
      ctx.fillRect(startX, 0, totalWidth, height);
    }

    // Lane Dividers (Configurable)
    if (showLaneDividers) {
      ctx.strokeStyle = 'rgba(63, 63, 70, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const x = startX + i * laneWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Strums / Receptors (osu!mania style caps)
    for (let i = 0; i < 4; i++) {
      const x = startX + i * laneWidth;
      const ry = receptorY;
      const isPressed = pressedKeysRef.current[i] || pressedKeys[i] || (autoPlay && isPlaying);

      ctx.fillStyle = isPressed ? `${fnfColors[i]}66` : 'rgba(39, 39, 42, 0.85)';
      ctx.strokeStyle = isPressed ? '#ffffff' : fnfColors[i];
      ctx.lineWidth = isPressed ? 3 : 2;

      ctx.beginPath();
      ctx.roundRect(x + 4, ry - 15 * effectivePlayfieldScale, laneWidth - 8, 30 * effectivePlayfieldScale, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isPressed ? '#ffffff' : fnfColors[i];
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const keyLabel = (currentKeyMap[i] || fnfKeySymbols[i]).toUpperCase();
      ctx.fillText(keyLabel, x + laneWidth / 2, ry + 4);
    }

    // Active Notes (osu!mania style clean rounded pill notes)
    const activeNotes = getActiveNotes();

    activeNotes.forEach(note => {
      const isConsumed = processedNotesRef.current.has(note.id);
      const isHold = note.durationMs > 0;

      if (isConsumed && !isHold) return;

      const noteEndTimeMs = note.timeMs + note.durationMs;
      if (isHold && isConsumed && timeMs >= noteEndTimeMs) return;

      const timeDiff = note.timeMs - timeMs;
      const timeDistance = chart?.isIricPackage ? getIricDistance(timeMs, note.timeMs) : timeDiff;
      const yOffset = timeDistance * speed;
      let noteY = scrollDirection === 'down' ? receptorY - yOffset : receptorY + yOffset;

      if (isHold && isConsumed) {
        noteY = receptorY;
      }

      const origLane = note.lane % 4;
      const lane = origLane;
      let x = startX + lane * laneWidth;
      const color = fnfColors[lane];

      const alpha = 1.0;
      ctx.globalAlpha = alpha;

      // Hold Note Trail
      if (isHold) {
        const holdTailStartMs = Math.max(timeMs, note.timeMs);
        const remainingHoldDuration = Math.max(0, noteEndTimeMs - holdTailStartMs);
        const holdTailDistance = chart?.isIricPackage
          ? Math.max(0, getIricDistance(holdTailStartMs, noteEndTimeMs))
          : remainingHoldDuration;
        const tailLength = holdTailDistance * speed;
        const tailY = scrollDirection === 'down' ? noteY - tailLength : noteY + tailLength;

        if (tailLength > 0) {
          ctx.fillStyle = `${color}66`;
          ctx.fillRect(x + 10, Math.min(noteY, tailY), laneWidth - 20, Math.abs(tailLength));
        }
      }

      // Note Head (osu!mania style rounded pill bar)
      if (!isConsumed && noteY >= -50 && noteY <= height + 50) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 6, noteY - 10 * effectivePlayfieldScale, laneWidth - 12, 20 * effectivePlayfieldScale, 4);
        ctx.fill();

        ctx.strokeStyle = isHold ? '#e9d5ff' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
    });
  };

  // Deltarune: Lightners Live + Stage (Osu!/Mania engine style note rendering)
  const renderLlpStage = (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => {
    const laneWidth = effectivePlayfieldFill ? Math.floor(width / 2) : Math.min(100 * effectivePlayfieldScale, Math.floor((width - 40) / 2));
    const totalWidth = laneWidth * 2;
    const startX = effectivePlayfieldFill ? (width - totalWidth) / 2 : (width - totalWidth) / 2;

    const receptorY = scrollDirection === 'down' ? height - 90 : 90;
    const regionSpeedMult = getRegionSpeedMult(timeMs);
    const speed = effectiveScrollSpeed * 0.22 * regionSpeedMult;

    const krisColors = ['#00e5ff', '#ff2d55'];
    const krisBgColors = ['rgba(0, 229, 255, 0.35)', 'rgba(255, 45, 85, 0.35)'];

    // Track Background
    if (trackOpacity > 0) {
      ctx.fillStyle = `rgba(10, 10, 18, ${trackOpacity})`;
      ctx.fillRect(startX, 0, totalWidth, height);
    }

    if (showLaneDividers) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();

      ctx.strokeStyle = '#ff2d55';
      ctx.beginPath();
      ctx.moveTo(startX + totalWidth, 0);
      ctx.lineTo(startX + totalWidth, height);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX + laneWidth, 0);
      ctx.lineTo(startX + laneWidth, height);
      ctx.stroke();
    }

    // Receptors / Strums (osu!mania style caps)
    for (let i = 0; i < 2; i++) {
      const x = startX + i * laneWidth;
      const ry = receptorY;
      const isPressed = pressedKeysRef.current[i] || pressedKeys[i] || (autoPlay && isPlaying);

      ctx.fillStyle = isPressed ? krisBgColors[i] : 'rgba(24, 24, 32, 0.9)';
      ctx.strokeStyle = isPressed ? '#ffffff' : krisColors[i];
      ctx.lineWidth = isPressed ? 3 : 2;

      ctx.beginPath();
      ctx.roundRect(x + 6, ry - 15 * effectivePlayfieldScale, laneWidth - 12, 30 * effectivePlayfieldScale, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isPressed ? '#ffffff' : krisColors[i];
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const keyLabel = (currentKeyMap[i] || (i === 0 ? 'D' : 'K')).toUpperCase();
      ctx.fillText(keyLabel, x + laneWidth / 2, ry + 4);
    }

    // Active Notes (osu!mania style clean rounded pill notes)
    const activeNotes = getActiveNotes();

    activeNotes.forEach(note => {
      const isConsumed = processedNotesRef.current.has(note.id);
      const isHold = note.durationMs > 0;

      if (isConsumed && !isHold) return;

      const noteEndTimeMs = note.timeMs + note.durationMs;
      if (isHold && isConsumed && timeMs >= noteEndTimeMs) return;

      const timeDiff = note.timeMs - timeMs;
      const timeDistance = chart?.isIricPackage ? getIricDistance(timeMs, note.timeMs) : timeDiff;
      const yOffset = timeDistance * speed;
      let noteY = scrollDirection === 'down' ? receptorY - yOffset : receptorY + yOffset;

      if (isHold && isConsumed) {
        noteY = receptorY;
      }

      const origLane = note.lane % 2;
      const lane = origLane;
      let x = startX + lane * laneWidth;
      const color = krisColors[lane];

      const alpha = 1.0;
      ctx.globalAlpha = alpha;

      // Hold Note Trail
      if (isHold) {
        const holdTailStartMs = Math.max(timeMs, note.timeMs);
        const remainingHoldDuration = Math.max(0, noteEndTimeMs - holdTailStartMs);
        const holdTailDistance = chart?.isIricPackage
          ? Math.max(0, getIricDistance(holdTailStartMs, noteEndTimeMs))
          : remainingHoldDuration;
        const tailLength = holdTailDistance * speed;
        const tailY = scrollDirection === 'down' ? noteY - tailLength : noteY + tailLength;

        if (tailLength > 0) {
          ctx.fillStyle = `${color}55`;
          ctx.fillRect(x + 12, Math.min(noteY, tailY), laneWidth - 24, Math.abs(tailLength));
        }
      }

      // Note Head (osu!mania style rounded pill bar)
      if (!isConsumed && noteY >= -50 && noteY <= height + 50) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 6, noteY - 10 * effectivePlayfieldScale, laneWidth - 12, 20 * effectivePlayfieldScale, 4);
        ctx.fill();

        ctx.strokeStyle = isHold ? '#ffffff' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
    });
  };

  const totalHitsHUD = judgmentCounts.perfect + judgmentCounts.great + judgmentCounts.bad + judgmentCounts.miss;
  const rawHitPointsHUD = (judgmentCounts.perfect * 300) + (judgmentCounts.great * 200) + (judgmentCounts.bad * 100);
  const accuracy = totalHitsHUD > 0 ? Math.min(100, Math.max(0, (rawHitPointsHUD / (totalHitsHUD * 300)) * 100)).toFixed(1) : '100.0';

  if (isPlayMode) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center overflow-hidden">
        {bgVideoUrl ? (
          <video
            ref={videoRef}
            src={bgVideoUrl}
            muted
            playsInline
            loop
            disablePictureInPicture
            controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
            className={`absolute inset-0 w-full h-full ${coverBackground ? 'object-cover' : 'object-contain bg-black'} pointer-events-none z-0`}
          />
        ) : bgImageUrl ? (
          <img
            src={bgImageUrl}
            alt="Background"
            className={`absolute inset-0 w-full h-full ${coverBackground ? 'object-cover' : 'object-contain bg-black'} pointer-events-none z-0`}
          />
        ) : null}

        {bgDim > 0 && (
          <div className="absolute inset-0 z-0 bg-black pointer-events-none transition-opacity" style={{ opacity: bgDim }} />
        )}

        {/* Red Vignette Border on Death / Stage Failed */}
        {hasFailed && (
          <div className="absolute inset-0 pointer-events-none z-30 shadow-[inset_0_0_100px_rgba(239,68,68,0.7)] border-4 border-red-500/60 animate-pulse" />
        )}

        {/* Taiko Controls Display - Compact & Unobtrusive */}
        {activeMode === 'taiko' && !hideGameplayUi && (
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 pointer-events-none opacity-60 hover:opacity-100 transition-opacity">
            <div className={`px-2.5 py-1 rounded-xl border backdrop-blur-sm flex items-center gap-2 transition-all ${
              pressedKeys[0] 
                ? 'bg-red-950/70 border-red-500/70 text-white scale-105' 
                : 'bg-black/40 border-white/10 text-zinc-400'
            }`}>
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-[10px] font-mono font-bold text-red-300">
                DON: {currentKeyMap[0] ? currentKeyMap[0].toUpperCase() : 'F/J'}
              </span>
            </div>

            <div className={`px-2.5 py-1 rounded-xl border backdrop-blur-sm flex items-center gap-2 transition-all ${
              pressedKeys[1] 
                ? 'bg-blue-950/70 border-blue-500/70 text-white scale-105' 
                : 'bg-black/40 border-white/10 text-zinc-400'
            }`}>
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span className="text-[10px] font-mono font-bold text-blue-300">
                KAT: {currentKeyMap[1] ? currentKeyMap[1].toUpperCase() : 'D/K'}
              </span>
            </div>
          </div>
        )}

        {/* Top Left Always-Visible Minimal Glass Controls (Pause, Fullscreen, Pequeñísimo Time Counter) */}
        <div className="absolute top-4 left-4 z-40 flex items-center gap-2 pointer-events-auto select-none">
          <button
            onClick={togglePlay}
            className="p-2.5 bg-zinc-950/40 hover:bg-zinc-900/60 text-zinc-200 hover:text-white rounded-2xl border border-white/15 backdrop-blur-xl backdrop-saturate-150 shadow-2xl transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center"
            title="Pause / Resume"
          >
            <Pause className="w-4 h-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 bg-zinc-950/40 hover:bg-zinc-900/60 text-zinc-200 hover:text-white rounded-2xl border border-white/15 backdrop-blur-xl backdrop-saturate-150 shadow-2xl transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4 text-indigo-400" /> : <Maximize2 className="w-4 h-4 text-zinc-300" />}
          </button>

          {/* Pequeñísimo Timer Counter with Glassmorphism */}
          <div className="px-3 py-1.5 bg-zinc-950/40 rounded-2xl border border-white/15 backdrop-blur-xl backdrop-saturate-150 flex items-center gap-1.5 shadow-2xl text-[10px] font-mono font-bold text-zinc-200">
            <span>{Math.floor(Math.max(0, currentTimeMs) / 60000)}:{String(Math.floor((Math.max(0, currentTimeMs) % 60000) / 1000)).padStart(2, '0')}</span>
            <span className="text-zinc-500">/</span>
            <span className="text-zinc-400">{Math.floor(durationMs / 60000)}:{String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}</span>
          </div>

          {autoPlay && (
            <div className="px-2.5 py-1 bg-purple-950/60 text-purple-300 border border-purple-500/40 rounded-xl backdrop-blur-xl text-[9px] font-mono font-bold tracking-wider shadow-lg">
              AUTO
            </div>
          )}
        </div>

        {/* Ultra-Fine Timeline Border orbiting entire screen perimeter clockwise */}
        {durationMs > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-50 overflow-visible">
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="3"
            />
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="none"
              stroke={
                hasFailed || health <= 0
                  ? '#ef4444'
                  : health >= 80
                  ? '#ffffff'
                  : `rgb(255, ${Math.round(68 + (health / 80) * (255 - 68))}, ${Math.round(68 + (health / 80) * (255 - 68))})`
              }
              strokeWidth="3"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - Math.min(100, Math.max(0, (currentTimeMs / durationMs) * 100))}
              className="transition-all duration-100 ease-linear"
              style={{
                filter: health < 50 || hasFailed
                  ? 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.9))'
                  : 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.8))'
              }}
            />
          </svg>
        )}

        {/* Recent Judgment Popup */}
        {!hideGameplayUi && recentJudgment && (
          <div
            key={recentJudgment.key}
            className={`absolute pointer-events-none z-30 text-center animate-bounce flex flex-col items-center ${
              activeMode === 'taiko'
                ? 'top-1/2 -translate-x-1/2 -translate-y-[110px]'
                : 'top-1/4 left-1/2 -translate-x-1/2'
            }`}
            style={activeMode === 'taiko' ? { left: `${Math.max(160, Math.floor((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.12))}px` } : undefined}
          >
            <span
              className="text-3xl sm:text-4xl font-black tracking-widest drop-shadow-[0_0_12px_rgba(0,0,0,0.8)]"
              style={{ color: recentJudgment.color }}
            >
              {recentJudgment.text}
            </span>
          </div>
        )}

        {/* Countdown Overlay (3... 2... 1... GO!) - NO BLUR */}
        {countdown !== null && !hideCountdown && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-center">
              <span className={`text-9xl font-black tracking-widest font-mono drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] ${
                typeof countdown === 'number'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}>
                {countdown}
              </span>
            </div>
          </div>
        )}

        {/* Results / Score Breakdown Overlay */}
        {isResultsOpen && resultsData && (
          <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className={`w-full max-w-md glass-panel border rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center relative overflow-hidden ${
              resultsData.isFailed 
                ? 'border-red-500/50 shadow-red-950/50' 
                : 'border-indigo-500/50 shadow-indigo-950/60'
            }`}>
              {/* Top ambient glow light */}
              <div className={`absolute -top-16 inset-x-0 h-32 blur-3xl opacity-50 pointer-events-none ${
                resultsData.isFailed ? 'bg-red-500' : 'bg-indigo-500'
              }`} />

              {/* Header Badge & Title */}
              <div className="text-center mb-5 z-10 w-full">
                {resultsData.isAutoPlay ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-black uppercase tracking-wider mb-2.5 shadow-sm">
                    <Bot className="w-3.5 h-3.5" /> DEMO MODE
                  </span>
                ) : resultsData.isFailed ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/50 text-[10px] font-black uppercase tracking-wider mb-2.5 shadow-sm">
                    <Skull className="w-3.5 h-3.5" /> STAGE FAILED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-black uppercase tracking-wider mb-2.5 shadow-sm">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" /> STAGE CLEARED
                  </span>
                )}

                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight truncate max-w-xs mx-auto drop-shadow-md">
                  {chart?.title || 'Rhythm Track'}
                </h2>
                <p className="text-xs text-indigo-300 font-mono font-bold mt-1 tracking-wider uppercase">
                  {activeDiff?.name || chart?.version || 'Normal'} ({activeKeyCount}K)
                </p>
              </div>

              {/* Rank + Main Metrics */}
              <div className="flex items-center justify-center gap-5 w-full mb-6 z-10 glass-card p-5 rounded-2xl border border-white/10 shadow-lg">
                <div className={`w-18 h-18 sm:w-20 sm:h-20 rounded-2xl flex flex-col items-center justify-center border shadow-xl ${getRankColor(resultsData.rank)}`}>
                  <span className="text-4xl sm:text-5xl font-black tracking-tighter drop-shadow-md">{resultsData.rank}</span>
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-400 font-bold">Total Score</span>
                  <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight drop-shadow-sm">
                    {resultsData.score.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2 mt-1.5 text-xs font-mono font-bold">
                    <span className="text-emerald-400">ACC: {resultsData.accuracy.toFixed(1)}%</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-amber-400">MAX: {resultsData.maxCombo}x</span>
                  </div>
                </div>
              </div>

              {/* Judgments Grid */}
              <div className="grid grid-cols-4 gap-2 w-full mb-6 z-10 text-center font-mono text-xs">
                <div className="p-2.5 glass-card border border-emerald-500/30 rounded-xl shadow-sm">
                  <div className="text-[9px] text-emerald-400 font-black uppercase">PERFECT</div>
                  <div className="font-black text-white mt-1 text-sm">{resultsData.perfect}</div>
                </div>
                <div className="p-2.5 glass-card border border-sky-500/30 rounded-xl shadow-sm">
                  <div className="text-[9px] text-sky-400 font-black uppercase">GREAT</div>
                  <div className="font-black text-white mt-1 text-sm">{resultsData.great}</div>
                </div>
                <div className="p-2.5 glass-card border border-amber-500/30 rounded-xl shadow-sm">
                  <div className="text-[9px] text-amber-400 font-black uppercase">BAD</div>
                  <div className="font-black text-white mt-1 text-sm">{resultsData.bad}</div>
                </div>
                <div className="p-2.5 glass-card border border-red-500/30 rounded-xl shadow-sm">
                  <div className="text-[9px] text-red-400 font-black uppercase">MISS</div>
                  <div className="font-black text-white mt-1 text-sm">{resultsData.miss}</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 w-full z-10">
                <button
                  onClick={resetGameplay}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black rounded-xl border border-indigo-400/40 shadow-lg shadow-indigo-950/50 transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </button>
                <button
                  onClick={onBackToCharter}
                  className="flex-1 py-3 px-4 glass-card-interactive text-zinc-300 font-bold rounded-xl border border-white/10 transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Menu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pause Overlay */}
        {!isPlaying && !isPreparing && countdown === null && !isResultsOpen && (
          <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-xs glass-panel border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute -top-10 inset-x-0 h-20 bg-indigo-500/20 blur-xl pointer-events-none" />

              <h2 className="text-xl font-black text-white tracking-widest uppercase mb-5 z-10">
                {currentTimeMs === 0 ? 'Ready' : 'Paused'}
              </h2>

              <div className="flex flex-col gap-2.5 w-full z-10">
                <button
                  onClick={togglePlay}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black rounded-xl transition-all shadow-lg shadow-indigo-950/50 hover:scale-105 active:scale-95 cursor-pointer text-xs flex items-center justify-center gap-2 border border-indigo-400/40 uppercase tracking-wider"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {currentTimeMs === 0 ? 'Start' : 'Continue'}
                </button>

                <button
                  onClick={resetGameplay}
                  className="w-full py-3 glass-card-interactive text-white font-bold rounded-xl border border-white/10 transition-all hover:scale-105 active:scale-95 cursor-pointer text-xs flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart Level
                </button>

                <button
                  onClick={toggleAutoBot}
                  className={`w-full py-2.5 rounded-2xl border font-bold transition-transform hover:scale-105 active:scale-95 cursor-pointer text-xs flex items-center justify-center gap-2 ${
                    autoPlay
                      ? 'bg-purple-600/90 text-white border-purple-400/40 shadow-purple-950/50'
                      : 'bg-white/5 text-zinc-300 border-white/10'
                  }`}
                >
                  <Bot className="w-4 h-4 text-purple-400" />
                  {autoPlay ? 'Disable AutoBot' : 'Enable AutoBot'}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold rounded-2xl border border-white/10 transition-transform hover:scale-105 active:scale-95 cursor-pointer text-xs flex items-center justify-center gap-2"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4 text-indigo-400" /> : <Maximize2 className="w-4 h-4 text-indigo-400" />}
                  {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </button>

                <button
                  onClick={onBackToCharter}
                  className="w-full py-2.5 bg-red-600/80 hover:bg-red-500 text-white font-bold rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer text-xs flex items-center justify-center gap-2 mt-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Exit to Menu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canvas Stage */}
        <canvas
          ref={canvasRef}
          width={typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280}
          height={typeof window !== 'undefined' ? window.innerHeight || 800 : 800}
          className="w-full h-full relative z-10 bg-transparent pointer-events-none max-w-none"
        />

        {/* Mobile Orientation Suggestion Banner */}
        {!isMobileLandscapePromptDismissed && isTouchDevice && typeof window !== 'undefined' && window.innerHeight > window.innerWidth && activeKeyCount >= 5 && isPlaying && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-zinc-900/95 border border-indigo-500/40 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs text-zinc-200 pointer-events-auto">
            <span>📱 <strong>Tip:</strong> Rotate to <strong>Landscape</strong> for wider touch columns!</span>
            <button 
              onClick={() => setIsMobileLandscapePromptDismissed(true)} 
              className="p-1 text-zinc-400 hover:text-white font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Direct Playfield Touch Overlay for Vertical / Portrait Mode */}
        {showTouchControls && isPlaying && isPortraitOrientation && (
          <div
            className="absolute inset-0 z-30 touch-none select-none game-touch-surface"
            style={{ WebkitUserSelect: 'none', touchAction: 'none' }}
            onPointerDown={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const clientX = e.clientX - rect.left;
              const width = rect.width;
              
              let lane = 0;
              if (activeMode === 'taiko') {
                // In Taiko: Left half = DON (0), Right half = KAT (1)
                lane = clientX < width / 2 ? 0 : 1;
              } else {
                const kCount = activeKeyCount;
                const laneWidth = width / kCount;
                lane = Math.max(0, Math.min(kCount - 1, Math.floor(clientX / laneWidth)));
              }
              handleTouchDownLane(lane, e.pointerId, e);
            }}
            onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
            onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
            onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
          >
            {/* Subtle column guide feedback in vertical mode */}
            <div 
              className="w-full h-full grid pointer-events-none"
              style={{
                gridTemplateColumns: activeMode === 'taiko' 
                  ? 'repeat(2, minmax(0, 1fr))' 
                  : `repeat(${activeKeyCount}, minmax(0, 1fr))`
              }}
            >
              {Array.from({ length: activeMode === 'taiko' ? 2 : activeKeyCount }).map((_, i) => {
                const isPressed = pressedKeys[i];
                return (
                  <div
                    key={i}
                    className={`h-full border-r border-white/5 transition-colors duration-75 flex flex-col justify-end pb-8 items-center ${
                      isPressed ? 'bg-indigo-500/20' : ''
                    }`}
                  >
                    <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-full backdrop-blur-sm ${
                      isPressed ? 'bg-indigo-500 text-white shadow-lg' : 'bg-black/40 text-white/40'
                    }`}>
                      {activeMode === 'taiko' ? (i === 0 ? 'DON' : 'KAT') : (currentKeyMap[i] || `${i + 1}`).toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Button Touch Controls Overlay for Horizontal / Landscape Mode */}
        {showTouchControls && isPlaying && !isPortraitOrientation && (
          <div className="absolute inset-0 z-30 pointer-events-none select-none game-touch-surface">
            {/* Taiko Touch Layout */}
            {activeMode === 'taiko' ? (
              <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center px-4">
                <div className="w-full max-w-2xl grid grid-cols-4 gap-2.5 h-20 sm:h-24 pointer-events-auto">
                  {/* Outer Left: KAT (Blue) */}
                  <button
                    type="button"
                    onPointerDown={(e) => handleTouchDownLane(1, e.pointerId, e)}
                    onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                    style={{ opacity: touchOpacity }}
                    className={`rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all select-none game-touch-surface active:scale-95 shadow-lg backdrop-blur-md cursor-pointer ${
                      pressedKeys[1]
                        ? 'bg-blue-600 text-white border-blue-400 shadow-blue-500/50 scale-95 ring-2 ring-blue-300/50'
                        : 'bg-blue-950/70 text-blue-300 border-blue-500/40 hover:bg-blue-900/60'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-black tracking-wider uppercase">KAT</span>
                    <span className="text-[10px] font-mono text-blue-200/70">Rim L</span>
                  </button>

                  {/* Inner Left: DON (Red) */}
                  <button
                    type="button"
                    onPointerDown={(e) => handleTouchDownLane(0, e.pointerId, e)}
                    onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                    style={{ opacity: touchOpacity }}
                    className={`rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all select-none game-touch-surface active:scale-95 shadow-lg backdrop-blur-md cursor-pointer ${
                      pressedKeys[0]
                        ? 'bg-red-600 text-white border-red-400 shadow-red-500/50 scale-95 ring-2 ring-red-300/50'
                        : 'bg-red-950/70 text-red-300 border-red-500/40 hover:bg-red-900/60'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-black tracking-wider uppercase">DON</span>
                    <span className="text-[10px] font-mono text-red-200/70">Drum L</span>
                  </button>

                  {/* Inner Right: DON (Red) */}
                  <button
                    type="button"
                    onPointerDown={(e) => handleTouchDownLane(0, e.pointerId, e)}
                    onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                    style={{ opacity: touchOpacity }}
                    className={`rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all select-none game-touch-surface active:scale-95 shadow-lg backdrop-blur-md cursor-pointer ${
                      pressedKeys[0]
                        ? 'bg-red-600 text-white border-red-400 shadow-red-500/50 scale-95 ring-2 ring-red-300/50'
                        : 'bg-red-950/70 text-red-300 border-red-500/40 hover:bg-red-900/60'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-black tracking-wider uppercase">DON</span>
                    <span className="text-[10px] font-mono text-red-200/70">Drum R</span>
                  </button>

                  {/* Outer Right: KAT (Blue) */}
                  <button
                    type="button"
                    onPointerDown={(e) => handleTouchDownLane(1, e.pointerId, e)}
                    onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                    onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                    style={{ opacity: touchOpacity }}
                    className={`rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all select-none game-touch-surface active:scale-95 shadow-lg backdrop-blur-md cursor-pointer ${
                      pressedKeys[1]
                        ? 'bg-blue-600 text-white border-blue-400 shadow-blue-500/50 scale-95 ring-2 ring-blue-300/50'
                        : 'bg-blue-950/70 text-blue-300 border-blue-500/40 hover:bg-blue-900/60'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-black tracking-wider uppercase">KAT</span>
                    <span className="text-[10px] font-mono text-blue-200/70">Rim R</span>
                  </button>
                </div>
              </div>
            ) : activeMode === 'fnf' ? (
              /* FNF Touch Layout */
              <div className={`absolute left-0 right-0 flex items-center justify-center px-3 ${
                scrollDirection === 'down' ? 'bottom-3' : 'top-16'
              }`}>
                <div className="w-full max-w-xl grid grid-cols-4 gap-2.5 h-20 sm:h-24 pointer-events-auto">
                  {[
                    { lane: 0, label: '←', name: 'Left', border: 'border-purple-400', activeBg: 'bg-purple-600', idleBg: 'bg-purple-950/80 text-purple-200' },
                    { lane: 1, label: '↓', name: 'Down', border: 'border-cyan-400', activeBg: 'bg-cyan-600', idleBg: 'bg-cyan-950/80 text-cyan-200' },
                    { lane: 2, label: '↑', name: 'Up', border: 'border-emerald-400', activeBg: 'bg-emerald-600', idleBg: 'bg-emerald-950/80 text-emerald-200' },
                    { lane: 3, label: '→', name: 'Right', border: 'border-rose-400', activeBg: 'bg-rose-600', idleBg: 'bg-rose-950/80 text-rose-200' }
                  ].map(btn => (
                    <button
                      key={btn.lane}
                      type="button"
                      onPointerDown={(e) => handleTouchDownLane(btn.lane, e.pointerId, e)}
                      onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                      style={{ opacity: touchOpacity }}
                      className={`rounded-2xl border-2 flex flex-col items-center justify-center transition-all select-none game-touch-surface active:scale-95 shadow-lg backdrop-blur-md cursor-pointer ${
                        pressedKeys[btn.lane]
                          ? `${btn.activeBg} text-white ${btn.border} scale-95 shadow-lg ring-2 ring-white/40`
                          : `${btn.idleBg} ${btn.border}/50 hover:opacity-100`
                      }`}
                    >
                      <span className="text-xl sm:text-2xl font-black">{btn.label}</span>
                      <span className="text-[10px] font-bold uppercase opacity-80">{btn.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Mania & LL+ (1K to 9K) Touch Layout */
              <div className={`absolute left-0 right-0 flex items-center justify-center px-2 ${
                touchPadStyle === 'full_lanes'
                  ? 'inset-y-0'
                  : (scrollDirection === 'down' ? 'bottom-3' : 'top-16')
              }`}>
                <div
                  className={`w-full grid gap-1.5 pointer-events-auto ${
                    touchPadStyle === 'full_lanes' ? 'h-full' : 'h-20 sm:h-24'
                  }`}
                  style={{
                    maxWidth: playfieldFillScreen ? '100%' : `${Math.min(96, activeKeyCount * (activeKeyCount <= 4 ? 22 : 12))}%`,
                    gridTemplateColumns: `repeat(${activeKeyCount}, minmax(0, 1fr))`
                  }}
                >
                  {Array.from({ length: activeKeyCount }).map((_, i) => {
                    const isPressed = pressedKeys[i];
                    const keyLabel = currentKeyMap[i] ? currentKeyMap[i].toUpperCase() : `${i + 1}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        onPointerDown={(e) => handleTouchDownLane(i, e.pointerId, e)}
                        onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                        style={{ opacity: touchOpacity }}
                        className={`rounded-2xl border-2 flex flex-col items-center ${
                          touchPadStyle === 'full_lanes'
                            ? (scrollDirection === 'down' ? 'justify-end pb-4' : 'justify-start pt-4')
                            : 'justify-center'
                        } transition-all select-none game-touch-surface active:scale-[0.98] shadow-lg backdrop-blur-md cursor-pointer ${
                          isPressed
                            ? 'bg-gradient-to-b from-indigo-600 to-indigo-700 text-white border-indigo-400 shadow-indigo-500/50 scale-[0.98] ring-2 ring-indigo-400/50'
                            : 'bg-zinc-950/80 text-zinc-300 border-zinc-700/60 hover:bg-zinc-900/90'
                        }`}
                      >
                        <span className="text-sm sm:text-base font-black font-mono">{keyLabel}</span>
                        <span className="text-[10px] text-zinc-400 font-bold">Lane {i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audio Elements */}
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            onLoadedMetadata={() => {
              if (audioRef.current) setDurationMs(audioRef.current.duration * 1000);
            }}
            onEnded={handleLevelComplete}
            onError={() => setAudioError("Could not play the audio track.")}
          />
        )}
        {vocalsUrl && (
          <audio ref={vocalsRef} src={vocalsUrl} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar Header & Test Zone Workbench (Liquid Glass Panel) */}
      <div className="glass-panel p-4 sm:p-5 rounded-3xl space-y-4 relative overflow-hidden">
        {/* Specular Highlight Top Edge */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500/30 to-cyan-500/30 p-0.5 border border-white/15 flex items-center justify-center shrink-0 shadow-lg">
              <div className="w-full h-full bg-slate-950/40 backdrop-blur-md rounded-[14px] flex items-center justify-center text-indigo-400">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                  {chart?.title || 'Universal Engine'}
                </h2>
                {chart && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider border shadow-sm ${
                      activeMode === 'llplus' ? 'bg-amber-500/15 text-amber-300 border-amber-400/30' :
                      activeMode === 'fnf' ? 'bg-purple-500/15 text-purple-300 border-purple-400/30' :
                      activeMode === 'taiko' ? 'bg-rose-500/15 text-rose-300 border-rose-400/30' :
                      'bg-indigo-500/15 text-indigo-300 border-indigo-400/30'
                    }`}>
                      {activeMode.toUpperCase()} • {activeKeyCount}K
                    </span>

                    {/* Live BPM Badge */}
                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold glass-pill text-zinc-300 flex items-center gap-1">
                      <Activity className="w-3 h-3 text-cyan-400" />
                      {activeBpm} BPM
                    </span>

                    {/* Live NPS Gauge */}
                    <span className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold border flex items-center gap-1 transition-all ${
                      currentNps > 8 ? 'bg-rose-500/20 text-rose-300 border-rose-400/40' :
                      currentNps > 4 ? 'bg-amber-500/20 text-amber-300 border-amber-400/40' :
                      'glass-pill text-emerald-300 border-emerald-400/30'
                    }`}>
                      <Gauge className="w-3 h-3" />
                      {currentNps} NPS {peakNps > 0 && <span className="text-[9px] text-zinc-400">({peakNps})</span>}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">
                {chart ? `${chart.artist} • ${chart.charter} • ${activeDiff?.notes?.length || 0} notes` : 'Drag & drop or load any chart (.osu, .osz, .zip, .json, .mid)'}
              </p>
            </div>
          </div>

          {/* Quick Actions / Utilities */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* AutoPlay Bot Toggle */}
            <button
              type="button"
              onClick={toggleAutoBot}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95 ${
                autoPlay 
                  ? 'bg-gradient-to-r from-purple-600/90 to-indigo-600/90 text-white border-purple-400/60 shadow-purple-950/60' 
                  : 'glass-card-interactive text-zinc-300'
              }`}
              title="Autoplay Bot [Tab]"
            >
              <Bot className="w-4 h-4" />
              <span>{autoPlay ? 'Bot Active' : 'Bot Off'}</span>
            </button>

            {/* Keybinds */}
            <button
              type="button"
              onClick={() => setIsRebindingModalOpen(true)}
              className="px-3.5 py-2 glass-card-interactive text-zinc-200 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
            >
              <Keyboard className="w-4 h-4 text-indigo-400" />
              Keybinds
            </button>

            {/* Upload File */}
            <label className="inline-flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-indigo-600/90 to-cyan-600/90 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold rounded-xl border border-white/20 transition-all cursor-pointer shadow-md active:scale-95">
              <Upload className="w-4 h-4" />
              <span>Load Chart</span>
              <input type="file" accept=".iric,.osu,.zip,.osz,.json,.llmap,.mid,.midi" onChange={handleFileUpload} className="hidden" />
            </label>

            {onBackToCharter && (
              <button
                type="button"
                onClick={onBackToCharter}
                className="px-3.5 py-2 glass-card-interactive text-zinc-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer active:scale-95"
              >
                Back to Charter
              </button>
            )}
          </div>
        </div>

        {/* Quick Difficulty Switcher Pills (If multiple difficulties exist) */}
        {chart?.difficulties && chart.difficulties.length > 0 && (
          <div className="pt-2 border-t border-white/10 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none relative z-10">
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              Difficulty:
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {chart.difficulties.map((diff, idx) => {
                const isSelected = selectedDiffIndex === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSelectedDiffIndex(idx);
                      resetGameplay();
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                      isSelected
                        ? 'bg-amber-500 text-neutral-950 border-amber-400'
                        : 'glass-card-interactive text-zinc-300'
                    }`}
                  >
                    <span>{diff.name || `Difficulty ${idx + 1}`}</span>
                    <span className="text-[10px] opacity-75 font-mono">({diff.notes.length}n)</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {chart ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Gameplay Container */}
          <div 
            onDragOver={handleStageDragOver}
            onDragLeave={handleStageDragLeave}
            onDrop={handleStageDrop}
            className={`lg:col-span-3 bg-zinc-950 p-4 rounded-lg border flex flex-col items-center relative overflow-hidden min-h-[580px] transition-colors ${
              isStageDragOver ? 'border-amber-400' : 'border-zinc-800/90'
            }`}
          >
            {/* Stage Drag & Drop Overlay */}
            {isStageDragOver && (
              <div className="absolute inset-0 z-50 bg-indigo-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-indigo-400 rounded-2xl pointer-events-none">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 mb-3 animate-bounce">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Drop Chart or Media Here</h3>
                <p className="text-xs text-indigo-200 mt-1 max-w-sm text-center">
                  Drop <code className="bg-indigo-900 px-1 py-0.5 rounded text-white">.osz / .zip / .osu / .json / .mid</code> or background images / audio to test immediately.
                </p>
              </div>
            )}

            {/* Red Vignette Border on Death / Stage Failed */}
            {hasFailed && (
              <div className="absolute inset-0 pointer-events-none z-30 shadow-[inset_0_0_90px_rgba(239,68,68,0.7)] border-4 border-red-500/60 rounded-2xl animate-pulse" />
            )}

            {/* Taiko Controls Display - Always Visible */}
            {activeMode === 'taiko' && (
              <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2 pointer-events-none">
                <div className={`px-2.5 py-1 rounded-xl border backdrop-blur-md flex items-center gap-1.5 transition-all shadow-md ${
                  pressedKeys[0] 
                    ? 'bg-red-600/40 border-red-400 text-white scale-105' 
                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-300'
                }`}>
                  <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                  <span className="text-[9px] font-bold text-zinc-400 uppercase">DON</span>
                  <span className="text-xs font-mono font-black text-red-400">
                    {currentKeyMap[0] ? currentKeyMap[0].toUpperCase() : 'F / J'}
                  </span>
                </div>

                <div className={`px-2.5 py-1 rounded-xl border backdrop-blur-md flex items-center gap-1.5 transition-all shadow-md ${
                  pressedKeys[1] 
                    ? 'bg-blue-600/40 border-blue-400 text-white scale-105' 
                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-300'
                }`}>
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                  <span className="text-[9px] font-bold text-zinc-400 uppercase">KAT</span>
                  <span className="text-xs font-mono font-black text-blue-400">
                    {currentKeyMap[1] ? currentKeyMap[1].toUpperCase() : 'D / K'}
                  </span>
                </div>
              </div>
            )}
            {/* Background Video / Image (Works for ALL modes!) */}
            {bgVideoUrl ? (
              <video
                ref={videoRef}
                src={bgVideoUrl}
                muted
                playsInline
                loop
                disablePictureInPicture
                controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
                className={`absolute inset-0 w-full h-full ${fitMedia ? 'object-contain bg-black' : 'object-cover'} pointer-events-none z-0`}
              />
            ) : bgImageUrl ? (
              <img
                src={bgImageUrl}
                alt="Background"
                className={`absolute inset-0 w-full h-full ${fitMedia ? 'object-contain bg-black' : 'object-cover'} pointer-events-none z-0`}
              />
            ) : null}

            {/* Top Score/Acc Bar */}
            <div className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900/90 rounded-xl border border-zinc-800/80 mb-3 text-xs font-mono z-10 backdrop-blur-md">
              <div className="flex items-center gap-4">
                <span className="text-zinc-400">SCORE: <strong className="text-indigo-400 text-sm">{score}</strong></span>
                <span className="text-zinc-400">ACC: <strong className="text-emerald-400 text-sm">{accuracy}%</strong></span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-zinc-400 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  COMBO: <strong className="text-amber-400 text-sm">{combo}x</strong>
                </span>
                <span className="text-zinc-400">MAX: <strong className="text-zinc-200">{maxCombo}x</strong></span>
              </div>
            </div>

            {/* Health Bar */}
            <div className="w-full flex flex-col gap-1 mb-3 z-10">
              <div className={`w-full h-2.5 rounded-full overflow-hidden border ${
                hasFailed ? 'bg-red-950/80 border-red-500/50' : 'bg-zinc-900/90 border-zinc-800'
              }`}>
                <div
                  className={`h-full transition-all duration-150 ${
                    hasFailed ? 'bg-red-600 w-0' : (health > 50 ? 'bg-emerald-500' : (health > 20 ? 'bg-amber-500' : 'bg-red-500'))
                  }`}
                  style={{ width: `${hasFailed ? 0 : health}%` }}
                />
              </div>
              <div className="flex items-center justify-between w-full text-[10px] font-mono px-1">
                {hasFailed ? (
                  <span className="text-red-400 font-bold flex items-center gap-1">
                    <Skull className="w-3 h-3" /> HEALTH DEPLETED (0%) — Failed Mode
                  </span>
                ) : (
                  <>
                    <span className="text-zinc-400">HP: <strong className={health > 50 ? 'text-emerald-400' : (health > 20 ? 'text-amber-400' : 'text-red-400')}>{Math.round(health)}%</strong></span>
                    <span className="text-zinc-400 font-mono text-[10px]">
                      {Math.floor(currentTimeMs / 1000)}s / {Math.floor(durationMs / 1000)}s
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Recent Judgment Popup */}
            {recentJudgment && (
              <div
                key={recentJudgment.key}
                className="absolute top-24 pointer-events-none z-20 text-center animate-bounce"
              >
                <span
                  className="text-3xl font-black tracking-widest drop-shadow-lg"
                  style={{ color: recentJudgment.color }}
                >
                  {recentJudgment.text}
                </span>
              </div>
            )}

            {/* Countdown Overlay (3... 2... 1... GO!) - No blur */}
            {countdown !== null && !hideCountdown && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl pointer-events-none">
                <div className="text-center">
                  <span className={`text-8xl font-black tracking-widest font-mono drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] ${
                    typeof countdown === 'number'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}>
                    {countdown}
                  </span>
                </div>
              </div>
            )}

            {/* Canvas Stage (Fully Transparent canvas for smooth video background!) */}
            <canvas
              ref={canvasRef}
              width={640}
              height={520}
              className="w-full max-w-[640px] h-[520px] rounded-xl border border-zinc-800/80 shadow-2xl relative z-10 bg-transparent"
            />

            {/* Charter Preview Touch Controls for mobile / touch screens */}
            {showTouchControls && (
              <div className="w-full max-w-[640px] mt-2 mb-1 z-10 select-none game-touch-surface">
                {activeMode === 'taiko' ? (
                  <div className="grid grid-cols-4 gap-2 h-16">
                    <button
                      type="button"
                      onPointerDown={(e) => handleTouchDownLane(1, e.pointerId, e)}
                      onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                      className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                        pressedKeys[1] ? 'bg-blue-600 text-white border-blue-400' : 'bg-blue-950/60 text-blue-300 border-blue-500/30'
                      }`}
                    >
                      <span className="text-xs font-black">KAT</span>
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) => handleTouchDownLane(0, e.pointerId, e)}
                      onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                      className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                        pressedKeys[0] ? 'bg-red-600 text-white border-red-400' : 'bg-red-950/60 text-red-300 border-red-500/30'
                      }`}
                    >
                      <span className="text-xs font-black">DON</span>
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) => handleTouchDownLane(0, e.pointerId, e)}
                      onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                      className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                        pressedKeys[0] ? 'bg-red-600 text-white border-red-400' : 'bg-red-950/60 text-red-300 border-red-500/30'
                      }`}
                    >
                      <span className="text-xs font-black">DON</span>
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) => handleTouchDownLane(1, e.pointerId, e)}
                      onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                      onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                      className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                        pressedKeys[1] ? 'bg-blue-600 text-white border-blue-400' : 'bg-blue-950/60 text-blue-300 border-blue-500/30'
                      }`}
                    >
                      <span className="text-xs font-black">KAT</span>
                    </button>
                  </div>
                ) : activeMode === 'fnf' ? (
                  <div className="grid grid-cols-4 gap-2 h-16">
                    {[
                      { lane: 0, label: '←', border: 'border-purple-400', active: 'bg-purple-600', idle: 'bg-purple-950/60 text-purple-300' },
                      { lane: 1, label: '↓', border: 'border-cyan-400', active: 'bg-cyan-600', idle: 'bg-cyan-950/60 text-cyan-300' },
                      { lane: 2, label: '↑', border: 'border-emerald-400', active: 'bg-emerald-600', idle: 'bg-emerald-950/60 text-emerald-300' },
                      { lane: 3, label: '→', border: 'border-rose-400', active: 'bg-rose-600', idle: 'bg-rose-950/60 text-rose-300' }
                    ].map(btn => (
                      <button
                        key={btn.lane}
                        type="button"
                        onPointerDown={(e) => handleTouchDownLane(btn.lane, e.pointerId, e)}
                        onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                        className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                          pressedKeys[btn.lane] ? `${btn.active} text-white ${btn.border}` : `${btn.idle} ${btn.border}/40`
                        }`}
                      >
                        <span className="text-lg font-black">{btn.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div 
                    className="grid gap-1.5 h-16"
                    style={{ gridTemplateColumns: `repeat(${activeKeyCount}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: activeKeyCount }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onPointerDown={(e) => handleTouchDownLane(i, e.pointerId, e)}
                        onPointerUp={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerCancel={(e) => handleTouchUpLane(e.pointerId, e)}
                        onPointerLeave={(e) => handleTouchUpLane(e.pointerId, e)}
                        className={`rounded-xl border flex flex-col items-center justify-center transition-all select-none active:scale-95 cursor-pointer ${
                          pressedKeys[i]
                            ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-400/50'
                            : 'bg-zinc-900/90 text-zinc-300 border-zinc-800'
                        }`}
                      >
                        <span className="text-xs font-black font-mono">{currentKeyMap[i] ? currentKeyMap[i].toUpperCase() : `${i + 1}`}</span>
                        <span className="text-[9px] text-zinc-400">L{i + 1}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Audio Scrubber & Main Playback Controls (Liquid Glass) */}
            <div className="w-full mt-4 space-y-3.5 z-10 glass-panel p-4 sm:p-5 rounded-2xl shadow-xl">
              {/* Seek Timeline */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-300 font-bold">{formatTime(currentTimeMs)}</span>
                    <span className="text-zinc-500">/</span>
                    <span>{formatTime(durationMs || 1000)}</span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400 glass-pill px-2 py-0.5 rounded-lg">
                    {durationMs > 0 ? `${Math.round((currentTimeMs / durationMs) * 100)}%` : '0%'}
                  </span>
                </div>

                <div className="relative flex items-center group">
                  <input
                    type="range"
                    min={0}
                    max={durationMs || 1000}
                    value={currentTimeMs}
                    onChange={(e) => {
                      const newTime = parseFloat(e.target.value);
                      const newTimeSec = newTime / 1000;
                      currentTimeMsRef.current = newTime;
                      setCurrentTimeMs(newTime);
                      if (audioRef.current) audioRef.current.currentTime = newTimeSec;
                      if (vocalsRef.current) vocalsRef.current.currentTime = newTimeSec;
                      if (videoRef.current) videoRef.current.currentTime = newTimeSec;
                    }}
                    className="w-full accent-indigo-400 cursor-pointer h-2 bg-black/40 rounded-lg"
                  />
                </div>
              </div>

              {/* Main Transport Controls */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                <div className="flex items-center gap-2">
                  {/* Jump -5s */}
                  <button
                    type="button"
                    onClick={() => {
                      const newTime = Math.max(0, currentTimeMsRef.current - 5000);
                      const newTimeSec = newTime / 1000;
                      currentTimeMsRef.current = newTime;
                      setCurrentTimeMs(newTime);
                      if (audioRef.current) audioRef.current.currentTime = newTimeSec;
                      if (vocalsRef.current) vocalsRef.current.currentTime = newTimeSec;
                      if (videoRef.current) videoRef.current.currentTime = newTimeSec;
                    }}
                    className="p-2.5 glass-card-interactive text-zinc-300 rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Rewind 5s (Shortcut: ←)"
                  >
                    <Rewind className="w-4 h-4" />
                  </button>

                  {/* Play / Pause */}
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-sm rounded-md transition-colors cursor-pointer flex items-center gap-2"
                    title="Play / Pause (Shortcut: Space)"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5 fill-white" />}
                    <span>{isPlaying ? 'Pause [Space]' : 'Play [Space]'}</span>
                  </button>

                  {/* Jump +5s */}
                  <button
                    type="button"
                    onClick={() => {
                      const newTime = Math.min(durationMs || 1000, currentTimeMsRef.current + 5000);
                      const newTimeSec = newTime / 1000;
                      currentTimeMsRef.current = newTime;
                      setCurrentTimeMs(newTime);
                      if (audioRef.current) audioRef.current.currentTime = newTimeSec;
                      if (vocalsRef.current) vocalsRef.current.currentTime = newTimeSec;
                      if (videoRef.current) videoRef.current.currentTime = newTimeSec;
                    }}
                    className="p-2.5 glass-card-interactive text-zinc-300 rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Forward 5s (Shortcut: →)"
                  >
                    <FastForward className="w-4 h-4" />
                  </button>

                  {/* Restart */}
                  <button
                    type="button"
                    onClick={resetGameplay}
                    className="px-3.5 py-2.5 glass-card-interactive text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 active:scale-95"
                    title="Restart from beginning (Shortcut: R)"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Restart [R]</span>
                  </button>
                </div>

                {/* Volumes */}
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-zinc-400">Audio:</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={instVolume}
                      onChange={(e) => setInstVolume(parseFloat(e.target.value))}
                      className="w-16 accent-indigo-400 cursor-pointer h-1.5 bg-black/40 rounded"
                    />
                  </div>

                  {vocalsUrl && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400">Vocals:</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={vocalsVolume}
                        onChange={(e) => setVocalsVolume(parseFloat(e.target.value))}
                        className="w-16 accent-purple-400 cursor-pointer h-1.5 bg-black/40 rounded"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-2 glass-card-interactive text-zinc-300 rounded-xl cursor-pointer active:scale-95"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-zinc-300" />}
                  </button>
                </div>
              </div>

              {/* Hotkeys Quick Helper Footnote */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 glass-pill rounded font-mono text-zinc-200 text-[10px]">Space</kbd> Play/Pause
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 glass-pill rounded font-mono text-zinc-200 text-[10px]">R</kbd> Restart
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 glass-pill rounded font-mono text-zinc-200 text-[10px]">Tab</kbd> Autoplay
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 glass-pill rounded font-mono text-zinc-200 text-[10px]">← / →</kbd> Seek 5s
                  </span>
                </div>
                <span className="text-zinc-500 text-[10px] hidden sm:inline">
                  Drag & Drop <code className="text-indigo-300">.osu / .zip / .mid</code> onto stage
                </span>
              </div>
            </div>

            {/* Audio Elements */}
            {audioUrl && (
              <audio
                ref={audioRef}
                src={audioUrl}
                muted={isMuted}
                onPlay={(e) => {
                  const isSilenced = isMuted;
                  e.currentTarget.volume = isSilenced ? 0 : instVolume;
                  e.currentTarget.muted = isSilenced;
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                }}
                onPlaying={(e) => {
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                }}
                onLoadedMetadata={(e) => {
                  const isSilenced = isMuted;
                  e.currentTarget.volume = isSilenced ? 0 : instVolume;
                  e.currentTarget.muted = isSilenced;
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                  if (audioRef.current) setDurationMs(audioRef.current.duration * 1000);
                }}
                onEnded={() => setIsPlaying(false)}
                onError={() => setAudioError("Could not play audio track.")}
              />
            )}
            {vocalsUrl && (
              <audio 
                ref={vocalsRef} 
                src={vocalsUrl} 
                muted={isMuted}
                onPlay={(e) => {
                  const isSilenced = isMuted;
                  e.currentTarget.volume = isSilenced ? 0 : vocalsVolume;
                  e.currentTarget.muted = isSilenced;
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                }}
                onPlaying={(e) => {
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                }}
                onLoadedMetadata={(e) => {
                  const isSilenced = isMuted;
                  e.currentTarget.volume = isSilenced ? 0 : vocalsVolume;
                  e.currentTarget.muted = isSilenced;
                  try { e.currentTarget.playbackRate = playbackSpeed; } catch {}
                }}
              />
            )}
          </div>

          {/* Right Sidebar Settings (Liquid Glass Panels) */}
          <div className="space-y-4">
            {/* Difficulty Selector */}
            {chart?.difficulties && chart.difficulties.length > 0 && (
              <div className="glass-panel p-4 rounded-2xl space-y-3">
                <h3 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  Difficulty
                </h3>

                <div className="space-y-1.5">
                  <select
                    value={selectedDiffIndex}
                    onChange={(e) => {
                      setSelectedDiffIndex(parseInt(e.target.value, 10));
                      resetGameplay();
                    }}
                    className="w-full glass-input text-zinc-200 text-xs rounded-xl p-2.5 focus:outline-none"
                  >
                    {chart.difficulties.map((d, idx) => (
                      <option key={idx} value={idx} className="bg-zinc-900 text-zinc-200">
                        {d.name} {d.keyCount ? `[${d.keyCount}K]` : ''} ({d.notes.length} notes)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Key Hitsounds Switch & Volume */}
            <div className="glass-panel p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                  {hitsoundsEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
                  Hitsounds
                </span>
                <button
                  onClick={() => {
                    const next = !hitsoundsEnabled;
                    setHitsoundsEnabled(next);
                    hitSoundManager.setEnabled(next);
                    if (next) hitSoundManager.playHitSound(activeMode, 0);
                  }}
                  className={`w-11 h-6 rounded-full transition-colors p-1 cursor-pointer ${hitsoundsEnabled ? 'bg-emerald-500/80' : 'bg-white/10'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${hitsoundsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {hitsoundsEnabled && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                    <span>Volume</span>
                    <strong className="text-emerald-400">{Math.round(hitsoundVol * 100)}%</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={hitsoundVol}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setHitsoundVol(v);
                      hitSoundManager.setVolume(v);
                      hitSoundManager.playHitSound(activeMode, 0);
                    }}
                    className="w-full accent-emerald-400 cursor-pointer h-1.5"
                  />
                </div>
              )}
            </div>

            {/* Auto-Play Bot Switch */}
            <div className="glass-panel p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <Bot className="w-4 h-4 text-indigo-400" />
                  Bot Autoplay
                </span>
                <button
                  onClick={() => setAutoPlay(!autoPlay)}
                  className={`w-11 h-6 rounded-full transition-colors p-1 cursor-pointer ${autoPlay ? 'bg-indigo-500/80' : 'bg-white/10'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${autoPlay ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Video Framing Option */}
            <div className="glass-panel p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <Video className="w-4 h-4 text-indigo-400" />
                  Video Framing
                </span>
                <button
                  onClick={() => setFitMedia(!fitMedia)}
                  className={`px-3 py-1 text-xs rounded-xl border transition-all cursor-pointer font-medium ${
                    fitMedia
                      ? 'bg-indigo-500/25 border-indigo-400/40 text-indigo-300'
                      : 'glass-card-interactive text-zinc-400'
                  }`}
                >
                  {fitMedia ? 'Fit' : 'Cover'}
                </button>
              </div>
            </div>

            {/* Scroll Speed & Direction */}
            <div className="glass-panel p-4 rounded-2xl space-y-4">
              <h3 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                Scroll Speed
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                  <span>Speed Multiplier</span>
                  <strong className="text-indigo-300">{scrollSpeed.toFixed(2)}x</strong>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={2.5}
                  step={0.05}
                  value={scrollSpeed}
                  onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                  className="w-full accent-indigo-400 cursor-pointer h-1.5"
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(spd => (
                  <button
                    key={spd}
                    onClick={() => setScrollSpeed(spd)}
                    className={`py-1 text-xs font-mono rounded-lg border transition-all cursor-pointer ${
                      scrollSpeed === spd 
                        ? 'bg-indigo-500/30 text-indigo-300 border-indigo-400/50 shadow-sm' 
                        : 'glass-card-interactive text-zinc-400'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              {chart?.mode !== 'taiko' && (
                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  <label className="text-[11px] text-zinc-400 font-medium">Scroll Direction</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setScrollDirection('down')}
                      className={`py-1.5 text-xs font-medium rounded-xl border transition-all cursor-pointer ${
                        scrollDirection === 'down' 
                          ? 'bg-indigo-500/25 text-indigo-300 border-indigo-400/50' 
                          : 'glass-card-interactive text-zinc-400'
                      }`}
                    >
                      Downscroll
                    </button>
                    <button
                      onClick={() => setScrollDirection('up')}
                      className={`py-1.5 text-xs font-medium rounded-xl border transition-all cursor-pointer ${
                        scrollDirection === 'up' 
                          ? 'bg-indigo-500/25 text-indigo-300 border-indigo-400/50' 
                          : 'glass-card-interactive text-zinc-400'
                      }`}
                    >
                      Upscroll
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div 
          onDragOver={handleStageDragOver}
          onDragLeave={handleStageDragLeave}
          onDrop={handleStageDrop}
          className={`p-12 text-center rounded-3xl border transition-all space-y-4 glass-panel ${
            isStageDragOver 
              ? 'border-indigo-400/80 ring-2 ring-indigo-500/40 scale-[1.01]' 
              : 'border-white/10'
          }`}
        >
          <div className={`p-4 rounded-2xl w-16 h-16 mx-auto flex items-center justify-center transition-transform glass-card ${
            isStageDragOver ? 'scale-110 text-indigo-300' : 'text-indigo-400'
          }`}>
            {isStageDragOver ? <Upload className="w-8 h-8" /> : <Music className="w-8 h-8" />}
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-lg font-semibold text-white">
              {isStageDragOver ? 'Drop the chart here' : 'Test a chart'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Choose a chart file or drag one here to try it in Test Zone.
            </p>
          </div>
          <div>
            <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-sm font-medium rounded-md border border-amber-400 transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Load Chart File
              <input type="file" accept=".iric,.osu,.zip,.osz,.json,.llmap,.mid,.midi" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>
      )}

      {/* Rebinding Keys Modal (Liquid Glass) */}
      {isRebindingModalOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="glass-panel border border-neutral-700 rounded-lg p-6 max-w-md w-full space-y-5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                <Keyboard className="w-5 h-5 text-indigo-400" />
                Keybinds ({modeKey.toUpperCase()})
              </h3>
              <button
                onClick={() => setIsRebindingModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Select any lane to reassign keyboard input:
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {currentKeyMap.map((key, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveRebindIndex(idx)}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    activeRebindIndex === idx 
                      ? 'bg-indigo-600 text-white border-indigo-400 shadow-md ring-2 ring-indigo-400/40' 
                      : 'glass-card-interactive text-indigo-300'
                  }`}
                >
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Lane {idx + 1}</div>
                  <div className="text-base font-bold font-mono uppercase mt-1">
                    {activeRebindIndex === idx ? '...' : key}
                  </div>
                </button>
              ))}
            </div>

            {activeRebindIndex !== null && (
              <div className="p-3 glass-card border border-indigo-400/50 rounded-xl text-center text-xs text-indigo-200">
                Press any key for Lane {activeRebindIndex + 1}...
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setCustomKeyMaps(prev => ({ ...prev, [modeKey]: DEFAULT_KEY_MAPS[modeKey] }));
                  setActiveRebindIndex(null);
                }}
                className="px-3 py-1.5 glass-card-interactive text-zinc-300 rounded-xl text-xs cursor-pointer"
              >
                Reset Defaults
              </button>
              <button
                onClick={() => setIsRebindingModalOpen(false)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
