// The daily workout reminder. Real ask: "workout reminders." Runs once a day
// (the Hobby plan's cron limit — see vercel.json) and nudges everyone who has
// reminders on and hasn't trained yet today, unless they've already hit
// their days-per-week this week. Called only by Vercel's scheduler, which
// sends the CRON_SECRET; anyone else is refused.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const VAPID_PUBLIC_KEY = "BK0dG_2Uk7ItbaIRe6JKXtQzhxkpSaY4QiJj8swUgTaj4AKyvQyYTso15xNBZ0KMYv0dZqXnzvHQFOK_82mp-5Y";
export const VAPID_SUBJECT = "https://www.overload-app.com";
export const config = { maxDuration: 60 };

// Today's date where the person actually is (the app saves their time zone
// when they turn reminders on), as YYYY-MM-DD.
export function localDateISO(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (e) {
    return now.toISOString().slice(0, 10);
  }
}

// The reminder to send this person today, or null for none.
export function reminderFor(state, now = new Date()) {
  const push = state?.push;
  if (!push?.reminders || !Array.isArray(push.subscriptions) || push.subscriptions.length === 0) return null;
  const days = state?.program?.days || [];
  if (days.length === 0) return null;
  const workouts = state?.logs?.workouts || [];
  const today = localDateISO(push.tz, now);
  if (workouts.some((w) => w.date === today)) return null;
  // Already done this week's sessions (last 7 days, today included): no nag.
  const weekAgo = localDateISO(push.tz, new Date(now.getTime() - 6 * 86400000));
  const thisWeek = workouts.filter((w) => w.date >= weekAgo && w.date <= today).length;
  const perWeek = Number(state?.profile?.daysPerWeek) || days.length;
  if (thisWeek >= perWeek) return null;
  const next = days[workouts.length % days.length];
  return { kind: "reminder", title: "Time to train 💪", body: `Today's workout: ${next?.name || "your next session"}. Tap to start.`, tag: "reminder", url: "/" };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || (req.headers?.authorization || "") !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Not allowed." });
  }
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  let sent = 0, people = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from("app_state").select("user_id, state").eq("state->push->>reminders", "true").range(from, from + 499);
    if (error) return res.status(500).json({ error: error.message });
    for (const row of data || []) {
      const note = reminderFor(row.state);
      if (!note) continue;
      people++;
      const results = await Promise.allSettled(row.state.push.subscriptions.map((sub) => webpush.sendNotification(sub, JSON.stringify(note), { TTL: 3600 })));
      sent += results.filter((r) => r.status === "fulfilled").length;
    }
    if (!data || data.length < 500) break;
  }
  return res.status(200).json({ people, sent });
}
