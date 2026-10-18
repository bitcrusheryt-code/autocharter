import JSZip from 'jszip';
import { ChartNote, DifficultyOption, ParsedChart } from './chartParser';
export type { ChartNote, DifficultyOption, ParsedChart };
import { AudioRegion } from '../components/AudioRegionEditorModal';
import { exportFile, shareFile, canShareFile } from './fileExport';

export interface IricDifficultyManifest {
  id: string;
  name: string;
  file: string;
  noteCount: number;
  keyCount: number;
  mode: 'mania' | 'taiko' | 'fnf' | 'llplus';
  bpm: number;
  scrollSpeed?: number;
  svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
}

export interface IricManifest {
  format: 'IRIC_CONTAINER_V1';
  version: '1.0';
  generator: string;
  createdAt: string;
  song: {
    title: string;
    artist: string;
    charter: string;
    bpm: number;
    offsetMs: number;
    mode: 'mania' | 'taiko' | 'fnf' | 'llplus';
    audioFilename: string;
    videoFilename?: string;
    coverFilename?: string;
    scrollSpeed?: number;
    svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
  };
  autocharterConfig?: Record<string, any>;
  audioRegions: AudioRegion[];
  difficulties: IricDifficultyManifest[];
}

export interface ParsedIricPackage extends ParsedChart {
  audioRegions?: AudioRegion[];
  videoBlob?: Blob;
  videoUrl?: string;
  scrollSpeed?: number;
  svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
  autocharterConfig?: Record<string, any>;
  isIricPackage: true;
}

/**
  * Export the current session, audio, video, difficulties, SV changes, and audio regions as an official .iric package
  */
export async function createIricPackageBlob(params: {
  songName: string;
  artist: string;
  charter: string;
  bpm: number;
  offsetMs?: number;
  mode?: 'mania' | 'taiko' | 'fnf' | 'llplus';
  scrollSpeed?: number;
  svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
  audioFile: File | Blob | null;
  videoFile?: File | Blob | null;
  coverBlob?: Blob | File;
  audioRegions?: AudioRegion[];
  autocharterConfig?: Record<string, any>;
  notes?: ChartNote[];
  difficulties?: Array<{
    name: string;
    notes: ChartNote[];
    keyCount: number;
    mode: 'mania' | 'taiko' | 'fnf' | 'llplus';
    bpm: number;
    scrollSpeed?: number;
    svChanges?: Array<{ timeMs: number; sv: number; bpm?: number }>;
  }>;
  useShare?: boolean;
}): Promise<Blob> {
  const zip = new JSZip();

  const title = params.songName.trim() || 'Untitled Song';
  const artist = params.artist.trim() || 'Unknown Artist';
  const charter = params.charter.trim() || 'Iris Auto-Charter';
  const bpm = params.bpm || 120;
  const offsetMs = params.offsetMs || 0;
  const mainMode = params.mode || 'mania';

  let audioFilename = 'audio.mp3';
  if (params.audioFile && 'name' in params.audioFile && params.audioFile.name) {
    audioFilename = params.audioFile.name;
  } else if (params.audioFile?.type?.includes('ogg')) {
    audioFilename = 'audio.ogg';
  } else if (params.audioFile?.type?.includes('wav')) {
    audioFilename = 'audio.wav';
  }

  // 1. Add Audio file if available
  if (params.audioFile) {
    zip.file(audioFilename, params.audioFile);
  }

  // 2. Add Video file if available
  let videoFilename: string | undefined = undefined;
  if (params.videoFile) {
    videoFilename = 'video.mp4';
    if ('name' in params.videoFile && params.videoFile.name) {
      videoFilename = params.videoFile.name;
    } else if (params.videoFile.type?.includes('webm')) {
      videoFilename = 'video.webm';
    }
    zip.file(videoFilename, params.videoFile);
  }

  // 3. Add Cover image if available
  let coverFilename: string | undefined = undefined;
  if (params.coverBlob) {
    coverFilename = 'cover.png';
    if ('name' in params.coverBlob && params.coverBlob.name.toLowerCase().endsWith('.jpg')) {
      coverFilename = 'cover.jpg';
    }
    zip.file(coverFilename, params.coverBlob);
  }

  // 4. Prepare difficulties
  let diffsToExport = params.difficulties || [];
  if (diffsToExport.length === 0 && params.notes && params.notes.length > 0) {
    diffsToExport = [{
      name: 'Normal',
      notes: params.notes,
      keyCount: mainMode === 'taiko' ? 2 : (mainMode === 'llplus' ? 2 : 4),
      mode: mainMode,
      bpm,
      scrollSpeed: params.scrollSpeed,
      svChanges: params.svChanges
    }];
  }

  const manifestDifficulties: IricDifficultyManifest[] = [];

  // 5. Save chart files
  diffsToExport.forEach((diff, idx) => {
    const diffFileName = `charts/chart_${idx + 1}_${diff.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    const chartContent = JSON.stringify({
      title,
      artist,
      charter,
      difficultyName: diff.name,
      bpm: diff.bpm || bpm,
      mode: diff.mode || mainMode,
      keyCount: diff.keyCount,
      scrollSpeed: diff.scrollSpeed || params.scrollSpeed || 1.0,
      svChanges: diff.svChanges || params.svChanges || [],
      notes: diff.notes || []
    }, null, 2);

    zip.file(diffFileName, chartContent);

    manifestDifficulties.push({
      id: `diff-${idx + 1}`,
      name: diff.name,
      file: diffFileName,
      noteCount: diff.notes?.length || 0,
      keyCount: diff.keyCount,
      mode: diff.mode || mainMode,
      bpm: diff.bpm || bpm,
      scrollSpeed: diff.scrollSpeed || params.scrollSpeed,
      svChanges: diff.svChanges || params.svChanges || []
    });
  });

  // 6. Generate Manifest JSON
  const manifest: IricManifest = {
    format: 'IRIC_CONTAINER_V1',
    version: '1.0',
    generator: 'Iris Rhythm Auto-Charter & Engine',
    createdAt: new Date().toISOString(),
    song: {
      title,
      artist,
      charter,
      bpm,
      offsetMs,
      mode: mainMode,
      audioFilename,
      videoFilename,
      coverFilename,
      scrollSpeed: params.scrollSpeed || 1.0,
      svChanges: params.svChanges || []
    },
    autocharterConfig: params.autocharterConfig,
    audioRegions: params.audioRegions || [],
    difficulties: manifestDifficulties
  };

  zip.file('iric_manifest.json', JSON.stringify(manifest, null, 2));

  // 7. Generate ZIP Blob
  const iricBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return iricBlob;
}

export async function exportIricPackage(params: Parameters<typeof createIricPackageBlob>[0]): Promise<boolean> {
  const iricBlob = await createIricPackageBlob(params);
  const title = params.songName.trim() || 'Untitled Song';
  const sanitizedTitle = title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'chart';
  const fullFileName = `${sanitizedTitle}.iric`;

  if (params.useShare && canShareFile(fullFileName, iricBlob)) {
    const shared = await shareFile(iricBlob, fullFileName, title);
    if (shared) return true;
  }

  await exportFile(iricBlob, fullFileName);
  return true;
}

/**
  * Parse a .iric package file and extract all contents
  */
export async function parseIricPackage(file: File | Blob, fileName?: string, targetDifficulty?: number | string): Promise<ParsedChart> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  const manifestEntry = loadedZip.files['iric_manifest.json'] || loadedZip.files['manifest.json'] || loadedZip.files['meta.json'];

  let manifest: IricManifest | null = null;
  if (manifestEntry) {
    try {
      const manifestText = await manifestEntry.async('text');
      manifest = JSON.parse(manifestText);
    } catch (e) {
      console.warn('Could not parse iric_manifest.json inside .iric package:', e);
    }
  }

  let audioBlob: Blob | undefined;
  let audioUrl: string | undefined;
  let videoBlob: Blob | undefined;
  let videoUrl: string | undefined;
  let bgBlob: Blob | undefined;
  let bgUrl: string | undefined;

  let extractedTitle = manifest?.song?.title || '';
  let extractedArtist = manifest?.song?.artist || '';
  let extractedCharter = manifest?.song?.charter || '';
  let extractedBpm = manifest?.song?.bpm || 120;
  let extractedOffsetMs = manifest?.song?.offsetMs || 0;
  let extractedMode: 'mania' | 'taiko' | 'fnf' | 'llplus' = manifest?.song?.mode || 'mania';

  const audioRegions: AudioRegion[] = manifest?.audioRegions || [];
  const diffs: DifficultyOption[] = [];

  // Extract Audio, Video & Cover
  for (const rel in loadedZip.files) {
    const entry = loadedZip.files[rel];
    if (entry.dir) continue;
    const lower = rel.toLowerCase();

    if (manifest?.song?.audioFilename && lower.endsWith(manifest.song.audioFilename.toLowerCase())) {
      audioBlob = await entry.async('blob');
    } else if (!audioBlob && (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg'))) {
      audioBlob = await entry.async('blob');
    }

    if (manifest?.song?.videoFilename && lower.endsWith(manifest.song.videoFilename.toLowerCase())) {
      videoBlob = await entry.async('blob');
    } else if (!videoBlob && (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mkv'))) {
      videoBlob = await entry.async('blob');
    }

    const coverFilename = manifest?.song?.coverFilename?.toLowerCase();
    const isManifestCover = coverFilename && (lower === coverFilename || lower.endsWith(`/${coverFilename}`));
    const isImage = lower.endsWith('.jpg') || lower.endsWith('.png') || lower.endsWith('.jpeg');
    if (isManifestCover || (!coverFilename && !bgBlob && (lower.includes('cover') || isImage))) {
      bgBlob = await entry.async('blob');
    }
  }

  if (audioBlob) {
    audioUrl = URL.createObjectURL(audioBlob);
  }
  if (videoBlob) {
    videoUrl = URL.createObjectURL(videoBlob);
  }
  if (bgBlob) {
    bgUrl = URL.createObjectURL(bgBlob);
  }

  // Parse Difficulties from Manifest or chart JSONs
  if (manifest?.difficulties && Array.isArray(manifest.difficulties)) {
    for (const diffManifest of manifest.difficulties) {
      const chartEntry = loadedZip.files[diffManifest.file] || loadedZip.files[diffManifest.file.replace(/^charts\//, '')];
      if (chartEntry) {
        try {
          const chartText = await chartEntry.async('text');
          const chartData = JSON.parse(chartText);
          diffs.push({
            name: diffManifest.name || chartData.difficultyName || 'Normal',
            notes: chartData.notes || [],
            keyCount: diffManifest.keyCount || chartData.keyCount || 4,
            mode: diffManifest.mode || chartData.mode || extractedMode,
            bpm: chartData.bpm || diffManifest.bpm || extractedBpm,
            scrollSpeed: chartData.scrollSpeed ?? diffManifest.scrollSpeed ?? manifest?.song?.scrollSpeed,
            svChanges: chartData.svChanges || diffManifest.svChanges || manifest?.song?.svChanges || []
          });
        } catch (e) {
          console.error('Failed to parse chart file in .iric package:', diffManifest.file, e);
        }
      }
    }
  }

  // Fallback: search for any .json files in charts/ or root if manifest was missing or empty
  if (diffs.length === 0) {
    for (const rel in loadedZip.files) {
      const entry = loadedZip.files[rel];
      if (entry.dir || rel.endsWith('.json')) {
        const lower = rel.toLowerCase();
        if (lower.includes('manifest') || lower.includes('package') || lower.includes('metadata')) continue;

        try {
          const chartText = await entry.async('text');
          const chartData = JSON.parse(chartText);
          if (Array.isArray(chartData.notes)) {
            diffs.push({
              name: chartData.difficultyName || chartData.name || rel.split('/').pop()?.replace(/\.json$/i, '') || 'Normal',
              notes: chartData.notes,
              keyCount: chartData.keyCount || 4,
              mode: chartData.mode || extractedMode,
              bpm: chartData.bpm || extractedBpm,
              scrollSpeed: chartData.scrollSpeed,
              svChanges: chartData.svChanges || []
            });
          }
        } catch {
          // ignore invalid json
        }
      }
    }
  }

  let selectedDiffIndex = 0;
  if (diffs.length > 0 && typeof targetDifficulty === 'number' && Number.isFinite(targetDifficulty)) {
    selectedDiffIndex = Math.max(0, Math.min(diffs.length - 1, Math.floor(targetDifficulty)));
  } else if (diffs.length > 0 && typeof targetDifficulty === 'string' && targetDifficulty.trim()) {
    const byName = diffs.findIndex(diff => diff.name.toLowerCase() === targetDifficulty.trim().toLowerCase());
    const parsedIndex = Number.parseInt(targetDifficulty, 10);
    if (byName >= 0) selectedDiffIndex = byName;
    else if (Number.isFinite(parsedIndex)) selectedDiffIndex = Math.max(0, Math.min(diffs.length - 1, parsedIndex));
  }

  const selectedDiff = diffs[selectedDiffIndex] || {
    name: 'Normal',
    notes: [],
    keyCount: 4,
    mode: extractedMode,
    bpm: extractedBpm,
    scrollSpeed: manifest?.song?.scrollSpeed || 1.0,
    svChanges: manifest?.song?.svChanges || []
  };

  const rawName = fileName || (file instanceof File ? file.name : 'chart.iric');

  return {
    title: extractedTitle || rawName.replace(/\.iric$/i, ''),
    artist: extractedArtist || 'Unknown Artist',
    charter: extractedCharter || 'Iris Charter',
    bpm: selectedDiff.bpm || extractedBpm,
    offsetMs: extractedOffsetMs,
    keyCount: selectedDiff.keyCount,
    mode: selectedDiff.mode,
    notes: selectedDiff.notes,
    difficulties: diffs,
    activeDifficultyIndex: selectedDiffIndex,
    audioBlob,
    audioUrl,
    videoBlob,
    videoUrl,
    bgBlob,
    bgUrl,
    audioRegions,
    scrollSpeed: selectedDiff.scrollSpeed || manifest?.song?.scrollSpeed || 1.0,
    svChanges: selectedDiff.svChanges || manifest?.song?.svChanges || [],
    autocharterConfig: manifest?.autocharterConfig,
    isIricPackage: true
  };
}
