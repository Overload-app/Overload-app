// Vercel automatically turns any file in /api into a serverless endpoint.
// Shared, cross-account cache for "similar exercises" AI suggestions —
// same idea, and the same Supabase project, as api/exercise-gif.js's
// shared GIF cache: two different accounts asking for alternatives to the
// exact same exercise (extremely common — "Bench Press", "Squat",
// "Deadlift" show up in countless programs) used to each pay for their
// own separate Claude API call for an answer that's realistically the
// same either way. See supabase-migration-exercise-alternatives.sql for
// the table and why injuries are deliberately excluded from caching.
import { createClient } from "@supabase/supabase-js";

export function cacheKey(name, equipment) {
  return `${name.trim().toLowerCase()}|${equipment}`;
}

function equipmentDescription(equipment) {
  if (equipment === "full") return "a fully-equipped gym (barbells, dumbbells, machines, cables)";
  if (equipment === "dumbbell") return "dumbbells only";
  return "bodyweight only, no equipment";
}

// Same loose-JSON extraction as the client's parseJSONLoose — the model is
// instructed to return only JSON, but sometimes adds a stray sentence
// before or after it anyway.
export function parseAlternatives(raw) {
  const clean = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const jsonText = start !== -1 && end !== -1 && end > start ? clean.slice(start, end + 1) : clean;
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing the ANTHROPIC_API_KEY environment variable." });
  }

  const name = (req.query.name || "").toString().trim();
  const equipment = (req.query.equipment || "full").toString().trim();
  const injuries = (req.query.injuries || "").toString().trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= query parameter." });
  }

  // Only cache (read or write) when there are no injuries to work around —
  // see the migration file for why.
  const cacheable = injuries.length === 0;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;
  const key = cacheKey(name, equipment);

  if (cacheable && supabaseAdmin) {
    const { data: cached } = await supabaseAdmin.from("exercise_alternatives").select("alternatives").eq("cache_key", key).maybeSingle();
    if (cached && Array.isArray(cached.alternatives) && cached.alternatives.length > 0) {
      return res.status(200).json({ alternatives: cached.alternatives, source: "cache" });
    }
  }

  const system = `You are a knowledgeable strength coach. Given a specific exercise, suggest exactly 3 genuinely similar alternative exercises — same primary muscle emphasis AND a comparable movement pattern (don't suggest an isolation exercise as an alternative to a compound lift, or vice versa, and don't suggest something just because it's "the same body part"). Respond ONLY with JSON, no markdown fences: {"alternatives": ["<exercise name>", "<exercise name>", "<exercise name>"]}`;
  const userMsg = `Exercise: ${name}. Available equipment: ${equipmentDescription(equipment)}. Injuries/areas to avoid: ${injuries || "none"}.`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error?.message || `Anthropic API error ${upstream.status}` });
    }
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    let alternatives;
    try {
      alternatives = parseAlternatives(raw);
    } catch (e) {
      return res.status(502).json({ error: "Couldn't parse the AI's response as JSON." });
    }

    if (cacheable && supabaseAdmin && alternatives.length > 0) {
      await supabaseAdmin.from("exercise_alternatives").upsert({ cache_key: key, alternatives, created_at: new Date().toISOString() });
    }
    res.status(200).json({ alternatives, source: "live" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
