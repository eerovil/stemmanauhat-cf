# Build the bundles scripts/publish-songs.sh uploads, with song-app's own
# publish code (eerovil/musescore-choir-plugins, src/song_app/publish.py), on
# the host where song-app and MuseScore live. Nothing is uploaded here.
#
#   <song-app>/.venv/bin/python scripts/song-app-bundle.py <song-app> <out-dir> <slug> ...
#
# Each <out-dir>/<slug>/ gets what song-app's publish uploads, plus score.mid:
# manifest.json, score.musicxml, score.mid, timing.json and parts/<n>-<name>.mp3.
# The tempo for a score without one is the recording's, as in song-app's publish.
# Remove once song-app's publish uploads score.mid itself.
import json
import os
import shutil
import sys
import tempfile
import unicodedata

song_app, out_root, slugs = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3:]
if not slugs:
    sys.exit("usage: song-app-bundle.py <song-app> <out-dir> <slug> ...")
sys.path.insert(0, song_app)
os.chdir(song_app)
from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env")
from src.song_app import pipeline, publish, state  # noqa: E402

for slug in slugs:
    song = state.load(slug)
    cleaned = song.cleaned_path()
    if not os.path.exists(cleaned):
        # .song.json may spell the name decomposed (NFD) while the disk has it composed.
        cleaned = unicodedata.normalize("NFC", cleaned)
    bpm = None if pipeline.has_opening_tempo(cleaned) else song.data.get("record", {}).get("bpm", 80)
    out = os.path.join(out_root, slug)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "parts"))
    with tempfile.TemporaryDirectory() as tmp:
        bundle = publish.build_bundle(cleaned, tmp, initial_bpm=bpm, log=print)
        shutil.copy(bundle.musicxml, os.path.join(out, "score.musicxml"))
        # build_bundle exports the MIDI next to the score; publish does not upload it yet.
        shutil.copy(os.path.join(tmp, "score.mid"), os.path.join(out, "score.mid"))
        with open(os.path.join(out, "timing.json"), "w") as f:
            json.dump(bundle.timing, f)
        parts = []
        for index, (name, mp3) in enumerate(bundle.parts):
            parts.append({"name": name, "file": publish.part_file(index, name)})
            shutil.copy(mp3, os.path.join(out, parts[-1]["file"]))
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump({"slug": slug, "title": song.name, "parts": parts,
                   "duration": bundle.timing["duration"]}, f, ensure_ascii=False)
    print(f"built {song.name} → {out}")
