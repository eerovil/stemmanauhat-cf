import { createApp } from "vue";
import App from "./App.vue";
import { forgetSongLists } from "./api";
import { listenForInstall } from "./install";
import { isIOS, preventZoom } from "./no-zoom";
import "./style.css";

// Signing out, or landing on sign-in, forgets the song lists this tab kept (#43).
document.addEventListener("submit", (event) => {
  if ((event.target as HTMLFormElement).action.endsWith("/auth/logout")) forgetSongLists();
});
if (location.pathname.startsWith("/signin")) forgetSongLists();

listenForInstall();
createApp(App).mount("#app");
if (isIOS()) preventZoom();

// Installable as an app (public/manifest.webmanifest); sw.js only adds an offline page.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  });
}
