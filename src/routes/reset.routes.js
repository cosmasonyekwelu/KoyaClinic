const express = require('express');
const { resetDatabase } = require('../controllers/reset.controller');

const router = express.Router();

router.post('/', resetDatabase);

module.exports = router;
