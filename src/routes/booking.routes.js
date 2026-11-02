const express = require('express');
const bookingController = require('../controllers/booking.controller');

const router = express.Router();

router.post('/', bookingController.createBooking);
router.get('/:id', bookingController.getBookingById);

module.exports = router;
