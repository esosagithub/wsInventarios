const express = require('express');
const router = express.Router();
const tercerConteoController = require('../controllers/tercerConteoController');
const { basicAuth } = require('../middleware/auth');

// Aplicar autenticación básica
router.use(basicAuth);

// Ruta para registrar tercer conteo
router.post('/tercer-conteo', tercerConteoController.registrarTercerConteo);

// Ruta para obtener tercer conteo por ID
router.get('/tercer-conteo/:cd_tercer_conteo', tercerConteoController.obtenerTercerConteoPorId);

module.exports = router;