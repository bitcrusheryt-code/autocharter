import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Save, 
  Keyboard, 
  Sliders, 
  RotateCcw, 
  Check, 
  Volume2, 
  VolumeX,
  Gauge, 
  Tv, 
  Info,
  Sparkles,
  Zap,
  Music,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Touchpad,
  Vibrate
} from 'lucide-react';
import { hitSoundManager } from '../lib/hitsound';

interface SettingsMenuProps {
  onBack: () => void;
}

const DEFAULT_KEY_MAPS: Record<string, string[]> = {
  'game_actions': ['escape'],
  'llplus': ['d', 'k'],
  'taiko': ['z', 'c'],
  'fnf': ['arrowleft', 'arrowdown', 'arrowup', 'arrowright'],
  '1': ['space'],
  '2': ['d', 'k'],
  '3': ['d', 'space', 'k'],
  '4': ['d', 'f', 'j', 'k'],
  '5': ['d', 'f', 'space', 'j', 'k'],
  '6': ['s', 'd', 'f', 'j', 'k', 'l'],
  '7': ['s', 'd', 'f', 'space', 'j', 'k', 'l'],
  '8': ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'],
  '9': ['a', 's', 'd', 'f', 'space', 'j', 'k', 'l', ';'],
};

export default function SettingsMenu({ onBack }: SettingsMenuProps) {
  const [activeTab, setActiveTab] = useState<'controls' | 'audio' | 'mobile' | 'info'>('controls');
  const [selectedKeyMode, setSelectedKeyMode] = useState<string>('llplus');

  const [keyMaps, setKeyMaps] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('rhythm_engine_keymaps');
      return saved ? { ...DEFAULT_KEY_MAPS, ...JSON.parse(saved) } : DEFAULT_KEY_MAPS;
    } catch {
      return DEFAULT_KEY_MAPS;
    }
  });

  // Audio & Gameplay General Settings
  const [scrollSpeed, setScrollSpeed] = useState<number>(() => {
    return parseFloat(localStorage.getItem('rhythm_engine_scrollSpeed') || '1.0');
  });
  const [scrollDirection, setScrollDirection] = useState<'down' | 'up'>(() => {
    return (localStorage.getItem('rhythm_engine_scrollDirection') as 'down' | 'up') || 'down';
  });
  const [audioOffset, setAudioOffset] = useState<number>(() => {
    return parseInt(localStorage.getItem('rhythm_engine_audioOffset') || '0', 10);
  });
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
  const [hideGameplayUi, setHideGameplayUi] = useState<boolean>(true);
  const [hideCountdown, setHideCountdown] = useState<boolean>(true);

  // Mobile & Touch Controls Settings
  const [touchControlsMode, setTouchControlsMode] = useState<'auto' | 'always' | 'never'>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchMode');
    return (saved as 'auto' | 'always' | 'never') || 'auto';
  });
  const [touchPadStyle, setTouchPadStyle] = useState<'bottom_pads' | 'full_lanes'>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchPadStyle');
    return (saved as 'bottom_pads' | 'full_lanes') || 'bottom_pads';
  });
  const [touchHaptics, setTouchHaptics] = useState<boolean>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchHaptics');
    return saved !== null ? saved === 'true' : true;
  });
  const [touchOpacity, setTouchOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('rhythm_engine_touchOpacity');
    return saved !== null ? parseFloat(saved) : 0.85;
  });
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false;
  });
  const [vibrationTestActive, setVibrationTestActive] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Hitsounds (Key Press Sound Effects) State
  const [hitsoundsEnabled, setHitsoundsEnabled] = useState<boolean>(() => hitSoundManager.isEnabled());
  const [holdSoundEnabled, setHoldSoundEnabled] = useState<boolean>(() => hitSoundManager.isHoldSoundEnabled());
  const [hitsoundVol, setHitsoundVol] = useState<number>(() => hitSoundManager.getVolume());

  const [savedMessage, setSavedMessage] = useState(false);
  const [activeRebinding, setActiveRebinding] = useState<{ mode: string; index: number } | null>(null);

  const modesScrollRef = useRef<HTMLDivElement>(null);

  const scrollModes = (direction: 'left' | 'right') => {
    if (modesScrollRef.current) {
      modesScrollRef.current.scrollBy({
        left: direction === 'left' ? -250 : 250,
        behavior: 'smooth'
      });
    }
  };

  // Key recording listener
  useEffect(() => {
    if (!activeRebinding) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let newKey = e.key.toLowerCase();
      if (newKey === ' ') newKey = 'space';
      if (newKey === 'escape' && activeRebinding.mode !== 'game_actions') {
        setActiveRebinding(null);
        return;
      }

      // Ignore standard lone modifiers
      if (['shift', 'control', 'alt', 'meta', 'tab', 'capslock'].includes(newKey)) return;

      const { mode, index } = activeRebinding;
      const updated = { ...keyMaps };
      if (!updated[mode]) updated[mode] = [...DEFAULT_KEY_MAPS[mode]];
      updated[mode][index] = newKey;
      setKeyMaps(updated);
      setActiveRebinding(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRebinding, keyMaps]);

  const handleSave = () => {
    try {
      localStorage.setItem('rhythm_engine_keymaps', JSON.stringify(keyMaps));
      localStorage.setItem('rhythm_engine_scrollSpeed', scrollSpeed.toString());
      localStorage.setItem('rhythm_engine_scrollDirection', scrollDirection);
      localStorage.setItem('rhythm_engine_audioOffset', audioOffset.toString());
      localStorage.setItem('rhythm_engine_bgDim', bgDim.toString());
      localStorage.setItem('rhythm_engine_trackOpacity', trackOpacity.toString());
      localStorage.setItem('rhythm_engine_playfieldScale', playfieldScale.toString());
      localStorage.setItem('rhythm_engine_playfieldFillScreen', playfieldFillScreen.toString());
      localStorage.setItem('rhythm_engine_showLaneDividers', showLaneDividers.toString());
      localStorage.setItem('rhythm_engine_coverBackground', coverBackground.toString());
      localStorage.setItem('rhythm_engine_hideGameplayUi', hideGameplayUi.toString());
      localStorage.setItem('rhythm_engine_hideCountdown', hideCountdown.toString());

      // Mobile Touch Storage
      localStorage.setItem('rhythm_engine_touchMode', touchControlsMode);
      localStorage.setItem('rhythm_engine_touchPadStyle', touchPadStyle);
      localStorage.setItem('rhythm_engine_touchHaptics', touchHaptics.toString());
      localStorage.setItem('rhythm_engine_touchOpacity', touchOpacity.toString());
      
      hitSoundManager.setEnabled(hitsoundsEnabled);
      hitSoundManager.setHoldSoundEnabled(holdSoundEnabled);
      hitSoundManager.setVolume(hitsoundVol);

      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2200);
    } catch (err) {
      console.error("Error saving settings:", err);
    }
  };

  const handleResetDefaults = () => {
    if (confirm('Reset all engine settings to default values?')) {
      setKeyMaps(DEFAULT_KEY_MAPS);
      setScrollSpeed(1.0);
      setScrollDirection('down');
      setAudioOffset(0);
      setBgDim(0.0);
      setTrackOpacity(0.0);
      setPlayfieldScale(1.0);
      setPlayfieldFillScreen(false);
      setShowLaneDividers(false);
      setCoverBackground(true);
      setHideGameplayUi(true);
      setHideCountdown(true);

      setTouchControlsMode('auto');
      setTouchPadStyle('bottom_pads');
      setTouchHaptics(true);
      setTouchOpacity(0.85);

      setHitsoundsEnabled(true);
      setHoldSoundEnabled(true);
      setHitsoundVol(0.7);

      localStorage.setItem('rhythm_engine_keymaps', JSON.stringify(DEFAULT_KEY_MAPS));
      localStorage.setItem('rhythm_engine_scrollSpeed', '1.0');
      localStorage.setItem('rhythm_engine_scrollDirection', 'down');
      localStorage.setItem('rhythm_engine_audioOffset', '0');
      localStorage.setItem('rhythm_engine_bgDim', '0.0');
      localStorage.setItem('rhythm_engine_trackOpacity', '0.0');
      localStorage.setItem('rhythm_engine_playfieldScale', '1.0');
      localStorage.setItem('rhythm_engine_playfieldFillScreen', 'false');
      localStorage.setItem('rhythm_engine_showLaneDividers', 'false');
      localStorage.setItem('rhythm_engine_coverBackground', 'true');
      localStorage.setItem('rhythm_engine_hideGameplayUi', 'true');
      localStorage.setItem('rhythm_engine_hideCountdown', 'true');

      localStorage.setItem('rhythm_engine_touchMode', 'auto');
      localStorage.setItem('rhythm_engine_touchPadStyle', 'bottom_pads');
      localStorage.setItem('rhythm_engine_touchHaptics', 'true');
      localStorage.setItem('rhythm_engine_touchOpacity', '0.85');

      hitSoundManager.setEnabled(true);
      hitSoundManager.setHoldSoundEnabled(true);
      hitSoundManager.setVolume(0.7);

      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2200);
    }
  };

  const formatKeyName = (key: string) => {
    if (!key) return '?';
    const lower = key.toLowerCase();
    switch (lower) {
      case 'space': return 'SPACE';
      case 'arrowleft': return '←';
      case 'arrowright': return '→';
      case 'arrowup': return '↑';
      case 'arrowdown': return '↓';
      case 'escape': return 'ESC';
      case 'enter': return 'ENTER';
      case 'backspace': return 'BACK';
      default: return lower.toUpperCase();
    }
  };

  const modeTabs = [
    { id: 'llplus', label: 'Lightners Live +', keysCount: 2 },
    { id: 'fnf', label: "Friday Night Funkin'", keysCount: 4 },
    { id: 'taiko', label: 'osu!taiko', keysCount: 2 },
    { id: 'game_actions', label: 'Actions (Pause)', keysCount: 1 },
    { id: '1', label: 'osu!mania (1K)', keysCount: 1 },
    { id: '2', label: 'osu!mania (2K)', keysCount: 2 },
    { id: '3', label: 'osu!mania (3K)', keysCount: 3 },
    { id: '4', label: 'osu!mania (4K)', keysCount: 4 },
    { id: '5', label: 'osu!mania (5K)', keysCount: 5 },
    { id: '6', label: 'osu!mania (6K)', keysCount: 6 },
    { id: '7', label: 'osu!mania (7K)', keysCount: 7 },
    { id: '8', label: 'osu!mania (8K)', keysCount: 8 },
    { id: '9', label: 'osu!mania (9K)', keysCount: 9 },
  ];

  return (
    <div className="min-h-screen bg-[#071426] text-slate-100 flex flex-col relative overflow-hidden font-sans select-none">
      {/* Top Header Bar */}
      <header className="w-full z-20 border-b border-[#2d4259] bg-[#071426]/95 px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg border border-zinc-800 transition-colors cursor-pointer text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4 text-[#1e5bff]" />
            Back
          </button>
          
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white uppercase flex items-center gap-2.5">
              <Sliders className="w-6 h-6 text-[#1e5bff]" />
              Engine Settings
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-red-300 rounded-lg border border-zinc-800 hover:border-red-500/30 transition-colors text-xs font-bold cursor-pointer"
            title="Reset default values"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 bg-[#ffc20e] hover:bg-[#ffda65] text-[#071426] text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm transition-colors cursor-pointer border border-[#ffc20e]"
          >
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 z-10 space-y-6 pb-24 overflow-y-auto">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 p-1.5 bg-zinc-900/80 border border-zinc-800/90 rounded-2xl backdrop-blur-md">
          {[
            { id: 'controls', label: 'Controls & Keybinds', icon: <Keyboard className="w-4 h-4" /> },
            { id: 'audio', label: 'Audio & Calibration', icon: <Volume2 className="w-4 h-4" /> },
            { id: 'mobile', label: 'Mobile & Touch', icon: <Smartphone className="w-4 h-4" /> },
            { id: 'info', label: 'Shortcuts & Guide', icon: <Info className="w-4 h-4" /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#ffc20e] text-[#071426]'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Saved confirmation toast banner */}
        <AnimatePresence>
          {savedMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center gap-2 text-emerald-300 text-xs font-bold"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Settings saved successfully!</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* TAB 1: CONTROLS & KEYMAPS */}
        {activeTab === 'controls' && (
          <div className="space-y-6">
            {/* Mode selection horizontal chips with scroll controls */}
            <div className="flex items-center gap-2 bg-zinc-950/70 p-2 rounded-2xl border border-zinc-800/80 shadow-md">
              <button
                type="button"
                onClick={() => scrollModes('left')}
                className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl border border-zinc-800 transition-all cursor-pointer shrink-0 active:scale-95 shadow-sm"
                title="Scroll left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div
                ref={modesScrollRef}
                className="flex-1 flex items-center gap-2 overflow-x-auto pb-2.5 pt-1 px-1 custom-scrollbar-x select-none"
              >
                {modeTabs.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedKeyMode(m.id)}
                    className={`px-3.5 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors border cursor-pointer shrink-0 ${
                      selectedKeyMode === m.id
                        ? 'bg-[#f1f3f3] text-[#071426] border-[#f1f3f3]'
                        : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 border-zinc-800 hover:bg-zinc-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => scrollModes('right')}
                className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl border border-zinc-800 transition-all cursor-pointer shrink-0 active:scale-95 shadow-sm"
                title="Scroll right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Active Keybinds Card */}
            {(() => {
              const currentKeys = keyMaps[selectedKeyMode] || DEFAULT_KEY_MAPS[selectedKeyMode] || ['d', 'k'];
              const currentMeta = modeTabs.find(m => m.id === selectedKeyMode);

              return (
                <div className="p-6 sm:p-8 bg-zinc-900/70 border border-zinc-800 rounded-xl shadow-md space-y-6">
                  <div className="flex items-center justify-between flex-wrap gap-4 border-b border-zinc-800/80 pb-4">
                    <div>
                      <h2 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2.5">
                        <Zap className="w-5 h-5 text-[#ffc20e]" />
                        {currentMeta?.label}
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Click any slot and press a key on your keyboard to rebind.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const updated = { ...keyMaps };
                        updated[selectedKeyMode] = [...DEFAULT_KEY_MAPS[selectedKeyMode]];
                        setKeyMaps(updated);
                      }}
                      className="text-xs font-bold text-zinc-400 hover:text-[#ffe9a6] transition-colors cursor-pointer"
                    >
                      Reset this mode only
                    </button>
                  </div>

                  {/* 3D Keycaps Interactive Grid */}
                  <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 py-6">
                    {currentKeys.map((key, i) => {
                      const isListening = activeRebinding?.mode === selectedKeyMode && activeRebinding?.index === i;
                      
                      let label = `Column ${i + 1}`;
                      if (selectedKeyMode === 'game_actions') label = 'Pause';
                      if (selectedKeyMode === 'llplus') label = i === 0 ? 'Left Lane' : 'Right Lane';
                      if (selectedKeyMode === 'taiko') label = i === 0 ? 'Don / Red' : 'Katsu / Blue';
                      if (selectedKeyMode === 'fnf') label = ['Left (←)', 'Down (↓)', 'Up (↑)', 'Right (→)'][i];

                      return (
                        <div key={i} className="flex flex-col items-center gap-2">
                          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                            {label}
                          </span>

                          <button
                            type="button"
                            onClick={() => setActiveRebinding({ mode: selectedKeyMode, index: i })}
                            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer relative shadow-lg ${
                              isListening
                                ? 'bg-[#332d16] text-[#fff0b1] border-2 border-[#ffc20e] ring-1 ring-[#ffc20e]/40'
                                : 'bg-[#061326] hover:bg-[#12263c] border-2 border-[#2d4259] hover:border-[#ffc20e] text-[#c8d2dc] hover:text-white'
                            }`}
                          >
                            <span className="text-xl sm:text-2xl font-mono font-black tracking-wider">
                              {isListening ? '...' : formatKeyName(key)}
                            </span>
                            <span className="text-[9px] text-zinc-400 mt-1 uppercase font-semibold">
                              {isListening ? 'Press key' : 'Click to change'}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {activeRebinding && (
                    <div className="p-3 bg-[#332d16] border border-[#775b14] rounded-sm text-center text-xs font-bold text-[#ffe9a6]">
                      Press any key on your keyboard to assign. Press <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-white">ESC</kbd> to cancel.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 2: AUDIO & CALIBRATION */}
        {activeTab === 'audio' && (
          <div className="space-y-4">
            {/* Group 1: Audio & Sound Effects */}
            <div className="p-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {hitsoundsEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
                  <span className="text-sm font-bold text-white uppercase tracking-wider">Hitsounds & Audio</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => hitSoundManager.playHitSound('4', 0)}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors cursor-pointer"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !hitsoundsEnabled;
                      setHitsoundsEnabled(next);
                      hitSoundManager.setEnabled(next);
                      if (next) hitSoundManager.playHitSound('4', 0);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      hitsoundsEnabled
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    {hitsoundsEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              {hitsoundsEnabled && (
                <div className="space-y-3 pt-3 border-t border-zinc-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Hitsound Volume</span>
                    <strong className="text-emerald-400 font-mono">{Math.round(hitsoundVol * 100)}%</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2.0}
                    step={0.05}
                    value={hitsoundVol}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setHitsoundVol(v);
                      hitSoundManager.setVolume(v);
                      hitSoundManager.playHitSound('4', 0);
                    }}
                    className="w-full accent-emerald-500 cursor-pointer bg-zinc-950 h-1.5 rounded-lg"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-zinc-300 font-medium">Hold Note Sustain Sound</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !holdSoundEnabled;
                        setHoldSoundEnabled(next);
                        hitSoundManager.setHoldSoundEnabled(next);
                        if (next) hitSoundManager.playTestHoldSound();
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        holdSoundEnabled
                          ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                          : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {holdSoundEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Group 2: Calibration & Gameplay */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Audio Offset */}
              <div className="p-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#c8d2dc]" />
                    Audio Offset
                  </span>
                  <span className="text-xs font-mono font-bold text-[#f1f3f3] bg-[#061326] px-2 py-0.5 rounded-sm border border-[#2d4259]">
                    {audioOffset > 0 ? `+${audioOffset}` : audioOffset} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={-200}
                  max={200}
                  step={5}
                  value={audioOffset}
                  onChange={(e) => setAudioOffset(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-500 cursor-pointer bg-zinc-950 h-1.5 rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>-200ms</span>
                  <button onClick={() => setAudioOffset(0)} className="text-[#ffe9a6] hover:underline font-bold">0ms</button>
                  <span>+200ms</span>
                </div>
              </div>

              {/* Scroll Direction */}
              <div className="p-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-3">
                <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#c8d2dc]" />
                  Scroll Direction
                </span>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setScrollDirection('down')}
                    className={`py-2 px-3 rounded-sm font-bold text-xs border transition-colors cursor-pointer ${
                      scrollDirection === 'down'
                        ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    Downscroll
                  </button>
                  <button
                    type="button"
                    onClick={() => setScrollDirection('up')}
                    className={`py-2 px-3 rounded-sm font-bold text-xs border transition-colors cursor-pointer ${
                      scrollDirection === 'up'
                        ? 'bg-[#ffc20e] text-[#071426] border-[#ffc20e]'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    Upscroll
                  </button>
                </div>
              </div>
            </div>

            {/* Group 3: Visual & Display Settings */}
            <div className="p-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-4">
              <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                <Tv className="w-3.5 h-3.5 text-[#c8d2dc]" />
                Visual Display
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Background Dim */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400 font-medium">Background Dim</span>
                    <strong className="text-[#f1f3f3] font-mono">{Math.round(bgDim * 100)}%</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bgDim}
                    onChange={(e) => setBgDim(parseFloat(e.target.value))}
                    className="w-full accent-[#ffc20e] cursor-pointer bg-[#061326] h-1.5 rounded-sm"
                  />
                </div>

                {/* Track Overlay */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400 font-medium">Track Darkness</span>
                    <strong className="text-indigo-300 font-mono">{Math.round(trackOpacity * 100)}%</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={trackOpacity}
                    onChange={(e) => setTrackOpacity(parseFloat(e.target.value))}
                    className="w-full accent-[#ffc20e] cursor-pointer bg-[#061326] h-1.5 rounded-sm"
                  />
                </div>

                {/* Playfield Scale (Lane & Arrow Size) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400 font-medium">Playfield & Arrow Size</span>
                    <strong className="text-indigo-300 font-mono">
                      {isPortrait ? "200% (Vertical Full Width)" : (playfieldFillScreen ? "FULL WIDTH" : `${(playfieldScale * 100).toFixed(0)}%`)}
                    </strong>
                  </div>
                  {isPortrait ? (
                    <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2">
                      <span className="font-bold uppercase tracking-wider">Vertical Mode:</span> Locked at 200% Full-Width direct tap. Rotate device horizontally to customize size with button pads.
                    </div>
                  ) : (
                    <>
                      <input
                        type="range"
                        min={0.5}
                        max={2.5}
                        step={0.05}
                        value={playfieldScale}
                        onChange={(e) => {
                          setPlayfieldScale(parseFloat(e.target.value));
                          if (playfieldFillScreen) setPlayfieldFillScreen(false);
                        }}
                        disabled={playfieldFillScreen}
                        className="w-full accent-indigo-500 cursor-pointer bg-zinc-950 h-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setPlayfieldFillScreen(!playfieldFillScreen)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            playfieldFillScreen 
                              ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50' 
                              : 'bg-zinc-900/50 text-zinc-500 border-zinc-800'
                          }`}
                        >
                          {playfieldFillScreen ? 'Fill Screen (Active)' : 'Fill Screen'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Toggles Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-zinc-800/60">
                <div className="flex items-center justify-between p-2.5 bg-zinc-950/60 rounded-xl border border-zinc-800/60 text-xs">
                  <span className="text-zinc-300 font-medium">Lane Dividers</span>
                  <button
                    type="button"
                    onClick={() => setShowLaneDividers(!showLaneDividers)}
                    className={`px-2.5 py-1 rounded-md font-bold text-[11px] border transition-colors cursor-pointer ${
                      showLaneDividers ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {showLaneDividers ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-zinc-950/60 rounded-xl border border-zinc-800/60 text-xs">
                  <span className="text-zinc-300 font-medium">Background Fit</span>
                  <button
                    type="button"
                    onClick={() => setCoverBackground(!coverBackground)}
                    className={`px-2.5 py-1 rounded-md font-bold text-[11px] border transition-colors cursor-pointer ${
                      coverBackground ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {coverBackground ? 'Cover' : 'Contain'}
                  </button>
                </div>


              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MOBILE & TOUCH SETTINGS */}
        {activeTab === 'mobile' && (
          <div className="space-y-6">
            {/* Main Touch Controls Card */}
            <div className="p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-6">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-indigo-400" />
                  Touchscreen & Mobile Controls
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Configure on-screen touch receptors, lane layouts, and tactile haptic vibration for mobile phones and tablets.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Touch Activation Mode */}
                <div className="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Touchpad className="w-4 h-4 text-indigo-400" />
                      Touch Overlay Mode
                    </span>
                    <span className="text-[11px] font-mono font-bold text-indigo-400 uppercase">
                      {touchControlsMode}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Choose when on-screen touch buttons should be visible during gameplay.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'auto', label: 'Auto (Detect)' },
                      { id: 'always', label: 'Always On' },
                      { id: 'never', label: 'Disabled' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTouchControlsMode(opt.id as any)}
                        className={`py-2 px-2 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                          touchControlsMode === opt.id
                            ? 'bg-amber-500 text-neutral-950 border-amber-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Touch Layout Style */}
                <div className="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-400" />
                      Touch Receptor Style
                    </span>
                    <span className="text-[11px] font-mono font-bold text-indigo-400 uppercase">
                      {touchPadStyle === 'bottom_pads' ? 'Bottom Receptors' : 'Full Screen Lanes'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Style of touch surface on mobile screens.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTouchPadStyle('bottom_pads')}
                      className={`py-2 px-3 rounded-md text-xs font-medium border transition-colors cursor-pointer flex flex-col items-center gap-1 ${
                        touchPadStyle === 'bottom_pads'
                          ? 'bg-amber-500 text-neutral-950 border-amber-400'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <span>Bottom Pads</span>
                      <span className="text-[10px] font-normal opacity-75">Ergonomic Buttons</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTouchPadStyle('full_lanes')}
                      className={`py-2 px-3 rounded-md text-xs font-medium border transition-colors cursor-pointer flex flex-col items-center gap-1 ${
                        touchPadStyle === 'full_lanes'
                          ? 'bg-amber-500 text-neutral-950 border-amber-400'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <span>Full Lanes</span>
                      <span className="text-[10px] font-normal opacity-75">Vertical Columns</span>
                    </button>
                  </div>
                </div>

                {/* Haptic Vibration Feedback */}
                <div className="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Vibrate className="w-4 h-4 text-emerald-400" />
                      Haptic Vibration
                    </span>
                    <button
                      type="button"
                      onClick={() => setTouchHaptics(!touchHaptics)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        touchHaptics
                          ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {touchHaptics ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Vibrates the mobile device slightly upon hitting notes for tactile feedback.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                        try {
                          navigator.vibrate([15, 30, 15]);
                          setVibrationTestActive(true);
                          setTimeout(() => setVibrationTestActive(false), 600);
                        } catch {
                          // Ignore
                        }
                      }
                    }}
                    className={`w-full py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                      vibrationTestActive
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
                    }`}
                  >
                    <Vibrate className="w-3.5 h-3.5" />
                    <span>{vibrationTestActive ? 'Vibrating...' : 'Test Haptic Vibration'}</span>
                  </button>
                </div>

                {/* Touch Button Opacity Slider */}
                <div className="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Tv className="w-4 h-4 text-indigo-400" />
                      Touch Button Opacity
                    </span>
                    <span className="text-xs font-mono font-bold text-indigo-400">
                      {Math.round(touchOpacity * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Adjust transparency of on-screen buttons so you can see background videos.
                  </p>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={touchOpacity}
                    onChange={(e) => setTouchOpacity(parseFloat(e.target.value))}
                    className="w-full accent-[#1e5bff] cursor-pointer"
                  />
                </div>
              </div>

              {/* Mobile Best Practices Info */}
              <div className="p-4 bg-[#12263c] border border-[#1e5bff]/40 rounded-sm space-y-2">
                <h3 className="text-xs font-bold text-[#8ca9ff] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#1e5bff]" />
                  Mobile Gameplay Tips
                </h3>
                <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                  <li><strong>Multi-Touch Supported:</strong> You can tap 2, 3, or 4 lanes at the same time for chords and rapid double taps.</li>
                  <li><strong>Landscape Mode Recommended:</strong> For 5K-9K mania charts, rotating your device gives wider finger columns.</li>
                  <li><strong>Fullscreen:</strong> Tap the Fullscreen icon in the top-left HUD to hide browser address bars for ultra-smooth play.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INFO & SHORTCUTS */}
        {activeTab === 'info' && (
          <div className="p-5 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl backdrop-blur-md space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-400" />
              Keyboard Shortcuts & Tips
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: 'ESC', desc: 'Pause or resume gameplay' },
                { key: 'Space / Click', desc: 'Confirm menu actions' },
                { key: 'F11', desc: 'Toggle Fullscreen mode' },
                { key: '1.0x - 1.5x', desc: 'Optimal scroll speed range' },
              ].map((item, idx) => (
                <div key={idx} className="p-3 bg-zinc-950/60 border border-zinc-800/60 rounded-xl flex items-center gap-3">
                  <div className="px-2.5 py-1 bg-zinc-900 border border-zinc-700 text-indigo-300 font-mono font-bold text-xs rounded-md shadow-sm">
                    {item.key}
                  </div>
                  <span className="text-xs font-medium text-zinc-300">
                    {item.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
