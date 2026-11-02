const express = require('express');
const healthRoutes = require('./health.routes');
const resetRoutes = require('./reset.routes');
const slotsRoutes = require('./slots.routes');
const bookingsRoutes = require('./bookings.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/reset', resetRoutes);
router.use('/slots', slotsRoutes);
router.use('/bookings', bookingsRoutes);

module.exports = router;
