const express = require('express');
const router = express.Router();
const { procesarEscaneo } = require('../controllers/procesarEscaneos');
const { basicAuth } = require('../middleware/auth');

// Aplicar autenticación básica a todas las rutas
router.use(basicAuth);

// Ruta para procesar escaneos
router.post('/process-scan', procesarEscaneo);

module.exports = router;