// Service worker: nhận thông báo đẩy + cho phép cài PWA ra màn hình

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Fetch pass-through (tối thiểu để trình duyệt nhận app là cài được).
// Không cache API để dữ liệu luôn mới; các request khác đi thẳng ra mạng.
self.addEventListener('fetch', (event) => {
  // để mặc định trình duyệt xử lý; chỉ cần có handler này là đủ điều kiện cài
  return;
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'SayCar Đặt Hộ';
  const options = {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
