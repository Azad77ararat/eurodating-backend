const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/subscriptionsController');

router.post('/', handleWebhook);

module.exports = router;
