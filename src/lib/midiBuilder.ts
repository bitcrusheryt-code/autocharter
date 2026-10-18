export interface MidiNote {
  timeInSec: number;
  durationInSec: number;
  pitch: number; // e.g. 38 (Kris L), 36 (Kris R), 39 (Kris L Hold), 35 (Kris R Hold)
  trackIndex?: number;
}

/**
 * Builds a valid Standard MIDI File (.mid) formatted for Deltarune Lightners Live Plus.
 * Produces Standard Type 0 MIDI with embedded Tempo (FF 51 03) and Time Signature (FF 58 04).
 */
export function buildLlpMidi(
  notes: MidiNote[],
  bpm: number = 120
): Uint8Array {
  const ppq = 480; // Pulses Per Quarter Note (standard DAW resolution)
  const safeBpm = Math.max(20, Math.min(400, bpm || 120));
  const tempoUs = Math.round(60000000 / safeBpm); // Microseconds per quarter note

  function writeVarInt(val: number): number[] {
    let v = Math.max(0, Math.round(val));
    const bytes = [v & 0x7f];
    while (v >> 7) {
      v >>= 7;
      bytes.push((v & 0x7f) | 0x80);
    }
    return bytes.reverse();
  }

  const ticksPerSec = (safeBpm / 60) * ppq;

  // Build events
  interface MidiRawEvent {
    tick: number;
    type: 'on' | 'off';
    pitch: number;
  }

  const rawEvents: MidiRawEvent[] = [];

  notes.forEach((n) => {
    const startTick = Math.max(0, Math.round(n.timeInSec * ticksPerSec));
    const durSec = Math.max(0.05, n.durationInSec);
    const endTick = startTick + Math.max(1, Math.round(durSec * ticksPerSec));

    rawEvents.push({ tick: startTick, type: 'on', pitch: n.pitch & 0x7f });
    rawEvents.push({ tick: endTick, type: 'off', pitch: n.pitch & 0x7f });
  });

  // Sort events chronologically. If tick is the same, 'off' comes before 'on' to avoid overlapping note clashes
  rawEvents.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'off' && b.type === 'on') return -1;
    if (a.type === 'on' && b.type === 'off') return 1;
    return a.pitch - b.pitch;
  });

  const trackBody: number[] = [];

  // 1. Delta 0: Track Name "Kris" (FF 03 04 'K','r','i','s')
  trackBody.push(0x00, 0xff, 0x03, 0x04, 0x4b, 0x72, 0x69, 0x73);

  // 2. Delta 0: Set Tempo (FF 51 03 tt tt tt)
  trackBody.push(
    0x00,
    0xff,
    0x51,
    0x03,
    (tempoUs >> 16) & 0xff,
    (tempoUs >> 8) & 0xff,
    tempoUs & 0xff
  );

  // 3. Delta 0: Time Signature 4/4 (FF 58 04 04 02 18 08)
  trackBody.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // 4. Write note events with delta times
  let lastTick = 0;
  rawEvents.forEach((evt) => {
    const delta = evt.tick - lastTick;
    lastTick = evt.tick;
    trackBody.push(...writeVarInt(delta));
    if (evt.type === 'on') {
      trackBody.push(0x90, evt.pitch, 0x64); // Note On, Channel 0, Pitch, Velocity 100
    } else {
      trackBody.push(0x80, evt.pitch, 0x00); // Note Off, Channel 0, Pitch, Velocity 0
    }
  });

  // 5. Delta 0: End of Track (FF 2F 00)
  trackBody.push(0x00, 0xff, 0x2f, 0x00);

  // Track Chunk (MTrk)
  const trackLen = trackBody.length;
  const trackHeader = [
    0x4d,
    0x54,
    0x72,
    0x6b, // 'MTrk'
    (trackLen >> 24) & 0xff,
    (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff,
    trackLen & 0xff,
  ];

  // File Header Chunk (MThd): Type 0 (1 track), PPQ 480
  const mthd = [
    0x4d,
    0x54,
    0x68,
    0x64, // 'MThd'
    0x00,
    0x00,
    0x00,
    0x06, // Header length = 6
    0x00,
    0x00, // Format 0 (Single Track, highest compatibility)
    0x00,
    0x01, // 1 Track
    (ppq >> 8) & 0xff,
    ppq & 0xff, // 480 PPQ
  ];

  const fullMidi = new Uint8Array(mthd.length + trackHeader.length + trackBody.length);
  fullMidi.set(mthd, 0);
  fullMidi.set(trackHeader, mthd.length);
  fullMidi.set(trackBody, mthd.length + trackHeader.length);

  return fullMidi;
}

