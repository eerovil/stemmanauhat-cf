"""Writes tests/fixtures/signatures/: a made-up song whose clef, key and time signature change
along the way, for the one-line view's pinned signature (the clef, key and time of the bar
under the playhead stay at the left edge as the line slides).

Tenori (treble clef, 8 below) and Basso (bass clef), at 120 bpm:
  bars 1-8   F major (one flat), 4/4
  bars 9-12  F major, 3/4
  bars 13-16 D major (two sharps; the flat is cancelled by a natural), 4/4 again
  bars 17-24 A major (three sharps), 4/4 (a key change alone)
  bars 21-24 Tenori moves to the bass clef (a clef change alone)
Writes score.musicxml, timing.json, score.mid and manifest.json.
Run from the repo root: python3 tests/fixtures/make-signatures.py
"""
import json
import struct

OUT = "tests/fixtures/signatures"
DIV = 1  # MusicXML divisions per quarter
MIDI_DIV = 480
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
BPM = 120
SECONDS_PER_QUARTER = 60 / BPM
NAMES = ["Tenori", "Basso"]
PITCH = {"Tenori": ("A", 3), "Basso": ("D", 2)}

# (first bar, beats, fifths); each applies from its first bar on.
CHANGES = [(1, 4, -1), (9, 3, -1), (13, 4, 2), (17, 4, 3)]
BAR_COUNT = 24
# Tenori's clef changes here: OSMD draws it at the end of the bar before.
CLEF_CHANGE = (21, "Tenori")
TEXT = ["la", "li", "lo", "lu"]


def beats_of(bar):
    return [c for c in CHANGES if c[0] <= bar][-1][1]


def attributes(bar, name):
    first = bar == 1
    change = next((c for c in CHANGES if c[0] == bar), None)
    new_clef = (bar, name) == CLEF_CHANGE
    if not first and not change and not new_clef:
        return ""
    old = [c for c in CHANGES if c[0] < bar]
    key = change and (first or change[2] != old[-1][2])
    time = change and (first or change[1] != old[-1][1])
    treble = "<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
    bass = "<clef><sign>F</sign><line>4</line></clef>"
    clef = treble if name == "Tenori" and not new_clef else bass
    out = "<attributes>"
    if first:
        out += f"<divisions>{DIV}</divisions>"
    if key:
        out += f"<key><fifths>{change[2]}</fifths></key>"
    if time:
        out += f"<time><beats>{change[1]}</beats><beat-type>4</beat-type></time>"
    if first or new_clef:
        out += clef
    return out + "</attributes>"


def part_xml(index, name):
    step, octave = PITCH[name]
    out = [f'<part id="P{index}">']
    for bar in range(1, BAR_COUNT + 1):
        out.append(f'<measure number="{bar}">' + attributes(bar, name))
        if bar == 1 and index == 1:
            out.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                       f'<per-minute>{BPM}</per-minute></metronome></direction-type><sound tempo="{BPM}"/></direction>')
        for beat in range(beats_of(bar)):
            out.append(f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
                       f'<duration>{DIV}</duration><type>quarter</type>'
                       f'<lyric number="1"><syllabic>single</syllabic><text>{TEXT[beat % 4]}</text></lyric></note>')
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


xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
       '"http://www.musicxml.org/dtds/partwise.dtd">\n'
       '<score-partwise version="3.1"><work><work-title>Merkinnät</work-title></work><part-list>'
       + "".join(f'<score-part id="P{i}"><part-name>{n}</part-name></score-part>' for i, n in enumerate(NAMES, 1))
       + "</part-list>" + "".join(part_xml(i, n) for i, n in enumerate(NAMES, 1))
       + "</score-partwise>\n")
open(f"{OUT}/score.musicxml", "w").write(xml)

points = []
quarters = 0
for bar in range(BAR_COUNT):
    beats = beats_of(bar + 1)
    for beat in range(beats + 1):
        points.append([round((quarters + beat) * SECONDS_PER_QUARTER, 3), bar, float(beat)])
    quarters += beats
duration = quarters * SECONDS_PER_QUARTER
open(f"{OUT}/timing.json", "w").write(json.dumps(
    {"version": 1, "measures": BAR_COUNT, "duration": duration, "points": points}))

tempo = track([
    (0, b"\xff\x51\x03" + round(60_000_000 / BPM).to_bytes(3, "big")),
    (0, b"\xff\x58\x04\x04\x02\x18\x08"),
])
tracks = []
for channel, name in enumerate(NAMES):
    step, octave = PITCH[name]
    pitch = 12 * (octave + 1) + STEPS[step]
    events = [(0, b"\xff\x03" + vlq(len(name)) + name.encode()),
              (0, bytes([0xC0 | channel, 0])),
              (0, bytes([0xB0 | channel, 7, 100]))]
    for _ in range(quarters):
        events.append((0, bytes([0x90 | channel, pitch, 80])))
        events.append((MIDI_DIV, bytes([0x80 | channel, pitch, 0])))
    tracks.append(track(events))
header = b"MThd" + struct.pack(">IHHH", 6, 1, 1 + len(tracks), MIDI_DIV)
open(f"{OUT}/score.mid", "wb").write(header + tempo + b"".join(tracks))

manifest = {
    "slug": "merkinnat", "title": "Merkinnät", "choir": "public", "version": "20261009T120000Z",
    "score": "score.musicxml", "timing": "timing.json",
    "parts": [{"name": n} for n in NAMES],
    "duration": duration, "midi": "score.mid",
}
open(f"{OUT}/manifest.json", "w").write(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
