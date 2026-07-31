import Stripe from "stripe";

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

  try {
    const stripe = new Stripe(secretKey);
    const { email, userId, plan } = req.body;
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const priceId = plan === "yearly" && yearlyPriceId ? yearlyPriceId : monthlyPriceId;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      client_reference_id: userId,
      metadata: { userId, plan: plan || "monthly" },
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
