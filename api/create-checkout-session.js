import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Used to make a Stripe checkout page for anyone who asked, signed in or not,
// for whatever email and account id the request named. Harmless money-wise,
// but it meant pages could be made for (and payments land on) accounts that
// never asked. The account and email now come from the signed-in session; the
// body's email/userId are ignored. Same pattern as create-portal-session.js.
export function bearerToken(req) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const monthlyPriceId = process.env.STRIPE_PRICE_ID;
  const yearlyPriceId = process.env.STRIPE_PRICE_ID_YEARLY;
  if (!secretKey || !monthlyPriceId) {
    return res.status(500).json({ error: "Server is missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID." });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Please sign in again, then try subscribing." });
  let userId, email;
  try {
    const { data, error } = await createClient(supabaseUrl, serviceRoleKey).auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Please sign in again, then try subscribing." });
    userId = data.user.id;
    email = data.user.email || undefined;
  } catch (e) {
    return res.status(401).json({ error: "Please sign in again, then try subscribing." });
  }

  try {
    const stripe = new Stripe(secretKey);
    const plan = req.body?.plan === "yearly" ? "yearly" : "monthly";
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const priceId = plan === "yearly" && yearlyPriceId ? yearlyPriceId : monthlyPriceId;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      client_reference_id: userId,
      metadata: { userId, plan },
      // Shows a "Add promotion code" field on the Stripe checkout page.
      // Create codes in Stripe -> Product catalog -> Coupons, then attach
      // a promotion code to each one (this is how you comp friends & family).
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
