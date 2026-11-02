const express = require('express');
const healthRoutes = require('./health.routes');
const resetRoutes = require('./reset.routes');
const slotRoutes = require('./slot.routes');
const bookingRoutes = require('./booking.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/reset', resetRoutes);
router.use('/slots', slotRoutes);
router.use('/bookings', bookingRoutes);

module.exports = router;
