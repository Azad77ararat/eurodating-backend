const db = require('../config/db');

// GET /api/matches
const getMatches = async (req, res) => {
  try {
    const [matches] = await db.execute(
      `SELECT m.id as match_id, m.matched_at,
              u.uuid, u.first_name, u.profile_photo, u.is_online, u.last_seen,
              FLOOR(DATEDIFF(NOW(), u.birth_date) / 365.25) as age,
              c.id as conversation_id,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND is_read = FALSE) as unread_count
       FROM matches m
       JOIN conversations c ON m.id = c.match_id
       JOIN users u ON (CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END) = u.id
       WHERE (m.user1_id = ? OR m.user2_id = ?) AND m.is_active = TRUE
       ORDER BY last_message_at DESC, m.matched_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/messages/:conversationId
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify user has access to this conversation
    const [access] = await db.execute(
      `SELECT c.id FROM conversations c
       JOIN matches m ON c.match_id = m.id
       WHERE c.id = ? AND (m.user1_id = ? OR m.user2_id = ?)`,
      [conversationId, req.user.id, req.user.id]
    );

    if (!access.length) return res.status(403).json({ error: 'Access denied' });

    const [messages] = await db.execute(
      `SELECT msg.id, msg.sender_id, msg.content, msg.message_type, msg.media_url,
              msg.is_read, msg.created_at,
              u.first_name, u.profile_photo
       FROM messages msg
       JOIN users u ON msg.sender_id = u.id
       WHERE msg.conversation_id = ?
       ORDER BY msg.created_at DESC
       LIMIT ? OFFSET ?`,
      [conversationId, parseInt(limit), parseInt(offset)]
    );

    // Mark messages as read
    await db.execute(
      'UPDATE messages SET is_read = TRUE WHERE conversation_id = ? AND sender_id != ?',
      [conversationId, req.user.id]
    );

    res.json(messages.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/messages/:conversationId
const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, message_type = 'text', media_url } = req.body;

    // Verify access
    const [access] = await db.execute(
      `SELECT c.id, m.user1_id, m.user2_id FROM conversations c
       JOIN matches m ON c.match_id = m.id
       WHERE c.id = ? AND (m.user1_id = ? OR m.user2_id = ?)`,
      [conversationId, req.user.id, req.user.id]
    );

    if (!access.length) return res.status(403).json({ error: 'Access denied' });

    const [result] = await db.execute(
      'INSERT INTO messages (conversation_id, sender_id, content, message_type, media_url) VALUES (?, ?, ?, ?, ?)',
      [conversationId, req.user.id, content, message_type, media_url]
    );

    await db.execute(
      'UPDATE conversations SET last_message_at = NOW() WHERE id = ?',
      [conversationId]
    );

    const receiverId = access[0].user1_id === req.user.id ? access[0].user2_id : access[0].user1_id;
    await db.execute(
      'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
      [receiverId, 'message', `New message from ${req.user.first_name}`, content?.substring(0, 100)]
    );

    const [newMessage] = await db.execute('SELECT * FROM messages WHERE id = ?', [result.insertId]);
    res.status(201).json(newMessage[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getMatches, getMessages, sendMessage };
