// Rest-timer alerts while the app is closed. Real ask: "the rest timer can
// buzz you even when the app is closed." When a set is checked off, the app
// asks this endpoint to notify the person when the rest ends; it waits until
// then (waiting isn't billed as CPU), re-reads their saved workout, and only sends if that
// same rest is still the current one — the app already saves the rest's end
// time with the in-progress workout, so +15s, Skip, the next set, or
// finishing the workout all change it and quietly cancel this.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { waitUntil } from "@vercel/functions";

// Public by design (it's in the app's own bundle too); the private half is
// the VAPID_PRIVATE_KEY environment variable.
export const VAPID_PUBLIC_KEY = "BK0dG_2Uk7ItbaIRe6JKXtQzhxkpSaY4QiJj8swUgTaj4AKyvQyYTso15xNBZ0KMYv0dZqXnzvHQFOK_82mp-5Y";
export const VAPID_SUBJECT = "https://www.overload-app.com";
export const MAX_REST_SECONDS = 15 * 60;
// One function can only run 5 minutes on Hobby. A longer rest is waited out
// in legs: each one waits up to this long, checks the rest is still on, and
// hands the remainder to a fresh call of this same endpoint.
export const LEG_MS = 270 * 1000;
export const SELF_URL = "https://www.overload-app.com/api/rest-alert";
// A little after the rest ends, so an app that's open and already cleared
// the alert has had time to save that.
export const SEND_DELAY_MS = 1500;

export const config = { maxDuration: 300 };

// Deliberately duplicated rather than imported across endpoint files.
export function bearerToken(req) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

// Only rests that end soon. Anything else is refused rather than kept
// waiting.
export function validRestAlert(body, nowMs) {
  const endAt = Number(body?.endAt);
  if (!Number.isFinite(endAt)) return null;
  const wait = endAt - nowMs;
  if (wait <= 0 || wait > MAX_REST_SECONDS * 1000) return null;
  return { endAt };
}

// At send time: still switched on, somewhere to send it, and still the
// current rest of a workout that's still going.
export function shouldSendRestAlert(state, endAt) {
  return !!state?.push?.restAlerts
    && Array.isArray(state?.push?.subscriptions) && state.push.subscriptions.length > 0
    && Number(state?.inProgressWorkout?.rest?.endAt) === endAt;
}

export async function sendToSubscriptions(subscriptions, payload, send) {
  const results = await Promise.allSettled((subscriptions || []).map((sub) => send(sub, JSON.stringify(payload))));
  return results.filter((r) => r.status === "fulfilled").length;
}

// The next leg of a long rest proves it came from here with the server-only
// CRON_SECRET, and says whose rest it is.
export function internalCaller(req, secret) {
  const header = req?.headers?.["x-overload-internal"];
  const userId = req?.body?.userId;
  if (!secret || header !== secret || typeof userId !== "string" || !userId) return null;
  return userId;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  let userId = internalCaller(req, process.env.CRON_SECRET);
  if (!userId) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Not signed in." });
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) return res.status(401).json({ error: "Not signed in." });
      userId = data.user.id;
    } catch (e) {
      return res.status(401).json({ error: "Not signed in." });
    }
  }
  const alert = validRestAlert(req.body, Date.now());
  if (!alert) return res.status(400).json({ error: "Rest must end within the next 15 minutes." });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  waitUntil((async () => {
    await sleep(Math.min(alert.endAt + SEND_DELAY_MS - Date.now(), LEG_MS));
    const { data } = await supabaseAdmin.from("app_state").select("state").eq("user_id", userId).maybeSingle();
    const state = data?.state;
    if (!shouldSendRestAlert(state, alert.endAt)) return;
    if (Date.now() < alert.endAt) {
      // Still resting: pass the rest of the wait to the next leg.
      await fetch(SELF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-overload-internal": process.env.CRON_SECRET || "" },
        body: JSON.stringify({ endAt: alert.endAt, userId }),
      });
      return;
    }
    await sendToSubscriptions(state.push.subscriptions, {
      kind: "rest",
      title: "Rest's up",
      body: "Time for your next set 💪",
      tag: "rest",
      url: "/",
    }, (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60, urgency: "high" }));
  })().catch(() => {}));
  return res.status(202).json({ scheduled: true });
}
