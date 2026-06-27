const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../config/db');

const PLANS = {
  monthly:  { price: 1000,  currency: 'eur', duration_days: 30,   label: '1 Monat' },
  '6months': { price: 3000,  currency: 'eur', duration_days: 180,  label: '6 Monate' },
  yearly:   { price: 5000,  currency: 'eur', duration_days: 365,  label: '1 Jahr' },
  lifetime: { price: 10000, currency: 'eur', duration_days: null, label: 'Lifetime' },
};

// GET /api/subscriptions/plans
const getPlans = async (req, res) => {
  res.json({
    plans: [
      { id: 'monthly',  name: '1 Monat',   price: 10,  currency: 'EUR', per_month: 10 },
      { id: '6months',  name: '6 Monate',  price: 30,  currency: 'EUR', per_month: 5 },
      { id: 'yearly',   name: '1 Jahr',    price: 50,  currency: 'EUR', per_month: 4.17 },
      { id: 'lifetime', name: 'Lifetime',  price: 100, currency: 'EUR', per_month: null },
    ]
  });
};

// POST /api/subscriptions/create-payment-intent
const createPaymentIntent = async (req, res) => {
  try {
    const { plan_type } = req.body;
    const plan = PLANS[plan_type];

    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.first_name,
        metadata: { user_id: req.user.id.toString() }
      });
      customerId = customer.id;
      await db.execute('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, req.user.id]);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: plan.price,
      currency: plan.currency,
      customer: customerId,
      metadata: {
        user_id: req.user.id.toString(),
        plan_type,
      },
      automatic_payment_methods: { enabled: true },
    });

    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment error' });
  }
};

// POST /api/subscriptions/confirm
const confirmSubscription = async (req, res) => {
  try {
    const { payment_intent_id, plan_type } = req.body;
    const plan = PLANS[plan_type];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const expiresAt = plan.duration_days
      ? new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000)
      : null;

    await db.execute(
      `UPDATE users SET subscription_type = ?, subscription_expires_at = ? WHERE id = ?`,
      [plan_type, expiresAt, req.user.id]
    );

    await db.execute(
      `INSERT INTO subscriptions (user_id, stripe_payment_intent_id, plan_type, amount, status, expires_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [req.user.id, payment_intent_id, plan_type, plan.price / 100, expiresAt]
    );

    res.json({ success: true, subscription_type: plan_type, expires_at: expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/subscriptions/status
const getStatus = async (req, res) => {
  try {
    const [user] = await db.execute(
      'SELECT subscription_type, subscription_expires_at FROM users WHERE id = ?',
      [req.user.id]
    );

    const sub = user[0];
    let is_active = false;

    if (sub.subscription_type === 'lifetime') {
      is_active = true;
    } else if (sub.subscription_type !== 'free' && sub.subscription_expires_at) {
      is_active = new Date(sub.subscription_expires_at) > new Date();
    }

    res.json({
      subscription_type: sub.subscription_type,
      expires_at: sub.subscription_expires_at,
      is_active,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/stripe/webhook
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook error' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const userId = pi.metadata?.user_id;
    const planType = pi.metadata?.plan_type;

    if (userId && planType) {
      const plan = PLANS[planType];
      if (plan) {
        const expiresAt = plan.duration_days
          ? new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000)
          : null;
        await db.execute(
          'UPDATE users SET subscription_type = ?, subscription_expires_at = ? WHERE id = ?',
          [planType, expiresAt, userId]
        ).catch(console.error);
      }
    }
  }

  res.json({ received: true });
};

module.exports = { getPlans, createPaymentIntent, confirmSubscription, getStatus, handleWebhook };
