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
    if (!upstream.ok) {
      // Quota exhausted, name not found, upstream hiccup, etc. — the
      // client treats any non-200 the same way (no GIF available for this
      // exercise), so just pass the status through without needing the
      // client to parse WorkoutX-specific error shapes.
      return res.status(upstream.status).json({ error: `WorkoutX API error ${upstream.status}` });
    }
    const results = await upstream.json();
    const gifUrl = Array.isArray(results) && results.length > 0 ? results[0].gifUrl : null;
    res.status(200).json({ gifUrl: gifUrl || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
