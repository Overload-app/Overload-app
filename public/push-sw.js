// Push notifications (workout reminders and rest alerts), loaded into the
// generated service worker via workbox.importScripts in vite.config.js.
// Every push shows a notification — iOS takes notification permission away
// from apps whose pushes show nothing.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Overload";
  const kind = data.tag || "overload";
  // Real report: "rest notifications only sometimes buzz, although they
  // show up on the home screen" (same for weigh-in and food). Every one of a
  // kind used to share one tag, and a notification that replaces one with the
  // same tag is shown silently on iPhone (Safari ignores renotify). Each now
  // gets its own tag, so every one buzzes; the older ones of the same kind
  // are still cleared first so rest alerts don't pile up (real report: 25+
  // by the end of a workout). Matched by kind here, not by asking the phone
  // to filter, since some phones hand back every notification.
  const sameKind = (n) => n.tag === kind || String(n.tag || "").startsWith(`${kind}:`);
  event.waitUntil(self.registration.getNotifications().then((old) => old.filter(sameKind).forEach((n) => n.close())).catch(() => {}).then(() => self.registration.showNotification(title, {
    body: data.body || "",
    tag: `${kind}:${Date.now()}`,
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
