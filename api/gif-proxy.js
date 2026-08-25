// Vercel automatically turns any file in /api into a serverless endpoint.
// A plain <img src="https://api.workoutxapp.com/...gif"> request from the
// browser can't attach the X-WorkoutX-Key header — and WorkoutX's asset
// URLs, not just their search endpoint, appear to require it (a real
// screenshot showed the search succeeding — correct tips, real match —
// but the <img> itself rendering as a broken image, the classic signature
// of an authenticated resource requested without its auth header). This
// fetches the actual GIF bytes server-side (with the key) and streams them
// back, so the browser's <img src> just points here instead of directly
// at WorkoutX.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing the WORKOUTX_API_KEY environment variable." });
  }

  const url = (req.query.url || "").toString();
  // Only ever proxy WorkoutX's own asset URLs — never an arbitrary caller-
  // supplied URL, which would turn this into an open proxy anyone could
  // point at anything using this server (and this API key's auth header).
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: "Invalid url parameter." });
  }
  if (parsed.hostname !== "api.workoutxapp.com" || parsed.protocol !== "https:") {
    return res.status(400).json({ error: "url must be an https://api.workoutxapp.com/... address." });
  }

  try {
    const upstream = await fetch(parsed.toString(), { headers: { "X-WorkoutX-Key": apiKey } });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `WorkoutX asset error ${upstream.status}` });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/gif");
    // Demo GIFs never change once published — safe to cache aggressively
    // both in the browser and on Vercel's edge, which also means repeat
    // views of the same exercise don't cost a fresh WorkoutX request.
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.status(200).send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
