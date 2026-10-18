import React, { useState, useEffect } from 'react';
import { ArrowRight, Play, RefreshCw, Settings, Music2, Maximize2, Minimize2 } from 'lucide-react';

interface MainMenuProps {
  onSelectAutocharter: () => void;
  onSelectConverter: () => void;
  onSelectPlay: () => void;
  onSelectSettings: () => void;
}

export default function MainMenu({
  onSelectAutocharter,
  onSelectConverter,
  onSelectPlay,
  onSelectSettings
}: MainMenuProps) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    return typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false;
  });

  useEffect(() => {
    const handleFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="min-h-screen bg-[#071426] text-[#f1f3f3] flex flex-col px-5 py-5 sm:px-8 sm:py-7 md:px-12">
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between gap-4 border-b border-[#2d4259] pb-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 flex items-center justify-center bg-[#ffc20e] text-[#071426] rounded-sm">
            <Music2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight leading-none">IRIS</h1>
            <p className="text-xs text-[#aebdca] mt-1">Autocharter</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-6 text-sm text-[#aebdca]">
          <span className="text-white border-b-2 border-[#f1f3f3] pb-[21px] -mb-[22px]">Create</span>
          <button type="button" onClick={onSelectConverter} className="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Convert</button>
          <button type="button" onClick={onSelectPlay} className="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]">Play</button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-2 px-3 py-2 border border-[#3b536c] rounded-sm text-xs text-[#c8d2dc] hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]"
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span className="hidden md:inline">{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
          </button>
          <button
            type="button"
            onClick={onSelectSettings}
            className="inline-flex items-center gap-2 px-3 py-2 border border-[#3b536c] rounded-sm text-xs text-[#c8d2dc] hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden md:inline">Settings</span>
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto mt-8 mb-auto py-6 sm:py-14 md:my-auto md:mt-0 md:mb-0">
        <div className="mb-7 sm:mb-9">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Autocharter</h2>
          <p className="text-sm sm:text-base text-[#aebdca] mt-3 max-w-xl">Turn a song into a playable chart. Choose a game format, set the difficulty, and generate.</p>
        </div>

        <button
          type="button"
          onClick={onSelectAutocharter}
          className="w-full group text-left p-5 sm:p-7 mb-5 bg-[#0c1b2e] border border-[#435c75] rounded-sm hover:border-[#ffc20e] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-[#12263c] text-[#c4cedb] border border-[#2d4259] rounded-sm shrink-0">
                <Music2 className="w-5 h-5" />
              </div>
              <div>
                <span className="font-display block text-lg sm:text-xl font-semibold">Auto-Charter</span>
                <span className="block text-sm text-[#aebdca] mt-0.5">Start with an audio file</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#ffc20e] text-[#071426] rounded-sm text-sm font-semibold group-hover:bg-[#ffda65]">
              Open chart editor <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 border-t border-[#2d4259] pt-4 text-xs uppercase tracking-[0.12em]">
            <span className="text-[#c8d2dc]">01 Audio</span><span className="h-px flex-1 bg-[#3b536c]" />
            <span className="text-[#c8d2dc]">02 Format</span><span className="h-px flex-1 bg-[#3b536c]" />
            <span className="text-[#ffc20e]">03 Chart</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-4 text-xs sm:text-sm">
            <span className="text-[#c8d2dc]">Formats</span>
            <span className="text-[#e21d2d]">FNF</span>
            <span className="text-[#aebdca]">·</span>
            <span className="text-[#1e5bff]">Lightners Live+</span>
            <span className="text-[#aebdca]">·</span>
            <span className="text-[#ffc20e]">osu!mania</span>
            <span className="text-[#aebdca]">·</span>
            <span className="text-[#22b14c]">Taiko</span>
          </div>
        </button>

        <div className="border-y border-[#2d4259] divide-y divide-[#2d4259]">
          <button
            type="button"
            onClick={onSelectConverter}
            className="w-full group flex items-center justify-between gap-4 py-4 text-left hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]"
          >
            <span className="flex items-center gap-3 min-w-0">
              <RefreshCw className="w-4 h-4 text-[#1e5bff] shrink-0" />
              <span>
                <span className="block text-sm font-medium">Universal Converter</span>
                <span className="block text-xs text-[#aebdca] mt-0.5">Convert an existing chart between supported formats.</span>
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-[#aebdca] group-hover:text-[#ffc20e] group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          <button
            type="button"
            onClick={onSelectPlay}
            className="w-full group flex items-center justify-between gap-4 py-4 text-left hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc20e]"
          >
            <span className="flex items-center gap-3 min-w-0">
              <Play className="w-4 h-4 text-[#22b14c] shrink-0" />
              <span>
                <span className="block text-sm font-medium">Play charts</span>
                <span className="block text-xs text-[#aebdca] mt-0.5">Open your library or test a chart in Test Zone.</span>
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-[#aebdca] group-hover:text-[#ffc20e] group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </main>
    </div>
  );
}
