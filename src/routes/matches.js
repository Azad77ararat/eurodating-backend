const express = require('express');
const router = express.Router();
const { getMatches } = require('../controllers/matchesController');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getMatches);

module.exports = router;
