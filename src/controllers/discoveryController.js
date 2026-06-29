const db = require('../config/db');

const FREE_DAILY_LIMIT = 30;

// Helper: check and get today's swipe count for free users
const getDailySwipeStatus = async (userId, subscriptionType) => {
  if (subscriptionType !== 'free') return { limited: false, count: 0, remaining: 999 };

  const today = new Date().toISOString().split('T')[0];
  const [rows] = await db.execute(
    'SELECT swipe_count FROM daily_swipes WHERE user_id = ? AND swipe_date = ?',
    [userId, today]
  );

  const count = rows.length ? rows[0].swipe_count : 0;
  const remaining = FREE_DAILY_LIMIT - count;

  return { limited: true, count, remaining, reached: remaining <= 0 };
};

// GET /api/discovery - Get users to swipe on
const getDiscovery = async (req, res) => {
  try {
    const { min_age = 18, max_age = 99, max_distance = 100, gender } = req.query;
    const userId = req.user.id;

    const [currentUser] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const me = currentUser[0];

    // Check daily limit for free users
    const swipeStatus = await getDailySwipeStatus(userId, me.subscription_type);
    if (swipeStatus.reached) {
      return res.json({
        profiles: [],
        daily_limit_reached: true,
        reset_time: 'midnight',
        swipes_used: swipeStatus.count,
        swipes_limit: FREE_DAILY_LIMIT,
      });
    }

    const targetGender = gender || me.looking_for;
    let genderClause = '';
    if (targetGender === 'male') genderClause = "AND u.gender = 'male'";
    else if (targetGender === 'female') genderClause = "AND u.gender = 'female'";

    const [users] = await db.execute(
      `SELECT u.uuid, u.first_name, u.profile_photo, u.city, u.country,
              u.bio, u.occupation, u.is_online, u.last_seen, u.subscription_type,
              FLOOR(DATEDIFF(NOW(), u.birth_date) / 365.25) as age,
              GROUP_CONCAT(DISTINCT up.photo_url ORDER BY up.order_index SEPARATOR ',') as photos,
              GROUP_CONCAT(DISTINCT ui.interest SEPARATOR ',') as interests,
              (CASE WHEN u.latitude IS NOT NULL AND ? IS NOT NULL
               THEN (6371 * acos(cos(radians(?)) * cos(radians(u.latitude)) *
                    cos(radians(u.longitude) - radians(?)) +
                    sin(radians(?)) * sin(radians(u.latitude))))
               ELSE NULL END) as distance_km
       FROM users u
       LEFT JOIN user_photos up ON u.id = up.user_id
       LEFT JOIN user_interests ui ON u.id = ui.user_id
       WHERE u.id != ?
         AND u.is_active = TRUE
         AND u.is_banned = FALSE
         AND 1=1
         ${genderClause}
         AND FLOOR(DATEDIFF(NOW(), u.birth_date) / 365.25) BETWEEN ? AND ?
         AND u.id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ?)
         AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
         AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       GROUP BY u.id
       HAVING distance_km IS NULL OR distance_km <= ?
       ORDER BY u.is_online DESC, u.last_seen DESC
       LIMIT 20`,
      [me.latitude, me.latitude, me.longitude, me.latitude,
       userId, min_age, max_age, userId, userId, userId, max_distance]
    );

    const profiles = users.map(u => ({
      ...u,
      photos: u.photos ? u.photos.split(',') : [],
      interests: u.interests ? u.interests.split(',') : [],
      distance_km: u.distance_km ? Math.round(u.distance_km) : null
    }));

    res.json({
      profiles,
      daily_limit_reached: false,
      swipes_used: swipeStatus.count,
      swipes_remaining: swipeStatus.remaining,
      swipes_limit: swipeStatus.limited ? FREE_DAILY_LIMIT : null,
      is_premium: me.subscription_type !== 'free',
    });
  } catch (err) {
    console.error('Discovery error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/discovery/swipe
const swipe = async (req, res) => {
  try {
    const { target_uuid, action } = req.body;
    const userId = req.user.id;

    if (!['like', 'dislike', 'superlike'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Check daily limit for free users
    const [userRow] = await db.execute('SELECT subscription_type FROM users WHERE id = ?', [userId]);
    const subscriptionType = userRow[0].subscription_type;
    const swipeStatus = await getDailySwipeStatus(userId, subscriptionType);

    if (swipeStatus.reached) {
      return res.status(429).json({
        error: 'Daily swipe limit reached',
        code: 'DAILY_LIMIT_REACHED',
        swipes_limit: FREE_DAILY_LIMIT,
        reset_time: 'midnight',
      });
    }

    const [target] = await db.execute('SELECT id FROM users WHERE uuid = ?', [target_uuid]);
    if (!target.length) return res.status(404).json({ error: 'User not found' });

    const targetId = target[0].id;

    // Record swipe
    await db.execute(
      'INSERT INTO swipes (swiper_id, swiped_id, action) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE action = ?',
      [userId, targetId, action, action]
    );

    // Increment daily count for free users
    if (subscriptionType === 'free') {
      const today = new Date().toISOString().split('T')[0];
      await db.execute(
        `INSERT INTO daily_swipes (user_id, swipe_date, swipe_count)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE swipe_count = swipe_count + 1`,
        [userId, today]
      );
    }

    let isMatch = false;

    if (action === 'like' || action === 'superlike') {
      const [theyLiked] = await db.execute(
        "SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ? AND action IN ('like', 'superlike')",
        [targetId, userId]
      );

      if (theyLiked.length) {
        const user1 = Math.min(userId, targetId);
        const user2 = Math.max(userId, targetId);

        await db.execute('INSERT IGNORE INTO matches (user1_id, user2_id) VALUES (?, ?)', [user1, user2]);

        const [match] = await db.execute(
          'SELECT id FROM matches WHERE user1_id = ? AND user2_id = ?', [user1, user2]
        );

        if (match.length) {
          await db.execute('INSERT IGNORE INTO conversations (match_id) VALUES (?)', [match[0].id]);
          await db.execute(
            'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
            [targetId, 'match', 'New Match! 💕', `You matched with ${req.user.first_name}!`]
          );
        }
        isMatch = true;
      }
    }

    // Return updated swipe count
    const newStatus = await getDailySwipeStatus(userId, subscriptionType);
    res.json({
      success: true,
      is_match: isMatch,
      swipes_remaining: newStatus.remaining,
      swipes_limit: subscriptionType === 'free' ? FREE_DAILY_LIMIT : null,
    });
  } catch (err) {
    console.error('Swipe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/discovery/liked-me - Who liked me (premium only)
const getLikedMe = async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT u.uuid, u.first_name, u.profile_photo, u.city, u.country,
              FLOOR(DATEDIFF(NOW(), u.birth_date) / 365.25) as age,
              s.action, s.created_at
       FROM swipes s
       JOIN users u ON s.swiper_id = u.id
       WHERE s.swiped_id = ? AND s.action IN ('like', 'superlike')
         AND s.swiper_id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ? AND action = 'dislike')
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [req.user.id, req.user.id]
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/discovery/swipe-status
const getSwipeStatus = async (req, res) => {
  try {
    const [userRow] = await db.execute('SELECT subscription_type FROM users WHERE id = ?', [req.user.id]);
    const status = await getDailySwipeStatus(req.user.id, userRow[0].subscription_type);
    res.json({
      is_premium: userRow[0].subscription_type !== 'free',
      swipes_used: status.count,
      swipes_remaining: status.remaining,
      swipes_limit: status.limited ? FREE_DAILY_LIMIT : null,
      daily_limit_reached: status.reached || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getDiscovery, swipe, getLikedMe, getSwipeStatus };
