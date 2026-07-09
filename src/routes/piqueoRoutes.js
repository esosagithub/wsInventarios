const express = require('express');
const router = express.Router();
const { obtenerPiqueosPorCedula, actualizarSegundoConteo } = require('../controllers/piqueoController');
const { basicAuth } = require('../middleware/auth');

// Aplicar autenticación básica a todas las rutas
router.use(basicAuth);

// Ruta para obtener piqueos por cédula
router.post('/piqueos', obtenerPiqueosPorCedula);

// Nueva ruta para actualizar segundo conteo
router.post('/actualizar-segundo-conteo', actualizarSegundoConteo);

module.exports = router;