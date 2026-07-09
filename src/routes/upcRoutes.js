const express = require('express');
const router = express.Router();
const upcController = require('../controllers/upcController');
const { basicAuth } = require('../middleware/auth');

// Aplicar autenticación básica
router.use(basicAuth);

// Ruta para obtener UPCs por cédula
router.post('/upcs-por-cedula', upcController.obtenerUpcsPorCedula);

module.exports = router;