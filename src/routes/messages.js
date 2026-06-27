const express = require('express');
const router = express.Router();
const { getMessages, sendMessage } = require('../controllers/matchesController');
const { authMiddleware } = require('../middleware/auth');

router.get('/:conversationId', authMiddleware, getMessages);
router.post('/:conversationId', authMiddleware, sendMessage);

module.exports = router;
