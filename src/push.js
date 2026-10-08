// Workout reminders and rest alerts — the phone side. The server side is
// api/push-cron.js and api/rest-alert.js; the notification itself is shown
// by public/push-sw.js.
import { supabase } from "./supabaseClient.js";

// Public half of the VAPID key pair (the private half is a server env var).
export const VAPID_PUBLIC_KEY = "BK0dG_2Uk7ItbaIRe6JKXtQzhxkpSaY4QiJj8swUgTaj4AKyvQyYTso15xNBZ0KMYv0dZqXnzvHQFOK_82mp-5Y";

export function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent || "");
const isStandalone = () => typeof window !== "undefined"
  && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator?.standalone === true);

// Why notifications can't be turned on here, in words a person can act on —
// or null when they can.
export function pushUnavailableReason() {
  if (typeof window === "undefined") return "Notifications aren't supported here.";
  if (isIOS() && !isStandalone()) return "On iPhone, add Overload to your Home Screen first (Share → Add to Home Screen), then turn this on from there.";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "This browser doesn't support notifications.";
  }
  if (Notification.permission === "denied") return "Notifications are blocked for Overload — allow them in your phone's settings, then try again.";
  return null;
}

// Asks for permission (must run from a tap) and returns this device's
// subscription as plain JSON to save with the account. Throws an Error whose
// message is fit to show.
export async function subscribeForPush() {
  const reason = pushUnavailableReason();
  if (reason) throw new Error(reason);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed, so this stayed off.");
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  return sub.toJSON();
}

// Adds this device to the saved list (one entry per device).
export function withSubscription(push, sub) {
  const others = (push?.subscriptions || []).filter((s) => s?.endpoint !== sub?.endpoint);
  return [...others, sub].slice(-5);
}

export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}

// Ask the server to buzz this phone when the rest ends. Fire-and-forget:
// the in-app chime still works without it.
export async function requestRestAlert(endAt) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch("/api/rest-alert", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endAt }),
    });
  } catch (e) {
    // Offline at the gym, etc. — nothing to do.
  }
}
