const jwt = require('jsonwebtoken');
const db = require('../config/db');

module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [users] = await db.execute('SELECT id, first_name FROM users WHERE id = ?', [decoded.id]);
      if (!users.length) return next(new Error('User not found'));

      socket.userId = users[0].id;
      socket.userName = users[0].first_name;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`User ${socket.userId} connected`);
    onlineUsers.set(socket.userId, socket.id);

    // Update online status
    await db.execute('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = ?', [socket.userId]);
    io.emit('user_online', { userId: socket.userId });

    // Join user's conversation rooms
    const [conversations] = await db.execute(
      `SELECT c.id FROM conversations c
       JOIN matches m ON c.match_id = m.id
       WHERE m.user1_id = ? OR m.user2_id = ?`,
      [socket.userId, socket.userId]
    );
    conversations.forEach(conv => socket.join(`conv_${conv.id}`));

    // Send message
    socket.on('send_message', async (data) => {
      try {
        const { conversation_id, content, message_type = 'text', media_url } = data;

        // Verify access
        const [access] = await db.execute(
          `SELECT c.id, m.user1_id, m.user2_id FROM conversations c
           JOIN matches m ON c.match_id = m.id
           WHERE c.id = ? AND (m.user1_id = ? OR m.user2_id = ?)`,
          [conversation_id, socket.userId, socket.userId]
        );

        if (!access.length) return;

        const [result] = await db.execute(
          'INSERT INTO messages (conversation_id, sender_id, content, message_type, media_url) VALUES (?, ?, ?, ?, ?)',
          [conversation_id, socket.userId, content, message_type, media_url]
        );

        await db.execute('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [conversation_id]);

        const [message] = await db.execute('SELECT * FROM messages WHERE id = ?', [result.insertId]);
        const msg = { ...message[0], sender_name: socket.userName };

        io.to(`conv_${conversation_id}`).emit('new_message', msg);

        // Notify receiver if offline
        const receiverId = access[0].user1_id === socket.userId ? access[0].user2_id : access[0].user1_id;
        if (!onlineUsers.has(receiverId)) {
          await db.execute(
            'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
            [receiverId, 'message', `Neue Nachricht von ${socket.userName}`, content?.substring(0, 100)]
          );
        }
      } catch (err) {
        console.error('Socket send_message error:', err);
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      socket.to(`conv_${data.conversation_id}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.userName,
        conversation_id: data.conversation_id
      });
    });

    socket.on('stop_typing', (data) => {
      socket.to(`conv_${data.conversation_id}`).emit('user_stop_typing', {
        userId: socket.userId,
        conversation_id: data.conversation_id
      });
    });

    // Mark messages as read
    socket.on('mark_read', async (data) => {
      try {
        await db.execute(
          'UPDATE messages SET is_read = TRUE WHERE conversation_id = ? AND sender_id != ?',
          [data.conversation_id, socket.userId]
        );
        socket.to(`conv_${data.conversation_id}`).emit('messages_read', {
          conversation_id: data.conversation_id,
          reader_id: socket.userId
        });
      } catch (err) {
        console.error(err);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${socket.userId} disconnected`);
      onlineUsers.delete(socket.userId);
      await db.execute('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = ?', [socket.userId]);
      io.emit('user_offline', { userId: socket.userId });
    });
  });
};
