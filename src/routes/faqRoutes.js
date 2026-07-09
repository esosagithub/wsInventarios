const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');

// Ruta principal de búsqueda (POST con JSON)
router.post('/search', faqController.buscarEnFAQ);

// Ruta para obtener categorías (GET sin parámetros)
router.get('/categorias', faqController.obtenerCategoriasFAQ);

// Ruta para obtener FAQs por categoría (POST con JSON)
router.post('/categoria', faqController.obtenerFAQPorCategoria);

// Nueva ruta para obtener TODOS los FAQs (GET sin parámetros)
router.get('/todos', faqController.obtenerTodosFAQs);

module.exports = router;