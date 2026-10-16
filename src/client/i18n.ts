/**
 * The site's words in English and Finnish (JoyWeShare).
 *
 * The Finnish is the site's own text, copied as it was; the English is written for
 * US use. Part names, song titles and the AI voices' names are not translated.
 *
 * Which language a page shows: `?lang=` in the address, then the language last
 * chosen on this device, then the browser's preferred languages, then Finnish.
 */
import { computed, ref } from "vue";

export type Lang = "fi" | "en";
export const LANGS: readonly Lang[] = ["en", "fi"];

const LOCALES: Record<Lang, string> = { fi: "fi-FI", en: "en-US" };
const STORAGE_KEY = "stemmanauhat:lang";

const fi = {
  siteName: "Stemmanauhat",
  language: "Kieli",
  signOut: "Kirjaudu ulos",
  signInGoogle: "Kirjaudu Google-tilillä",
  admin: "Ylläpito",
  cancel: "Peru",
  send: "Lähetä",
  save: "Tallenna",
  remove: "Poista",
  edit: "Muokkaa",
  gotIt: "Selvä",
  sungVersion: "Laulettu versio",
  newBadge: "Uusi",
  loading: "Ladataan…",
  retry: "Yritä uudelleen",
  pdfOnly: "Nuotti (PDF)",

  composerAbbr: "säv.",
  lyricistAbbr: "san.",
  arrangerAbbr: "sov.",
  sungBy: "Tekoälyn laulama · Ääni:",
  flagProblems: {
    notes: "Väärä nuotti",
    part: "Väärä stemma",
    lyrics: "Sanat",
    timing: "Rytmi / ajoitus",
    sound: "Ääni",
    other: "Muu",
  },

  // JoyWeShare: replaces his "Tekijänoikeusvapaita kuorolauluja kaikille…" (copyright-free
  // songs), a claim this site does not make; Don's wording, 2026-10-15.
  homeOpenHint: "Harjoittele omaa stemmaasi omin päin, milloin vain.",
  homeMembersHint: "Kuoron jäsen? Kirjaudu, niin näet oman kuorosi laulut.",
  signedInAs: (email: string) => `Kirjautuneena: ${email}`,

  signinLead: "Kuorojen harjoitusnauhat: nuotti ja oma stemma.",
  signinFailed: "Kirjautuminen ei onnistunut. Yritä uudelleen.",
  signinOldLink: "Kuoron vanha linkki toimii edelleen ilman Google-tiliä.",
  tryDemo: "Kokeile esittelykappaleita",

  notFound: "Tätä sivua ei löytynyt.",
  toHome: "Etusivulle",
  refusedAccountBefore: "Tilillä",
  refusedAccountAfter: "ei ole pääsyä tähän kuoroon.",
  refusedNoAccount: "Sinulla ei ole pääsyä tähän kuoroon.",
  refusedHint: "Jos kuulut kuoroon, pyydä kuoron yhteyshenkilöä lisäämään sähköpostiosoitteesi.",
  useOtherAccount: "Käytä toista tiliä",

  joinText: "Pääsit sisään linkillä. Lisää Google-tilisi kuoron jäseneksi, niin pysyt kirjautuneena kaikilla laitteillasi.",
  joinButton: "Lisää Google-tili",
  continueFrom: "Jatka siitä",
  newSetlist: "Uusi setlista",
  editSetlist: "Muokkaa setlistaa",
  setlistName: "Setlistan nimi",
  moveUp: (title: string) => `Siirrä ylös: ${title}`,
  moveDown: (title: string) => `Siirrä alas: ${title}`,
  pickSongsBelow: "Valitse kappaleet alta.",
  addSongs: "Lisää kappaleita",
  deleteSetlist: "Poista setlista",
  saved: "Tallennettu.",
  confirmDeleteSetlist: (name: string) => `Poistetaanko setlista ${name}?`,
  setlistDeleted: "Setlista poistettu.",
  requestTrack: "Pyydä stemmanauhaa",
  requestHint: "Kirjoita kappaleen nimi tai liitä nuotti, tai molemmat.",
  songName: "Kappaleen nimi",
  composerArranger: "Säveltäjä / sovittaja",
  notes: "Lisätietoja",
  yourName: "Nimesi",
  musicPdfOptional: "Nuotti (PDF, vapaaehtoinen)",
  needTitleOrPdf: "Kirjoita kappaleen nimi tai liitä nuotti.",
  requestSent: "Kiitos! Pyyntö lähetetty.",
  setlist: "Setlista",
  allSongs: "Kaikki kappaleet",
  showAll: "Näytä kaikki",
  searchSongs: "Hae kappaletta",
  order: "Järjestys",
  byName: "Nimi",
  newest: "Uusimmat",
  otherSongs: "Muut kappaleet",
  noSongs: "Ei vielä kappaleita.",
  setlistEmpty: "Setlistassa ei ole vielä kappaleita.",
  setlistCount: (n: number, total: number) => `Setlistassa ${n} kappaletta, kaikkiaan ${total}.`,
  requested: (n: number) => `Pyydetyt (${n})`,
  requestsCount: (n: number) => `Pyyntöjä: ${n}`,

  loadFailed: "Kappaleen lataus epäonnistui:",
  preparingSound: "Valmistellaan ääntä…",
  tapWord: "Napauta",
  tapPlay: " nuottia: soita tai pysäytä",
  tapMove: " nuottia: siirry siihen",
  dragWord: "Vedä",
  dragMove: " nuottia sivulle: siirry",
  reportedProblems: "Ilmoitetut virheet",
  reportedProblem: "Ilmoitettu virhe:",
  listening: "Kuuntelu",
  howYouListen: "Miten kuuntelet",
  modes: {
    focus: { label: "Oma esillä", hint: "Oma stemma kovaa, muut hiljempaa" },
    equal: { label: "Tasan", hint: "Kaikki stemmat yhtä kovaa, kuin kuorossa" },
    minus: { label: "Ilman omaa", hint: "Oma stemma hiljaa: laula se itse" },
    solo: { label: "Vain oma", hint: "Pelkkä oma stemma" },
  },
  sound: "Ääni",
  piano: "Piano",
  sung: "Laulu",
  loadingSinging: "Ladataan laulua…",
  singingFailed: "Laulua ei saatu soimaan, soitetaan piano.",
  tempo: "Tempo",
  otherParts: "Muut stemmat",
  otherPartsVolume: "Muiden stemmojen voimakkuus",
  loadingPiano: "Ladataan pianoa…",
  loadingParts: "Ladataan stemmoja…",
  slower: "Hitaammin",
  normalTempo: "Normaali tempo",
  normal: "Normaali",
  faster: "Nopeammin",
  score: "Nuotti",
  staves: "Viivastot",
  allStaves: "Kaikki",
  ownStaff: "Oma",
  scoreSize: "Nuotin koko",
  smaller: "Pienennä nuottia",
  larger: "Suurenna nuottia",
  reportProblem: "Ilmoita virheestä",
  flagThanks: "Kiitos! Ilmoitus lähetetty.",
  position: "Kohta kappaleessa",
  backToSongs: "Takaisin lauluihin",
  bar: "Tahti",
  changePart: "Vaihda oma stemma",
  ownTag: "Oma",
  pause: "Tauko",
  play: "Soita",
  closeSettings: "Sulje säädöt",
  settings: "Säädöt",
  flagIntro: "Mikä on vialla? Ilmoitus menee ylläpitäjälle, joka korjaa nuotin.",
  whatsWrong: "Mikä on vialla",
  flagNeedSomething: "Valitse mikä on vialla tai kirjoita lisätietoja.",
  chooseYourPart: "Valitse oma stemma",
  whichPart: "Mikä on sinun stemmasi?",
  partIntro: "Se soi kovimmin ja sen nuotit näkyvät tummalla sinisellä. Voit vaihtaa sitä myöhemmin napauttamalla Oma-painiketta.",

  requestsHeading: (n: number) => `Pyynnöt (${n})`,
  noRequests: "Ei pyyntöjä.",
  flagTag: "Virhe:",
  barLower: (n: number) => `tahti ${n}`,
  partLower: (part: string) => `stemma ${part}`,
  viaLink: "Linkillä tullut",
  doneOn: (day: string) => ` · tehty ${day}`,
  done: "Tehty",
  members: (n: number) => `Jäsenet (${n})`,
  pasteEmails: "Liitä sähköpostiosoitteet, yksi riville",
  addMembers: (name: string) => `Lisää jäseniä: ${name}`,
  add: "Lisää",
  choirLink: "Kuoron linkki",
  linkHint: "Linkillä pääsee kappaleisiin heti, ja Google-tilin voi lisätä jäseneksi samalla.",
  linkLabel: (name: string) => `Linkki: ${name}`,
  copy: "Kopioi",
  oldLinkHidden: "Vanha linkki on käytössä, mutta sitä ei voi näyttää. Tee uusi, jos haluat jakaa linkin täältä.",
  linkOff: "Linkillä kirjautuminen on pois päältä.",
  newLink: "Tee uusi linkki",
  makeLink: "Tee linkki",
  turnOff: "Pois päältä",
  admins: "Ylläpitäjät",
  addAdminBefore: "Ylläpitäjän lisää",
  added: (n: number) => `Lisätty ${n}.`,
  noValidAddresses: "Ei kelvollisia osoitteita.",
  confirmRemove: (email: string) => `Poistetaanko ${email}?`,
  removed: (email: string) => `Poistettu ${email}.`,
  confirmNewLink: "Tehdäänkö uusi linkki? Vanha linkki lakkaa toimimaan.",
  newLinkMade: "Uusi linkki tehty. Vanhalla linkillä tulleet on kirjattu ulos.",
  linkMade: "Linkki tehty.",
  linkCopied: "Linkki kopioitu.",
  confirmLinkOff: "Poistetaanko linkillä kirjautuminen tästä kuorosta?",
  markedDone: (title: string) => `Merkitty tehdyksi: ${title}.`,
  confirmRemoveFlag: (title: string) => `Poistetaanko virheilmoitus ${title}?`,
  confirmRemoveRequest: (title: string) => `Poistetaanko pyyntö ${title}?`,
  flagRemoved: "Virheilmoitus poistettu.",
  requestRemoved: "Pyyntö poistettu.",
};

export type Messages = typeof fi;

const en: Messages = {
  siteName: "JoyWeShare Rehearse",
  language: "Language",
  signOut: "Sign out",
  signInGoogle: "Sign in with Google",
  admin: "Admin",
  cancel: "Cancel",
  send: "Send",
  save: "Save",
  remove: "Remove",
  edit: "Edit",
  gotIt: "Got it",
  sungVersion: "Sung version",
  newBadge: "New",
  loading: "Loading…",
  retry: "Try again",
  pdfOnly: "Music (PDF)",

  composerAbbr: "music",
  lyricistAbbr: "words",
  arrangerAbbr: "arr.",
  sungBy: "Sung by AI · Voice:",
  flagProblems: {
    notes: "Wrong note",
    part: "Wrong part",
    lyrics: "Words",
    timing: "Rhythm / timing",
    sound: "Sound",
    other: "Other",
  },

  homeOpenHint: "Rehearse your part on your own, anytime.",
  homeMembersHint: "In a choir? Sign in to see your choir's songs.",
  signedInAs: (email: string) => `Signed in as ${email}`,

  signinLead: "Practice tracks for choirs: the score and your own part.",
  signinFailed: "Signing in didn't work. Please try again.",
  signinOldLink: "Your choir's link still works without a Google account.",
  tryDemo: "Try the demo songs",

  notFound: "This page wasn't found.",
  toHome: "Home page",
  refusedAccountBefore: "The account",
  refusedAccountAfter: "doesn't have access to this choir.",
  refusedNoAccount: "You don't have access to this choir.",
  refusedHint: "If you're in this choir, ask your choir's contact to add your email address.",
  useOtherAccount: "Use another account",

  joinText: "You came in with the choir's link. Add your Google account to the choir to stay signed in on all your devices.",
  joinButton: "Add Google account",
  continueFrom: "Continue",
  newSetlist: "New setlist",
  editSetlist: "Edit setlist",
  setlistName: "Setlist name",
  moveUp: (title: string) => `Move up: ${title}`,
  moveDown: (title: string) => `Move down: ${title}`,
  pickSongsBelow: "Choose songs below.",
  addSongs: "Add songs",
  deleteSetlist: "Delete setlist",
  saved: "Saved.",
  confirmDeleteSetlist: (name: string) => `Delete the setlist ${name}?`,
  setlistDeleted: "Setlist deleted.",
  requestTrack: "Request a practice track",
  requestHint: "Give the song's name, attach the music, or both.",
  songName: "Song name",
  composerArranger: "Composer / arranger",
  notes: "Notes",
  yourName: "Your name",
  musicPdfOptional: "Music (PDF, optional)",
  needTitleOrPdf: "Give the song's name or attach the music.",
  requestSent: "Thank you! Your request was sent.",
  setlist: "Setlist",
  allSongs: "All songs",
  showAll: "Show all",
  searchSongs: "Search for a song",
  order: "Order",
  byName: "Name",
  newest: "Newest",
  otherSongs: "Other songs",
  noSongs: "No songs yet.",
  setlistEmpty: "This setlist has no songs yet.",
  setlistCount: (n: number, total: number) => `${n} songs in this setlist, ${total} in all.`,
  requested: (n: number) => `Requested (${n})`,
  requestsCount: (n: number) => `Requests: ${n}`,

  loadFailed: "The song didn't load:",
  preparingSound: "Preparing the sound…",
  tapWord: "Tap",
  tapPlay: " the score: play or pause",
  tapMove: " a note: go to it",
  dragWord: "Drag",
  dragMove: " the score sideways: move",
  reportedProblems: "Reported problems",
  reportedProblem: "Reported problem:",
  listening: "Listening",
  howYouListen: "How you listen",
  modes: {
    focus: { label: "Mine up front", hint: "Your part loud, the others softer" },
    equal: { label: "Even", hint: "All parts equally loud, as in the choir" },
    minus: { label: "Without mine", hint: "Your part silent: sing it yourself" },
    solo: { label: "Mine only", hint: "Your part alone" },
  },
  sound: "Sound",
  piano: "Piano",
  sung: "Singing",
  loadingSinging: "Loading the singing…",
  singingFailed: "The singing couldn't play, so the piano plays.",
  tempo: "Tempo",
  otherParts: "Other parts",
  otherPartsVolume: "Volume of the other parts",
  loadingPiano: "Loading the piano…",
  loadingParts: "Loading the sung parts…",
  slower: "Slower",
  normalTempo: "Normal tempo",
  normal: "Normal",
  faster: "Faster",
  score: "Score",
  staves: "Staves",
  allStaves: "All",
  ownStaff: "Mine",
  scoreSize: "Score size",
  smaller: "Smaller score",
  larger: "Larger score",
  reportProblem: "Report a problem",
  flagThanks: "Thank you! Your report was sent.",
  position: "Position in the song",
  backToSongs: "Back to the songs",
  bar: "Bar",
  changePart: "Change your part",
  ownTag: "Mine",
  pause: "Pause",
  play: "Play",
  closeSettings: "Close settings",
  settings: "Settings",
  flagIntro: "What's wrong? Your report goes to the admin, who corrects the score.",
  whatsWrong: "What's wrong",
  flagNeedSomething: "Choose what's wrong or write a note.",
  chooseYourPart: "Choose your part",
  whichPart: "Which part do you sing?",
  partIntro: "It plays loudest, and its notes show in dark blue. You can change it later with the Mine button.",

  requestsHeading: (n: number) => `Requests (${n})`,
  noRequests: "No requests.",
  flagTag: "Problem:",
  barLower: (n: number) => `bar ${n}`,
  partLower: (part: string) => `part ${part}`,
  viaLink: "Came by link",
  doneOn: (day: string) => ` · done ${day}`,
  done: "Done",
  members: (n: number) => `Members (${n})`,
  pasteEmails: "Paste email addresses, one per line",
  addMembers: (name: string) => `Add members: ${name}`,
  add: "Add",
  choirLink: "Choir link",
  linkHint: "The link opens the songs at once, and a Google account can be added to the choir at the same time.",
  linkLabel: (name: string) => `Link: ${name}`,
  copy: "Copy",
  oldLinkHidden: "An older link is in use but can't be shown. Make a new one to share it from here.",
  linkOff: "Signing in by link is off.",
  newLink: "Make a new link",
  makeLink: "Make a link",
  turnOff: "Turn off",
  admins: "Admins",
  addAdminBefore: "Admins are added with",
  added: (n: number) => `Added ${n}.`,
  noValidAddresses: "No valid addresses.",
  confirmRemove: (email: string) => `Remove ${email}?`,
  removed: (email: string) => `Removed ${email}.`,
  confirmNewLink: "Make a new link? The old link will stop working.",
  newLinkMade: "New link made. Everyone who came by the old link is signed out.",
  linkMade: "Link made.",
  linkCopied: "Link copied.",
  confirmLinkOff: "Turn off signing in by link for this choir?",
  markedDone: (title: string) => `Marked done: ${title}.`,
  confirmRemoveFlag: (title: string) => `Remove the problem report ${title}?`,
  confirmRemoveRequest: (title: string) => `Remove the request ${title}?`,
  flagRemoved: "Problem report removed.",
  requestRemoved: "Request removed.",
};

export const MESSAGES: Record<Lang, Messages> = { fi, en };

const isLang = (value: unknown): value is Lang => value === "fi" || value === "en";

/** The language to show: `?lang=`, this device's choice, the browser's languages, then Finnish. */
export function pickLang(from: { param: string | null; stored: string | null; browser: readonly string[] }): Lang {
  if (isLang(from.param)) return from.param;
  if (isLang(from.stored)) return from.stored;
  for (const tag of from.browser) {
    const main = tag.toLowerCase().split("-")[0];
    if (isLang(main)) return main;
  }
  return "fi";
}

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function initial(): Lang {
  if (typeof window === "undefined") return "fi";
  return pickLang({
    param: new URLSearchParams(location.search).get("lang"),
    stored: stored(),
    browser: navigator.languages?.length ? navigator.languages : [navigator.language ?? ""],
  });
}

/** The language shown now. */
export const lang = ref<Lang>(initial());
/** The words for the language shown now; in a template, `t.searchSongs`. */
export const t = computed(() => MESSAGES[lang.value]);
/** The same words outside a component. */
export const words = (): Messages => MESSAGES[lang.value];

function showLang() {
  if (typeof document !== "undefined") document.documentElement.lang = lang.value;
}
showLang();

/** Switches the language and remembers the choice on this device. */
export function setLang(next: Lang) {
  lang.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing may refuse storage; the choice then lasts this page.
  }
  showLang();
}

/** For unit tests: the language, without storage. */
export function setLangForTests(next: Lang) {
  lang.value = next;
}

/** The locale for dates and alphabetical order in the language shown now. */
export const sortLocale = () => LOCALES[lang.value];
/** A date as the language writes it: 10/5/2026, or 5.10.2026. */
export const day = (at: string) => new Date(at).toLocaleDateString(sortLocale());
/** Alphabetical order in the language shown now. */
export const byTitle = <T extends { title: string }>(a: T, b: T) => a.title.localeCompare(b.title, sortLocale());
