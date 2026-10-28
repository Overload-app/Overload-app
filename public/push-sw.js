// Push notifications (workout reminders and rest alerts), loaded into the
// generated service worker via workbox.importScripts in vite.config.js.
// Every push shows a notification — iOS takes notification permission away
// from apps whose pushes show nothing.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Overload";
  const tag = data.tag || "overload";
  // One alert per kind at a time: the previous rest alert is replaced, not
  // stacked (real report: 25+ of them by the end of a workout).
  // Checked by tag here as well: if a phone ignores the tag in the request
  // and hands back every notification, closing them all would let a 7am
  // food reminder silently remove the 7am weigh-in reminder.
  event.waitUntil(self.registration.getNotifications({ tag }).then((old) => old.filter((n) => n.tag === tag).forEach((n) => n.close())).catch(() => {}).then(() => self.registration.showNotification(title, {
    body: data.body || "",
    tag,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  })));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
