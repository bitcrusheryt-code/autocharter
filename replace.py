import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Remove unused states from App component
content = re.sub(
    r"  const \[levelName, setLevelName\] = useState\('CustomLevel'\);\n.*?const \[isWizardOpen, setIsWizardOpen\] = useState\(false\);",
    "  const [songName, setSongName] = useState('');\n  const [artist, setArtist] = useState('');\n  const [isGenerating, setIsGenerating] = useState(false);\n  const [isWizardOpen, setIsWizardOpen] = useState(false);",
    content,
    flags=re.DOTALL
)

# 2. Simplify handlers
content = re.sub(
    r"  const handleTabChange = .*?const runGenerationWithParams =",
    "  const handleTabChange = (tab: 'charter_typo' | 'charter_mania' | 'charter_taiko' | 'converter') => {\n    setActiveTab(tab);\n  };\n\n  const runGenerationWithParams =",
    content,
    flags=re.DOTALL
)

# 3. Replace the main UI starting from "General Settings" down to the end of the charter block
content = re.sub(
    r'          <section className="space-y-6">\n            <div className="flex items-center justify-between">.*?<OsuConverter />',
    '''          <section className="space-y-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              Song Info
            </h2>
            <div className="space-y-4 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Song Title</label>
                  <input 
                    type="text" 
                    value={songName}
                    onChange={(e) => setSongName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow"
                    placeholder="e.g. My Cool Song"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Artist</label>
                  <input 
                    type="text" 
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow"
                    placeholder="e.g. Awesome Artist"
                  />
                </div>
              </div>
            </div>
            
            <div className="pt-6">
              <button
                onClick={() => {
                   if (!audioFile) {
                     alert("Please upload a song first.");
                     return;
                   }
                   if (!songName || !artist) {
                     alert("Please provide the song title and artist.");
                     return;
                   }
                   setIsWizardOpen(true);
                }}
                disabled={isGenerating || !audioFile}
                className="w-full md:w-auto flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium px-8 py-4 rounded-xl transition-colors cursor-pointer"
              >
                <Sparkles className="w-5 h-5" />
                {isGenerating ? 'Auto-Charting...' : `Auto Setup & Generate`}
              </button>
            </div>
          </section>
        </div>
        </>
        ) : (
          <OsuConverter />''',
    content,
    flags=re.DOTALL
)

# 4. Remove handleGenerate completely
content = re.sub(
    r"  const handleGenerate = async \(\) => \{.*?  };\n\n  return \(",
    "  return (",
    content,
    flags=re.DOTALL
)


# 5. Replace QuickSetupWizard with KeyConfigModal
# We'll replace from 'function QuickSetupWizard' to the end of the file, then append FileUpload back.
file_upload_code = re.search(r'(function FileUpload.*?)$', content, flags=re.DOTALL).group(1)

content = re.sub(
    r"function QuickSetupWizard\(\{.*?$",
    '''function KeyConfigModal({
  isOpen,
  onClose,
  runGeneration,
  exportFormat,
  audioFile,
  chartingAudioFile,
  bgFile,
  songName,
  artist
}: {
  isOpen: boolean;
  onClose: () => void;
  runGeneration: (
    audio: File,
    chartingAudio: File | null,
    bg: File | null,
    levelName: string,
    songTitle: string,
    artist: string,
    bpm: number | null,
    offset: number | null,
    diffs: DifficultyConfig[],
    useOnsetDetection: boolean,
    silenceThreshold?: number,
    useSectionIntensity?: boolean,
    exportFormat?: 'typo' | 'mania' | 'taiko'
  ) => Promise<void>;
  exportFormat: 'typo' | 'mania' | 'taiko';
  audioFile: File | null;
  chartingAudioFile: File | null;
  bgFile: File | null;
  songName: string;
  artist: string;
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
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!audioFile) return;

    let diffConfigs: DifficultyConfig[] = [];

    if (keysMode === 'recommended') {
      let keysStr = 'Space, Return';
      if (exportFormat === 'taiko') keysStr = 'Space, Return';
      if (exportFormat === 'mania') keysStr = 'd, f, j, k';
      diffConfigs = [
        { value: 1, keysStr: keysStr },
        { value: 3, keysStr: keysStr },
        { value: 5, keysStr: keysStr },
        { value: 7, keysStr: keysStr },
        { value: 10, keysStr: keysStr }
      ];
    } else if (keysMode === 'custom') {
      if (!customKeys.trim()) {
        alert("Please provide at least 1 allowed key for custom keys.");
        return;
      }
      const keysStr = customKeys;
      diffConfigs = [
        { value: 1, keysStr: keysStr },
        { value: 3, keysStr: keysStr },
        { value: 5, keysStr: keysStr },
        { value: 7, keysStr: keysStr },
        { value: 10, keysStr: keysStr }
      ];
    } else if (keysMode === 'scalable_auto') {
      if (exportFormat === 'taiko') {
        diffConfigs = [
          { value: 1, keysStr: 'Space, Return' },
          { value: 3, keysStr: 'Space, Return' },
          { value: 5, keysStr: 'Space, Return' },
          { value: 7, keysStr: 'Space, Return' },
          { value: 10, keysStr: 'Space, Return' }
        ];
      } else if (exportFormat === 'mania') {
        diffConfigs = [
          { value: 1, keysStr: 'd' },
          { value: 3, keysStr: 'd, k' },
          { value: 5, keysStr: 'd, j, k' },
          { value: 7, keysStr: 'd, f, j, k' },
          { value: 10, keysStr: 's, d, f, j, k, l' }
        ];
      } else {
        diffConfigs = [
          { value: 1, keysStr: 'Space' },
          { value: 3, keysStr: 'Space' },
          { value: 5, keysStr: 'Space, Return' },
          { value: 7, keysStr: 's, Space, l' },
          { value: 10, keysStr: 'a, s, k, l' }
        ];
      }
    } else if (keysMode === 'scalable_custom') {
      diffConfigs = [
        { value: 1, keysStr: scalableKeys.min || 'Space' },
        { value: 3, keysStr: scalableKeys.easy || 'Space' },
        { value: 5, keysStr: scalableKeys.medium || 'Space, Return' },
        { value: 7, keysStr: scalableKeys.hard || 's, Space, l' },
        { value: 10, keysStr: scalableKeys.max || 'a, s, k, l' }
      ];
    }
    
    setIsProcessing(true);
    
    try {
      const levelFolder = songName.trim() || 'QuickLevel';

      await runGeneration(
        audioFile,
        chartingAudioFile,
        bgFile,
        levelFolder,
        songName,
        artist,
        null, 
        null,
        diffConfigs,
        true, // useOnsetDetection
        0.035, // silenceThreshold
        true, // useSectionIntensity
        exportFormat
      );

      onClose();
    } catch (e) {
      console.error(e);
      alert("An error occurred during generation.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/50">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-400" />
              Key Configuration
            </h2>
          </div>
          <button 
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 flex flex-col min-h-[300px]">
          <div className="flex-1 space-y-4">
            <div className="space-y-4 pt-2">
              {exportFormat === 'typo' && (
                <>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Allowed Keys Configuration</label>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setKeysMode('recommended')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        keysMode === 'recommended' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                      }`}
                    >
                      Default (Space, Return)
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeysMode('custom')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        keysMode === 'custom' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                      }`}
                    >
                      Fixed Custom
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeysMode('scalable_auto')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        keysMode === 'scalable_auto' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                      }`}
                    >
                      Escalable Auto
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeysMode('scalable_custom')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        keysMode === 'scalable_custom' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                      }`}
                    >
                      Escalable Custom
                    </button>
                  </div>
                  
                  {keysMode === 'recommended' && (
                    <div className="text-xs text-zinc-400 flex items-center gap-2 px-3 py-2.5 bg-zinc-950 rounded-lg border border-zinc-800">
                      All difficulties will use: <kbd className="px-2 py-0.5 bg-zinc-800 rounded text-zinc-300 font-mono text-xs">Space</kbd> <kbd className="px-2 py-0.5 bg-zinc-800 rounded text-zinc-300 font-mono text-xs">Return</kbd>
                    </div>
                  )}

                  {keysMode === 'custom' && (
                    <input 
                      type="text" 
                      value={customKeys}
                      onChange={(e) => setCustomKeys(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-shadow text-xs"
                      placeholder="e.g. a, b, Space, Return"
                    />
                  )}

                  {keysMode === 'scalable_auto' && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-xs">
                      <div className="text-zinc-400 font-medium mb-1">Automatic difficulty progression:</div>
                      <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Min (1):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">Space</code></div>
                      <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Easy (3):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">Space</code></div>
                      <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Medium (5):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">Space, Return</code></div>
                      <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Hard (7):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">s, Space, l</code></div>
                      <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Max (10):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">a, s, k, l</code></div>
                    </div>
                  )}

                  {keysMode === 'scalable_custom' && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
                      <div className="text-zinc-400 font-medium">Custom keys per difficulty level:</div>
                      <div className="grid grid-cols-1 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-20 text-zinc-500 font-medium">Min (1):</span>
                          <input 
                            type="text" 
                            value={scalableKeys.min} 
                            onChange={(e) => setScalableKeys({...scalableKeys, min: e.target.value})}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none"
                            placeholder="e.g. Space"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-20 text-zinc-500 font-medium">Easy (3):</span>
                          <input 
                            type="text" 
                            value={scalableKeys.easy} 
                            onChange={(e) => setScalableKeys({...scalableKeys, easy: e.target.value})}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none"
                            placeholder="e.g. Space"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-20 text-zinc-500 font-medium">Medium (5):</span>
                          <input 
                            type="text" 
                            value={scalableKeys.medium} 
                            onChange={(e) => setScalableKeys({...scalableKeys, medium: e.target.value})}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none"
                            placeholder="e.g. Space, Return"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-20 text-zinc-500 font-medium">Hard (7):</span>
                          <input 
                            type="text" 
                            value={scalableKeys.hard} 
                            onChange={(e) => setScalableKeys({...scalableKeys, hard: e.target.value})}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none"
                            placeholder="e.g. s, Space, l"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-20 text-zinc-500 font-medium">Max (10):</span>
                          <input 
                            type="text" 
                            value={scalableKeys.max} 
                            onChange={(e) => setScalableKeys({...scalableKeys, max: e.target.value})}
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none"
                            placeholder="e.g. a, s, k, l"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {exportFormat === 'mania' && (
                <>
                   <label className="block text-sm font-medium text-zinc-400 mb-2">Key Count Configuration</label>
                   <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setKeysMode('recommended')}
                        className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          keysMode === 'recommended' || keysMode === 'custom'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                        }`}
                      >
                        Fixed Key Count
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeysMode('scalable_auto')}
                        className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          keysMode === 'scalable_auto' || keysMode === 'scalable_custom'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-zinc-800/30 text-zinc-400 border border-transparent hover:bg-zinc-800/50'
                        }`}
                      >
                        Escalable Auto
                      </button>
                   </div>
                   
                   {(keysMode === 'recommended' || keysMode === 'custom') && (
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-950 rounded-lg border border-zinc-800 text-xs">
                        <span className="text-zinc-500 font-medium">All difficulties will use:</span>
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
                        <div className="text-zinc-400 font-medium mb-1">Automatic difficulty progression:</div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Min (1):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">1K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Easy (3):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">2K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Medium (5):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">3K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Hard (7):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">4K</code></div>
                        <div className="flex justify-between items-center text-zinc-300"><span className="text-zinc-500 font-medium">Max (10):</span> <code className="bg-zinc-800 px-2 py-0.5 rounded text-emerald-400 font-mono">6K</code></div>
                      </div>
                   )}
                </>
              )}

              {exportFormat === 'taiko' && (
                <>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Note Mapping Configuration</label>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400">
                    Keys are automatically mapped to <strong>Don</strong> and <strong>Kat</strong> hit sounds for all generated difficulties.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="pt-6 mt-auto border-t border-zinc-800/50 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium px-6 py-2.5 rounded-xl transition-colors cursor-pointer"
            >
              {isProcessing ? 'Processing & Generating...' : 'Auto-Generate ZIP'}
            </button>
          </div>
          
          <p className="text-center text-xs text-zinc-500 mt-3">
            This will automatically detect BPM, configure 5 difficulties, and generate the package.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

''' + file_upload_code,
    content,
    flags=re.DOTALL
)

# And fix the reference to QuickSetupWizard in the App return block
content = content.replace(
    '''      <QuickSetupWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        runGeneration={runGenerationWithParams}
        exportFormat={activeTab === 'charter_typo' ? 'typo' : (activeTab === 'charter_mania' ? 'mania' : 'taiko')}
      />''',
    '''      <KeyConfigModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        runGeneration={runGenerationWithParams}
        exportFormat={activeTab === 'charter_typo' ? 'typo' : (activeTab === 'charter_mania' ? 'mania' : 'taiko')}
        audioFile={audioFile}
        chartingAudioFile={chartingAudioFile}
        bgFile={bgFile}
        songName={songName}
        artist={artist}
      />'''
)


with open('src/App.tsx', 'w') as f:
    f.write(content)

