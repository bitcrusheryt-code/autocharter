export interface ScoreRecord {
  levelTitle: string;
  difficultyName: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  rank: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'AUTO';
  perfect: number;
  great: number;
  bad: number;
  miss: number;
  timestamp: number;
  mods?: string[];
}

const STORAGE_KEY = 'iris_rhythm_game_scores';

function getStorageMap(): Record<string, ScoreRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function generateScoreKey(levelIdentifier: string, diffIdentifier: string | number): string {
  const cleanLevel = levelIdentifier.toLowerCase().trim();
  const cleanDiff = String(diffIdentifier).toLowerCase().trim();
  return `${cleanLevel}:::${cleanDiff}`;
}

export function saveScoreRecord(
  levelIdentifier: string,
  diffIdentifier: string | number,
  record: ScoreRecord
): { isNewHighScore: boolean; previousRecord: ScoreRecord | null } {
  const map = getStorageMap();
  const key = generateScoreKey(levelIdentifier, diffIdentifier);
  const existing = map[key] || null;

  let isNewHighScore = false;
  if (!existing || record.score > existing.score) {
    map[key] = record;
    isNewHighScore = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      console.error('Failed to save score in localStorage', e);
    }
  }

  return { isNewHighScore, previousRecord: existing };
}

export function getScoreRecord(levelIdentifier: string, diffIdentifier: string | number): ScoreRecord | null {
  const map = getStorageMap();
  const key = generateScoreKey(levelIdentifier, diffIdentifier);
  return map[key] || null;
}

export function calculateRank(accuracy: number, missCount: number, perfectRatio: number): 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 99.5 && missCount === 0 && perfectRatio >= 0.95) return 'SS';
  if (accuracy >= 95) return 'S';
  if (accuracy >= 88) return 'A';
  if (accuracy >= 78) return 'B';
  if (accuracy >= 65) return 'C';
  return 'D';
}

export function getRankColor(rank: string): string {
  switch (rank) {
    case 'AUTO':
      return 'text-purple-300 bg-purple-500/20 border-purple-400/40 shadow-[0_0_12px_rgba(192,132,252,0.5)]';
    case 'F':
      return 'text-red-400 bg-red-500/20 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.5)]';
    case 'SS':
      return 'text-amber-300 bg-amber-400/20 border-amber-300/40 shadow-[0_0_12px_rgba(251,191,36,0.5)]';
    case 'S':
      return 'text-yellow-400 bg-yellow-400/20 border-yellow-400/40 shadow-[0_0_10px_rgba(250,204,21,0.4)]';
    case 'A':
      return 'text-emerald-400 bg-emerald-400/20 border-emerald-400/40';
    case 'B':
      return 'text-blue-400 bg-blue-400/20 border-blue-400/40';
    case 'C':
      return 'text-purple-400 bg-purple-400/20 border-purple-400/40';
    case 'D':
    default:
      return 'text-zinc-400 bg-zinc-700/30 border-zinc-600/30';
  }
}
