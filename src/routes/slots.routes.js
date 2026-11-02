const express = require('express');
const { getSlots } = require('../controllers/slots.controller');

const router = express.Router();

router.get('/', getSlots);

module.exports = router;
