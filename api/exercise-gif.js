// Vercel automatically turns any file in /api into a serverless endpoint.
// This keeps the WorkoutX API key on the server — it never reaches the
// browser. Mirrors api/claude.js's pattern.
import { createClient } from "@supabase/supabase-js";

// Confirmed from a real response the user pulled directly from WorkoutX's
// own API Tester (not the docs, which showed a bare-array example and was
// wrong): WorkoutX wraps results as { total, count, data: [...] } — an
// object, not a bare array.
function extractItems(results) {
  if (Array.isArray(results)) return results;
  if (Array.isArray(results?.data)) return results.data;
  return [];
}

async function searchWorkoutX(query, apiKey) {
  const upstream = await fetch(`https://api.workoutxapp.com/v1/exercises/name/${encodeURIComponent(query)}`, {
    headers: { "X-WorkoutX-Key": apiKey },
  });
  const bodyText = await upstream.text();
  return { upstream, bodyText };
}

// A generated program's exercise name can carry qualifiers that don't
// exist in WorkoutX's own naming — a real report: "Leg Press (Low)" found
// nothing even though WorkoutX obviously has a plain "Leg Press" entry.
// Builds a list of progressively simpler search terms (full name, then
// with any "(...)" qualifier stripped, then with a leading equipment word
// also stripped) and tries each in order until one gets a real match.
const EQUIPMENT_PREFIX = /^(barbell|dumbbell|cable|machine|smith machine|bodyweight|kettlebell|band|ez-?bar)\s+/i;
export function searchCandidates(name) {
  const candidates = [name];
  const noParens = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (noParens && noParens !== name) candidates.push(noParens);
  const base = noParens || name;
  const noEquipment = base.replace(EQUIPMENT_PREFIX, "");
  if (noEquipment && !candidates.includes(noEquipment)) candidates.push(noEquipment);
  return candidates;
}

// Once the full catalog has been bulk-synced into exercise_gifs (see
// sync-exercise-catalog.js), most near-misses can resolve entirely from
// that LOCAL copy — zero further WorkoutX requests — instead of falling
// through to a live search every time an AI-generated name doesn't match
// verbatim. Real ask: "take workouts from the actual gif program, word for
// word" — this is the practical version of that when the AI's phrasing
// still drifts slightly (e.g. "Tricep Pushdown" vs a catalog entry spelled
// "Triceps Pushdown").
const STOPWORDS = new Set(["the", "a", "an", "of", "with", "to"]);
function stem(word) {
  // Naive plural stripping — enough to line up "tricep"/"triceps",
  // "curl"/"curls" without a real stemming library.
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
function tokenize(name) {
  return (name || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

// Real, confirmed miss: "Machine Shoulder Press" fuzzy-matched a "Machine
// Chest Press" catalog entry at exactly 50% token overlap — sharing only
// the two GENERIC words "machine" and "press", while differing on the one
// word that actually identifies which exercise this is. A plain word-count
// score treats every word equally; body-part/muscle-group words are the
// real disambiguator. If both names mention one and they're not the same
// one, that's the strongest possible signal these are different exercises
// — rejected outright, before scoring, regardless of overall overlap.
const DISTINGUISHING_TERMS = new Set([
  "chest", "shoulder", "back", "leg", "bicep", "tricep", "calf", "calve", "glute", "quad",
  "hamstring", "ab", "abs", "core", "lat", "delt", "forearm", "neck", "hip",
]);

// "leg" is commonly used as a generic stand-in for any lower-body isolation
// exercise — an AI-generated "Seated Leg Extension" and a catalog entry
// literally named "Quad Extension" describe the exact same machine, but
// used to get rejected outright because "leg" and "quad" didn't literally
// match. Real report: this exact exercise (one of the most common leg
// exercises there is) had no demo video for anyone. The other
// distinguishing terms don't have this generic/specific split (nobody
// calls a bicep curl an "arm curl" in practice), so this stays narrowly
// scoped to "leg" plus its actual lower-body sub-parts, not a general
// term-grouping that would risk conflating genuinely different exercises.
const LEG_SUBPARTS = new Set(["quad", "hamstring", "calf", "calve", "glute"]);
function distinguishingTermsConflict(aTerms, bTerms) {
  if (aTerms.length === 0 || bTerms.length === 0) return false;
  for (const a of aTerms) {
    for (const b of bTerms) {
      if (a === b) return false;
      if ((a === "leg" && LEG_SUBPARTS.has(b)) || (b === "leg" && LEG_SUBPARTS.has(a))) return false;
    }
  }
  return true;
}

// candidates: [{ name_key, gif_url }]. Jaccard token overlap — deliberately
// conservative (>0.5 = MORE than half the combined vocabulary between the
// two names actually matches, not just a tie) because showing the WRONG
// exercise's demo is worse than showing none at all, so a low-confidence
// guess is refused rather than risked.
export function bestFuzzyMatch(query, candidates) {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return null;
  const qDistinguishing = [...qTokens].filter((t) => DISTINGUISHING_TERMS.has(t));
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const cTokens = new Set(tokenize(c.name_key));
    if (cTokens.size === 0) continue;
    const cDistinguishing = [...cTokens].filter((t) => DISTINGUISHING_TERMS.has(t));
    if (distinguishingTermsConflict(qDistinguishing, cDistinguishing)) {
      continue; // both name a body part/muscle group, and it's not the same one
    }
    let intersection = 0;
    for (const t of qTokens) if (cTokens.has(t)) intersection++;
    const union = new Set([...qTokens, ...cTokens]).size;
    const score = intersection / union;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0.5 ? best : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing the WORKOUTX_API_KEY environment variable." });
  }

  const name = (req.query.name || "").toString().trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= query parameter." });
  }
  const key = name.toLowerCase();

  // Shared, cross-account cache — reused from the same Supabase project the
  // rest of the app already uses, same service-role pattern as
  // api/stripe-webhook.js and api/create-portal-session.js (server-side
  // only, bypasses RLS, never exposed to the browser). If ANY account has
  // ever looked up this exact exercise before, this is a free read with no
  // WorkoutX request at all — the whole point, since the free tier's
  // 500 req/month is shared across every user, not per-account.
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

  if (supabaseAdmin) {
    const { data: cached } = await supabaseAdmin.from("exercise_gifs").select("gif_url").eq("name_key", key).maybeSingle();
    // A real, confirmed match is always safe to trust and return
    // immediately. A cached NULL is a different story — it just means
    // this exact name found nothing THE LAST TIME it was checked, which
    // could predate the catalog being bulk-synced (or growing since).
    // Real report: "Back Squat" got cached as null before the vocabulary
    // was renamed to "Barbell Squat" (a real, confirmed match) — every
    // later request for the old name kept trusting that stale null
    // forever, never getting a chance to check the now-much-fuller local
    // catalog. So a null cache hit still falls through to the fuzzy check
    // below (a local read, zero WorkoutX cost) instead of returning early.
    if (cached && cached.gif_url) {
      return res.status(200).json({ gifUrl: cached.gif_url, matchCount: 1, source: "cache" });
    }

    // No confirmed exact match, but the bulk-synced catalog may still have
    // a real one under slightly different wording — check locally (a
    // plain table read, no WorkoutX cost) before ever going live.
    const { data: allEntries } = await supabaseAdmin.from("exercise_gifs").select("name_key, gif_url").not("gif_url", "is", null);
    if (allEntries && allEntries.length > 0) {
      const fuzzy = bestFuzzyMatch(name, allEntries);
      if (fuzzy) {
        // Cache THIS exact name too, so next time it's a free direct hit.
        await supabaseAdmin.from("exercise_gifs").upsert({ name_key: key, gif_url: fuzzy.gif_url, checked_at: new Date().toISOString() });
        return res.status(200).json({ gifUrl: fuzzy.gif_url, matchCount: 1, source: "fuzzy-cache" });
      }
    }

    // Genuinely still nothing, and there was already a cached null for
    // this exact name — no point spending a live WorkoutX request to
    // re-confirm the same negative answer.
    if (cached) {
      return res.status(200).json({ gifUrl: null, matchCount: 0, source: "cache" });
    }
  }

  try {
    let items = [];
    for (const candidate of searchCandidates(name)) {
      const { upstream, bodyText } = await searchWorkoutX(candidate, apiKey);
      // Logged either way (not just on failure) — cheap, and the only way
      // to see what WorkoutX actually said without a passthrough. Check
      // this in the Vercel dashboard: Project -> Deployments -> (latest)
      // -> Functions -> exercise-gif, or `vercel logs` if you have the CLI.
      console.log(`WorkoutX lookup for "${candidate}": ${upstream.status}`, bodyText.slice(0, 500));
      if (!upstream.ok) {
        // Quota exhausted, bad/missing key, upstream hiccup, etc. — don't
        // cache this (it's not a real answer), and don't try further
        // candidates once the upstream itself is failing.
        return res.status(upstream.status).json({ error: `WorkoutX API error ${upstream.status}`, detail: bodyText.slice(0, 300) });
      }
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        return res.status(502).json({ error: "WorkoutX returned a non-JSON response", detail: bodyText.slice(0, 300) });
      }
      items = extractItems(parsed);
      if (items.length > 0) break;
    }

    const gifUrl = items[0]?.gifUrl || null;
    // Cache the CONFIRMED result (found, or genuinely zero matches after
    // every candidate) — global, for every account, forever (or until the
    // row is manually cleared) — so this exact exercise never costs a
    // second WorkoutX request, from this account or any other.
    if (supabaseAdmin) {
      await supabaseAdmin.from("exercise_gifs").upsert({ name_key: key, gif_url: gifUrl, checked_at: new Date().toISOString() });
    }
    res.status(200).json({ gifUrl, matchCount: items.length, source: "workoutx" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
