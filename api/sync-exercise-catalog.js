// One-time (or occasionally re-run) admin operation: pulls WorkoutX's
// ENTIRE exercise catalog (1,400+ entries, via their real GET /v1/exercises
// list-with-pagination endpoint — confirmed from their own docs, not just
// the name-search endpoint the rest of this app uses day to day) into the
// same shared exercise_gifs table used everywhere else. After this has run
// to completion, most exercise-GIF lookups resolve straight from that
// local cache (exact key, or the fuzzy match in exercise-gif.js) with ZERO
// further WorkoutX requests — this is the one-time cost that buys that.
//
// Free tier caps a single page at 10 results, and there's no page-count
// metadata up front, so this just keeps paging with offset += 10 until an
// empty page comes back. To stay well inside a serverless function's
// execution limit, one invocation stops after a ~8s time budget and
// returns {done: false, nextOffset} — call again with that offset to
// continue. {done: true} means it reached the end of the catalog.
//
// Gated behind ADMIN_SYNC_SECRET (a plain env var you set once in Vercel,
// distinct from WORKOUTX_API_KEY) so this can't be triggered by anyone who
// just finds the URL — each run burns real shared quota.
import { createClient } from "@supabase/supabase-js";

const PAGE_LIMIT = 10;
const TIME_BUDGET_MS = 8000;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminSecret = process.env.ADMIN_SYNC_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: "Server is missing the ADMIN_SYNC_SECRET environment variable." });
  }
  if ((req.query.secret || "").toString() !== adminSecret) {
    return res.status(401).json({ error: "Missing or incorrect ?secret=." });
  }

  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing the WORKOUTX_API_KEY environment variable." });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  let offset = parseInt(req.query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const startedAt = Date.now();
  let pagesFetched = 0;
  let itemsSynced = 0;

  try {
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const upstream = await fetch(`https://api.workoutxapp.com/v1/exercises?limit=${PAGE_LIMIT}&offset=${offset}`, {
        headers: { "X-WorkoutX-Key": apiKey },
      });
      const bodyText = await upstream.text();
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: `WorkoutX API error ${upstream.status}`, detail: bodyText.slice(0, 300), offset, itemsSynced, pagesFetched });
      }
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        return res.status(502).json({ error: "WorkoutX returned a non-JSON response", detail: bodyText.slice(0, 300), offset, itemsSynced, pagesFetched });
      }
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
      pagesFetched += 1;

      if (items.length === 0) {
        return res.status(200).json({ done: true, offset, itemsSynced, pagesFetched });
      }

      const rows = items
        .filter((it) => it && it.name)
        .map((it) => ({ name_key: it.name.toLowerCase().trim(), gif_url: it.gifUrl || null, checked_at: new Date().toISOString() }));
      if (rows.length > 0) {
        const { error } = await supabaseAdmin.from("exercise_gifs").upsert(rows);
        if (error) {
          return res.status(500).json({ error: `Supabase upsert failed: ${error.message}`, offset, itemsSynced, pagesFetched });
        }
        itemsSynced += rows.length;
      }

      offset += PAGE_LIMIT;
      if (items.length < PAGE_LIMIT) {
        // Short page — this was the last one, no need to make one more
        // request just to confirm an empty page.
        return res.status(200).json({ done: true, offset, itemsSynced, pagesFetched });
      }
    }

    // Time budget hit mid-catalog — call again with this offset to continue.
    return res.status(200).json({ done: false, nextOffset: offset, itemsSynced, pagesFetched });
  } catch (e) {
    return res.status(500).json({ error: e.message, offset, itemsSynced, pagesFetched });
  }
}
