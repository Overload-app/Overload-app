// Vercel automatically turns any file in /api into a serverless endpoint.
// This keeps your Anthropic API key on the server — it never reaches the browser.
//
// This endpoint used to accept any POST from anyone and forward the body to
// Anthropic verbatim. Its address is visible in the app's public JS bundle,
// so anyone who looked could have used this project's Anthropic account as a
// free Claude proxy — and because the body was forwarded untouched, they
// could also have asked for a far pricier model than the app itself uses.
// Two gates close that: the caller must present a real signed-in session,
// and the model and output ceiling are decided HERE rather than by whatever
// the caller sent.
import { createClient } from "@supabase/supabase-js";

// The app's own model and output ceiling. Pinned server-side on purpose:
// the client sends these too, but a request that asks for anything else
// (a more expensive model, a much larger response) gets these instead.
export const MODEL = "claude-sonnet-5";
export const MAX_OUTPUT_TOKENS = 8000;

export function bearerToken(req) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

// Everything the app legitimately sends is passed through; the model and
// output ceiling are replaced with this project's own. Deliberately an
// allowlist rather than a passthrough — an unknown field from an untrusted
// caller has no business reaching Anthropic on this account's key.
export function buildUpstreamBody(clientBody) {
  const body = clientBody && typeof clientBody === "object" ? clientBody : {};
  const requested = Number(body.max_tokens);
  const maxTokens = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), MAX_OUTPUT_TOKENS)
    : MAX_OUTPUT_TOKENS;
  const upstream = { model: MODEL, max_tokens: maxTokens };
  for (const field of ["system", "messages", "tools", "tool_choice", "output_config"]) {
    if (body[field] !== undefined) upstream[field] = body[field];
  }
  return upstream;
}

// Same reasoning as before: a full program generation is a genuinely large
// response, and Vercel's 10s default would kill it server-side no matter
// what the client does.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }

  // Every AI feature in this app runs behind a signed-in account (onboarding
  // itself only renders once an account exists), so requiring a real session
  // here costs no legitimate caller anything.
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }
  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: "Not signed in." });
    }
  } catch (e) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(buildUpstreamBody(req.body)),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
