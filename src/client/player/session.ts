/**
 * iPhones mute web audio when the ringer switch is on silent, unless the page
 * says it plays media (eerovil/stemmanauhat-cf#99). Safari 17 and later read
 * navigator.audioSession.type; "playback" makes the songs sound like a music
 * app does, silent switch or not. Older browsers have no audioSession and keep
 * their own behaviour. Called before each audio context is made and again from
 * the tap that starts it.
 */
export function allowSilentMode(nav: Navigator = navigator): void {
  const session = (nav as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && session.type !== "playback") session.type = "playback";
}
