const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const healthRoutes = require('./health.routes');
const resetRoutes = require('./reset.routes');
const slotRoutes = require('./slot.routes');
const bookingRoutes = require('./booking.routes');

const router = express.Router();

// Public health check route
router.use('/health', healthRoutes);

// Protected assessment endpoints (Level 2+)
router.use('/reset', authMiddleware, resetRoutes);
router.use('/slots', authMiddleware, slotRoutes);
router.use('/bookings', authMiddleware, bookingRoutes);

module.exports = router;
