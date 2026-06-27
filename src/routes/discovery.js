const express = require('express');
const router = express.Router();
const { getDiscovery, swipe, getLikedMe, getSwipeStatus } = require('../controllers/discoveryController');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getDiscovery);
router.post('/swipe', authMiddleware, swipe);
router.get('/swipe-status', authMiddleware, getSwipeStatus);
router.get('/liked-me', authMiddleware, subscriptionMiddleware, getLikedMe);

module.exports = router;
