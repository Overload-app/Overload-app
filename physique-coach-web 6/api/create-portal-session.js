import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId." });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile?.stripe_customer_id) {
      return res.status(404).json({ error: "No billing account found for this user yet." });
    }

    const stripe = new Stripe(secretKey);
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: origin,
    });

    res.status(200).json({ url: portalSession.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
