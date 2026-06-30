const db = require('../config/db');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(jpg|jpeg|png|webp|gif)$/i;
    if (file.mimetype.startsWith('image/ allowed'));
  }
});

const getProfile = async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT u.id, u.uuid, u.first_name, u.birth_date, u.gender, u.country, u.city,
              u.bio, u.occupation, u.education, u.height, u.body_type, u.relationship_goal,
              u.is_online, u.last_seen, u.profile_photo, u.subscription_type,
              GROUP_CONCAT(DISTINCT up.photo_url ORDER BY up.order_index SEPARATOR ',') as photos,
              GROUP_CONCAT(DISTINCT ui.interest SEPARATOR ',') as interests
       FROM users u
       LEFT JOIN user_photos up ON u.id = up.user_id
       LEFT JOIN user_interests ui ON u.id = ui.user_id
       WHERE u.uuid = ? AND u.is_active = TRUE AND u.is_banned = FALSE
       GROUP BY u.id`,
      [req.params.uuid]
    );

    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    user.photos = user.photos ? user.photos.split(',') : [];
    user.interests = user.interests ? user.interests.split(',') : [];
    user.age = Math.floor((new Date() - new Date(user.birth_date)) / (365.25 * 24 * 60 * 60 * 1000));

    if (req.user && req.user.id !== user.id) {
      await db.execute(
        'INSERT INTO profile_views (viewer_id, viewed_id) VALUES (?, ?)',
        [req.user.id, user.id]
      ).catch(() => {});
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const {
      bio, occupation, education, height, body_type, relationship_goal,
      country, city, latitude, longitude, looking_for, language_preference,
      interests
    } = req.body;

    await db.execute(
      `UPDATE users SET bio=?, occupation=?, education=?, height=?, body_type=?,
       relationship_goal=?, country=?, city=?, latitude=?, longitude=?,
       looking_for=?, language_preference=? WHERE id=?`,
      [bio, occupation, education, height, body_type, relationship_goal,
       country, city, latitude, longitude, looking_for, language_preference, req.user.id]
    );

    if (interests && Array.isArray(interests)) {
      await db.execute('DELETE FROM user_interests WHERE user_id = ?', [req.user.id]);
      for (const interest of interests.slice(0, 20)) {
        await db.execute('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)', [req.user.id, interest]);
      }
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const uploadPhoto = async (req, res) => {
  try {
    const userId = req.user.id;

    const [photos] = await db.execute('SELECT id FROM user_photos WHERE user_id = ?', [userId]);
    if (photos.length >= 9) {
      return res.status(400).json({ error: 'Maximum 9 photos allowed' });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'eurodating', transformation: [{ width: 800, height: 800, crop: 'cover' }, { quality: 85 }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    const photoUrl = result.secure_url;
    const isPrimary = photos.length === 0;

    await db.execute(
      'INSERT INTO user_photos (user_id, photo_url, is_primary, order_index) VALUES (?, ?, ?, ?)',
      [userId, photoUrl, isPrimary, photos.length]
    );

    if (isPrimary) {
      await db.execute('UPDATE users SET profile_photo = ? WHERE id = ?', [photoUrl, userId]);
    }

    res.json({ photo_url: photoUrl, is_primary: isPrimary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const deletePhoto = async (req, res) => {
  try {
    const [photos] = await db.execute(
      'SELECT * FROM user_photos WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!photos.length) return res.status(404).json({ error: 'Photo not found' });

    const photo = photos[0];

    if (photo.photo_url.includes('cloudinary.com')) {
      const publicId = photo.photo_url.split('/').slice(-2).join('/').split('.')[0];
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    await db.execute('DELETE FROM user_photos WHERE id = ?', [photo.id]);

    if (photo.is_primary) {
      const [remaining] = await db.execute(
        'SELECT id, photo_url FROM user_photos WHERE user_id = ? ORDER BY order_index LIMIT 1',
        [req.user.id]
      );
      if (remaining.length) {
        await db.execute('UPDATE user_photos SET is_primary = TRUE WHERE id = ?', [remaining[0].id]);
        await db.execute('UPDATE users SET profile_photo = ? WHERE id = ?', [remaining[0].photo_url, req.user.id]);
      } else {
        await db.execute('UPDATE users SET profile_photo = NULL WHERE id = ?', [req.user.id]);
      }
    }

    res.json({ message: 'Photo deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getProfileViews = async (req, res) => {
  try {
    const [views] = await db.execute(
      `SELECT u.uuid, u.first_name, u.profile_photo, u.city, u.country,
              pv.viewed_at,
              FLOOR((DATEDIFF(NOW(), u.birth_date)) / 365.25) as age
       FROM profile_views pv
       JOIN users u ON pv.viewer_id = u.id
       WHERE pv.viewed_id = ?
       ORDER BY pv.viewed_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(views);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const reportUser = async (req, res) => {
  try {
    const { reported_uuid, reason, description } = req.body;
    const [reported] = await db.execute('SELECT id FROM users WHERE uuid = ?', [reported_uuid]);
    if (!reported.length) return res.status(404).json({ error: 'User not found' });

    await db.execute(
      'INSERT INTO reports (reporter_id, reported_id, reason, description) VALUES (?, ?, ?, ?)',
      [req.user.id, reported[0].id, reason, description]
    );
    res.json({ message: 'Report submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const blockUser = async (req, res) => {
  try {
    const { blocked_uuid } = req.body;
    const [blocked] = await db.execute('SELECT id FROM users WHERE uuid = ?', [blocked_uuid]);
    if (!blocked.length) return res.status(404).json({ error: 'User not found' });

    await db.execute(
      'INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
      [req.user.id, blocked[0].id]
    );
    res.json({ message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getProfile, updateProfile, upload, uploadPhoto, deletePhoto, getProfileViews, reportUser, blockUser };