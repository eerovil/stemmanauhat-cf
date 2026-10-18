"""The two-part song with both parts on one staff, Tenori voice 1 and Basso voice 2,
as musescore-choir-plugins publishes a song of more than five parts (#420), except
that Basso sings bar 2 in unison with Tenori (eerovil/eeron-omat-taskit#76). Its
timing is the two-part song's own; its MIDI is written by make-two-part-midi.py.
Run from the repo root."""
import json
import re

src = open("tests/fixtures/two-part/score.musicxml").read()
parts = re.findall(r'<part id="P\d">(.*?)</part>', src, re.S)
tenor = re.findall(r"<measure.*?</measure>", parts[0], re.S)
bass = re.findall(r"<measure.*?</measure>", parts[1], re.S)


def voiced(measure, voice):
    return re.sub(r"(<duration>\d+</duration>)", rf"\1<voice>{voice}</voice>", measure)


measures = []
for bar, (top, low) in enumerate(zip(tenor, bass)):
    head, body = re.match(r"(<measure[^>]*>)(.*)</measure>", top, re.S).groups()
    lower = re.match(r"<measure[^>]*>(.*)</measure>", top if bar == 1 else low, re.S).group(1)
    lower = re.sub(r"<attributes>.*?</attributes>", "", lower, flags=re.S)
    lower = re.sub(r"<direction.*?</direction>", "", lower, flags=re.S)
    measures.append(head + voiced(body, 1) + "<backup><duration>4</duration></backup>"
                    + voiced(lower, 2) + "</measure>")
xml = re.sub(r"<part-list>.*</score-partwise>",
             '<part-list><score-part id="P1"><part-name>Tenori/Basso</part-name></score-part>'
             '</part-list><part id="P1">' + "".join(measures) + "</part></score-partwise>",
             src, flags=re.S)
open("tests/fixtures/shared-staff/score.musicxml", "w").write(xml)
manifest = json.load(open("tests/fixtures/two-part/manifest.json"))
manifest.update(slug="jaettu", title="Jaettu", choir="naiskuoro",
                parts=[{"name": "Tenori", "staff": 0, "voices": [1]},
                       {"name": "Basso", "staff": 0, "voices": [2]}])
json.dump(manifest, open("tests/fixtures/shared-staff/manifest.json", "w"), indent=1,
          ensure_ascii=False)
