"""Writes tests/fixtures/long-syllables/: a made-up song shaped like the bars
around one that OSMD drew far too wide (#127). Its notes and words are made up;
only the rhythm follows that bar and the two before it.

Four parts, 120 bpm. Bar 3 (6/8) has a word in every part whose last syllable
is held over into bar 4; bar 4 has no words in two of the parts. Bar 5 (4/4) is
the wide one: one part holds a whole note while the others come in late on
sixteenths, eighths and a dotted eighth with hyphenated syllables. OSMD left
room after each short note with a long syllable, as wide as the syllable, and
with the overhang carried on from bar 3 the bar came out about twice as wide per
beat as its neighbours. Writes score.musicxml, timing.json, score.mid and
manifest.json.
Run from the repo root: python3 tests/fixtures/make-long-syllables.py
"""
import json
import struct

OUT = "tests/fixtures/long-syllables"
DIV = 12  # MusicXML divisions per quarter
MIDI_DIV = 480
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# Length in twelfths of a quarter: (type, dotted)
TYPES = {48: ("whole", False), 24: ("half", False), 18: ("quarter", True), 12: ("quarter", False),
         9: ("eighth", True), 6: ("eighth", False), 3: ("16th", False)}
# Each bar's time signature, as (beats, beat type).
TIMES = [(4, 4), (4, 4), (6, 8), (6, 8), (4, 4), (4, 4), (4, 4)]
R = None


def plain(octave):
    return [("C", octave, 12, "la"), ("D", octave, 12, "la"), ("E", octave, 12, "la"), ("D", octave, 12, "la")]


def held(pitches):
    """Bar 3: a word whose last syllable is held over into bar 4."""
    (s1, o1), (s2, o2), (s3, o3) = pitches
    return [(s1, o1, 12, "vaa", "begin"), (s2, o2, 6, "ra", "middle"), (s3, o3, 18, "ton?", "end", "start")]


# (step, octave, length in twelfths of a quarter, syllable, syllabic, tie); a rest has no step.
# The pitches are ones that drew bar 5 about twice as wide per beat as its neighbours:
# how wide OSMD draws it depends on them too.
BARS = {
    "Tenori 1": [
        plain(4), plain(4), held([("D", 5), ("D", 4), ("E", 4)]),
        [("E", 4, 18, R, R, "stop"), (R, R, 12, R), ("F", 5, 3, "Ki", "begin"), ("A", 4, 3, "vä", "end")],
        [("D", 5, 48, "on", "single")],
        plain(4), [("C", 4, 48, "laa")],
    ],
    "Tenori 2": [
        plain(4), plain(4), held([("B", 4), ("D", 4), ("C", 5)]),
        [("C", 5, 18, R, R, "stop start"), ("C", 5, 18, R, R, "stop")],
        [(R, R, 6, R), ("D", 4, 3, "Ki", "begin"), ("E", 4, 3, "vä", "end"), ("D", 4, 12, "on", "single", "start"),
         ("D", 4, 24, R, R, "stop")],
        plain(4), [("C", 4, 48, "laa")],
    ],
    "Basso 1": [
        plain(3), plain(3),
        [("D", 2, 12, "vaa", "begin"), ("B", 3, 6, "ra", "middle"), ("D", 2, 6, "ton?", "end"),
         ("F", 2, 6, "mat", "begin"), ("A", 2, 6, "kan", "end")],
        [("D", 2, 6, "vaa", "begin"), ("F", 3, 6), ("B", 3, 6, "ra", "middle"), ("G", 3, 18, "ton?", "end")],
        [(R, R, 12, R), (R, R, 6, R), ("A", 3, 3, "Ki", "begin"), ("E", 2, 3, "vä", "end"),
         ("D", 3, 24, "on", "single")],
        plain(3), [("C", 3, 48, "laa")],
    ],
    "Basso 2": [
        plain(3), plain(3), held([("G", 2), ("C", 2), ("B", 3)]),
        [("B", 3, 18, R, R, "stop start"), ("B", 3, 18, R, R, "stop")],
        [(R, R, 24, R), (R, R, 6, R), ("D", 2, 6, "Kai", "begin"), ("E", 2, 9, "vail", "middle"),
         ("G", 2, 3, "la", "end")],
        plain(3), [("C", 3, 48, "laa")],
    ],
}
BPM = 120
SECONDS_PER_QUARTER = 60 / BPM


def bar_length(number):
    beats, beat_type = TIMES[number - 1]
    return beats * 4 * DIV // beat_type


def note_xml(step, octave, length, syllable=None, syllabic="single", tie=""):
    kind, dotted = TYPES[length]
    dot = "<dot/>" if dotted else ""
    if step is None:
        return f"<note><rest/><duration>{length}</duration><type>{kind}</type>{dot}</note>"
    ties = tie.split() if tie else []
    lyric = (f"<lyric number=\"1\"><syllabic>{syllabic}</syllabic><text>{syllable}</text></lyric>"
             if syllable else "")
    tied = "".join(f'<tied type="{t}"/>' for t in ties)
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{length}</duration>" + "".join(f'<tie type="{t}"/>' for t in ties)
            + f"<type>{kind}</type>{dot}" + (f"<notations>{tied}</notations>" if tied else "") + f"{lyric}</note>")


def part_xml(index, name, bars):
    clef = ("<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
            if name.startswith("Tenori") else "<clef><sign>F</sign><line>4</line></clef>")
    out = [f'<part id="P{index}">']
    for number, bar in enumerate(bars, 1):
        assert sum(n[2] for n in bar) == bar_length(number), (name, number)
        out.append(f'<measure number="{number}">')
        beats, beat_type = TIMES[number - 1]
        time = f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>"
        if number == 1:
            out.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>0</fifths></key>{time}{clef}</attributes>")
            if index == 1:
                out.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                           f'<per-minute>{BPM}</per-minute></metronome></direction-type><sound tempo="{BPM}"/></direction>')
        elif TIMES[number - 1] != TIMES[number - 2]:
            out.append(f"<attributes>{time}</attributes>")
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
       '<score-partwise version="3.1"><work><work-title>Pitkät tavut</work-title></work><part-list>'
       + "".join(f'<score-part id="P{i}"><part-name>{n}</part-name></score-part>' for i, n in enumerate(names, 1))
       + "</part-list>"
       + "".join(part_xml(i, n, BARS[n]) for i, n in enumerate(names, 1))
       + "</score-partwise>\n")
open(f"{OUT}/score.musicxml", "w").write(xml)

measures = len(TIMES)
points = []
start = 0.0
for m in range(measures):
    quarters = bar_length(m + 1) // DIV
    for beat in range(quarters + 1):
        points.append([round((start + beat) * SECONDS_PER_QUARTER, 3), m, float(beat)])
    start += quarters
duration = start * SECONDS_PER_QUARTER
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
        for step, octave, length, *_ in bar:
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
    "slug": "pitkat-tavut", "title": "Pitkät tavut", "choir": "public", "version": "20261025T120000Z",
    "score": "score.musicxml", "timing": "timing.json",
    "parts": [{"name": n} for n in names],
    "duration": duration, "midi": "score.mid",
}
open(f"{OUT}/manifest.json", "w").write(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
