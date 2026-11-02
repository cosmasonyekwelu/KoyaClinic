const express = require('express');
const slotController = require('../controllers/slot.controller');

const router = express.Router();

router.get('/', slotController.getSlots);

module.exports = router;
