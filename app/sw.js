// 오프라인 캐시
//  · 코드/문서(html·css·js·manifest) → 네트워크 우선, 실패하면 캐시 (업데이트가 바로 반영된다)
//  · 스프라이트 이미지            → 캐시 우선 (한 번 받으면 다시 안 받는다)
const CACHE = 'poke-splendor-v5';
const CORE = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/app.js', './js/engine.js', './js/ai.js', './js/data.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAsset = (url) => /\.(png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isAsset(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })),
    );
    return;
  }

  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
