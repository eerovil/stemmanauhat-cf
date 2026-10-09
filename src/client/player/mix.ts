/**
 * How loud each part plays. Your part is the reference; the slider sets the
 * others. Today's videos play the other parts at MuseScore volume 36 against
 * 127; Eero, testing real songs, wanted them a bit louder, so the slider starts
 * at 0.4. MIDI volume is a squared curve, so the gain is the slider squared:
 * 0.4 is a gain of 0.16.
 */
export const DEFAULT_OTHERS = 0.4;

export function gainOf(level: number): number {
  return Math.max(0, Math.min(1, level)) ** 2;
}

/**
 * Each part's gain. Raising the others never makes the whole louder than the
 * default mix: past that, everything is scaled back to the default's total, so
 * the output stage below never has to work harder than at the default.
 */
export function mixLevels(count: number, master: number, others: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => (i === master ? 1 : gainOf(others)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const budget = 1 + (count - 1) * gainOf(DEFAULT_OTHERS);
  const scale = sum > budget ? budget / sum : 1;
  return raw.map((g) => g * scale);
}
