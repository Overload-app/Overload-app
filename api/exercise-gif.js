// Vercel automatically turns any file in /api into a serverless endpoint.
// This keeps the WorkoutX API key on the server — it never reaches the
// browser. Mirrors api/claude.js's pattern exactly.

// Confirmed from a real response (not the docs, which showed a bare array
// and turned out to be wrong): WorkoutX wraps results as
// { total, count, data: [...] } — an OBJECT, not a bare array. The
// original code checked Array.isArray(results) directly on that object,
// which is always false, so EVERY lookup was being treated as "zero
// matches" regardless of what WorkoutX actually found. This was the whole
// bug — never the search query itself.
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

// Kept as a fallback (harmless, doesn't cost anything now that the parsing
// itself is fixed) for the case where a full equipment-prefixed name
// genuinely isn't in their database under that exact phrasing.
const EQUIPMENT_PREFIX = /^(barbell|dumbbell|cable|machine|smith machine|bodyweight|kettlebell|band|ez-?bar)\s+/i;

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

  try {
    let { upstream, bodyText } = await searchWorkoutX(name, apiKey);
    // Logged either way (not just on failure) — cheap, and the only way to
    // see what WorkoutX actually said without a passthrough. Check this in
    // the Vercel dashboard: Project -> Deployments -> (latest) -> Functions
    // -> exercise-gif, or `vercel logs` if you have the CLI.
    console.log(`WorkoutX lookup for "${name}": ${upstream.status}`, bodyText.slice(0, 500));
    if (!upstream.ok) {
      // Quota exhausted, bad/missing key, upstream hiccup, etc. — the
      // client treats any non-200 the same way (no GIF available for this
      // exercise), but the real reason from WorkoutX is included here so
      // it's visible in the browser's Network tab without needing Vercel
      // dashboard access.
      return res.status(upstream.status).json({ error: `WorkoutX API error ${upstream.status}`, detail: bodyText.slice(0, 300) });
    }
    let results;
    try {
      results = JSON.parse(bodyText);
    } catch (e) {
      return res.status(502).json({ error: "WorkoutX returned a non-JSON response", detail: bodyText.slice(0, 300) });
    }
    let items = extractItems(results);

    if (items.length === 0) {
      const stripped = name.replace(EQUIPMENT_PREFIX, "");
      if (stripped !== name) {
        const retry = await searchWorkoutX(stripped, apiKey);
        console.log(`WorkoutX retry (stripped equipment) for "${stripped}": ${retry.upstream.status}`, retry.bodyText.slice(0, 500));
        if (retry.upstream.ok) {
          try {
            const retryItems = extractItems(JSON.parse(retry.bodyText));
            if (retryItems.length > 0) items = retryItems;
          } catch (e) {
            // Ignore a malformed retry response — fall through with the
            // original (empty) items rather than failing the whole
            // request over a fallback attempt.
          }
        }
      }
    }

    res.status(200).json({ gifUrl: items[0]?.gifUrl || null, matchCount: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
