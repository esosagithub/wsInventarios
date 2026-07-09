const db = require('../../config/database');
const oracledb = require('oracledb');

// Configurar Oracle para manejar CLOBs automáticamente
oracledb.fetchAsString = [ oracledb.CLOB ];

// Mapa de keywords para búsqueda directa - EXPANDIDO
const keywordsMap = {
  // Permisos y Licencias
  'calamidad': 'calamidad doméstica',
  'domestica': 'calamidad doméstica', 
  'calamidad domestica': 'calamidad doméstica',
  'maternidad': 'maternidad',
  'paternidad': 'paternidad',
  'licencia': 'licencia',
  'permiso': 'permiso',
  'fallecimiento': 'fallecimiento',
  'atraso': 'atraso',
  'ausencia': 'ausencia',
  'inasistencia': 'inasistencia',
  
  // Beneficios
  'beneficio': 'beneficios',
  'descuento': 'descuento',
  'seguro': 'seguros',
  'bupa': 'seguro médico',
  'medico': 'seguro médico',
  'salud': 'seguro médico',
  'telefonia': 'telefonía',
  'celular': 'telefonía',
  'movistar': 'telefonía',
  'claro': 'telefonía',
  'educacion': 'educación',
  'estudio': 'educación',
  'universidad': 'educación',
  
  // Contratos
  'contrato': 'contrato',
  'contratacion': 'contratación',
  'prueba': 'periodo de prueba',
  'renuncia': 'renuncia',
  'finiquito': 'finiquito',
  'despido': 'despido',
  'liquidacion': 'liquidación',
  
  // Nómina y Horarios
  'nomina': 'nómina',
  'salario': 'nómina',
  'sueldo': 'nómina',
  'pago': 'nómina',
  'horario': 'horarios',
  'jornada': 'horarios',
  'timbrado': 'horarios',
  
  // Procesos
  'seleccion': 'selección',
  'reclutamiento': 'selección',
  'entrevista': 'selección',
  'formativas': 'formativas',
  'induccion': 'inducción',
  'onboarding': 'onboarding',
  'ingreso': 'ingreso',
  
  // Desempeño
  'meta': 'meta',
  'objetivo': 'meta',
  'incumplimiento': 'incumplimiento',
  'evaluacion': 'evaluación',
  'desempeño': 'desempeño',
  'rendimiento': 'desempeño',
  
  // Cultura y Filosofía
  'mision': 'misión',
  'vision': 'visión',
  'valores': 'valores',
  'cultura': 'cultura',
  'filosofia': 'filosofía',
  'marathon': 'Marathon',
  'deporte': 'deporte',
  'atleta': 'atleta'
};

// Función mejorada para calcular similitud
function calcularSimilitud(texto1, texto2) {
  if (!texto1 || !texto2) return 0;
  
  const normalizar = (texto) => {
    return texto
      .toString()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const texto1Norm = normalizar(texto1);
  const texto2Norm = normalizar(texto2);
  
  // Coincidencia exacta después de normalizar
  if (texto1Norm === texto2Norm) return 1.0;
  
  // Si uno contiene al otro
  if (texto1Norm.includes(texto2Norm) || texto2Norm.includes(texto1Norm)) return 0.8;
  
  const palabras1 = new Set(texto1Norm.split(/\s+/).filter(p => p.length > 2));
  const palabras2 = new Set(texto2Norm.split(/\s+/).filter(p => p.length > 2));
  
  if (palabras1.size === 0 || palabras2.size === 0) return 0;
  
  const interseccion = new Set([...palabras1].filter(palabra => palabras2.has(palabra)));
  const union = new Set([...palabras1, ...palabras2]);
  
  return interseccion.size / union.size;
}

// Función para búsqueda por keywords
function buscarPorKeywords(pregunta) {
  const preguntaNormalizada = pregunta.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, ' ');
  
  // Buscar coincidencias exactas primero
  for (const [keyword, tema] of Object.entries(keywordsMap)) {
    if (preguntaNormalizada.includes(keyword)) {
      console.log(`🎯 Keyword detectado: "${keyword}" -> Tema: "${tema}"`);
      return { tema, keyword };
    }
  }
  return null;
}

// Buscar en FAQ - VERSIÓN MEJORADA
async function buscarEnFAQ(req, res) {
  let connection;
  
  try {
    const { question, threshold = 0.2 } = req.body;

    console.log('🔍 Buscando FAQ para:', question);

    if (!question || question.trim() === '') {
      return res.status(400).json({
        error: 'Parámetro inválido',
        mensaje: 'El campo "question" es requerido'
      });
    }

    // PRIMERO: Buscar por keywords
    const keywordResult = buscarPorKeywords(question);
    let queryFiltrada = '';
    let params = {};
    
    if (keywordResult) {
      queryFiltrada = `
        AND (UPPER(pregunta) LIKE '%' || UPPER(:keyword) || '%' 
             OR UPPER(respuesta) LIKE '%' || UPPER(:keyword) || '%'
             OR UPPER(categoria) LIKE '%' || UPPER(:keyword) || '%')
      `;
      params.keyword = keywordResult.tema;
    }

    // Obtener conexión
    connection = await db.getConnection();
    console.log('✅ Conexión a BD establecida');

    // CONSULTA con filtro por keyword si existe
    const query = `
      SELECT 
        id, 
        pregunta, 
        TO_CLOB(respuesta) as respuesta,
        categoria
      FROM FAQ_MARATHON_chatBot 
      WHERE ACTIVO = 'S'
      ${queryFiltrada}
      ORDER BY 
        CASE WHEN UPPER(pregunta) LIKE '%' || UPPER(:priority) || '%' THEN 1 ELSE 2 END,
        id
    `;

    // Agregar priority param para ordenar resultados relevantes primero
    params.priority = keywordResult ? keywordResult.tema : '';

    console.log('📊 Ejecutando consulta...');
    const result = await connection.execute(query, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });
    
    console.log(`✅ Consulta completada. ${result.rows.length} registros encontrados`);

    if (result.rows.length === 0) {
      await connection.close();
      return res.json({
        encontrado: false,
        necesita_qdrant: true,
        pregunta_original: question,
        mensaje: 'No hay FAQs disponibles en el sistema'
      });
    }

    // Procesar resultados
    const resultados = [];
    
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      
      // Convertir respuesta a string
      let respuestaTexto = '';
      try {
        if (row.RESPUESTA) {
          respuestaTexto = typeof row.RESPUESTA === 'string' 
            ? row.RESPUESTA 
            : row.RESPUESTA.toString();
        }
      } catch (error) {
        console.error('Error convirtiendo respuesta:', error);
      }

      // Calcular relevancia mejorada
      const relevanciaPregunta = calcularSimilitud(question, row.PREGUNTA);
      const relevanciaRespuesta = calcularSimilitud(question, respuestaTexto);
      const relevanciaCategoria = calcularSimilitud(question, row.CATEGORIA);
      const relevancia = Math.max(relevanciaPregunta, relevanciaRespuesta, relevanciaCategoria);
      
      // Bonus por keyword match
      const bonusKeyword = keywordResult && (
        row.PREGUNTA.toLowerCase().includes(keywordResult.tema) || 
        respuestaTexto.toLowerCase().includes(keywordResult.tema) ||
        row.CATEGORIA.toLowerCase().includes(keywordResult.tema)
      ) ? 0.4 : 0;
      
      const relevanciaFinal = Math.min(1.0, relevancia + bonusKeyword);
      
      resultados.push({
        id: row.ID,
        pregunta: row.PREGUNTA,
        respuesta: respuestaTexto,
        categoria: row.CATEGORIA,
        relevancia: relevanciaFinal,
        keyword_match: bonusKeyword > 0,
        detalles: {
          pregunta: relevanciaPregunta,
          respuesta: relevanciaRespuesta,
          categoria: relevanciaCategoria,
          bonus: bonusKeyword
        }
      });
    }

    // Encontrar el mejor match
    const resultadosFiltrados = resultados
      .filter(faq => faq.relevancia >= threshold)
      .sort((a, b) => b.relevancia - a.relevancia);

    console.log(`📈 Resultados filtrados: ${resultadosFiltrados.length}`);
    
    // DEBUG: Mostrar top 5 resultados
    if (resultadosFiltrados.length > 0) {
      console.log('🔍 Top resultados:');
      resultadosFiltrados.slice(0, 5).forEach((r, i) => {
        console.log(`   ${i+1}. [${r.relevancia.toFixed(2)}] "${r.pregunta}"`);
        console.log(`      Categoría: ${r.categoria}`);
        console.log(`      Keyword: ${r.keyword_match ? 'SÍ' : 'NO'}`);
      });
    } else {
      console.log('❌ No hay resultados que superen el umbral');
      // Mostrar top 3 aunque no superen el umbral para debug
      resultados.slice(0, 3).forEach((r, i) => {
        console.log(`   ${i+1}. [${r.relevancia.toFixed(2)}] "${r.pregunta}"`);
      });
    }

    // Cerrar conexión ANTES de enviar respuesta
    await connection.close();
    console.log('✅ Conexión cerrada');

    if (resultadosFiltrados.length === 0) {
      return res.json({
        encontrado: false,
        necesita_qdrant: true,
        pregunta_original: question,
        mensaje: 'No se encontraron FAQs que coincidan',
        metadata: {
          total_faqs_revisadas: result.rows.length,
          umbral_utilizado: threshold,
          keyword_detectado: keywordResult ? keywordResult.tema : 'ninguno',
          mejor_similitud_encontrada: resultados.length > 0 ? 
            Math.round(Math.max(...resultados.map(r => r.relevancia)) * 100) / 100 : 0
        }
      });
    }

    const mejorResultado = resultadosFiltrados[0];
    console.log(`🎯 Mejor resultado: "${mejorResultado.pregunta}" - Relevancia: ${mejorResultado.relevancia}`);

    // Umbral más bajo para keywords
    const esMatchConfiable = mejorResultado.relevancia >= 0.3 || mejorResultado.keyword_match;

    if (esMatchConfiable) {
      res.json({
        encontrado: true,
        respuesta: mejorResultado.respuesta,
        metadata: {
          id: mejorResultado.id,
          categoria: mejorResultado.categoria,
          pregunta_match: mejorResultado.pregunta,
          similitud: Math.round(mejorResultado.relevancia * 100) / 100,
          keyword_detectado: keywordResult ? keywordResult.tema : null,
          keyword_bonus: mejorResultado.keyword_match,
          fuente: "faq_directo"
        },
        necesita_qdrant: false
      });
    } else {
      res.json({
        encontrado: false,
        necesita_qdrant: true,
        pregunta_original: question,
        posibles_coincidencias: resultadosFiltrados.slice(0, 3).map(r => ({
          pregunta: r.pregunta,
          categoria: r.categoria,
          similitud: Math.round(r.relevancia * 100) / 100
        })),
        metadata: {
          total_faqs_revisadas: result.rows.length,
          mejor_similitud: Math.round(mejorResultado.relevancia * 100) / 100,
          umbral_utilizado: threshold,
          keyword_detectado: keywordResult ? keywordResult.tema : null
        }
      });
    }

  } catch (error) {
    console.error('❌ Error en buscarEnFAQ:', error);
    
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }
    
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al procesar la búsqueda',
      detalle: error.message
    });
  }
}

// Obtener categorías
async function obtenerCategoriasFAQ(req, res) {
  let connection;
  
  try {
    connection = await db.getConnection();

    const query = `
      SELECT DISTINCT categoria, COUNT(*) as total_preguntas
      FROM FAQ_MARATHON_chatBot
      WHERE ACTIVO = 'S'
      GROUP BY categoria
      ORDER BY categoria
    `;

    const result = await connection.execute(query, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    await connection.close();

    const categorias = result.rows.map(row => ({
      categoria: row.CATEGORIA,
      total_preguntas: row.TOTAL_PREGUNTAS
    }));
    
    res.json({
      success: true,
      total: categorias.length,
      categorias: categorias
    });

  } catch (error) {
    console.error('Error al obtener categorías:', error);
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al obtener las categorías'
    });
  }
}

// Obtener FAQs por categoría
async function obtenerFAQPorCategoria(req, res) {
  let connection;
  
  try {
    const { categoria } = req.body;

    if (!categoria || categoria.trim() === '') {
      return res.status(400).json({
        error: 'Parámetro inválido',
        mensaje: 'El campo "categoria" es requerido'
      });
    }

    connection = await db.getConnection();

    const query = `
      SELECT 
        id, 
        pregunta, 
        TO_CLOB(respuesta) as respuesta,
        categoria
      FROM FAQ_MARATHON_chatBot
      WHERE UPPER(categoria) = UPPER(:categoria)
        AND ACTIVO = 'S'
      ORDER BY pregunta
    `;

    const result = await connection.execute(query, { categoria }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    if (result.rows.length === 0) {
      // Obtener categorías disponibles
      const categoriasQuery = `
        SELECT DISTINCT categoria
        FROM FAQ_MARATHON_chatBot
        WHERE ACTIVO = 'S'
        ORDER BY categoria
      `;
      const categoriasResult = await connection.execute(categoriasQuery, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      });

      await connection.close();

      const categoriasDisponibles = categoriasResult.rows.map(row => row.CATEGORIA);

      return res.status(404).json({
        mensaje: 'No se encontraron FAQs para esta categoría',
        categoria: categoria,
        categorias_disponibles: categoriasDisponibles
      });
    }

    // Procesar respuestas CLOB
    const faqs = result.rows.map(row => {
      let respuestaTexto = '';
      try {
        if (row.RESPUESTA) {
          respuestaTexto = typeof row.RESPUESTA === 'string' 
            ? row.RESPUESTA 
            : row.RESPUESTA.toString();
        }
      } catch (error) {
        console.error('Error convirtiendo respuesta:', error);
      }

      return {
        id: row.ID,
        pregunta: row.PREGUNTA,
        respuesta: respuestaTexto,
        categoria: row.CATEGORIA
      };
    });

    await connection.close();

    res.json({
      success: true,
      mensaje: `FAQs encontrados para la categoría: ${categoria}`,
      categoria: categoria,
      total: faqs.length,
      faqs: faqs
    });

  } catch (error) {
    console.error('Error al obtener FAQs por categoría:', error);
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al obtener los FAQs'
    });
  }
}

// Búsqueda directa por pregunta exacta (para testing)
async function buscarExacto(req, res) {
  try {
    const { pregunta } = req.body;

    if (!pregunta) {
      return res.status(400).json({
        error: 'Parámetro requerido',
        mensaje: 'El campo "pregunta" es requerido'
      });
    }

    const query = `
      SELECT id, pregunta, TO_CLOB(respuesta) as respuesta, categoria
      FROM FAQ_MARATHON_chatBot
      WHERE UPPER(pregunta) LIKE '%' || UPPER(:pregunta) || '%'
        AND ACTIVO = 'S'
      ORDER BY id
    `;

    const result = await db.executeQuery(query, { pregunta });

    if (result.rows.length === 0) {
      return res.json({
        encontrado: false,
        mensaje: 'No se encontró la pregunta exacta'
      });
    }

    const faq = result.rows[0];
    const respuestaTexto = typeof faq.RESPUESTA === 'string' ? faq.RESPUESTA : faq.RESPUESTA.toString();

    res.json({
      encontrado: true,
      respuesta: respuestaTexto,
      metadata: {
        id: faq.ID,
        pregunta: faq.PREGUNTA,
        categoria: faq.CATEGORIA
      }
    });

  } catch (error) {
    console.error('Error en búsqueda exacta:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error en búsqueda exacta'
    });
  }
}

// Obtener TODOS los FAQs sin filtros
async function obtenerTodosFAQs(req, res) {
  let connection;
  
  try {
    connection = await db.getConnection();
    console.log('✅ Conexión establecida para obtener todos los FAQs');

    const query = `
      SELECT 
        ID,
        CATEGORIA,
        PREGUNTA,
        TO_CLOB(RESPUESTA) as RESPUESTA,
        ACTIVO,
        TO_CHAR(FECHA_CREACION, 'DD/MM/YYYY HH24:MI:SS') as FECHA_CREACION,
        TO_CHAR(FECHA_ACTUALIZACION, 'DD/MM/YYYY HH24:MI:SS') as FECHA_ACTUALIZACION
      FROM FAQ_MARATHON_chatBot
      ORDER BY CATEGORIA, ID
    `;

    const result = await connection.execute(query, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    console.log(`📊 Total de registros encontrados: ${result.rows.length}`);

    // Procesar los resultados
    const faqs = result.rows.map(row => {
      let respuestaTexto = '';
      try {
        if (row.RESPUESTA) {
          respuestaTexto = typeof row.RESPUESTA === 'string' 
            ? row.RESPUESTA 
            : row.RESPUESTA.toString();
        }
      } catch (error) {
        console.error(`Error convirtiendo respuesta del ID ${row.ID}:`, error);
      }

      return {
        id: row.ID,
        categoria: row.CATEGORIA,
        pregunta: row.PREGUNTA,
        respuesta: respuestaTexto,
        activo: row.ACTIVO,
        fecha_creacion: row.FECHA_CREACION,
        fecha_actualizacion: row.FECHA_ACTUALIZACION
      };
    });

    await connection.close();
    console.log('✅ Conexión cerrada');

    // Respuesta con estadísticas adicionales
    const stats = {
      total: faqs.length,
      activos: faqs.filter(f => f.activo === 'S').length,
      inactivos: faqs.filter(f => f.activo === 'N').length,
      categorias: [...new Set(faqs.map(f => f.categoria))].length
    };

    res.json({
      success: true,
      mensaje: 'FAQs obtenidos exitosamente',
      estadisticas: stats,
      data: faqs
    });

  } catch (error) {
    console.error('❌ Error al obtener todos los FAQs:', error);
    
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }
    
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al obtener los FAQs',
      detalle: error.message
    });
  }
}

module.exports = {
  buscarEnFAQ,
  obtenerCategoriasFAQ,
  obtenerFAQPorCategoria,
  buscarExacto,
  obtenerTodosFAQs
};