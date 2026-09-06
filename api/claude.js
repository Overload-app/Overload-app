// Vercel automatically turns any file in /api into a serverless endpoint.
// This keeps your Anthropic API key on the server — it never reaches the browser.
//
// Real report: Coach requests that need a full program rewrite (every day,
// every exercise, each with 4 tips + 3 alternatives) reliably timed out —
// not just occasionally, EVERY time. With no maxDuration set here, this
// function ran on Vercel's default limit (10s on Hobby without Fluid
// Compute), which a multi-thousand-token generation routinely exceeds.
// Vercel kills the function at that point regardless of anything the
// client does — no client-side timeout/retry tuning can fix a request
// that dies server-side before Anthropic even finishes responding. This
// raises the ceiling to something a large generation can actually fit
// inside; the client's own 60s AbortController is still there underneath
// as the real backstop.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing the ANTHROPIC_API_KEY environment variable." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
