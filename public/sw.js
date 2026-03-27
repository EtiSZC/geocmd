// GeoCommand Service Worker — Push notifications

self.addEventListener("push", (event) => {
  let data = { title: "⚡ CRISE GÉOPOLITIQUE", body: "Un événement requiert votre attention.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  const tag = data.tag || "geocmd-event";

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag,
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
