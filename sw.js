/* Service worker: يخلّي الموقع يشتغل بدون إنترنت.
   غيّر رقم VERSION عند كل تحديث للموقع عشان الأجهزة تاخد النسخة الجديدة. */
var VERSION = 'v6';
var CACHE = 'mass-schedule-' + VERSION;

/* ملفات الموقع نفسه (لازم تتخزن كلها وقت التثبيت) */
var CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];
/* اختيارية: لو الملف موجود يتخزن، ولو مش موجود مفيش مشكلة */
var OPTIONAL = ['vendor/html2canvas.min.js'];
/* مكتبة التصوير والخطوط من الإنترنت: تتخزن أول مرة تفتح فيها الموقع وانت متصل */
var CDN_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
var FONT_CSS = 'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;500;700&display=swap';

function isExternalAsset(url) {
  return /(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$|(^|\.)cdnjs\.cloudflare\.com$|(^|\.)cdn\.jsdelivr\.net$|(^|\.)unpkg\.com$/.test(url.hostname);
}

async function precacheFonts(cache) {
  try {
    var res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    var css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    var urls = Array.from(new Set((css.match(/url\((https:[^)]+)\)/g) || []).map(function (u) { return u.slice(4, -1).replace(/["']/g, ''); })));
    await Promise.all(urls.map(function (u) {
      return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return cache.put(u, r); }).catch(function () {});
    }));
  } catch (e) { /* offline during install: الخطوط هتتخزن في أول فتح وانت متصل */ }
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.all(OPTIONAL.map(function (u) { return cache.add(u).catch(function () {}); }));
    try { var r = await fetch(CDN_LIB, { mode: 'no-cors' }); await cache.put(CDN_LIB, r); } catch (e) {}
    await precacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k.indexOf('mass-schedule-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* صفحة الموقع: الإنترنت أولًا (عشان التحديثات تظهر)، ولو مفيش نت أو بطيء يفتح من التخزين */
  if (req.mode === 'navigate') {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE);
      try {
        var ctl = new AbortController();
        var t = setTimeout(function () { ctl.abort(); }, 4000);
        var res = await fetch(req, { signal: ctl.signal });
        clearTimeout(t);
        if (res && res.ok) { cache.put('index.html', res.clone()); return res; }
        throw new Error('bad');
      } catch (e) {
        return (await cache.match('index.html', { ignoreSearch: true })) || (await cache.match('./', { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  /* ملفات الموقع: من التخزين فورًا وتتحدث في الخلفية */
  if (url.origin === self.location.origin) {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE);
      var hit = await cache.match(req, { ignoreSearch: true });
      var net = fetch(req).then(function (res) { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(function () { return null; });
      if (hit) { net.catch(function () {}); return hit; }
      return (await net) || Response.error();
    })());
    return;
  }

  /* الخطوط والمكتبات الخارجية: من التخزين، ولو مش موجودة تتحمل وتتخزن */
  if (isExternalAsset(url)) {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE);
      var hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        var res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) { return Response.error(); }
    })());
  }
});
