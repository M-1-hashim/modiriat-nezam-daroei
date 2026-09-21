/* Service Worker — PWA: شبکه-first با کش احتیاطی؛ API همیشه از شبکه */
const CACHE = "pharma-shell-v2";
const SHELL = ["/logo.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return; // POSTها با صف localStorage همگام می‌شوند
  if (url.pathname.startsWith("/api/")) return; // API همیشه از شبکه
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // فقط پاسخ‌های سالم same-origin کش می‌شوند (نه خطاها و نه چانک‌های ۴۰۴)
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // آفلاین: fallback به کش؛ برای صفحه اصلی فقط اگر نسخه‌ای موجود باشد
        caches.match(e.request).then((m) => m || caches.match("/logo.svg"))
      )
  );
});
