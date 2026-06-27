const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/usersController');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');

router.get('/views', authMiddleware, subscriptionMiddleware, ctrl.getProfileViews);
router.get('/:uuid', authMiddleware, ctrl.getProfile);
router.put('/profile', authMiddleware, ctrl.updateProfile);
router.post('/photo', authMiddleware, ctrl.upload.single('photo'), ctrl.uploadPhoto);
router.delete('/photo/:id', authMiddleware, ctrl.deletePhoto);
router.post('/report', authMiddleware, ctrl.reportUser);
router.post('/block', authMiddleware, ctrl.blockUser);

module.exports = router;
