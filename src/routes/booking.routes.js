const express = require('express');
const bookingController = require('../controllers/booking.controller');
const { validateBookingInput } = require('../middleware/bookingValidation.middleware');

const router = express.Router();

router.post('/', validateBookingInput, bookingController.createBooking);
router.get('/:id', bookingController.getBookingById);

module.exports = router;
