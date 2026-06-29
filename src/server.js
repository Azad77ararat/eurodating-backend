require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/discovery', require('./routes/discovery'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/notifications', require('./routes/notifications'));

// Stripe webhook (raw body needed)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/webhook'));

// Socket.io
require('./socket/socketHandler')(io);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'EuroDating' }));

// Keep-alive ping كل 14 دقيقة
setInterval(() => {
  https.get('https://eurodating-backend.onrender.com/health', (res) => {
    console.log(`Keep-alive ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log(`Keep-alive error: ${err.message}`);
  });
}, 14 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 EuroDating server running on port ${PORT}`);
});

module.exports = { io };