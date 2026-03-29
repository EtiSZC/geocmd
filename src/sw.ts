/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching — vite-plugin-pwa injects the manifest here
precacheAndRoute(self.__WB_MANIFEST);

// ---- Push notification handlers ----

self.addEventListener("push", (event) => {
  let data = {
    title: "⚡ CRISE GÉOPOLITIQUE",
    body: "Un événement requiert votre attention.",
    url: "/",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // fallback to defaults
  }

  const tag = (data as any).tag || "geocmd-event";

  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: data.body,
    icon: "/pwa-192x192.png",
    badge: "/badge-96x96.png",
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options as NotificationOptions)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
