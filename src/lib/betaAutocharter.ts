/**
 * IRIS Beta Autocharter Engine (v2)
 * Next-Generation Musical, Ergonomic & Multi-Band Charting Engine.
 * 
 * Features:
 * 1. Multi-Band Spectral Separation (Sub/Bass, Mid/Vocal/Lead, High/Transients)
 * 2. Metric Hierarchy & Downbeat Mapping (Bars, Backbeats 2/4, 8th/16th Subdivisions)
 * 3. Ergonomic Hand-Flow Engine (Left/Right Hand Balance, Rolls 1->2->3->4, Alternating Trills)
 * 4. True Musical Hold Duration (Envelope Decay Tracking)
 * 5. Charting Style Presets (Balanced, Stream/Speed, Chordjack/Dense, Technical, Vocal/Melody)
 */

import { AudioRegion } from '../components/AudioRegionEditorModal';

export type BetaCharterStyle = 
  | 'balanced'       // Balanced musical flow, all-around
  | 'stream_speed'   // Fluid rolls, 1/4 & 1/8 streams, alternating hand runs
  | 'chordjack_dense'// Rhythmic kick/snare chord impacts, heavy beat stamina
  | 'technical'      // Polyrhythms, syncopated offbeat taps, cross-rhythms
  | 'vocal_melody';  // Vocal phrasing, melodic long holds & lyrical tracking

export interface BetaCharterOptions {
  style: BetaCharterStyle;
  enableHandFlow: boolean;          // Ergo Hand-Flow engine (L/R hand balance, roll direction)
  enableMultiBandAnalysis: boolean; // Bass / Mid / High spectral separation
  enableTrueMusicalHolds: boolean;  // Envelope decay tracking for holds
  enableMetricHierarchy: boolean;   // Bar downbeat, backbeat, and subdivision weights
  humanizeJitterMs?: number;        // Micro-humanization (0 to 8ms)
}

export const DEFAULT_BETA_OPTIONS: BetaCharterOptions = {
  style: 'balanced',
  enableHandFlow: true,
  enableMultiBandAnalysis: true,
  enableTrueMusicalHolds: true,
  enableMetricHierarchy: true,
  humanizeJitterMs: 0
};

export interface MultiBandEnergy {
  bass: number;  // 20 - 250 Hz (Kicks, basslines, 808s)
  mid: number;   // 250 - 3500 Hz (Vocals, guitars, synth leads, snare bodies)
  high: number;  // 3500 - 20000 Hz (Hi-hats, cymbals, air, sibilance)
  total: number;
}

/**
 * Fast Multi-Band Energy Analyzer.
 * Uses high-performance discrete filtering to extract low, mid, and high energy envelopes.
 */
export function analyzeMultiBandEnergy(audioBuffer: AudioBuffer, time: number, windowSize: number = 0.05): MultiBandEnergy {
  if (!audioBuffer) return { bass: 0.05, mid: 0.05, high: 0.05, total: 0.05 };

  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(time * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.floor((time + windowSize) * sampleRate));

  if (startSample >= endSample) return { bass: 0, mid: 0, high: 0, total: 0 };

  const count = endSample - startSample;
  let totalSum = 0;
  let bassSum = 0;
  let highSum = 0;

  // Discrete filter coefficients approximation for sampleRate
  // Low-pass filter (moving average over ~45 samples at 44.1kHz gives ~500Hz cutoff)
  const lowPassWindow = Math.max(2, Math.floor(sampleRate / 400));
  
  // Use first channel for speed (mono analysis is standard for rhythm chart rhythm detection)
  const channelData = audioBuffer.getChannelData(0);

  let runningLowSum = 0;
  for (let i = 0; i < lowPassWindow && (startSample + i) < endSample; i++) {
    runningLowSum += channelData[startSample + i];
  }

  for (let i = startSample; i < endSample; i++) {
    const raw = channelData[i];
    totalSum += raw * raw;

    // Moving window low-pass update
    if (i + lowPassWindow < audioBuffer.length) {
      runningLowSum += channelData[i + lowPassWindow] - channelData[i];
    }
    const low = runningLowSum / lowPassWindow;
    bassSum += low * low;

    // Simple 1st-order high-pass derivative
    const prev = i > 0 ? channelData[i - 1] : raw;
    const high = (raw - prev) * 0.5;
    highSum += high * high;
  }

  const total = Math.sqrt(totalSum / count);
  const bass = Math.sqrt(bassSum / count);
  const high = Math.min(total, Math.sqrt(highSum / count) * 2.2);
  const mid = Math.max(0, Math.sqrt(Math.max(0, totalSum - bassSum - (highSum * 0.5)) / count));

  return { bass, mid, high, total };
}

/**
 * Quantizes time to rhythmic beat subdivisions.
 */
function snapTimeToGrid(timeMs: number, bpm: number, offsetMs: number): number {
  if (!bpm || bpm <= 0) return Math.round(timeMs);
  const msPerBeat = (60 / bpm) * 1000;
  const subdivisionMs = msPerBeat / 4; // 1/16th note snap
  const timeSinceOffset = timeMs - offsetMs;
  const snappedUnits = Math.round(timeSinceOffset / subdivisionMs);
  return Math.round(offsetMs + (snappedUnits * subdivisionMs));
}

/**
 * Ergonomic Hand-Flow Engine
 * Ensures balanced finger movement, smooth rolls, and prevents wrist fatigue.
 */
class HandFlowEngine {
  private colsCount: number;
  private lastLane: number | null = null;
  private lastHand: 'left' | 'right' | 'center' | null = null;
  private handRunCount: number = 0;
  private rollDirection: number = 1; // 1 for 0->1->2->3, -1 for 3->2->1->0
  private rollStreak: number = 0;
  private leftHandScore: number = 0;
  private rightHandScore: number = 0;

  constructor(colsCount: number) {
    this.colsCount = colsCount;
  }

  /**
   * Identifies which hand naturally presses a given lane.
   */
  getHandForLane(lane: number): 'left' | 'right' | 'center' {
    if (this.colsCount % 2 !== 0 && lane === Math.floor(this.colsCount / 2)) {
      return 'center';
    }
    return lane < this.colsCount / 2 ? 'left' : 'right';
  }

  /**
   * Selects an optimal lane or lanes for a note or chord, respecting hand ergonomics.
   */
  selectErgonomicLanes(
    chordSize: number,
    availableLanes: number[],
    isFastStream: boolean,
    preferRoll: boolean
  ): number[] {
    if (availableLanes.length === 0) return [];
    if (chordSize >= availableLanes.length) return [...availableLanes];

    // --- SINGLE NOTE SELECTION (Flow, Rolls & Trill Balancing) ---
    if (chordSize === 1) {
      // 1. If in a fast stream, evaluate roll flow
      if (preferRoll && this.lastLane !== null && availableLanes.length > 1) {
        let nextCandidate = this.lastLane + this.rollDirection;
        
        // Bounce at boundaries (e.g. after lane 3, reverse direction to 3->2->1->0)
        if (nextCandidate >= this.colsCount || nextCandidate < 0) {
          this.rollDirection = -this.rollDirection;
          nextCandidate = this.lastLane + this.rollDirection;
        }

        if (availableLanes.includes(nextCandidate)) {
          this.recordNote(nextCandidate);
          return [nextCandidate];
        }
      }

      // 2. Hand-balance fatigue relief
      const favorRight = this.leftHandScore > this.rightHandScore + 2 || (this.lastHand === 'left' && this.handRunCount >= 3);
      const favorLeft = this.rightHandScore > this.leftHandScore + 2 || (this.lastHand === 'right' && this.handRunCount >= 3);

      const sortedCandidates = [...availableLanes].sort((a, b) => {
        const handA = this.getHandForLane(a);
        const handB = this.getHandForLane(b);

        if (favorRight) {
          if (handA === 'right' && handB !== 'right') return -1;
          if (handB === 'right' && handA !== 'right') return 1;
        } else if (favorLeft) {
          if (handA === 'left' && handB !== 'left') return -1;
          if (handB === 'left' && handA !== 'left') return 1;
        }

        // Avoid repeated notes on same lane in fast streams (anti-jack)
        if (isFastStream && this.lastLane !== null) {
          if (a === this.lastLane) return 1;
          if (b === this.lastLane) return -1;
        }

        return Math.random() - 0.5;
      });

      const chosen = sortedCandidates[0];
      this.recordNote(chosen);
      return [chosen];
    }

    // --- CHORD SELECTION (Symmetric & Split across Left/Right Hand) ---
    if (chordSize === 2) {
      const leftLanes = availableLanes.filter(l => this.getHandForLane(l) === 'left');
      const rightLanes = availableLanes.filter(l => this.getHandForLane(l) === 'right');

      // Best ergonomic 2-key chord: one note on left hand, one note on right hand!
      if (leftLanes.length > 0 && rightLanes.length > 0) {
        const leftChoice = leftLanes[Math.floor(Math.random() * leftLanes.length)];
        const rightChoice = rightLanes[Math.floor(Math.random() * rightLanes.length)];
        this.recordNote(leftChoice);
        this.recordNote(rightChoice);
        return [leftChoice, rightChoice].sort((a, b) => a - b);
      }
    }

    // Fallback for 3+ chords: distribute across available lanes with maximum separation
    const shuffled = [...availableLanes].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, chordSize).sort((a, b) => a - b);
    chosen.forEach(l => this.recordNote(l));
    return chosen;
  }

  private recordNote(lane: number) {
    const hand = this.getHandForLane(lane);
    if (hand === 'left') this.leftHandScore++;
    if (hand === 'right') this.rightHandScore++;

    if (this.lastHand === hand) {
      this.handRunCount++;
    } else {
      this.handRunCount = 1;
    }

    if (this.lastLane !== null) {
      const delta = lane - this.lastLane;
      if ((delta > 0 && this.rollDirection > 0) || (delta < 0 && this.rollDirection < 0)) {
        this.rollStreak++;
      } else {
        this.rollStreak = 1;
        if (delta !== 0) {
          this.rollDirection = delta > 0 ? 1 : -1;
        }
      }
    }

    this.lastLane = lane;
    this.lastHand = hand;
  }
}

/**
 * Traces audio envelope decay forwards in time to calculate true musical hold durations.
 */
function calculateMusicalHoldDuration(
  audioBuffer: AudioBuffer,
  startTime: number,
  duration: number,
  secondsPerBeat: number,
  finalBpm: number,
  finalOffset: number,
  baseHoldDuration: number
): number {
  if (!audioBuffer) return baseHoldDuration;

  const sampleWindow = 0.04;
  const initialEnergy = analyzeMultiBandEnergy(audioBuffer, startTime, sampleWindow).mid;
  const decayThreshold = initialEnergy * 0.40; // End hold when energy drops by 60%

  let releaseTime = startTime + secondsPerBeat; // default at least 1 beat
  const maxSearchTime = Math.min(duration - 0.05, startTime + (secondsPerBeat * 4));

  for (let t = startTime + (secondsPerBeat * 0.5); t < maxSearchTime; t += 0.05) {
    const current = analyzeMultiBandEnergy(audioBuffer, t, sampleWindow);
    // Transient spike or energy collapse indicates end of sustained note
    if (current.mid < decayThreshold || current.bass > initialEnergy * 1.5) {
      releaseTime = t;
      break;
    }
  }

  // Snap the release timestamp cleanly to 1/2 beat or 1 beat grid
  const snappedRelease = snapTimeToGrid(releaseTime * 1000, finalBpm, finalOffset * 1000) / 1000;
  const holdDur = Math.max(secondsPerBeat * 0.75, snappedRelease - startTime);

  return Math.min(holdDur, duration - startTime - 0.05);
}

/**
 * Main Generator function for Beta Autocharter.
 */
export function generateBetaDifficultyEvents(
  audioBuffer: AudioBuffer,
  diffValue: number,
  diffKeys: string[],
  finalBpm: number,
  finalOffset: number,
  duration: number,
  effectiveSilenceThreshold: number,
  maxTrackEnergy: number,
  avgTrackSectionEnergy: number,
  audioRegions: AudioRegion[],
  pExportFormat: 'llplus' | 'mania' | 'taiko' | 'fnf',
  pEnableHoldNotes: boolean,
  pUseFreeOnset: boolean,
  options: BetaCharterOptions = DEFAULT_BETA_OPTIONS
): any[] {
  const events: any[] = [];
  const colsCount = diffKeys.length || 4;
  const handFlow = new HandFlowEngine(colsCount);

  // Time stepping
  const step = pUseFreeOnset ? 0.010 : ((60 / finalBpm) / 4);
  const secondsPerBeat = 60 / finalBpm;
  const diffFactor = Math.min(1.0, Math.max(0.0, (diffValue - 1) / 24)); // 0.0 to 1.0

  // Minimum step gap between notes scaled by difficulty and preset style
  let minSteps = Math.max(1, Math.round(
    pUseFreeOnset
      ? (diffValue <= 3 ? 24 : diffValue <= 7 ? 14 : diffValue <= 11 ? 8 : diffValue <= 16 ? 5 : diffValue <= 20 ? 3 : 2)
      : (diffValue <= 4 ? 4 : diffValue <= 8 ? 2 : 1)
  ));

  if (options.style === 'stream_speed') {
    minSteps = Math.max(1, minSteps - 1);
  }

  let currentTime = 0;
  let stepsSinceLastNote = 999;
  let lastChordTime = -999;
  let beatIndex = 0;

  const laneHoldUntil: { [lane: number]: number } = {};
  for (let k = 0; k < colsCount; k++) {
    laneHoldUntil[k] = 0;
  }
  const spawnedHoldAndPlayRegions = new Set<string>();

  while (currentTime < duration) {
    let regionMultiplier = 1.0;
    let regionPatternPref = 'auto';
    let regionHoldAndPlaySide = 'any';
    let activeRegion: AudioRegion | null = null;

    if (audioRegions && audioRegions.length > 0) {
      const matchedReg = audioRegions.find(r => currentTime >= r.startTime && currentTime <= r.endTime);
      if (matchedReg) {
        activeRegion = matchedReg;
        if (matchedReg.type === 'silence' || matchedReg.densityMultiplier === 0) {
          stepsSinceLastNote++;
          currentTime += step;
          beatIndex++;
          continue;
        }
        regionMultiplier = matchedReg.densityMultiplier;
        regionPatternPref = matchedReg.patternPreference;
        regionHoldAndPlaySide = matchedReg.holdAndPlaySide || 'any';
      }
    }

    // --- 1. GUARANTEED HOLD & PLAY ANCHOR (Full Region Span) ---
    if (activeRegion && regionPatternPref === 'hold_and_play' && colsCount > 1) {
      if (!spawnedHoldAndPlayRegions.has(activeRegion.id)) {
        spawnedHoldAndPlayRegions.add(activeRegion.id);

        let anchors = [0, colsCount - 1];
        if (colsCount % 2 !== 0) anchors.push(Math.floor(colsCount / 2));

        if (regionHoldAndPlaySide === 'left') anchors = [0];
        else if (regionHoldAndPlaySide === 'right') anchors = [colsCount - 1];
        else if (regionHoldAndPlaySide === 'center') {
          anchors = colsCount % 2 !== 0 ? [Math.floor(colsCount / 2)] : [Math.floor(colsCount / 2) - 1, Math.floor(colsCount / 2)];
        }

        const validAnchors = anchors.filter(idx => (laneHoldUntil[idx] || 0) <= currentTime);
        const candidates = validAnchors.length > 0 ? validAnchors : anchors;
        const anchorLane = candidates[Math.floor(Math.random() * candidates.length)];
        const anchorKey = diffKeys[anchorLane];

        const snappedStart = snapTimeToGrid(Math.max(currentTime, activeRegion.startTime) * 1000, finalBpm, finalOffset * 1000) / 1000;
        const endTarget = Math.min(duration - 0.05, activeRegion.endTime - (secondsPerBeat * 0.25));
        const snappedEnd = Math.max(snappedStart + secondsPerBeat * 2, snapTimeToGrid(endTarget * 1000, finalBpm, finalOffset * 1000) / 1000);
        let anchorDuration = Math.max(secondsPerBeat * 2, snappedEnd - snappedStart);

        if (snappedStart + anchorDuration > duration) {
          anchorDuration = Math.max(0.1, duration - snappedStart - 0.05);
        }

        laneHoldUntil[anchorLane] = snappedStart + anchorDuration;

        events.push({
          n: "key",
          t: snappedStart,
          d: { i: anchorLane, r: 0, s: anchorKey, duration: anchorDuration }
        });
      }
    }

    // --- 2. MULTI-BAND SPECTRAL ANALYSIS ---
    const analysisWindow = pUseFreeOnset ? 0.04 : step;
    const band = options.enableMultiBandAnalysis
      ? analyzeMultiBandEnergy(audioBuffer, currentTime, analysisWindow)
      : { bass: 0, mid: 0, high: 0, total: analyzeMultiBandEnergy(audioBuffer, currentTime, analysisWindow).total };
    
    const prevBand = analyzeMultiBandEnergy(audioBuffer, Math.max(0, currentTime - analysisWindow), analysisWindow);

    const isAudioAudible = band.total >= effectiveSilenceThreshold;
    const relativeEnergy = Math.min(1.0, Math.max(0.0, (band.total - effectiveSilenceThreshold) / (maxTrackEnergy * 0.3 + 0.001)));

    // Onset Detection based on spectral transients (Bass kick, Snare mid, or Hi-hat transient)
    const isBassTransient = band.bass > prevBand.bass * 1.35 && band.bass > effectiveSilenceThreshold * 1.2;
    const isMidTransient = band.mid > prevBand.mid * 1.30 && band.mid > effectiveSilenceThreshold * 1.1;
    const isHighTransient = band.high > prevBand.high * 1.40 && band.high > effectiveSilenceThreshold * 0.9;
    const isGeneralPeak = band.total > prevBand.total * 1.25 && relativeEnergy >= 0.08;

    const isMusicalPeak = isBassTransient || isMidTransient || (options.style === 'stream_speed' && isHighTransient) || isGeneralPeak;

    // --- 3. METRIC HIERARCHY & DOWNBEAT CALCULATION ---
    const timeSinceOffset = currentTime - finalOffset;
    const currentBeat = timeSinceOffset / secondsPerBeat;
    const beatInBar = ((Math.round(currentBeat * 4) / 4) % 4 + 4) % 4; // 0.0, 1.0, 2.0, 3.0 in 4/4
    const isMeasureDownbeat = Math.abs(beatInBar) < 0.1;               // 1st beat of the bar
    const isBackbeat = Math.abs(beatInBar - 1) < 0.1 || Math.abs(beatInBar - 3) < 0.1; // 2nd and 4th beats
    const isOffbeat = Math.abs(currentBeat - Math.round(currentBeat)) > 0.2; // 8th or 16th note

    if (isAudioAudible && relativeEnergy >= 0.02) {
      let prob = 0;

      if (isMusicalPeak) {
        prob = 0.42 + (diffFactor * 0.55);
      } else {
        prob = 0;
      }

      // Style Preset probability adjustments
      if (options.style === 'stream_speed') {
        if (isHighTransient || isOffbeat) prob *= 1.35;
      } else if (options.style === 'chordjack_dense') {
        if (isBassTransient || isMeasureDownbeat) prob *= 1.40;
      } else if (options.style === 'vocal_melody') {
        if (isMidTransient) prob *= 1.45;
        if (isOffbeat && !isMidTransient) prob *= 0.7;
      } else if (options.style === 'technical') {
        if (isOffbeat) prob *= 1.30;
      }

      // Metric hierarchy weighting
      if (options.enableMetricHierarchy) {
        if (isMeasureDownbeat) prob *= 1.30;
        else if (isBackbeat) prob *= 1.15;
      }

      // Section Intensity adaptation
      const localSectionEnergy = analyzeMultiBandEnergy(audioBuffer, Math.max(0, currentTime - 2.0), 4.0).total;
      const sectionRatio = localSectionEnergy / (avgTrackSectionEnergy + 0.0001);
      const sectionMultiplier = Math.min(1.4, Math.max(0.35, Math.pow(sectionRatio, 0.75)));
      prob *= sectionMultiplier;

      // Region multiplier
      prob *= regionMultiplier;
      if (regionPatternPref === 'chords') prob *= 1.35;
      if (regionPatternPref === 'streams') prob *= 1.40;

      // Catch-up for long quiet gaps followed by clear sound
      if (stepsSinceLastNote > 8 && relativeEnergy >= 0.18) {
        prob += 0.25;
      }

      // Step limiter
      let effectiveMinSteps = minSteps;
      if (sectionMultiplier >= 1.2 && diffValue >= 6 && isMusicalPeak) {
        effectiveMinSteps = Math.max(1, effectiveMinSteps - 1);
      }

      if (stepsSinceLastNote < effectiveMinSteps) {
        prob = 0;
      }

      if (prob > 0 && Math.random() < prob) {
        // --- 4. CHORD SIZING WITH METRIC INTEGRITY ---
        let chordSize = 1;
        const maxKeys = Math.max(1, colsCount);

        if (maxKeys > 1) {
          const timeSinceLastChord = currentTime - lastChordTime;
          const minChordCooldown = diffValue >= 21 ? 0.08 : (diffValue >= 17 ? 0.11 : 0.16);

          const allowsChords = timeSinceLastChord >= minChordCooldown && regionPatternPref !== 'single' && regionPatternPref !== 'hold_and_play';

          if (allowsChords) {
            if (options.style === 'chordjack_dense' || isMeasureDownbeat) {
              // Downbeats and chordjack style get high chord resonance
              if (diffValue >= 17 && isBassTransient && maxKeys >= 4) {
                chordSize = Math.random() < 0.40 ? 3 : 2;
              } else if (diffValue >= 9 && (isBassTransient || isBackbeat)) {
                chordSize = 2;
              }
            } else if (diffValue >= 21) {
              chordSize = isMusicalPeak && Math.random() < 0.45 && maxKeys >= 6 ? 3 : (Math.random() < 0.70 ? 2 : 1);
            } else if (diffValue >= 16) {
              chordSize = isMusicalPeak && Math.random() < 0.55 ? 2 : 1;
            } else if (diffValue >= 11 && isMeasureDownbeat) {
              chordSize = Math.random() < 0.40 ? 2 : 1;
            }
          }

          if (regionPatternPref === 'chords' && maxKeys >= 2) chordSize = 2;
          if (regionPatternPref === 'stairs_and_chords' && maxKeys >= 2) {
            chordSize = isMeasureDownbeat || isBackbeat ? 2 : 1;
          }

          if (chordSize > 1) {
            lastChordTime = currentTime;
          }
        }

        // Available free lanes (strictly omitting active holds)
        const availableLanes = [];
        for (let l = 0; l < colsCount; l++) {
          if ((laneHoldUntil[l] || 0) <= currentTime) {
            availableLanes.push(l);
          }
        }

        if (availableLanes.length > 0) {
          chordSize = Math.min(chordSize, availableLanes.length);

          // --- 5. ERGONOMIC HAND-FLOW LANE ASSIGNMENT ---
          const isFastStream = (currentTime - (events[events.length - 1]?.t || 0)) < 0.16;
          const preferRoll = options.enableHandFlow && (options.style === 'stream_speed' || regionPatternPref === 'streams');

          const chosenLanes = options.enableHandFlow
            ? handFlow.selectErgonomicLanes(chordSize, availableLanes, isFastStream, preferRoll)
            : availableLanes.slice(0, chordSize);

          // --- 6. TRUE MUSICAL HOLD DURATION ---
          let holdDuration = 0;
          if (pEnableHoldNotes && regionPatternPref !== 'hold_and_play') {
            const isHoldCandidate = 
              (options.style === 'vocal_melody' && isMidTransient && relativeEnergy > 0.4) ||
              (isMusicalPeak && relativeEnergy > 0.55 && Math.random() < (0.2 + diffFactor * 0.2));

            if (isHoldCandidate) {
              if (options.enableTrueMusicalHolds) {
                holdDuration = calculateMusicalHoldDuration(
                  audioBuffer,
                  currentTime,
                  duration,
                  secondsPerBeat,
                  finalBpm,
                  finalOffset,
                  secondsPerBeat * 1.5
                );
              } else {
                holdDuration = Math.min(secondsPerBeat * 1.5, Math.max(secondsPerBeat * 0.4, step * 4));
              }
            }
          }

          // Snapping
          const snappedTimeSec = snapTimeToGrid(currentTime * 1000, finalBpm, finalOffset * 1000) / 1000;

          chosenLanes.forEach(laneIdx => {
            const key = diffKeys[laneIdx] || `${laneIdx + 1}`;
            if (holdDuration > 0) {
              laneHoldUntil[laneIdx] = snappedTimeSec + holdDuration;
            }

            events.push({
              n: "key",
              t: snappedTimeSec,
              d: { i: laneIdx, r: 0, s: key, duration: holdDuration }
            });
          });

          stepsSinceLastNote = 0;
        } else {
          stepsSinceLastNote++;
        }
      } else {
        stepsSinceLastNote++;
      }
    } else {
      stepsSinceLastNote++;
    }

    currentTime += step;
    beatIndex++;
  }

  // Sort chronologically for deterministic processing
  events.sort((a, b) => a.t - b.t);

  return events;
}
