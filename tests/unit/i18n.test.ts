import { afterEach, describe, expect, it } from "vitest";
import { credits, flagProblems, listCredits, problemLabels, sungCredit } from "../../src/client/api";
import { MESSAGES, pickLang, setLangForTests, sortLocale } from "../../src/client/i18n";
import { parseFlag, parseRequest } from "../../src/worker/requests";
import { serverMessage } from "../../src/worker/messages";

afterEach(() => setLangForTests("fi"));

describe("the phrase table", () => {
  it("has every phrase in both languages", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.fi).sort());
    for (const lang of ["fi", "en"] as const) {
      for (const [key, value] of Object.entries(MESSAGES[lang])) {
        const text = typeof value === "function" ? (value as (...a: unknown[]) => string)("X", 2, 3)
          : typeof value === "object" ? JSON.stringify(value) : value;
        expect(text, `${lang}.${key}`).toMatch(/\S/);
        if (typeof value === "object") {
          expect(Object.keys(MESSAGES.en[key as keyof typeof MESSAGES.en] as object).sort(), `${key} keys`)
            .toEqual(Object.keys(MESSAGES.fi[key as keyof typeof MESSAGES.fi] as object).sort());
        }
      }
    }
  });

  it("keeps the Finnish exactly as the screens had it", () => {
    const fi = MESSAGES.fi;
    expect(fi.siteName).toBe("Stemmanauhat");
    expect(fi.searchSongs).toBe("Hae kappaletta");
    expect([fi.popular, fi.byName, fi.newest]).toEqual(["Suositut", "Nimi", "Uusimmat"]);
    expect(fi.noSongs).toBe("Ei vielä kappaleita.");
    expect(fi.requestTrack).toBe("Pyydä stemmanauhaa");
    expect(fi.signOut).toBe("Kirjaudu ulos");
    expect(fi.joinText).toBe("Pääsit sisään linkillä. Lisää Google-tilisi kuoron jäseneksi, niin pysyt kirjautuneena kaikilla laitteillasi.");
    expect(fi.setlistCount(2, 5)).toBe("Setlistassa 2 kappaletta, kaikkiaan 5.");
    expect(fi.modes.focus).toEqual({ label: "Oma esillä", hint: "Oma stemma kovaa, muut hiljempaa" });
    expect(fi.settings).toBe("Säädöt");
    expect(fi.chooseYourPart).toBe("Valitse oma stemma");
    expect(fi.added(3)).toBe("Lisätty 3.");
    expect(fi.otherParts).toBe("Muut stemmat");
    expect(fi.otherPartsVolume).toBe("Muiden stemmojen voimakkuus");
    expect(fi.loadingPiano).toBe("Ladataan pianoa…");
    expect(fi.loadingParts).toBe("Ladataan stemmoja…");
  });

  it("keeps the home page's line, with its English translation", () => {
    expect(MESSAGES.fi.homeOpenHint).toBe("Tekijänoikeusvapaita kuorolauluja kaikille. Valitse laulu ja harjoittele omaa stemmaasi.");
    expect(MESSAGES.en.homeOpenHint).toBe("Choir songs free of copyright, for everyone. Choose a song and practice your part.");
  });
});

describe("which language a page shows", () => {
  it("takes ?lang= first, then this device's choice, then the browser, then Finnish", () => {
    expect(pickLang({ param: "en", stored: "fi", browser: ["fi-FI"] })).toBe("en");
    expect(pickLang({ param: null, stored: "en", browser: ["fi-FI"] })).toBe("en");
    expect(pickLang({ param: null, stored: null, browser: ["en-GB", "fi"] })).toBe("en");
    expect(pickLang({ param: null, stored: null, browser: ["sv-SE", "fi-FI"] })).toBe("fi");
    expect(pickLang({ param: null, stored: null, browser: ["de-DE"] })).toBe("fi");
    expect(pickLang({ param: null, stored: null, browser: [] })).toBe("fi");
  });

  it("ignores a language it does not have", () => {
    expect(pickLang({ param: "de", stored: "xx", browser: ["en-US"] })).toBe("en");
  });

  it("sorts and writes dates the language's way", () => {
    setLangForTests("en");
    expect(sortLocale()).toBe("en-US");
    setLangForTests("fi");
    expect(sortLocale()).toBe("fi-FI");
  });
});

describe("credits and labels follow the language", () => {
  it("stays Finnish by default", () => {
    expect(credits({ composer: "A", lyricist: "B", arranger: "C" })).toBe("säv. A · san. B · sov. C");
    expect(sungCredit([{ name: "T", file: "a.mp3", sung: true }])).toBe("Tekoälyn laulama · Ääni: REMY, UTAU French Resources (Hisa!)");
  });

  it("is English when English is chosen", () => {
    setLangForTests("en");
    expect(credits({ composer: "A", lyricist: "B", arranger: "C" })).toBe("music A · words B · arr. C");
    expect(listCredits({ composer: "A", lyricist: "B", arranger: "C" })).toBe("music A · arr. C");
    expect(sungCredit([{ name: "T", file: "a.mp3", sung: true }])).toBe("Sung by AI · Voice: REMY, UTAU French Resources (Hisa!)");
    expect(flagProblems().notes).toBe("Wrong note");
    expect(problemLabels(["notes", "lyrics"])).toBe("Wrong note, Words");
  });
});

describe("the server's messages follow the page's language", () => {
  it("answers in Finnish unless the page asks for English", () => {
    expect(serverMessage("fi").passphraseShort).toBe("Salasanan pitää olla vähintään 6 merkkiä.");
    expect(serverMessage("en").passphraseShort).toBe("The passphrase must be at least 6 characters.");
    expect(parseRequest({ title: "", credits: "", note: "", name: "" }, false))
      .toEqual({ error: "Kirjoita kappaleen nimi tai liitä nuotti." });
    expect(parseRequest({ title: "", credits: "", note: "", name: "" }, false, "en"))
      .toEqual({ error: "Give the song's name or attach the music." });
    expect(parseFlag({ problems: [], note: "" }, "en")).toEqual({ error: "Choose what's wrong or write a note." });
  });
});
