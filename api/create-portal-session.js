import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// This endpoint used to take a userId straight from the request body, with no
// check that the caller was that person — or signed in at all. Anyone holding
// someone else's user id could get a working Stripe billing portal link for
// them, which shows invoices and the payment method on file and can cancel
// their subscription. User ids are random UUIDs so they can't be guessed, but
// they aren't secrets either (a shared link, a screenshot, a support email),
// which made this one leak away from exposing a customer's billing.
//
// The id now comes from the verified session itself, and the body's userId is
// ignored entirely — there is no request shape that can reach another
// person's billing.
// Deliberately duplicated rather than imported from another endpoint file —
// each file here is its own serverless function, and keeping them
// independent avoids one endpoint's module graph being pulled into another's.
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
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return res.status(401).json({ error: "Not signed in." });
    }
    const userId = userData.user.id;

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
