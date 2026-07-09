const db = require('../../config/database');
const oracledb = require('oracledb');

/**
 * Obtener UPCs por cédula del colaborador
 * Realiza dos consultas encadenadas:
 * 1. Obtiene sbs_no y store_no según la cédula
 * 2. Obtiene los UPCs con descripción y esos parámetros
 */
async function obtenerUpcsPorCedula(req, res) {
  let connection;

  try {
    const { cedula } = req.body;

    // Validar que la cédula esté presente
    if (!cedula || cedula.trim() === '') {
      return res.status(400).json({
        error: 'Parámetro inválido',
        mensaje: 'El campo "cedula" es requerido y no puede estar vacío'
      });
    }

    console.log(`🔍 Buscando UPCs para cédula: ${cedula}`);

    // Obtener conexión
    connection = await db.getConnection();
    console.log('✅ Conexión a BD establecida');

    // PRIMERA CONSULTA: Obtener sbs_no, store_no y SAP_WERKS
    const query1 = `
      SELECT sbs_no, store_no, SAP_WERKS  
      FROM jde_general@DBL_CLOUDFRIDTMAN.REDBDD.REDPROD.ORACLEVCN.COM 
      WHERE trim(sap_werks) = (
        select distinct trim(almacen) 
        from inv_piqueos_inventario_tbl 
        where (estado = 'PENDIENTE' or estado = 'EN_PROCESO')
        and piqueo_id in(select piqueo_id from inv_piqueo_colaboradores_tbl where cedula = :cedula) )
    `;

    console.log('📊 Ejecutando primera consulta (sbs_no y store_no)...');
    const result1 = await connection.execute(query1, { cedula }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    // Validar si se encontraron datos
    if (result1.rows.length === 0) {
      await connection.close();
      console.log('❌ No se encontró información para la cédula');
      return res.status(404).json({
        error: 'No encontrado',
        mensaje: `No se encontró información para la cédula: ${cedula}`,
        cedula: cedula
      });
    }

    const { SBS_NO, STORE_NO, SAP_WERKS } = result1.rows[0];
    console.log(`✅ Datos obtenidos: sbs_no=${SBS_NO}, store_no=${STORE_NO}, SAP_WERKS=${SAP_WERKS}`);

    // SEGUNDA CONSULTA: Obtener el DBLINK desde rpro_tiendas_dblink
    const queryDblink = `
      SELECT dblink FROM rpro_tiendas_dblink@DBL_CLOUDFRIDTMAN.REDBDD.REDPROD.ORACLEVCN.COM 
      WHERE estado = 'A'
        AND CODNEG = :sapWerks
        AND DBLINK LIKE 'DB%'
    `;

    console.log('📊 Ejecutando consulta de DBLINK...');
    const resultDblink = await connection.execute(queryDblink, { sapWerks: SAP_WERKS }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    if (resultDblink.rows.length === 0) {
      await connection.close();
      console.log('❌ No se encontró DBLINK para SAP_WERKS:', SAP_WERKS);
      return res.status(404).json({
        error: 'No encontrado',
        mensaje: `No se encontró DBLINK activo para SAP_WERKS: ${SAP_WERKS}`
      });
    }

    const DBLINK = resultDblink.rows[0].DBLINK;
    console.log(`✅ DBLINK obtenido: ${DBLINK}`);

    // Validar que DBLINK solo contenga caracteres válidos para un database link
    if (!/^[a-zA-Z0-9_.]+$/.test(DBLINK)) {
      await connection.close();
      return res.status(400).json({
        error: 'Dato inválido',
        mensaje: 'El valor de DBLINK contiene caracteres no permitidos'
      });
    }

    // TERCERA CONSULTA: Obtener UPCs con descripción
    const query2 = `
      SELECT DISTINCT 
        a.local_upc,
        a.description1 || ' ' || a.description2 AS descripcion
      FROM INVN_SBS@${DBLINK} a, 
           invn_sbs_qty@${DBLINK} b 
      WHERE a.item_sid = b.item_sid
        AND b.sbs_no = :sbs_no
        AND b.store_no = :store_no
        AND b.qty <> 0
        AND LENGTH(a.local_upc) >= 11
      ORDER BY a.local_upc
    `;

    console.log('📊 Ejecutando segunda consulta (UPCs con descripción)...');
    const result2 = await connection.execute(query2, { 
      sbs_no: SBS_NO, 
      store_no: STORE_NO 
    }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    console.log(`✅ Consulta completada. ${result2.rows.length} UPCs encontrados`);

    // Cerrar conexión
    await connection.close();
    console.log('✅ Conexión cerrada');

    // Preparar respuesta con UPC y descripción
    const productos = result2.rows.map(row => ({
      upc: row.LOCAL_UPC,
      descripcion: row.DESCRIPCION ? row.DESCRIPCION.trim() : ''
    }));

    if (productos.length === 0) {
      return res.json({
        success: true,
        mensaje: 'No se encontraron productos con inventario disponible',
        cedula: cedula,
        tienda: {
          sbs_no: SBS_NO,
          store_no: STORE_NO
        },
        total_productos: 0,
        productos: []
      });
    }

    res.json({
      success: true,
      mensaje: 'Productos obtenidos exitosamente',
      cedula: cedula,
      tienda: {
        sbs_no: SBS_NO,
        store_no: STORE_NO
      },
      total_productos: productos.length,
      productos: productos
    });

  } catch (error) {
    console.error('❌ Error al obtener UPCs:', error);

    // Cerrar conexión en caso de error
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }

    // Manejo de errores específicos de Oracle
    if (error.errorNum) {
      return res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al consultar la base de datos',
        codigo: error.errorNum,
        detalle: error.message
      });
    }

    // Error general
    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al procesar la solicitud',
      detalle: error.message
    });
  }
}

module.exports = {
  obtenerUpcsPorCedula
};