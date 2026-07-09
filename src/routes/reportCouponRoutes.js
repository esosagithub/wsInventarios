const express = require('express');
const router = express.Router();
const controller = require('../controllers/reportCouponController');
const { basicAuth } = require('../middleware/auth');

// POST /api/report/coupons (protegido con Basic Auth)
router.post('/report/coupons', basicAuth, controller.createCoupon);

module.exports = router;
