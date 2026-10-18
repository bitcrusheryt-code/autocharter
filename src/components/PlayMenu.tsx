import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Trash2, 
  Play, 
  Music, 
  Search, 
  SlidersHorizontal,
  Volume2, 
  VolumeX, 
  FolderOpen, 
  Layers,
  ChevronRight,
  Gauge,
  Download,
} from 'lucide-react';
import { PlayLevelEntry, getAllPlayLevelsFromDB, savePlayLevelToDB, deletePlayLevelFromDB } from '../lib/playDb';
import { parseUniversalChart } from '../lib/chartParser';
import { getScoreRecord, getRankColor } from '../lib/scoreStorage';
import { hitSoundManager } from '../lib/hitsound';
import { exportFile } from '../lib/fileExport';


interface PlayMenuProps {
  onBack: () => void;
  onGoToConverter: () => void;
  onOpenLevel: (levelBlob: Blob, fileName: string, difficultyIndex?: number, difficultyName?: string) => void;
  onOpenSettings?: () => void;
}

export default function PlayMenu({ onBack, onGoToConverter, onOpenLevel, onOpenSettings }: PlayMenuProps) {
  const [levels, setLevels] = useState<PlayLevelEntry[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModeFilter, setSelectedModeFilter] = useState<string>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  
  // Create object URLs for images and audio
  const [bgUrls, setBgUrls] = useState<Record<string, string>>({});
  const [audioUrl, setAudioUrl] = useState<string | null>(null);


  // Hitsounds state
  const [hitsoundsEnabled, setHitsoundsEnabled] = useState<boolean>(() => hitSoundManager.isEnabled());
  const [hitsoundVol, setHitsoundVol] = useState<number>(() => hitSoundManager.getVolume());

  // Scroll speed state with quick presets
  const [scrollSpeed, setScrollSpeed] = useState<number>(() => {
    return parseFloat(localStorage.getItem('rhythm_engine_scrollSpeed') || '1.0');
  });

  const handleHitsoundToggle = (val: boolean) => {
    setHitsoundsEnabled(val);
    hitSoundManager.setEnabled(val);
    if (val) {
      hitSoundManager.playHitSound('4', 0);
    }
  };

  const handleHitsoundVolChange = (val: number) => {
    setHitsoundVol(val);
    hitSoundManager.setVolume(val);
    hitSoundManager.playHitSound('4', 0);
  };

  const handleScrollSpeedChange = (val: number) => {
    const clamped = Math.max(0.2, Math.min(2.5, Number(val.toFixed(2))));
    setScrollSpeed(clamped);
    localStorage.setItem('rhythm_engine_scrollSpeed', clamped.toString());
  };

  useEffect(() => {
    try {
      [
        'rhythm_engine_modFadeIn',
        'rhythm_engine_modFadeOut',
        'rhythm_engine_modSuddenDeath',
        'rhythm_engine_modMuted',
        'rhythm_engine_modMirror',
        'rhythm_engine_modSway',
        'rhythm_engine_modSideNotes',
        'rhythm_engine_modShake',
        'rhythm_engine_songSpeed',
        'rhythm_engine_playbackSpeed'
      ].forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Could not clear retired gameplay modifier settings:', error);
    }
    loadLevels();
  }, []);

  const loadLevels = async () => {
    const data = await getAllPlayLevelsFromDB();
    setLevels(data);

    // Generate object URLs for level artwork
    const urls: Record<string, string> = {};
    data.forEach(lvl => {
      if (lvl.bgBlob) {
        urls[lvl.id] = URL.createObjectURL(lvl.bgBlob);
      }
    });
    setBgUrls(urls);
  };

  const handleDownloadLevel = async (level: PlayLevelEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      let exportName = level.name || `${level.title || 'chart_package'}.zip`;
      if (!exportName.includes('.')) {
        exportName = `${exportName}.zip`;
      }
      await exportFile(level.blob, exportName);
    } catch (err) {
      console.error("Could not download level blob:", err);
    }
  };

  const [isWindowDragOver, setIsWindowDragOver] = useState(false);

  const importFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    for (const file of files) {
      try {
        const parsed = await parseUniversalChart(file, file.name);
        
        let bgBlob: Blob | undefined;
        let diffs: string[] = [];
        
        if (parsed.bgUrl) {
          try {
            const response = await fetch(parsed.bgUrl);
            bgBlob = await response.blob();
          } catch (e) {
            console.error("Could not fetch bg blob from url", e);
          }
        }

        if (parsed.difficulties && parsed.difficulties.length > 0) {
          diffs = parsed.difficulties.map((d: any) => d.name);
        } else {
          diffs = [parsed.version || 'Normal'];
        }

        const newEntry: PlayLevelEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: file.name,
          title: parsed.title,
          artist: parsed.artist,
          charter: parsed.charter,
          mode: parsed.mode,
          timestamp: Date.now(),
          blob: file,
          bgBlob: bgBlob,
          difficulties: diffs
        };

        await savePlayLevelToDB(newEntry);
        
      } catch (err: any) {
        console.error("Import error:", err);
        alert(`The file ${file.name} is incompatible or corrupted: ${err.message}`);
      }
    }
    
    await loadLevels();
    setIsImporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files) as File[];
    await importFiles(files);
    if (e.target) e.target.value = '';
  };

  const handleWindowDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWindowDragOver(true);
  };

  const handleWindowDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only turn off if leaving outer element
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsWindowDragOver(false);
  };

  const handleWindowDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWindowDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await importFiles(Array.from(e.dataTransfer.files) as File[]);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deletePlayLevelFromDB(id);
    setDeleteConfirmId(null);
    if (selectedLevelId === id) {
      setSelectedLevelId(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setIsPlayingPreview(false);
      }
    }
    await loadLevels();
  };

  const handleLevelClick = async (level: PlayLevelEntry) => {
    if (selectedLevelId === level.id) {
      setSelectedLevelId(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setIsPlayingPreview(false);
      }
    } else {
      setSelectedLevelId(level.id);
      
      try {
        const parsed = await parseUniversalChart(level.blob, level.name);
        if (parsed.audioUrl) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          setAudioUrl(parsed.audioUrl);
          if (audioRef.current) {
            audioRef.current.src = parsed.audioUrl;
            audioRef.current.play()
              .then(() => setIsPlayingPreview(true))
              .catch(e => {
                console.log("Audio play prevented", e);
                setIsPlayingPreview(false);
              });
          }
        } else {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            setIsPlayingPreview(false);
          }
        }
      } catch (e) {
        console.error("Could not play preview", e);
        setIsPlayingPreview(false);
      }
    }
  };

  // Filtered levels based on search & mode
  const filteredLevels = useMemo(() => {
    return levels.filter(lvl => {
      const titleMatch = (lvl.title || lvl.name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const artistMatch = (lvl.artist || '').toLowerCase().includes(searchQuery.toLowerCase());
      const charterMatch = (lvl.charter || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSearch = titleMatch || artistMatch || charterMatch;

      if (!matchesSearch) return false;
      if (selectedModeFilter === 'all') return true;
      return lvl.mode?.toLowerCase() === selectedModeFilter.toLowerCase();
    });
  }, [levels, searchQuery, selectedModeFilter]);

  const getModeBadge = (mode?: string) => {
    switch (mode?.toLowerCase()) {
      case 'fnf':
        return { label: 'FNF 4K', bg: 'bg-[#e21d2d]/10 text-[#ff7880] border-[#e21d2d]/30' };
      case 'llplus':
        return { label: 'LL+ 2K', bg: 'bg-[#1e5bff]/10 text-[#8ca9ff] border-[#1e5bff]/30' };
      case 'taiko':
        return { label: 'TAIKO', bg: 'bg-[#22b14c]/10 text-[#75dc91] border-[#22b14c]/30' };
      case 'mania':
      default:
        return { label: 'MANIA', bg: 'bg-[#ffc20e]/10 text-[#ffda65] border-[#ffc20e]/30' };
    }
  };

  return (
    <div 
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
      className="min-h-screen bg-[#071426] text-slate-100 flex flex-col relative overflow-hidden font-sans select-none"
    >
      <header className="relative z-30 w-full px-4 sm:px-6 lg:px-8">
        <div className="app-main-header max-w-5xl mx-auto relative gap-4 border-b border-[#2d4259] py-3">
          <button type="button" onClick={onBack} className="flex items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">
            <span className="w-9 h-9 flex items-center justify-center bg-[#ffc20e] text-[#071426] rounded-sm"><Music className="w-4 h-4" /></span>
            <span><span className="block text-sm font-bold tracking-wide">IRIS</span><span className="block text-[11px] text-[#aebdca]">Autocharter</span></span>
          </button>
          <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm">
            <button type="button" onClick={onBack} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Create</button>
            <button type="button" onClick={onGoToConverter} className="text-[#aebdca] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Convert</button>
            <span aria-current="page" className="text-white border-b-2 border-[#f1f3f3] py-2">Play</span>
          </nav>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row relative">
      {/* Drag & Drop Visual Overlay */}
      <AnimatePresence>
        {isWindowDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#071426]/90 border-2 border-dashed border-[#ffc20e] flex flex-col items-center justify-center p-6 pointer-events-none"
          >
            <div className="w-16 h-16 rounded-sm bg-[#12263c] border border-[#ffc20e]/50 flex items-center justify-center text-[#ffc20e] mb-4">
              <Upload className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight uppercase">
              Drop Charts Here
            </h2>
            <p className="text-sm font-medium text-[#c8d2dc] mt-2 max-w-md text-center">
              Release to install an <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.iric</code>, <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.osz</code>, <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.zip</code>, <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.osu</code>, <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.mid</code>, <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.json</code>, or <code className="bg-[#12263c] px-1.5 py-0.5 rounded-sm text-[#ffe9a6]">.llmap</code> chart.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected Level Dynamic Background */}
      <AnimatePresence>
        {selectedLevelId && bgUrls[selectedLevelId] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.38 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none scale-105 filter blur-[2px]"
            style={{ backgroundImage: `url(${bgUrls[selectedLevelId]})` }}
          />
        )}
      </AnimatePresence>
      
      <div className="fixed inset-0 bg-[#071426]/80 z-0 pointer-events-none" />

      <audio ref={audioRef} loop />

      {/* Left Control Sidebar (Glass Acrylic Panel) */}
        <div className="w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col gap-4 p-4 sm:p-6 z-20 relative border-b md:border-b-0 md:border-r border-[#2d4259] glass-surface h-auto md:h-full md:overflow-y-auto">
        {/* Library controls */}
        <div className="flex items-center justify-between gap-1.5">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 glass-card-interactive text-zinc-300 hover:text-[#1e5bff] rounded-sm text-xs font-bold cursor-pointer"
              title="Open Settings (Keybinds, Offsets, Display)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
              <span>Settings</span>
            </button>
          )}
          
          <div className="flex items-center gap-1.5 px-3 py-1.5 glass-pill rounded-sm text-[11px] font-bold text-[#c8d2dc]">
            <Layers className="w-3 h-3 text-indigo-400" />
            <span>{levels.length}</span>
          </div>
        </div>

        {/* Section Title */}
        <div className="mt-0.5">
          <h1 className="font-display text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Play className="w-5 h-5 text-amber-400 fill-amber-400/15" />
            Chart library
          </h1>
        </div>

        {/* Import Level Action Button */}
        <label className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-sm border font-medium text-sm transition-colors cursor-pointer shrink-0 ${isImporting ? 'bg-[#12263c] border-[#775b14] text-[#ffe9a6]' : 'bg-[#ffc20e] hover:bg-[#ffda65] border-[#ffc20e] text-[#071426]'}`}>
          <Upload className="w-4 h-4 shrink-0" />
          <span>{isImporting ? 'Importing files...' : 'Import New Chart'}</span>
          <input
            type="file"
            multiple
            accept=".iric,.osz,.zip,.llmap,.mid,.json,.osu"
            className="hidden"
            onChange={handleImport}
            disabled={isImporting}
          />
        </label>

        {/* Search Bar */}
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, artist or charter..."
            className="w-full glass-input rounded-sm pl-9 pr-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200 font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Game Mode Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 shrink-0" style={{ scrollbarWidth: 'none' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'mania', label: 'osu!mania' },
            { id: 'fnf', label: 'FNF' },
            { id: 'llplus', label: 'LL+' },
            { id: 'taiko', label: 'Taiko' }
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setSelectedModeFilter(filter.id)}
              className={`px-3 py-1.5 rounded-sm text-xs font-bold transition-colors cursor-pointer shrink-0 border ${
                selectedModeFilter === filter.id
                  ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                  : 'glass-card-interactive text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Scroll Speed Customizer Card */}
        <div className="p-3.5 glass-card rounded-sm w-full shrink-0 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
              Scroll Speed
            </label>
            <span className="text-xs font-mono font-bold text-[#c8d2dc] glass-pill px-2 py-0.5 rounded-sm">
              {scrollSpeed.toFixed(2)}x
            </span>
          </div>

          <input
            type="range"
            min={0.2}
            max={2.5}
            step={0.05}
            value={scrollSpeed}
            onChange={(e) => handleScrollSpeedChange(parseFloat(e.target.value))}
            className="w-full accent-[#ffc20e] cursor-pointer bg-zinc-950 h-1.5 rounded-sm"
          />

          {/* Quick Presets */}
          <div className="grid grid-cols-4 gap-1 pt-0.5">
            {[0.8, 1.0, 1.3, 1.6].map((spd) => (
              <button
                key={spd}
                onClick={() => handleScrollSpeedChange(spd)}
                className={`py-1 rounded-sm text-[11px] font-mono font-bold border transition-colors cursor-pointer ${
                  Math.abs(scrollSpeed - spd) < 0.03
                    ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                    : 'glass-card text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {spd.toFixed(1)}x
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Right Song List View */}
      <div className="flex-1 w-full h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 z-10 scroll-smooth">
        <div className="max-w-4xl mx-auto space-y-3 pb-24">
          {levels.length === 0 ? (
            <div className="w-full flex flex-col items-center justify-center py-20 text-center border-y border-[#2d4259] p-8">
              <FolderOpen className="w-7 h-7 text-[#1e5bff] mb-4" />
              <h3 className="font-display text-xl font-bold text-white tracking-tight">No charts installed</h3>
              <p className="text-[#aebdca] mt-2 max-w-md text-xs">
                Use <strong className="text-[#ffe9a6]">Import New Chart</strong> to add .iric, .osz, .llmap, .zip, .osu, .mid, or .json files.
              </p>
            </div>
          ) : filteredLevels.length === 0 ? (
            <div className="w-full flex flex-col items-center justify-center py-16 text-center border border-zinc-800 rounded-xl bg-zinc-900/20 p-6">
              <Search className="w-8 h-8 text-zinc-600 mb-3" />
              <h3 className="text-base font-bold text-zinc-300">No matching songs found</h3>
              <p className="text-zinc-500 text-xs mt-1">
                Try searching for a different keyword or change the game mode filter.
              </p>
            </div>
          ) : (
            filteredLevels.map((level) => {
              const isSelected = selectedLevelId === level.id;
              const modeBadge = getModeBadge(level.mode);
              
              return (
                <div key={level.id} className="w-full flex flex-col">
                  {/* Song Main Card */}
                  <motion.div
                    layout
                    onClick={() => handleLevelClick(level)}
                    className={`relative group overflow-hidden w-full p-4 sm:p-5 rounded-lg cursor-pointer transition-colors border ${
                      isSelected 
                        ? 'glass-panel border-amber-700' 
                        : 'glass-card-interactive'
                    }`}
                  >
                    {/* Background Artwork */}
                    {bgUrls[level.id] ? (
                      <div 
                        className={`absolute inset-0 z-0 bg-cover bg-center transition-all duration-500 ${
                          isSelected ? 'opacity-35 scale-105 filter blur-[1px]' : 'opacity-15 group-hover:opacity-25'
                        }`}
                        style={{ backgroundImage: `url(${bgUrls[level.id]})` }}
                      />
                    ) : (
                      <div className="absolute inset-0 z-0 bg-zinc-900/50 opacity-20" />
                    )}

                    {/* Gradient Overlay for high contrast text */}
                    <div className="absolute inset-0 z-0 bg-[#0b0b0a]/75" />

                    {/* Content Details */}
                    <div className="relative z-10 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Artwork Thumbnail / Icon */}
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-md bg-zinc-950/80 border border-neutral-700 overflow-hidden flex items-center justify-center shrink-0 relative">
                          {bgUrls[level.id] ? (
                            <img 
                              src={bgUrls[level.id]} 
                              alt="Thumbnail" 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Music className="w-6 h-6 text-indigo-400" />
                          )}
                          {isSelected && isPlayingPreview && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <Volume2 className="w-6 h-6 text-indigo-400 animate-pulse" />
                            </div>
                          )}
                        </div>

                        {/* Title, Artist, Difficulties count */}
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${modeBadge.bg}`}>
                              {modeBadge.label}
                            </span>
                            <span className="text-xs text-zinc-300 font-medium truncate">
                              by <strong className="text-white font-semibold">{level.artist || 'Unknown Artist'}</strong>
                            </span>
                          </div>

                          <h3 className="font-display text-lg sm:text-xl font-semibold text-white tracking-tight truncate mt-0.5 group-hover:text-amber-200 transition-colors">
                            {level.title || level.name}
                          </h3>

                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-xs text-zinc-400 font-semibold">
                              {level.difficulties.length} {level.difficulties.length === 1 ? 'difficulty' : 'difficulties'}
                            </span>
                            <div className="flex items-center gap-1">
                              {level.difficulties.map((_, i) => (
                                <div 
                                  key={i} 
                                  className="w-2 h-3.5 rounded-sm bg-amber-600"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right Actions */}
                      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        {/* Download level package button */}
                        <button
                          onClick={(e) => handleDownloadLevel(level, e)}
                          className="p-2.5 glass-card-interactive text-zinc-300 hover:text-indigo-400 rounded-xl transition-all cursor-pointer"
                          title="Download imported chart package"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {/* Delete confirmation or delete trigger */}
                        {deleteConfirmId === level.id ? (
                          <div className="flex items-center gap-1.5 bg-red-950/90 border border-red-500/40 p-1.5 rounded-2xl z-20">
                            <button
                              onClick={(e) => handleDelete(level.id, e)}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                              className="px-2 py-1 text-xs text-zinc-400 hover:text-white font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(level.id);
                            }}
                            className="p-2.5 glass-card-interactive text-zinc-400 hover:text-red-400 rounded-xl transition-all cursor-pointer"
                            title="Delete chart"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        <div className={`w-9 h-9 rounded-md flex items-center justify-center border transition-colors ${
                          isSelected 
                            ? 'bg-amber-950 text-amber-300 border-amber-800 rotate-90' 
                            : 'glass-card text-zinc-400 group-hover:border-zinc-600'
                        }`}>
                          <ChevronRight className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Expanded Difficulty Selector Grid */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="w-full flex flex-col gap-2.5 pt-2.5 pl-4 sm:pl-6 overflow-hidden"
                      >
                        {level.difficulties.map((diff, i) => {
                          const record = getScoreRecord(level.title || level.name, diff) || getScoreRecord(level.title || level.name, i);

                          return (
                            <motion.div
                              key={i}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (audioRef.current) {
                                  audioRef.current.pause();
                                }
                                onOpenLevel(level.blob, level.name, i, diff);
                              }}
                              className="relative overflow-hidden w-full flex items-center justify-between p-3.5 sm:p-4 rounded-md cursor-pointer text-white glass-card-interactive transition-colors group/diff"
                            >
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div className="w-10 h-10 rounded-md bg-[#2a261e] border border-amber-900 flex items-center justify-center text-amber-300 font-semibold text-sm shrink-0">
                                  {i + 1}
                                </div>
                                <div className="flex flex-col truncate">
                                  <span className="text-base sm:text-lg font-semibold tracking-tight text-white group-hover/diff:text-amber-200 transition-colors">
                                    {diff}
                                  </span>
                                  <span className="text-xs text-zinc-300 font-medium truncate">
                                    Charted by <strong className="text-white font-semibold">{level.charter || 'Unknown'}</strong>
                                  </span>
                                </div>
                              </div>

                              {/* Right: Score/Rank Record or Play Button */}
                              <div className="flex items-center gap-3 shrink-0">
                                {record ? (
                                  <div className="flex items-center gap-2.5 glass-card px-3 py-1.5 rounded-xl border border-white/10">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs border ${getRankColor(record.rank)}`}>
                                      {record.rank}
                                    </div>
                                    <div className="flex flex-col text-right font-mono">
                                      <span className="text-xs font-bold text-white leading-tight">
                                        {record.score.toLocaleString()}
                                      </span>
                                      <div className="flex items-center justify-end gap-1.5 text-[10px] text-zinc-300 font-medium">
                                        <span className="text-emerald-400 font-bold">{record.accuracy}%</span>
                                        <span>•</span>
                                        <span className="text-amber-400 font-bold">{record.maxCombo}x</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs font-semibold text-zinc-400 glass-pill px-3 py-1.5 rounded-xl border border-white/10">
                                    No Record
                                  </span>
                                )}

                                <div className="py-2 px-3.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-md flex items-center gap-1.5 transition-colors">
                                  <Play className="w-3.5 h-3.5 fill-white" />
                                  <span>Play</span>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>
      </div>


    </div>
  );
}
