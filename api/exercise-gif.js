// Vercel automatically turns any file in /api into a serverless endpoint.
// This keeps the WorkoutX API key on the server — it never reaches the
// browser. Mirrors api/claude.js's pattern exactly.
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
    const upstream = await fetch(`https://api.workoutxapp.com/v1/exercises/name/${encodeURIComponent(name)}`, {
      headers: { "X-WorkoutX-Key": apiKey },
    });
    // Logged either way (not just on failure) — cheap, and the only way to
    // see what WorkoutX actually said without a passthrough. Check this in
    // the Vercel dashboard: Project -> Deployments -> (latest) -> Functions
    // -> exercise-gif, or `vercel logs` if you have the CLI.
    const bodyText = await upstream.text();
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
    const gifUrl = Array.isArray(results) && results.length > 0 ? results[0].gifUrl : null;
    res.status(200).json({ gifUrl: gifUrl || null, matchCount: Array.isArray(results) ? results.length : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
