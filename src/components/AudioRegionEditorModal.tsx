import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Plus, Trash2, Volume2, VolumeX, Flame, Zap, 
  Sparkles, Sliders, Check, X, RotateCcw, Clock, Music, FastForward, Rewind, Layers,
  ZoomIn, ZoomOut
} from 'lucide-react';

export interface AudioRegion {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  type: 'silence' | 'chill' | 'normal' | 'intense' | 'extreme' | 'custom';
  densityMultiplier: number;
  speedMultiplier: number;
  patternPreference: 'auto' | 'streams' | 'holds' | 'single' | 'chords' | 'hold_and_play' | 'jacks' | 'stairs_and_chords';
  holdAndPlaySide?: 'any' | 'left' | 'right' | 'center';
  color: string;
}

interface AudioRegionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer | null;
  audioFile: File | null;
  duration: number;
  regions: AudioRegion[];
  activeTab: string;
  onSaveRegions: (regions: AudioRegion[]) => void;
  onGenerate: (regions: AudioRegion[]) => void;
  isGenerating?: boolean;
}

const REGION_COLORS: Record<AudioRegion['type'], string> = {
  silence: '#6b7280', // Gray
  chill: '#10b981',   // Emerald
  normal: '#3b82f6',  // Blue
  intense: '#f59e0b', // Amber
  extreme: '#ef4444', // Red
  custom: '#8b5cf6',  // Purple
};

export const AudioRegionEditorModal: React.FC<AudioRegionEditorModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  audioFile,
  duration,
  regions: initialRegions,
  activeTab,
  onSaveRegions,
  onGenerate,
  isGenerating = false,
}) => {
  const [regions, setRegions] = useState<AudioRegion[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // Dragging / creating state on canvas
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'create' | 'resize-left' | 'resize-right' | 'move' | null>(null);
  const [activeDragRegionId, setActiveDragRegionId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  const [dragEndTime, setDragEndTime] = useState(0);
  const [dragStartT, setDragStartT] = useState(0);
  const [dragCurrentT, setDragCurrentT] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // Zoom multiplier (1x to 10x)

  // Scroll container to playhead when playing, scrubbing, or zooming
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !canvasRef.current || duration <= 0) return;
    
    const canvasWidth = canvasRef.current.width;
    const playheadX = (currentTime / duration) * canvasWidth;
    
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;
    
    if (isPlaying) {
      const margin = containerWidth * 0.25; // Keep playhead within the middle 50%
      if (playheadX < scrollLeft + margin || playheadX > scrollLeft + containerWidth - margin) {
        container.scrollLeft = playheadX - containerWidth / 2;
      }
    } else {
      // If manually scrubbing or zooming, center the playhead
      if (playheadX < scrollLeft || playheadX > scrollLeft + containerWidth) {
        container.scrollLeft = playheadX - containerWidth / 2;
      }
    }
  }, [currentTime, isPlaying, duration, zoomLevel]);

  useEffect(() => {
    if (isOpen) {
      setRegions(initialRegions || []);
    }
  }, [isOpen, initialRegions]);

  useEffect(() => {
    if (!audioFile) return;
    const url = URL.createObjectURL(audioFile);
    const audio = new Audio(url);
    audioRef.current = audio;

    const updateTime = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', updateTime);
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  useEffect(() => {
    if (isPlaying && audioRef.current) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, width, height);

    const channelData = audioBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    ctx.fillStyle = '#3f3f46';
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = channelData[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    regions.forEach((region) => {
      if (duration <= 0) return;
      const startX = (region.startTime / duration) * width;
      const endX = (region.endTime / duration) * width;
      const regionWidth = Math.max(2, endX - startX);

      const isSelected = selectedRegionId === region.id;

      ctx.fillStyle = region.color + (isSelected ? '66' : '33');
      ctx.fillRect(startX, 0, regionWidth, height);

      ctx.strokeStyle = region.color;
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeRect(startX, 0, regionWidth, height);

      // Draw resize handles on edges if selected
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(startX - 2, 0, 4, height);
        ctx.fillRect(endX - 2, 0, 4, height);
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(
        `${region.name} (${region.densityMultiplier}x) [${region.startTime.toFixed(1)}s - ${region.endTime.toFixed(1)}s]`, 
        startX + 6, 
        18
      );
    });

    if (isDragging && dragMode === 'create' && duration > 0) {
      const startX = (Math.min(dragStartTime, dragCurrentT) / duration) * width;
      const endX = (Math.max(dragStartTime, dragCurrentT) / duration) * width;
      const regionWidth = Math.max(2, endX - startX);

      ctx.fillStyle = 'rgba(99, 102, 241, 0.25)'; // Indigo preview
      ctx.fillRect(startX, 0, regionWidth, height);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]); // Dashed borders for preview
      ctx.strokeRect(startX, 0, regionWidth, height);
      ctx.setLineDash([]); // Reset dash

      ctx.fillStyle = '#a5b4fc';
      ctx.font = 'italic bold 10px sans-serif';
      ctx.fillText(
        `Creating Region... (${Math.abs(dragCurrentT - dragStartTime).toFixed(1)}s)`,
        startX + 6,
        32
      );
    }

    if (duration > 0) {
      const playheadX = (currentTime / duration) * width;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(playheadX, 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [audioBuffer, regions, duration, currentTime, selectedRegionId, isDragging, dragMode, dragStartTime, dragCurrentT, zoomLevel]);

  if (!isOpen) return null;

  const getTimeFromMouseEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    return Number((ratio * duration).toFixed(2));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const t = getTimeFromMouseEvent(e);

    // Check if clicked near an existing region edge or inside a region
    let foundRegion: AudioRegion | null = null;
    let mode: 'create' | 'resize-left' | 'resize-right' | 'move' = 'create';

    for (const reg of regions) {
      const startX = (reg.startTime / duration) * canvas.width;
      const endX = (reg.endTime / duration) * canvas.width;

      if (Math.abs(clickX - startX) <= 8) {
        foundRegion = reg;
        mode = 'resize-left';
        break;
      } else if (Math.abs(clickX - endX) <= 8) {
        foundRegion = reg;
        mode = 'resize-right';
        break;
      } else if (clickX >= startX && clickX <= endX) {
        foundRegion = reg;
        mode = 'move';
        break;
      }
    }

    if (foundRegion) {
      setSelectedRegionId(foundRegion.id);
      setIsDragging(true);
      setDragMode(mode);
      setActiveDragRegionId(foundRegion.id);
      setDragStartX(clickX);
      setDragStartTime(foundRegion.startTime);
      setDragEndTime(foundRegion.endTime);
      setDragStartT(t);
      setDragCurrentT(t);
    } else {
      // Create new region by dragging
      setIsDragging(true);
      setDragMode('create');
      setDragStartTime(t);
      setDragEndTime(Math.min(duration, t + 5));
      setDragStartT(t);
      setDragCurrentT(t);
    }

    // Also update audio playback time
    if (audioRef.current) {
      audioRef.current.currentTime = t;
    }
    setCurrentTime(t);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || duration <= 0 || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const currentT = getTimeFromMouseEvent(e);

    setDragCurrentT(currentT);

    if (dragMode === 'create') {
      // Handled visually in useEffect canvas rendering
    } else if (activeDragRegionId) {
      setRegions(prev => {
        const next = prev.map(r => {
          if (r.id !== activeDragRegionId) return r;
          let newStart = r.startTime;
          let newEnd = r.endTime;

          if (dragMode === 'resize-left') {
            newStart = Math.max(0, Math.min(currentT, r.endTime - 0.5));
          } else if (dragMode === 'resize-right') {
            newEnd = Math.min(duration, Math.max(currentT, r.startTime + 0.5));
          } else if (dragMode === 'move') {
            const durationSpan = dragEndTime - dragStartTime;
            const deltaT = currentT - dragStartT;
            newStart = Math.max(0, Math.min(duration - durationSpan, dragStartTime + deltaT));
            newEnd = newStart + durationSpan;
          }

          return {
            ...r,
            startTime: Number(newStart.toFixed(2)),
            endTime: Number(newEnd.toFixed(2))
          };
        });
        return next;
      });
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (dragMode === 'create' && canvas) {
      const finalT = getTimeFromMouseEvent(e);
      const start = Number(Math.min(dragStartTime, finalT).toFixed(2));
      const end = Number(Math.max(dragStartTime, finalT).toFixed(2));
      if (end - start >= 1.0) { // Increased to 1.0s to avoid accidental clicks creating regions
        const newReg: AudioRegion = {
          id: `reg_${Date.now()}`,
          name: `Custom Region ${regions.length + 1}`,
          startTime: start,
          endTime: end,
          type: 'intense',
          densityMultiplier: 1.5,
          speedMultiplier: 1.0,
          patternPreference: 'auto',
          color: REGION_COLORS.intense
        };
        const updated = [...regions, newReg].sort((a, b) => a.startTime - b.startTime);
        setRegions(updated);
        onSaveRegions(updated); // Sync instantly to trigger draft autoguardado!
        setSelectedRegionId(newReg.id);
      }
    } else if (activeDragRegionId) {
      // Sync moved/resized regions instantly to parent!
      onSaveRegions(regions);
    }
    setIsDragging(false);
    setDragMode(null);
    setActiveDragRegionId(null);
  };

  const addRegion = () => {
    const start = Number(currentTime.toFixed(2));
    const end = Number(Math.min(duration, start + 15).toFixed(2));
    const newReg: AudioRegion = {
      id: `reg_${Date.now()}`,
      name: `Region ${regions.length + 1}`,
      startTime: start,
      endTime: end > start ? end : Number(Math.min(duration, start + 5).toFixed(2)),
      type: 'intense',
      densityMultiplier: 1.5,
      speedMultiplier: 1.0,
      patternPreference: 'auto',
      color: REGION_COLORS.intense
    };
    const updated = [...regions, newReg].sort((a, b) => a.startTime - b.startTime);
    setRegions(updated);
    setSelectedRegionId(newReg.id);
  };

  const updateRegion = (id: string, updates: Partial<AudioRegion>) => {
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...updates };
        if (updates.type) {
          updated.color = REGION_COLORS[updates.type];
          if (updates.type === 'silence') updated.densityMultiplier = 0;
          else if (updates.type === 'chill') updated.densityMultiplier = 0.5;
          else if (updates.type === 'normal') updated.densityMultiplier = 1.0;
          else if (updates.type === 'intense') updated.densityMultiplier = 1.5;
          else if (updates.type === 'extreme') updated.densityMultiplier = 2.0;
        }
        return updated;
      })
    );
  };

  const removeRegion = (id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
    if (selectedRegionId === id) setSelectedRegionId(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${Number(secs) < 10 ? '0' : ''}${secs}`;
  };

  const handleSaveAndClose = () => {
    onSaveRegions(regions);
    onClose();
  };

  const handleGenerateClick = () => {
    onSaveRegions(regions);
    onGenerate(regions);
  };

  const selectedRegion = regions.find(r => r.id === selectedRegionId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 sm:p-6 overflow-y-auto">
      <div className="glass-panel rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 glass-surface">
          <div className="flex items-center gap-3">
            <div className="p-2.5 glass-card rounded-2xl text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 uppercase tracking-tight">
                Timeline Regions Editor
                <span className="text-[10px] glass-pill text-indigo-300 font-mono uppercase tracking-wider">
                  Interactive
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Click and drag on the timeline to create or resize regions. Select a region to edit parameters.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white glass-card-interactive rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {/* Waveform Canvas & Controls */}
          <div className="space-y-3 glass-card p-4 rounded-2xl">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-mono flex-wrap gap-2.5">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-indigo-400" />
                <span className="text-zinc-200 font-semibold truncate max-w-[150px] sm:max-w-[300px]">{audioFile?.name || 'Loaded Track'}</span>
              </div>

              {/* Dynamic Zoom Controls */}
              <div className="flex items-center gap-1.5 glass-surface px-2 py-1 rounded-xl">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold px-1">Zoom:</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.max(1, prev - 1))}
                  disabled={zoomLevel <= 1}
                  className="p-1 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-bold text-indigo-300 font-mono px-2 min-w-[32px] text-center glass-pill py-0.5 rounded">
                  {zoomLevel}x
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.min(10, prev + 1))}
                  disabled={zoomLevel >= 10}
                  className="p-1 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-3 font-mono">
                <span className="text-indigo-400 font-bold">{formatTime(currentTime)}</span>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-400">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-inner group">
              <div 
                ref={scrollContainerRef}
                className="overflow-x-auto overflow-y-hidden custom-scrollbar w-full"
                style={{ scrollBehavior: 'smooth' }}
              >
                <canvas
                  ref={canvasRef}
                  width={800 * zoomLevel}
                  height={120}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  className="h-28 cursor-crosshair block"
                  style={{ 
                    width: `${800 * zoomLevel}px`, 
                    minWidth: '100%' 
                  }}
                />
              </div>
              <div className="absolute top-2 right-2 glass-pill text-[10px] text-zinc-300 px-2.5 py-1 rounded-lg pointer-events-none shadow">
                Drag on timeline to create region • Drag edges to resize
              </div>
            </div>

            {/* Direct Quick-Edit Bar for Selected Region on Timeline */}
            {selectedRegion && (
              <div className="bg-indigo-950/40 border border-indigo-500/40 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedRegion.color }} />
                  <input
                    type="text"
                    value={selectedRegion.name}
                    onChange={(e) => updateRegion(selectedRegion.id, { name: e.target.value })}
                    className="bg-zinc-900 border border-zinc-700 text-white text-xs font-bold px-2.5 py-1 rounded-lg w-36 focus:outline-none focus:border-indigo-400"
                  />
                  <span className="text-xs text-indigo-300 font-mono">
                    {selectedRegion.startTime.toFixed(2)}s - {selectedRegion.endTime.toFixed(2)}s
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Beautiful styled Density box with interactive minus/plus buttons */}
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 px-2.5 py-1 rounded-xl shadow-inner text-xs">
                    <span className="text-zinc-400 font-medium select-none">Density:</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateRegion(selectedRegion.id, { densityMultiplier: Math.max(0, Number((selectedRegion.densityMultiplier - 0.1).toFixed(1))) }); }}
                      className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold w-5 h-5 flex items-center justify-center cursor-pointer"
                      title="Decrease Density"
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={selectedRegion.densityMultiplier}
                      onChange={(e) => updateRegion(selectedRegion.id, { densityMultiplier: parseFloat(e.target.value) })}
                      className="w-16 accent-indigo-500 cursor-pointer h-1 bg-zinc-800 rounded-lg appearance-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); updateRegion(selectedRegion.id, { densityMultiplier: Math.min(3, Number((selectedRegion.densityMultiplier + 0.1).toFixed(1))) }); }}
                      className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold w-5 h-5 flex items-center justify-center cursor-pointer"
                      title="Increase Density"
                    >
                      +
                    </button>
                    <span className="font-mono font-extrabold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 text-[10px]">
                      {selectedRegion.densityMultiplier.toFixed(1)}x
                    </span>
                  </div>

                  {/* Beautiful styled Speed box with interactive minus/plus buttons */}
                  {(activeTab === 'charter_mania' || activeTab === 'charter_taiko') && (
                    <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 px-2.5 py-1 rounded-xl shadow-inner text-xs">
                      <span className="text-zinc-400 font-medium select-none">Speed:</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateRegion(selectedRegion.id, { speedMultiplier: Math.max(0.1, Number(((selectedRegion.speedMultiplier || 1.0) - 0.1).toFixed(1))) }); }}
                        className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold w-5 h-5 flex items-center justify-center cursor-pointer"
                        title="Decrease Speed"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.1"
                        value={selectedRegion.speedMultiplier || 1.0}
                        onChange={(e) => updateRegion(selectedRegion.id, { speedMultiplier: parseFloat(e.target.value) })}
                        className="w-16 accent-amber-500 cursor-pointer h-1 bg-zinc-800 rounded-lg appearance-none"
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); updateRegion(selectedRegion.id, { speedMultiplier: Math.min(3, Number(((selectedRegion.speedMultiplier || 1.0) + 0.1).toFixed(1))) }); }}
                        className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold w-5 h-5 flex items-center justify-center cursor-pointer"
                        title="Increase Speed"
                      >
                        +
                      </button>
                      <span className="font-mono font-extrabold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 text-[10px]">
                        {(selectedRegion.speedMultiplier || 1.0).toFixed(1)}x
                      </span>
                    </div>
                  )}

                  <button
                    onClick={() => removeRegion(selectedRegion.id)}
                    className="p-1.5 bg-rose-950/50 hover:bg-rose-900 text-rose-300 border border-rose-500/30 rounded-lg transition-all"
                    title="Delete Region"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="flex items-center gap-2 bg-[#191816] hover:bg-[#222019] text-stone-200 border border-neutral-700 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? 'Pause' : 'Play Preview'}
                </button>

                <button
                  onClick={() => {
                    if (audioRef.current) audioRef.current.currentTime = Math.max(0, currentTime - 5);
                  }}
                  className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all text-xs cursor-pointer"
                  title="Rewind 5s"
                >
                  <Rewind className="w-4 h-4" />
                </button>

                <button
                  onClick={() => {
                    if (audioRef.current) audioRef.current.currentTime = Math.min(duration, currentTime + 5);
                  }}
                  className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all text-xs cursor-pointer"
                  title="Forward 5s"
                >
                  <FastForward className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={addRegion}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Region at {formatTime(currentTime)}
                </button>
              </div>
            </div>
          </div>

          {/* Region List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Configured Audio Regions ({regions.length})
              </label>
              <span className="text-[11px] text-zinc-500">
                Click a region card or click/drag on the timeline above to edit.
              </span>
            </div>

            {regions.length === 0 ? (
              <div className="text-center py-8 bg-zinc-950/40 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 text-xs">
                No custom regions set. Click and drag on the timeline above to add a region.
              </div>
            ) : (
              <div className="space-y-3">
                {regions.map((region) => {
                  const isSelected = selectedRegionId === region.id;
                  return (
                    <div
                      key={region.id}
                      onClick={() => setSelectedRegionId(region.id)}
                      className={`p-4 rounded-2xl border transition-all space-y-3 ${
                        isSelected
                          ? 'bg-zinc-950 border-indigo-500/80 shadow-lg shadow-indigo-950/30'
                          : 'bg-zinc-950/50 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: region.color }}
                          />
                          <input
                            type="text"
                            value={region.name}
                            onChange={(e) => updateRegion(region.id, { name: e.target.value })}
                            className="bg-zinc-900 border border-zinc-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl w-full max-w-[220px] focus:outline-none focus:border-indigo-500"
                            placeholder="Region Name"
                          />
                        </div>

                        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          <span>Start:</span>
                          <input
                            type="number"
                            min={0}
                            max={region.endTime}
                            step={0.1}
                            value={region.startTime}
                            onChange={(e) => updateRegion(region.id, { startTime: Math.max(0, Number(e.target.value)) })}
                            className="w-16 bg-zinc-950 border border-zinc-800 text-indigo-300 font-mono text-center rounded px-1 py-0.5 focus:outline-none"
                          />
                          <span>s</span>
                          <span className="text-zinc-600">|</span>
                          <span>End:</span>
                          <input
                            type="number"
                            min={region.startTime}
                            max={duration}
                            step={0.1}
                            value={region.endTime}
                            onChange={(e) => updateRegion(region.id, { endTime: Math.min(duration, Number(e.target.value)) })}
                            className="w-16 bg-zinc-950 border border-zinc-800 text-indigo-300 font-mono text-center rounded px-1 py-0.5 focus:outline-none"
                          />
                          <span>s</span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRegion(region.id);
                          }}
                          className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-900 rounded-lg transition-all"
                          title="Delete Region"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {(() => {
                        const showSpeed = activeTab === 'charter_mania' || activeTab === 'charter_taiko';
                        const showPattern = activeTab === 'charter_mania' || activeTab === 'charter_fnf';
                        const visibleCols = 1 + (showSpeed ? 1 : 0) + (showPattern ? 1 : 0);
                        
                        return (
                          <div className={`grid grid-cols-1 sm:grid-cols-${visibleCols} gap-4 pt-2 border-t border-zinc-900`}>
                            <div>
                              <div className="flex justify-between items-center text-[10px] font-semibold text-zinc-500 mb-1">
                                <span>Density:</span>
                                <span className="text-indigo-400 font-mono font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 text-[10px]">
                                  {region.densityMultiplier.toFixed(1)}x
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 p-1.5 rounded-xl">
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateRegion(region.id, { densityMultiplier: Math.max(0, Number((region.densityMultiplier - 0.1).toFixed(1))) }); }}
                                  className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold shrink-0 w-6 h-6 flex items-center justify-center cursor-pointer"
                                  title="Decrease Density"
                                >
                                  -
                                </button>
                                <div className="relative flex-1 flex items-center">
                                  <input
                                    type="range"
                                    min="0"
                                    max="3"
                                    step="0.1"
                                    value={region.densityMultiplier}
                                    onChange={(e) => updateRegion(region.id, { densityMultiplier: parseFloat(e.target.value) })}
                                    className="w-full accent-indigo-500 cursor-pointer h-1 bg-zinc-800 rounded-lg appearance-none"
                                  />
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateRegion(region.id, { densityMultiplier: Math.min(3, Number((region.densityMultiplier + 0.1).toFixed(1))) }); }}
                                  className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold shrink-0 w-6 h-6 flex items-center justify-center cursor-pointer"
                                  title="Increase Density"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            {showSpeed && (
                              <div>
                                <div className="flex justify-between items-center text-[10px] font-semibold text-zinc-500 mb-1">
                                  <span>Scroll Speed:</span>
                                  <span className="text-amber-400 font-mono font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 text-[10px]">
                                    {(region.speedMultiplier || 1.0).toFixed(1)}x
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 p-1.5 rounded-xl">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateRegion(region.id, { speedMultiplier: Math.max(0.1, Number(((region.speedMultiplier || 1.0) - 0.1).toFixed(1))) }); }}
                                    className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold shrink-0 w-6 h-6 flex items-center justify-center cursor-pointer"
                                    title="Decrease Speed"
                                  >
                                    -
                                  </button>
                                  <div className="relative flex-1 flex items-center">
                                    <input
                                      type="range"
                                      min="0.1"
                                      max="3"
                                      step="0.1"
                                      value={region.speedMultiplier || 1.0}
                                      onChange={(e) => updateRegion(region.id, { speedMultiplier: parseFloat(e.target.value) })}
                                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
                                    />
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateRegion(region.id, { speedMultiplier: Math.min(3, Number(((region.speedMultiplier || 1.0) + 0.1).toFixed(1))) }); }}
                                    className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors text-xs font-bold shrink-0 w-6 h-6 flex items-center justify-center cursor-pointer"
                                    title="Increase Speed"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )}

                            {showPattern && (
                              <div>
                                <label className="block text-[10px] font-semibold text-zinc-500 mb-1">
                                  Pattern Style:
                                </label>
                                <select
                                  value={region.patternPreference}
                                  onChange={(e) => updateRegion(region.id, { patternPreference: e.target.value as any })}
                                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-xs rounded-xl px-2.5 py-2.5 focus:outline-none focus:border-indigo-500"
                                >
                                  <option value="auto">⭐ Auto / Balanced</option>
                                  <option value="streams">⚡ Rapid Streams (Stairs / Escaleras)</option>
                                  <option value="chords">🎹 Force Chords (Doubles/Triples)</option>
                                  <option value="holds">🟢 Hold / Long Notes (LNs)</option>
                                  <option value="single">🎯 Single Notes Only (No Chords)</option>
                                  <option value="hold_and_play">⛓️ Hold & Play (Anchor Long Note)</option>
                                  <option value="jacks">🦘 Repetitive Jacks (Fast repetition)</option>
                                  <option value="stairs_and_chords">🌀 Hybrid (Stairs + Chords)</option>
                                </select>

                                {region.patternPreference === 'hold_and_play' && (
                                  <div className="mt-2 pl-2 border-l-2 border-indigo-500/50">
                                    <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-1">
                                      Anchor Side / Posición:
                                    </label>
                                    <div className="flex gap-1">
                                      {(['any', 'left', 'right', 'center'] as const).map((side) => (
                                        <button
                                          key={side}
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); updateRegion(region.id, { holdAndPlaySide: side }); }}
                                          className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider border cursor-pointer transition-all ${
                                            (region.holdAndPlaySide || 'any') === side
                                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow shadow-indigo-950'
                                              : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'
                                          }`}
                                        >
                                          {side === 'any' ? 'Random' : side}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-white/10 glass-surface">
          <button
            onClick={handleSaveAndClose}
            className="flex items-center gap-2 glass-card-interactive text-white font-bold px-5 py-3 rounded-2xl transition-all text-xs cursor-pointer"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            Save Regions & Close
          </button>

          <button
            onClick={handleGenerateClick}
            disabled={isGenerating}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-semibold px-6 py-3 rounded-md transition-colors text-sm cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {isGenerating ? 'Generating chart…' : `Generate chart (${regions.length} regions)`}
          </button>
        </div>
      </div>
    </div>
  );
};
