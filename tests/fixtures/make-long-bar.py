"""Writes tests/fixtures/long-bar/: a made-up song that opens with one very long
bar, as a free-rhythm verse is often written (#45), for the long-bar cutting in
player/split.ts.

120 bpm, two parts (Tenori, Basso). Bar 1 is 32 quarters under a hidden 16/2
time signature: Tenori sings quarters with a syllable each, and one beamed pair
of eighths on beat 5; Basso holds half notes. Bars 2 and 3 are ordinary 4/4.
Writes score.musicxml, timing.json, score.mid and manifest.json.
Run from the repo root: python3 tests/fixtures/make-long-bar.py
"""
import json
import struct

OUT = "tests/fixtures/long-bar"
DIV = 2  # MusicXML divisions per quarter
MIDI_DIV = 480
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TYPES = {8: "whole", 4: "half", 2: "quarter", 1: "eighth"}
SYLLABLES = ["La", "lu", "li", "loo", "taa", "ti", "ka", "lo"]
MELODY = [("E", 4), ("F", 4), ("G", 4), ("A", 4), ("G", 4), ("F", 4), ("E", 4), ("D", 4)]

# (step, octave, length in eighths, syllable, beam)
tenor_long = []
for i in range(32):
    step, octave = MELODY[i % len(MELODY)]
    syl = SYLLABLES[i % len(SYLLABLES)]
    if i == 4:
        tenor_long.append((step, octave, 1, syl, "begin"))
        tenor_long.append(("A", 4, 1, "ri", "end"))
    else:
        tenor_long.append((step, octave, 2, syl, None))
BARS = {
    "Tenori": [
        tenor_long,
        [("G", 4, 4, "lu", None), ("E", 4, 4, "laa", None)],
        [("C", 4, 8, "loo", None)],
    ],
    "Basso": [
        [(("C", 3), ("G", 2), ("F", 3), ("C", 3))[i % 4] + (4, "Laa" if i == 0 else "aa", None) for i in range(16)],
        [("G", 2, 8, "lu", None)],
        [("C", 3, 8, "loo", None)],
    ],
}
BPM = 120
SECONDS_PER_QUARTER = 60 / BPM
BAR_QUARTERS = [32, 4, 4]


def note_xml(step, octave, length, syllable, beam):
    beam_xml = f'<beam number="1">{beam}</beam>' if beam else ""
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{length}</duration><voice>1</voice><type>{TYPES[length]}</type>{beam_xml}"
            f"<lyric number=\"1\"><syllabic>single</syllabic><text>{syllable}</text></lyric></note>")


def part_xml(index, name, bars):
    clef = ("<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
            if name == "Tenori" else "<clef><sign>F</sign><line>4</line></clef>")
    out = [f'<part id="P{index}">']
    for number, bar in enumerate(bars, 1):
        out.append(f'<measure number="{number}">')
        if number == 1:
            out.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>0</fifths></key>"
                       f'<time print-object="no"><beats>16</beats><beat-type>2</beat-type></time>{clef}</attributes>')
            if index == 1:
                out.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                           f'<per-minute>{BPM}</per-minute></metronome></direction-type><sound tempo="{BPM}"/></direction>')
        if number == 2:
            out.append("<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>")
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
       '<score-partwise version="3.1"><work><work-title>Vapaa rytmi</work-title></work><part-list>'
       + "".join(f'<score-part id="P{i}"><part-name>{n}</part-name></score-part>' for i, n in enumerate(names, 1))
       + "</part-list>"
       + "".join(part_xml(i, n, BARS[n]) for i, n in enumerate(names, 1))
       + "</score-partwise>\n")
open(f"{OUT}/score.musicxml", "w").write(xml)

points = []
start = 0
for m, quarters in enumerate(BAR_QUARTERS):
    for beat in range(quarters + 1):
        points.append([round((start + beat) * SECONDS_PER_QUARTER, 3), m, float(beat)])
    start += quarters
duration = start * SECONDS_PER_QUARTER
open(f"{OUT}/timing.json", "w").write(json.dumps(
    {"version": 1, "measures": len(BAR_QUARTERS), "duration": duration, "points": points}))

tempo = track([
    (0, b"\xff\x51\x03" + round(60_000_000 / BPM).to_bytes(3, "big")),
    (0, b"\xff\x58\x04\x04\x02\x18\x08"),
])
tracks = []
for channel, name in enumerate(names):
    events = [(0, b"\xff\x03" + vlq(len(name)) + name.encode()),
              (0, bytes([0xC0 | channel, 0])),
              (0, bytes([0xB0 | channel, 7, 100]))]
    for bar in BARS[name]:
        for step, octave, length, _, _ in bar:
            pitch = 12 * (octave + 1) + STEPS[step]
            events.append((0, bytes([0x90 | channel, pitch, 80])))
            events.append((length * MIDI_DIV // DIV, bytes([0x80 | channel, pitch, 0])))
    tracks.append(track(events))
header = b"MThd" + struct.pack(">IHHH", 6, 1, 1 + len(tracks), MIDI_DIV)
open(f"{OUT}/score.mid", "wb").write(header + tempo + b"".join(tracks))

manifest = {
    "slug": "vapaa-rytmi", "title": "Vapaa rytmi", "choir": "public", "version": "20261009T120000Z",
    "score": "score.musicxml", "timing": "timing.json",
    "parts": [{"name": n} for n in names],
    "duration": duration, "midi": "score.mid",
}
open(f"{OUT}/manifest.json", "w").write(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
