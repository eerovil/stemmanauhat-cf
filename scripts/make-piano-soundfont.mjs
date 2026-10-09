// Makes the piano the player plays every song with: MuseScore's own
// MuseScore_General.sf3 (MIT licensed, shipped inside MuseScore 3) cut down to
// its grand piano, preset 0. Samples stay compressed (about 15 MB).
//
//   node scripts/make-piano-soundfont.mjs <MuseScore_General.sf3> <out.sf3>
//
// MuseScore's AppImage has it at share/mscore-portable-3.6/sound/ once
// extracted (MuseScore3.AppImage --appimage-extract). Upload the result with
// scripts/upload-piano.sh; the site serves it at /sound/piano-1.sf3.
import { readFileSync, writeFileSync } from "node:fs";
import { SoundBankLoader } from "spessasynth_core";

const [source, out] = process.argv.slice(2);
if (!source || !out) {
  console.error("usage: make-piano-soundfont.mjs <MuseScore_General.sf3> <out.sf3>");
  process.exit(2);
}
const file = readFileSync(source);
const bank = SoundBankLoader.fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
for (const preset of [...bank.presets]) {
  const piano = preset.bankMSB === 0 && (preset.bankLSB ?? 0) === 0 && preset.program === 0 && !preset.isDrum;
  if (!piano) bank.deletePreset(preset);
}
bank.removeUnusedElements();
if (bank.presets.length !== 1) throw new Error(`expected one piano preset, got ${bank.presets.length}`);
const written = bank.writeSF2({ software: "stemmanauhat make-piano-soundfont" });
writeFileSync(out, Buffer.from(written));
console.log(`${bank.presets[0].name}: ${bank.samples.length} samples, ${written.byteLength} bytes -> ${out}`);
