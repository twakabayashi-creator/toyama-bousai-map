// アプリ本体をスマホに保存して、電波が弱くても開けるようにする仕組み。
// ファイルを更新したら、下の VERSION の数字を1つ増やしてください。
const VERSION = "v7";
const FILES = ["./", "index.html", "style.css", "app.js", "spots.csv", "sponsors.csv", "config.js", "sponsors.js", "homecheck.js", "privacy.html", "data/shelters.json", "data/volcano.json", "manifest.webmanifest", "icons/icon-192.png", "images/character.gif", ...["peek","sleep","surprise","question","banzai","sad","stand","power","run","plug-on","eat","sit"].map(n => `images/poses/${n}.png`)];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 自分のファイル：ネットを優先し、つながらないときは保存したものを使う
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
