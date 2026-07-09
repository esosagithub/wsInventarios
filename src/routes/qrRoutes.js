const express = require('express');
const { generarQR } = require('../controllers/qrController');

const router = express.Router();

// Ruta para generar QR
router.post('/generar-qr', generarQR);

module.exports = router;