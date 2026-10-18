import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Trash2, 
  Fingerprint, 
  Flame, 
  ArrowRight, 
  ChevronRight, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck,
  TrendingUp, 
  Music,
  Activity,
  Filter
} from 'lucide-react';
import { STYLE_PROFILES } from '../lib/styleProfiles';

interface BetaAnalysisPanelProps {
  critiqueLogs: any[];
  correctionLogs: any[];
  format: 'llplus' | 'mania' | 'taiko' | 'fnf';
  onClear: () => void;
}

export const BetaAnalysisPanel: React.FC<BetaAnalysisPanelProps> = ({
  critiqueLogs,
  correctionLogs,
  format,
  onClear
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'applied' | 'preserved'>('all');

  const currentProfile = STYLE_PROFILES[format] || STYLE_PROFILES.llplus;

  // Merge, deduplicate, and sort critique + correction logs
  const unifiedLogs = useMemo(() => {
    const mergedList: any[] = [];

    // 1. Add all correction logs (Refactor agent events)
    correctionLogs.forEach(log => {
      mergedList.push({
        timeMs: log.timeMs,
        type: 'correction',
        decision: log.decision, // 'applied' or 'preserved'
        originalPattern: log.originalPattern,
        resultPattern: log.decision === 'applied' ? log.alternativePattern : 'Kept Original',
        problem: log.problem,
        reason: log.reason,
        beforeScore: log.beforeScore,
        afterScore: log.afterScore,
        musicality: log.musicalityBefore,
        energy: log.energy || 0,
        rawLog: log
      });
    });

    // 2. Add critique logs if there isn't a correction log at almost the exact same timestamp
    critiqueLogs.forEach(log => {
      const hasOverlap = correctionLogs.some(c => Math.abs(c.timeMs - log.timeMs) < 10);
      if (!hasOverlap) {
        mergedList.push({
          timeMs: log.timeMs,
          type: 'critique',
          decision: log.decision === 'keep' ? 'preserved' : 'review', // map 'keep' to 'preserved', 'review' to 'review' or 'preserved'
          originalPattern: log.patternType,
          resultPattern: 'Kept Original',
          problem: log.decision === 'review' ? 'Potential fatigue or musical mismatch' : undefined,
          reason: log.reason,
          beforeScore: log.musicality,
          afterScore: log.musicality,
          musicality: log.musicality,
          energy: log.energy,
          rawLog: log
        });
      }
    });

    // Sort chronologically
    return mergedList.sort((a, b) => a.timeMs - b.timeMs);
  }, [critiqueLogs, correctionLogs]);

  // Compute stats on unified logs
  const stats = useMemo(() => {
    const totalCount = unifiedLogs.length;
    const appliedCount = unifiedLogs.filter(l => l.decision === 'applied').length;
    const preservedCount = unifiedLogs.filter(l => l.decision === 'preserved' || l.decision === 'keep').length;
    
    // Average score calculation before and after
    let sumBefore = 0;
    let sumAfter = 0;
    let countedItems = 0;

    unifiedLogs.forEach(l => {
      if (l.beforeScore !== undefined && l.afterScore !== undefined) {
        sumBefore += l.beforeScore;
        sumAfter += l.afterScore;
        countedItems++;
      }
    });

    const avgBefore = countedItems > 0 ? Math.round(sumBefore / countedItems) : 75;
    const avgAfter = countedItems > 0 ? Math.round(sumAfter / countedItems) : 85;
    const lift = avgAfter - avgBefore;

    return {
      totalCount,
      appliedCount,
      preservedCount,
      avgBefore,
      avgAfter,
      lift
    };
  }, [unifiedLogs]);

  // Filter and search unified logs
  const filteredLogs = useMemo(() => {
    return unifiedLogs.filter(log => {
      // Filter by type
      if (filterType === 'applied' && log.decision !== 'applied') return false;
      if (filterType === 'preserved' && (log.decision !== 'preserved' && log.decision !== 'keep')) return false;

      // Filter by search term
      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        const matchesOriginal = log.originalPattern?.toLowerCase().includes(term);
        const matchesResult = log.resultPattern?.toLowerCase().includes(term);
        const matchesReason = log.reason?.toLowerCase().includes(term);
        const matchesProblem = log.problem?.toLowerCase().includes(term);
        return matchesOriginal || matchesResult || matchesReason || matchesProblem;
      }

      return true;
    });
  }, [unifiedLogs, filterType, searchTerm]);

  const formatTime = (ms: number) => {
    const totalSecs = ms / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = (totalSecs % 60).toFixed(3);
    return `${mins}:${parseFloat(secs) < 10 ? '0' : ''}${secs}`;
  };

  return (
    <motion.section 
      id="unified-beta-panel"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-5 sm:p-6 rounded-3xl space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">IRIS Analysis Engine</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-xl">
            Unified view of active adjustments, hand-comfort checks, and musical alignments.
          </p>
        </div>
        
        <button
          onClick={onClear}
          className="inline-flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-rose-400 transition-colors glass-card hover:bg-rose-500/10 px-3.5 py-2 rounded-xl cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Analysis
        </button>
      </div>

      {/* Modern High-Contrast Stats Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 glass-card p-4 rounded-2xl relative z-10 overflow-hidden">
        {/* Global Stats Change */}
        <div className="flex items-center justify-between p-2">
          <div>
            <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Playability Score</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-lg font-mono font-bold text-zinc-400">{stats.avgBefore}</span>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-xl font-mono font-black text-emerald-400">{stats.avgAfter}</span>
            </div>
          </div>
          {stats.lift > 0 && (
            <div className="bg-emerald-500/10 px-2.5 py-1 rounded-xl border border-emerald-500/20 text-center shrink-0">
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" />
                +{stats.lift} pts
              </span>
              <span className="block text-[8px] font-bold text-emerald-400 uppercase">Comfort Gain</span>
            </div>
          )}
        </div>

        {/* Total Optimizations Applied */}
        <div className="flex items-center justify-between p-2 border-l border-white/10">
          <div>
            <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Applied Refactors</span>
            <span className="text-2xl font-mono font-black text-indigo-400 mt-1 block">
              {stats.appliedCount}
            </span>
          </div>
          <div className="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
        </div>

        {/* Total Preserved Decisons */}
        <div className="flex items-center justify-between p-2 border-l border-white/10">
          <div>
            <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Kept & Preserved</span>
            <span className="text-2xl font-mono font-black text-fuchsia-400 mt-1 block">
              {stats.preservedCount}
            </span>
          </div>
          <div className="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-fuchsia-400">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Control Filters & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 relative z-10">
        <div className="flex glass-card p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 sm:flex-none text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
              filterType === 'all' 
                ? 'bg-white/15 text-white shadow-sm' 
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            All Logs ({stats.totalCount})
          </button>
          <button
            onClick={() => setFilterType('applied')}
            className={`flex-1 sm:flex-none text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
              filterType === 'applied' 
                ? 'bg-indigo-600 text-white shadow-sm' 
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Optimized ({stats.appliedCount})
          </button>
          <button
            onClick={() => setFilterType('preserved')}
            className={`flex-1 sm:flex-none text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
              filterType === 'preserved' 
                ? 'bg-fuchsia-600 text-white shadow-sm' 
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Kept ({stats.preservedCount})
          </button>
        </div>

        <div className="relative w-full sm:flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
            <Filter className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            placeholder="Search pattern, location or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full glass-input text-xs text-white placeholder-zinc-500 pl-9 pr-4 py-2.5 rounded-xl focus:outline-none font-medium"
          />
        </div>
      </div>

      {/* Unified Timeline Stack */}
      <div className="max-h-80 overflow-y-auto glass-card rounded-2xl divide-y divide-white/5 custom-scrollbar relative z-10">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs">
            No analysis data found matching current criteria.
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredLogs.map((log, index) => {
              const isApplied = log.decision === 'applied';
              const isCritiqueFlag = log.rawLog && log.rawLog.decision === 'review';

              return (
                <div 
                  key={index} 
                  className={`px-4 py-3 hover:bg-white/[0.03] transition-colors flex flex-col gap-2 text-xs ${
                    isApplied 
                      ? 'border-l-2 border-l-indigo-400' 
                      : isCritiqueFlag 
                        ? 'border-l-2 border-l-amber-400'
                        : 'border-l-2 border-l-fuchsia-400'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    {/* Timestamp & Pattern title */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`font-mono px-1.5 py-0.5 rounded text-[11px] font-semibold border ${
                        isApplied 
                          ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/30' 
                          : 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-500/30'
                      }`}>
                        {formatTime(log.timeMs)}
                      </span>
                      
                      {/* Flow change display */}
                      <div className="flex items-center gap-1.5 text-zinc-200 font-bold truncate">
                        <span>{log.originalPattern}</span>
                        {isApplied && (
                          <>
                            <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-indigo-300 font-extrabold">{log.resultPattern}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Stats change or kept indicator */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isApplied ? (
                        <span className="bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-indigo-400" /> Optimized
                        </span>
                      ) : isCritiqueFlag ? (
                        <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-amber-500/20 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" /> Warning
                        </span>
                      ) : (
                        <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" /> Preserved
                        </span>
                      )}

                      {/* Score Diff */}
                      {isApplied ? (
                        <span className="font-mono text-[11px] glass-pill px-2 py-0.5 rounded text-indigo-300 font-bold">
                          {log.beforeScore} ➔ {log.afterScore}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] glass-pill px-2 py-0.5 rounded text-zinc-400">
                          Score: {log.beforeScore}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Reasons & explanations */}
                  <div className="space-y-1 pl-1.5 border-l border-white/10 ml-2">
                    {log.problem && (
                      <p className="text-[11px] text-zinc-400">
                        <strong className="text-zinc-300">Observation: </strong>{log.problem}
                      </p>
                    )}
                    <p className="text-zinc-300 leading-normal text-xs">
                      {log.reason}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
};
