export interface GameStyleProfile {
  gameName: string;
  fatigueWeight: number;       // How heavily column fatigue/jacks are penalized (0-1)
  alternationWeight: number;   // Weight of rhythmic alternation flow (Don/Kat left-right hands in Taiko)
  musicalityMatchWeight: number; // Importance of aligning hits strictly to transients (0-1)
  shieldPenalty: number;       // Penalty coefficient for shields (holds followed by tap in same column)
  comfortScale: number;        // General multiplier for ergonomic scaling
  burstAsymmetryPenalty: number; // Penalty for uncomfortable asymmetrical triplets/bursts (e.g., in Taiko)
  maxConsonantChords: number;  // Max comfortable keys hit simultaneously
  descriptor: string;
}

export const STYLE_PROFILES: { [key in 'llplus' | 'mania' | 'taiko' | 'fnf']: GameStyleProfile } = {
  llplus: {
    gameName: "Lightners Live +",
    fatigueWeight: 0.65,
    alternationWeight: 0.20,
    musicalityMatchWeight: 0.85,
    shieldPenalty: 0.40,
    comfortScale: 1.1,
    burstAsymmetryPenalty: 0.15,
    maxConsonantChords: 3,
    descriptor: "Focuses on clean 4-key rhythm accuracy, with strict visual alignment to prominent transients and moderate physical comfort checks."
  },
  mania: {
    gameName: "osu!mania (4K)",
    fatigueWeight: 0.95,
    alternationWeight: 0.10,
    musicalityMatchWeight: 0.80,
    shieldPenalty: 0.85,
    comfortScale: 1.3,
    burstAsymmetryPenalty: 0.10,
    maxConsonantChords: 4,
    descriptor: "Extremely strict finger ergonomics. Heavily penalizes rapid same-column jacks, complex shields, and unplayable single-finger strain."
  },
  taiko: {
    gameName: "osu!taiko",
    fatigueWeight: 0.10, // Column fatigue is nearly non-existent
    alternationWeight: 0.95, // Hand-alternation flow is critical
    musicalityMatchWeight: 0.90,
    shieldPenalty: 0.05,
    comfortScale: 0.9,
    burstAsymmetryPenalty: 0.85, // Highly sensitive to hand-breaking rapid color triplets (Don/Kat)
    maxConsonantChords: 2, // Taiko maps use at most 2 keys (dual hits for large notes)
    descriptor: "Ignores single-key lane fatigue. Instead, rewards smooth left-right drum roll hand alternations and penalizes awkward color switches."
  },
  fnf: {
    gameName: "Friday Night Funkin'",
    fatigueWeight: 0.70,
    alternationWeight: 0.40,
    musicalityMatchWeight: 0.75,
    shieldPenalty: 0.50,
    comfortScale: 1.0,
    burstAsymmetryPenalty: 0.30,
    maxConsonantChords: 2, // FNF gameplay restricts massive multi-key chords
    descriptor: "Favors fluid visual arrow patterns, allows moderate repetitive jacks for vocals mimicry, but warns against unplayable fast streams."
  }
};
