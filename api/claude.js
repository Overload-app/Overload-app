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
import { waitUntil } from "@vercel/functions";

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
  // Only a literal true — anything else means the ordinary, non-streamed reply.
  if (body.stream === true) upstream.stream = true;
  return upstream;
}

// Every real request is far below these: the Coach's whole prompt plus 30
// messages of history is under 100k characters, and a meal photo is
// compressed to 768px (~100 KB). Anything much bigger is a pasted essay or
// someone using the endpoint to run up this account's AI bill, and is
// refused before it costs anything.
export const MAX_TEXT_CHARS = 300000;
export const MAX_IMAGE_CHARS = 1500000;
export function requestTooLarge(body) {
  let imageChars = 0;
  const text = JSON.stringify(body || {}, (key, value) => {
    if (key === "data" && typeof value === "string") { imageChars += value.length; return ""; }
    return value;
  });
  return text.length > MAX_TEXT_CHARS || imageChars > MAX_IMAGE_CHARS;
}

// A per-account speed limit. Real use is a message every few seconds at the
// very most; a script hammering this endpoint is someone running up this
// account's AI bill. Kept in memory, so it's per server instance — not a
// hard global cap, but it stops a loop cold at no extra cost.
export const RATE_LIMIT = 40;
export const RATE_WINDOW_MS = 5 * 60 * 1000;
const recentCalls = new Map(); // userId -> timestamps (ms)
export function overRateLimit(userId, now = Date.now(), calls = recentCalls) {
  const kept = (calls.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (kept.length >= RATE_LIMIT) { calls.set(userId, kept); return true; }
  kept.push(now);
  calls.set(userId, kept);
  if (calls.size > 5000) calls.delete(calls.keys().next().value);
  return false;
}

// The free-trial AI spending cap, enforced here rather than only in the app
// (which a script calling this endpoint directly would skip). Same limits the
// app shows: 15 cents a day, 75 cents a month, for accounts that aren't
// subscribed. Spending is recorded per account per day in the ai_usage table
// (supabase-migration-ai-usage.sql); until that table exists, the cap is
// simply not enforced, so deploying this first can't lock anyone out.
export const TRIAL_DAILY_CAP_CENTS = 15;
export const TRIAL_MONTHLY_CAP_CENTS = 75;
const INPUT_DOLLARS_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_DOLLARS_PER_TOKEN = 10 / 1_000_000;

// The same arithmetic as estimateCostCents in the app.
export function usageCostCents(usage) {
  if (!usage) return 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens || 0;
  const unattributed = Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h - write5m);
  const dollars = (usage.input_tokens || 0) * INPUT_DOLLARS_PER_TOKEN
    + (usage.cache_read_input_tokens || 0) * 0.1 * INPUT_DOLLARS_PER_TOKEN
    + (write1h + unattributed) * 2 * INPUT_DOLLARS_PER_TOKEN
    + write5m * 1.25 * INPUT_DOLLARS_PER_TOKEN
    + (usage.output_tokens || 0) * OUTPUT_DOLLARS_PER_TOKEN;
  return dollars * 100;
}

export function overTrialCap(rows, today) {
  const month = today.slice(0, 7);
  let daily = 0, monthly = 0;
  for (const r of rows || []) {
    const cents = Number(r.cents) || 0;
    if (String(r.day).slice(0, 7) === month) monthly += cents;
    if (String(r.day).slice(0, 10) === today) daily += cents;
  }
  return daily >= TRIAL_DAILY_CAP_CENTS || monthly >= TRIAL_MONTHLY_CAP_CENTS;
}

// null = no cap applies (subscribed, or the usage table isn't set up yet).
async function trialSpendCheck(supabaseAdmin, userId, today) {
  try {
    const [{ data: profile }, usage] = await Promise.all([
      supabaseAdmin.from("profiles").select("subscribed").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("ai_usage").select("day, cents").eq("user_id", userId).gte("day", `${today.slice(0, 7)}-01`),
    ]);
    if (profile?.subscribed === true) return null;
    if (usage.error) return null;
    return { over: overTrialCap(usage.data, today) };
  } catch (e) {
    return null;
  }
}

function recordSpend(supabaseAdmin, userId, today, usage) {
  const cents = usageCostCents(usage);
  if (!(cents > 0)) return;
  try {
    waitUntil(Promise.resolve(supabaseAdmin.rpc("add_ai_usage", { p_user: userId, p_day: today, p_cents: cents })).catch(() => {}));
  } catch (e) {}
}

// Same reasoning as before: a full program generation is a genuinely large
// response, and Vercel's 10s default would kill it server-side no matter
// what the client does.
export const config = { maxDuration: 60 };

// Passes Anthropic's server-sent events straight through to the browser as
// they arrive, rather than waiting for the whole reply. Also reads the token
// counts out of the stream as it passes, and returns them, so a streamed
// reply's cost can be recorded like any other.
export async function pipeEventStream(body, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const usage = {};
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const data = buffer.slice(0, idx).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      buffer = buffer.slice(idx + 2);
      try {
        const event = JSON.parse(data);
        if (event.type === "message_start") Object.assign(usage, event.message?.usage || {});
        else if (event.type === "message_delta") Object.assign(usage, event.usage || {});
      } catch (e) {}
    }
  }
  res.end();
  return usage;
}

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
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  let userId;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: "Not signed in." });
    }
    userId = data.user.id;
    if (overRateLimit(data.user.id)) {
      return res.status(429).json({ error: "That's a lot of requests in a few minutes — give it a moment and try again." });
    }
  } catch (e) {
    return res.status(401).json({ error: "Not signed in." });
  }

  if (requestTooLarge(req.body)) {
    return res.status(413).json({ error: "That message is too long — try a shorter one." });
  }

  const today = new Date().toISOString().slice(0, 10);
  const spend = await trialSpendCheck(supabaseAdmin, userId, today);
  if (spend?.over) {
    return res.status(402).json({ error: "trial-ai-limit" });
  }

  try {
    const upstreamBody = buildUpstreamBody(req.body);
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstreamBody),
    });
    // Streamed only when the app asked for it (see COACH_STREAMING_ENABLED in
    // App.jsx), and only for a successful response — an error from Anthropic
    // is a normal JSON body and goes through the ordinary path below.
    if (upstreamBody.stream && upstream.ok && upstream.body) {
      const usage = await pipeEventStream(upstream.body, res);
      if (spend) recordSpend(supabaseAdmin, userId, today, usage);
      return;
    }
    const data = await upstream.json();
    if (spend && upstream.ok) recordSpend(supabaseAdmin, userId, today, data?.usage);
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
