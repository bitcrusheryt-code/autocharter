import React, { useState, useEffect } from 'react';
import { Save, X, Music, Sliders, Layers, Check } from 'lucide-react';

export type TabType = 'charter_llplus' | 'charter_mania' | 'charter_taiko' | 'charter_fnf' | 'game_engine';

interface CreateDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (slotName: string) => Promise<void>;
  defaultName: string;
  activeTab: TabType;
  audioFileName?: string;
  regionsCount: number;
  difficultiesCount: number;
}

export const CreateDraftModal: React.FC<CreateDraftModalProps> = ({
  isOpen,
  onClose,
  onSave,
  defaultName,
  activeTab,
  audioFileName,
  regionsCount,
  difficultiesCount,
}) => {
  const [slotName, setSlotName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSlotName(defaultName || `Draft - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      setIsSaving(false);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = slotName.trim() || 'Manual Draft Slot';
    setIsSaving(true);
    try {
      await onSave(finalName);
      onClose();
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const getTabLabel = (tab: TabType) => {
    switch (tab) {
      case 'charter_llplus': return 'LoveLive+ (9-Key)';
      case 'charter_mania': return 'Osu!Mania (4-7K)';
      case 'charter_fnf': return 'Friday Night Funkin\'';
      case 'charter_taiko': return 'Taiko no Tatsujin';
      default: return 'Standard';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-fadeIn">
      <div className="glass-panel rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 glass-surface">
          <div className="flex items-center gap-3">
            <div className="p-2.5 glass-card rounded-2xl text-amber-400">
              <Save className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-tight">Create Draft Slot</h3>
              <p className="text-xs text-zinc-400">Save your current workspace state to local storage</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white glass-card-interactive rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                Draft Slot Name
              </label>
              <input
                type="text"
                autoFocus
                value={slotName}
                onChange={(e) => setSlotName(e.target.value)}
                placeholder="e.g. My Custom Chart - Draft 1"
                className="glass-input w-full px-4 py-3 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-all font-medium"
              />
            </div>

            {/* Session Summary info */}
            <div className="glass-card p-4 rounded-2xl space-y-2 text-xs">
              <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Session Details to Save</p>
              
              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-2 text-zinc-400">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  Target Mode
                </span>
                <span className="font-semibold text-white">{getTabLabel(activeTab)}</span>
              </div>

              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-2 text-zinc-400">
                  <Music className="w-3.5 h-3.5 text-emerald-400" />
                  Audio Track
                </span>
                <span className="font-semibold text-white truncate max-w-[180px] text-right">
                  {audioFileName || 'No audio loaded'}
                </span>
              </div>

              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-2 text-zinc-400">
                  <Sliders className="w-3.5 h-3.5 text-purple-400" />
                  Configured Regions
                </span>
                <span className="font-semibold text-white">{regionsCount} active</span>
              </div>

              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-2 text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-amber-400" />
                  Difficulties
                </span>
                <span className="font-semibold text-white">{difficultiesCount} selected</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 glass-surface border-t border-white/10 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 glass-card-interactive text-zinc-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-md transition-colors text-sm cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Draft Slot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
