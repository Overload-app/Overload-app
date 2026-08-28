// Small manual-override tool for the exercise_gifs cache — for a specific,
// CONFIRMED case (not a guess) where a stale/wrong cached entry needs
// fixing without waiting for the general fuzzy-matcher to catch it. Real
// case: "Back Squat" got permanently cached as a confirmed null before it
// was renamed to "Barbell Squat" in the app's own vocabulary — a genuine
// real match exists, but "back squat"/"barbell squat" only share 1 of 3
// meaningful words (33%), under the fuzzy matcher's deliberately
// conservative 50% threshold (kept strict elsewhere specifically so a
// low-confidence guess never shows the WRONG exercise's video). Rather
// than loosen that threshold globally and risk that everywhere, this lets
// a specific, known-correct alias be set directly.
//
// Gated behind the same ADMIN_SYNC_SECRET as sync-exercise-catalog.js.
// Usage: GET /api/admin-set-gif?secret=...&name=Back+Squat&url=https://api.workoutxapp.com/v1/gifs/0026.gif
// Pass url=null (the literal string) to explicitly cache "confirmed no match" instead.
import { createClient } from "@supabase/supabase-js";

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

  const name = (req.query.name || "").toString().trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name=." });
  }
  const rawUrl = (req.query.url || "").toString().trim();
  const gifUrl = rawUrl && rawUrl.toLowerCase() !== "null" ? rawUrl : null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const nameKey = name.toLowerCase();
  const { error } = await supabaseAdmin.from("exercise_gifs").upsert({ name_key: nameKey, gif_url: gifUrl, checked_at: new Date().toISOString() });
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.status(200).json({ ok: true, name_key: nameKey, gif_url: gifUrl });
}
