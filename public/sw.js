// Makes the site installable and shows an offline page when there is no
// network. It caches only these public files: never a page, a song, the API
// or the piano, so every choir's songs still pass the Worker's access check and
// a new version of the site arrives with the next page load.
"use strict";
var CACHE = "stemmanauhat-shell-1";
var ASSETS = ["/offline", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
  "/icon-maskable-512.png", "/apple-touch-icon.png"];
// public/offline.html: the static assets serve it as /offline.
var OFFLINE = "/offline";

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(ASSETS.map(function (url) {
      return fetch(url, { cache: "reload" }).then(function (response) {
        if (!response.ok) throw new Error(url + ": " + response.status);
        return cache.put(url, response);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key.indexOf("stemmanauhat-shell-") === 0 && key !== CACHE;
    }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(function () {
      return caches.match(OFFLINE).then(function (page) { return page || Response.error(); });
    }));
    return;
  }

  // Everything else, songs and the piano included, goes to the network untouched.
  if (ASSETS.indexOf(url.pathname) === -1) return;
  event.respondWith(caches.open(CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response.ok) return cache.put(url.pathname, response.clone()).then(function () { return response; });
      return response;
    }).catch(function () { return cache.match(url.pathname); });
  }));
});
