import React from 'react';
import { Sparkles, Edit3, FolderDown, X } from 'lucide-react';

interface ImportChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  onStandardEdit: () => void;
  onMetadataQuickEdit: () => void;
}

export const ImportChoiceModal: React.FC<ImportChoiceModalProps> = ({
  isOpen,
  onClose,
  fileName,
  onStandardEdit,
  onMetadataQuickEdit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-fadeIn">
      <div className="glass-panel rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 glass-surface">
          <div className="flex items-center gap-3">
            <div className="p-2.5 glass-card rounded-2xl text-indigo-400">
              <FolderDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-tight">Imported File</h3>
              <p className="text-xs text-zinc-400 truncate max-w-[280px]">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white glass-card-interactive rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-zinc-300 font-medium">
            Choose how to process the imported file:
          </p>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={onStandardEdit}
              className="flex items-start gap-4 p-4 rounded-2xl glass-card-interactive text-left cursor-pointer group"
            >
              <div className="p-3 glass-surface text-zinc-300 group-hover:text-indigo-400 rounded-xl transition-colors">
                <Edit3 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Standard Editor</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Load chart and media tracks directly into the chart editor.
                </p>
              </div>
            </button>

            <button
              onClick={onMetadataQuickEdit}
              className="flex items-start gap-4 p-4 rounded-2xl glass-card-interactive text-left cursor-pointer group"
            >
              <div className="p-3 glass-surface text-zinc-300 group-hover:text-indigo-400 rounded-xl transition-colors">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white mb-1">
                  Extract Media & Auto-Generate
                </h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Extract audio, video, and cover art to create a new chart.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="px-6 py-4 glass-surface border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 glass-card-interactive text-zinc-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
