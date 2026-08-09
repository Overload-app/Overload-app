import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Stripe requires the raw, unparsed request body to verify the webhook signature.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Stripe/Supabase server env vars.");
    return res.status(500).send("Server misconfigured.");
  }

  const stripe = new Stripe(secretKey);
  // The service role key bypasses row-level security — this must NEVER be
  // exposed to the browser. It's only read here, server-side.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.userId;
      if (userId) {
        await supabaseAdmin
          .from("profiles")
          .update({ subscribed: true, stripe_customer_id: session.customer })
          .eq("id", userId);
      }
    }

    if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.paused") {
      const sub = event.data.object;
      await supabaseAdmin.from("profiles").update({ subscribed: false }).eq("stripe_customer_id", sub.customer);
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const active = sub.status === "active" || sub.status === "trialing";
      await supabaseAdmin.from("profiles").update({ subscribed: active }).eq("stripe_customer_id", sub.customer);
    }
  } catch (e) {
    console.error("Error handling webhook event:", e);
    // Still return 200 so Stripe doesn't retry indefinitely for a bug on our side
    // that a retry wouldn't fix; check your Vercel function logs if this happens.
  }

  res.status(200).json({ received: true });
}
