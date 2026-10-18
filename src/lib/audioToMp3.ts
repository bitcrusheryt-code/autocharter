import { Mp3Encoder } from '@breezystack/lamejs';

export async function convertAudioBufferToMp3(audioBuffer: AudioBuffer): Promise<Blob> {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  
  const mp3encoder = new Mp3Encoder(channels >= 2 ? 2 : 1, sampleRate, 128);
  const mp3Data: Uint8Array[] = [];

  const sampleLength = audioBuffer.length;
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = channels >= 2 ? audioBuffer.getChannelData(1) : leftChannel;

  const sampleBlockSize = 1152;
  const leftInt16 = new Int16Array(sampleBlockSize);
  const rightInt16 = new Int16Array(sampleBlockSize);

  for (let i = 0; i < sampleLength; i += sampleBlockSize) {
    const chunkLen = Math.min(sampleBlockSize, sampleLength - i);
    for (let j = 0; j < chunkLen; j++) {
      const sL = Math.max(-1, Math.min(1, leftChannel[i + j]));
      leftInt16[j] = sL < 0 ? Math.floor(sL * 0x8000) : Math.floor(sL * 0x7FFF);
      if (channels >= 2) {
        const sR = Math.max(-1, Math.min(1, rightChannel[i + j]));
        rightInt16[j] = sR < 0 ? Math.floor(sR * 0x8000) : Math.floor(sR * 0x7FFF);
      }
    }

    let mp3buf: Uint8Array;
    if (channels >= 2) {
      mp3buf = mp3encoder.encodeBuffer(leftInt16.subarray(0, chunkLen), rightInt16.subarray(0, chunkLen));
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftInt16.subarray(0, chunkLen));
    }
    if (mp3buf && mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const endBuf = mp3encoder.flush();
  if (endBuf && endBuf.length > 0) {
    mp3Data.push(new Uint8Array(endBuf));
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

export async function getMp3BlobForLlp(audioFile: File, audioBuffer: AudioBuffer): Promise<Blob> {
  const isAlreadyMp3 = audioFile.name.toLowerCase().endsWith('.mp3') || 
                       audioFile.type === 'audio/mpeg' || 
                       audioFile.type === 'audio/mp3';
                       
  if (isAlreadyMp3) {
    return audioFile;
  }
  
  return await convertAudioBufferToMp3(audioBuffer);
}

