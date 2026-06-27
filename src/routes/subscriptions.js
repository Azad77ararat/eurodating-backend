const express = require('express');
const router = express.Router();
const { getPlans, createPaymentIntent, confirmSubscription, getStatus } = require('../controllers/subscriptionsController');
const { authMiddleware } = require('../middleware/auth');

router.get('/plans', getPlans);
router.get('/status', authMiddleware, getStatus);
router.post('/create-payment-intent', authMiddleware, createPaymentIntent);
router.post('/confirm', authMiddleware, confirmSubscription);

module.exports = router;
