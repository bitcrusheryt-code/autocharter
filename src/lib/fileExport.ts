/**
 * Safe File Export utility for Desktop and Mobile (Android, iOS Safari, etc.)
 * Prevents mobile browsers (like Android Chrome / Samsung Browser) from automatically
 * appending '.txt' to custom rhythm game extensions (such as .osz, .zip, .json, .osu, .llmap).
 */

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

export function getMimeTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.osz') || lower.endsWith('.zip') || lower.endsWith('.llmap.zip') || lower.endsWith('.llmap') || lower.endsWith('.iric') || lower.endsWith('.tar')) {
    // CRITICAL FOR ANDROID / MOBILE:
    // When a file is downloaded with an unknown MIME (e.g. application/x-osu-pack or empty),
    // Android's Download Manager inspects the payload, thinks it is text or unknown binary,
    // and automatically renames 'song.osz' -> 'song.osz.txt'.
    // Providing 'application/zip' tells Android and iOS this is an archive, preserving the exact extension.
    return 'application/zip';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  if (lower.endsWith('.osu')) {
    return 'application/octet-stream';
  }
  if (lower.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (lower.endsWith('.ogg')) {
    return 'audio/ogg';
  }
  if (lower.endsWith('.wav')) {
    return 'audio/wav';
  }
  return 'application/octet-stream';
}

/**
 * Normalizes and exports a blob as a file download safely on both Desktop and Mobile devices.
 */
export async function exportFile(rawBlob: Blob, rawFilename: string): Promise<void> {
  const filename = sanitizeFilename(rawFilename);
  const correctMime = getMimeTypeForFilename(filename);

  // Ensure the blob carries the explicit correct archive/binary MIME type
  let blobToDownload = rawBlob;
  if (!rawBlob.type || rawBlob.type !== correctMime) {
    blobToDownload = new Blob([rawBlob], { type: correctMime });
  }

  const objectUrl = URL.createObjectURL(blobToDownload);

  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Keep the object URL alive long enough for mobile download managers to stream the blob
    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(objectUrl);
    }, 3000);
  } catch (err) {
    console.error('File export trigger error:', err);
    // Fallback: navigation trigger
    window.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
  }
}

/**
 * Checks if the Web Share API is available with File sharing support (common in Android / iOS mobile).
 */
export function canShareFile(filename: string, blob: Blob): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return false;
  }
  try {
    const mime = getMimeTypeForFilename(filename);
    const file = new File([blob], filename, { type: mime });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Shares a file directly to apps (e.g., osu! mobile, Files app, messaging) via native mobile share sheet.
 */
export async function shareFile(rawBlob: Blob, rawFilename: string, title?: string): Promise<boolean> {
  const filename = sanitizeFilename(rawFilename);
  const correctMime = getMimeTypeForFilename(filename);
  
  try {
    const file = new File([rawBlob], filename, { type: correctMime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: title || filename,
        text: `Exported chart: ${filename}`,
        files: [file]
      });
      return true;
    }
  } catch (err: any) {
    // User cancelled share or aborted
    if (err.name !== 'AbortError') {
      console.warn('Native share failed, falling back to direct export:', err);
    }
  }
  return false;
}
