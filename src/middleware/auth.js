const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [users] = await db.execute(
      'SELECT id, uuid, email, first_name, subscription_type, subscription_expires_at, is_active, is_banned FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!users.length || !users[0].is_active || users[0].is_banned) {
      return res.status(401).json({ error: 'Account not found or banned' });
    }

    req.user = users[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const subscriptionMiddleware = (req, res, next) => {
  const user = req.user;
  if (user.subscription_type === 'free') {
    return res.status(403).json({ error: 'Premium subscription required', code: 'SUBSCRIPTION_REQUIRED' });
  }
  if (user.subscription_type !== 'lifetime' && user.subscription_expires_at) {
    if (new Date(user.subscription_expires_at) < new Date()) {
      return res.status(403).json({ error: 'Subscription expired', code: 'SUBSCRIPTION_EXPIRED' });
    }
  }
  next();
};

module.exports = { authMiddleware, subscriptionMiddleware };
