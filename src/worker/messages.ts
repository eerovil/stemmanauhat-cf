/**
 * The messages a singer or admin can see from the server, in English and Finnish.
 * The page says which language it shows in the X-Lang header
 * (src/client/api.ts); without it, Finnish, as before.
 */
export type ServerLang = "fi" | "en";

const fi = {
  passphraseShort: "Salasanan pitää olla vähintään 6 merkkiä.",
  setlistNameLength: (max: number) => `Nimen pitää olla 1–${max} merkkiä.`,
  badSongList: "Kappalelista ei kelpaa.",
  pdfTooBig: "PDF on liian suuri (yli 20 Mt).",
  notPdf: "Liite ei ole PDF.",
  tooLong: (max: number) => `Liian pitkä teksti (yli ${max} merkkiä).`,
  needTitleOrPdf: "Kirjoita kappaleen nimi tai liitä nuotti.",
  unknownProblem: "Tuntematon virheen laji.",
  badBar: "Tahdin numero ei kelpaa.",
  flagNeedSomething: "Valitse mikä on vialla tai kirjoita lisätietoja.",
};

const en: typeof fi = {
  passphraseShort: "The passphrase must be at least 6 characters.",
  setlistNameLength: (max: number) => `The name must be 1–${max} characters.`,
  badSongList: "The song list isn't valid.",
  pdfTooBig: "The PDF is too large (over 20 MB).",
  notPdf: "The attachment isn't a PDF.",
  tooLong: (max: number) => `The text is too long (over ${max} characters).`,
  needTitleOrPdf: "Give the song's name or attach the music.",
  unknownProblem: "Unknown kind of problem.",
  badBar: "That bar number isn't valid.",
  flagNeedSomething: "Choose what's wrong or write a note.",
};

export const serverMessage = (lang: ServerLang) => (lang === "en" ? en : fi);

/** The language the page asked for: English when it says so, otherwise Finnish. */
export const requestLang = (request: Request): ServerLang =>
  request.headers.get("X-Lang") === "en" ? "en" : "fi";
