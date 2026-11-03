/* ============================================================
   Service Worker — تطبيق الحمية الغذائية
   استراتيجية:
   - الملفات المحلية + Chart.js => Cache First
   - طلبات التنقل (navigate) => Network First مع الرجوع للكاش
   ============================================================ */

const CACHE_VERSION = 'v1';
const CACHE_NAME    = 'diet-tracker-' + CACHE_VERSION;

// الملفات الأساسية (App Shell)
const APP_SHELL = [
  './index.html',
  './',
  './manifest.json',
  './icon.svg',
  // Chart.js — نخزّنها أيضاً حتى يعمل الرسم بدون إنترنت بعد أول فتح
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // نخزن كل ملف بشكل مستقل حتى لا يفشل التثبيت لو فشل ملف واحد
    for (const url of APP_SHELL) {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
        console.log('[SW] cached:', url);
      } catch (err) {
        console.warn('[SW] failed to cache:', url, err.message);
      }
    }
    await self.skipWaiting();
  })());
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
    console.log('[SW] activated:', CACHE_NAME);
  })());
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // لا نتعامل إلا مع طلبات GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // تجاهل طلبات غير http(s) (مثل chrome-extension)
  if (!url.protocol.startsWith('http')) return;

  /* ===== طلبات التنقل (فتح التطبيق) — Network First ===== */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // تحديث الكاش بالنسخة الأحدث
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (err) {
        // بدون إنترنت => نرجع النسخة المخزنة
        return (
          (await caches.match('./index.html')) ||
          (await caches.match('./')) ||
          new Response('أنت غير متصل بالإنترنت، ولم يتم تحميل التطبيق سابقاً.', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          })
        );
      }
    })());
    return;
  }

  /* ===== كل الطلبات الأخرى — Cache First ===== */
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // نخزن أي رد ناجح (محلي أو CDN)
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // احتياطي للصور
      if (req.destination === 'image') {
        const icon = await caches.match('./icon.svg');
        if (icon) return icon;
      }
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

/* ---------- رسائل من الصفحة (اختياري) ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
