"""Writes tests/fixtures/long-song/: a made-up song long enough that its one line is wider
than OSMD's default page limit (32767), as Rautavaara's "Katedralen" is (351 bars,
eeron-omat-taskit#104): OSMD wrapped such a line into rows the player did not follow.

4/4 at 120 bpm, 300 bars, two parts (Tenori, Basso). Each Tenori bar is sixteen sixteenths
with a syllable under each; Basso holds a whole note. Writes score.musicxml, timing.json,
score.mid and manifest.json.
Run from the repo root: python3 tests/fixtures/make-long-song.py
"""
import json
import struct

OUT = "tests/fixtures/long-song"
DIV = 4  # MusicXML divisions per quarter
MIDI_DIV = 480
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TYPES = {16: "whole", 8: "half", 4: "quarter", 1: "16th"}

SIXTEENTHS = [("E", 4), ("F", 4), ("G", 4), ("A", 4)] * 4
SYLLABLES = ["ti", "ki", "ta", "ka"] * 4
BAR_COUNT = 300
BARS = {
    "Tenori": [[(s, o, 1, syl) for (s, o), syl in zip(SIXTEENTHS, SYLLABLES)]] * BAR_COUNT,
    "Basso": [[("C", 3, 16, "loo")]] * BAR_COUNT,
}
BPM = 120
SECONDS_PER_QUARTER = 60 / BPM


def note_xml(step, octave, length, syllable):
    if step is None:
        return f'<note><rest measure="yes"/><duration>{length}</duration></note>'
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{length}</duration><type>{TYPES[length]}</type>"
            f"<lyric number=\"1\"><syllabic>single</syllabic><text>{syllable}</text></lyric></note>")


def part_xml(index, name, bars):
    clef = ("<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
            if name == "Tenori" else "<clef><sign>F</sign><line>4</line></clef>")
    out = [f'<part id="P{index}">']
    for number, bar in enumerate(bars, 1):
        out.append(f'<measure number="{number}">')
        if number == 1:
            out.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>0</fifths></key>"
                       f"<time><beats>4</beats><beat-type>4</beat-type></time>{clef}</attributes>")
            if index == 1:
                out.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                           f'<per-minute>{BPM}</per-minute></metronome></direction-type><sound tempo="{BPM}"/></direction>')
        out.extend(note_xml(*n) for n in bar)
        out.append("</measure>")
    out.append("</part>")
    return "".join(out)


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def track(events):
    data = b"".join(vlq(d) + e for d, e in events) + b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


names = list(BARS)
xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
       '"http://www.musicxml.org/dtds/partwise.dtd">\n'
       '<score-partwise version="3.1"><work><work-title>Pitkä laulu</work-title></work><part-list>'
       + "".join(f'<score-part id="P{i}"><part-name>{n}</part-name></score-part>' for i, n in enumerate(names, 1))
       + "</part-list>"
       + "".join(part_xml(i, n, BARS[n]) for i, n in enumerate(names, 1))
       + "</score-partwise>\n")
open(f"{OUT}/score.musicxml", "w").write(xml)

measures = len(BARS["Tenori"])
points = []
for m in range(measures):
    for beat in range(5):
        points.append([round((m * 4 + beat) * SECONDS_PER_QUARTER, 3), m, float(beat)])
duration = measures * 4 * SECONDS_PER_QUARTER
open(f"{OUT}/timing.json", "w").write(json.dumps(
    {"version": 1, "measures": measures, "duration": duration, "points": points}))

tempo = track([
    (0, b"\xff\x51\x03" + round(60_000_000 / BPM).to_bytes(3, "big")),
    (0, b"\xff\x58\x04\x04\x02\x18\x08"),
])
tracks = []
for channel, name in enumerate(names):
    events = [(0, b"\xff\x03" + vlq(len(name)) + name.encode()),
              (0, bytes([0xC0 | channel, 0])),
              (0, bytes([0xB0 | channel, 7, 100]))]
    rest = 0
    for bar in BARS[name]:
        for step, octave, length, _ in bar:
            if step is None:
                rest += length * MIDI_DIV // DIV
                continue
            pitch = 12 * (octave + 1) + STEPS[step]
            events.append((rest, bytes([0x90 | channel, pitch, 80])))
            rest = 0
            events.append((length * MIDI_DIV // DIV, bytes([0x80 | channel, pitch, 0])))
    tracks.append(track(events))
header = b"MThd" + struct.pack(">IHHH", 6, 1, 1 + len(tracks), MIDI_DIV)
open(f"{OUT}/score.mid", "wb").write(header + tempo + b"".join(tracks))

manifest = {
    "slug": "pitka", "title": "Pitkä laulu", "choir": "public", "version": "20261009T120000Z",
    "score": "score.musicxml", "timing": "timing.json",
    "parts": [{"name": n} for n in names],
    "duration": duration, "midi": "score.mid",
}
open(f"{OUT}/manifest.json", "w").write(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
