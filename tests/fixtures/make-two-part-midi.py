"""Writes tests/fixtures/two-part/score.mid: the made-up two-part test song as MIDI.

Matches score.musicxml and timing.json: 4/4 at 120 bpm, four bars of quarter
notes, a track per part named as in manifest.json (Tenori, Basso), one channel
each, piano. Run from the repo root: python3 tests/fixtures/make-two-part-midi.py
"""
import struct

DIV = 480
NOTES = {
    "Tenori": [64, 64, 64, 64, 62, 64, 65, 64, 60, 62, 64, 67, 64, 64, 64, 64],
    "Basso": [52, 52, 52, 52, 55, 55, 57, 55, 57, 55, 53, 52, 52, 52, 52, 52],
}


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


tempo = track([
    (0, b"\xff\x51\x03" + (500000).to_bytes(3, "big")),          # 120 bpm
    (0, b"\xff\x58\x04\x04\x02\x18\x08"),                        # 4/4
])
parts = []
for channel, (name, pitches) in enumerate(NOTES.items()):
    events = [(0, b"\xff\x03" + vlq(len(name)) + name.encode()),
              (0, bytes([0xC0 | channel, 0])),                    # piano
              (0, bytes([0xB0 | channel, 7, 100]))]               # volume
    for pitch in pitches:
        events.append((0, bytes([0x90 | channel, pitch, 80])))
        events.append((DIV, bytes([0x80 | channel, pitch, 0])))
    parts.append(track(events))

header = b"MThd" + struct.pack(">IHHH", 6, 1, 1 + len(parts), DIV)
open("tests/fixtures/two-part/score.mid", "wb").write(header + tempo + b"".join(parts))
