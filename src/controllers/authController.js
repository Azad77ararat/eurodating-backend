const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
};

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { email, password, first_name, birth_date, gender, looking_for, language_preference } = req.body;

    if (!email || !password || !first_name || !birth_date || !gender) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check age (18+)
    const age = Math.floor((new Date() - new Date(birth_date)) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 18) {
      return res.status(400).json({ error: 'You must be at least 18 years old' });
    }

    // Check existing email
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const uuid = uuidv4();

    await db.execute(
      `INSERT INTO users (uuid, email, password_hash, first_name, birth_date, gender, looking_for, language_preference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, email.toLowerCase(), password_hash, first_name, birth_date, gender, looking_for || 'both', language_preference || 'de']
    );

    const [newUser] = await db.execute('SELECT id, uuid, email, first_name FROM users WHERE email = ?', [email.toLowerCase()]);
    const token = generateToken(newUser[0].id);

    res.status(201).json({ token, user: newUser[0] });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email.toLowerCase()]
    );

    if (!users.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

    if (user.is_banned) {
      return res.status(403).json({ error: 'Account banned' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update online status
    await db.execute('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = ?', [user.id]);

    const token = generateToken(user.id);
    const { password_hash, ...userData } = user;

    res.json({ token, user: userData });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = ?', [req.user.id]);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT u.*, GROUP_CONCAT(up.photo_url ORDER BY up.order_index) as photos
       FROM users u
       LEFT JOIN user_photos up ON u.id = up.user_id
       WHERE u.id = ?
       GROUP BY u.id`,
      [req.user.id]
    );

    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const { password_hash, ...userData } = users[0];
    userData.photos = userData.photos ? userData.photos.split(',') : [];
    res.json(userData);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { register, login, logout, getMe };
