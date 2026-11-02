const express = require('express');
const slotController = require('../controllers/slot.controller');

const router = express.Router();

router.post('/', slotController.reset);

module.exports = router;
