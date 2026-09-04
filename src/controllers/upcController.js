const db = require('../../config/database');
const oracledb = require('oracledb');
const {
  getOrCreateStoreProducts,
  getActiveGenerations,
  CacheGenerationInProgressError
} = require('../services/upcCacheService');

const RETRY_AFTER_SECONDS = 60;
const DEFAULT_DBLINK_TIMEOUT_MS = 6 * 60 * 1000;

function getDblinkTimeoutMs() {
  const configuredTimeout = Number.parseInt(process.env.UPC_DBLINK_TIMEOUT_MS, 10);
  return Number.isInteger(configuredTimeout) && configuredTimeout > 5 * 60 * 1000
    ? configuredTimeout
    : DEFAULT_DBLINK_TIMEOUT_MS;
}

async function closeConnection(connection) {
  if (!connection) return;
  try {
    await connection.close();
  } catch (closeError) {
    console.error('Error cerrando conexion:', closeError);
  }
}

async function obtenerUpcsPorCedula(req, res) {
  let connection;
  let requestedDblink;

  try {
    const { cedula } = req.body;
    if (typeof cedula !== 'string' || cedula.trim() === '') {
      return res.status(400).json({
        error: 'Parametro invalido',
        mensaje: 'El campo "cedula" es requerido y no puede estar vacio'
      });
    }

    connection = await db.getConnection();
    connection.callTimeout = getDblinkTimeoutMs();

    // Esta consulta se mantiene en cada solicitud porque la asignacion puede cambiar diariamente.
    const query1 = `
      SELECT sbs_no, store_no, SAP_WERKS
      FROM jde_general@DBL_CLOUDFRIDTMAN.REDBDD.REDPROD.ORACLEVCN.COM
      WHERE trim(sap_werks) = (
        SELECT DISTINCT trim(almacen)
        FROM inv_piqueos_inventario_tbl
        WHERE estado IN ('PENDIENTE', 'EN_PROCESO')
          AND piqueo_id IN (
            SELECT piqueo_id FROM inv_piqueo_colaboradores_tbl WHERE cedula = :cedula
          )
      )
    `;
    const result1 = await connection.execute(query1, { cedula: cedula.trim() }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    if (result1.rows.length === 0) {
      return res.status(404).json({
        error: 'No encontrado',
        mensaje: `No se encontro informacion para la cedula: ${cedula}`,
        cedula
      });
    }

    const { SBS_NO, STORE_NO, SAP_WERKS } = result1.rows[0];
    const queryDblink = `
      SELECT dblink
      FROM rpro_tiendas_dblink@DBL_CLOUDFRIDTMAN.REDBDD.REDPROD.ORACLEVCN.COM
      WHERE estado = 'A'
        AND CODNEG = :sapWerks
        AND DBLINK LIKE 'DB%'
    `;
    const resultDblink = await connection.execute(queryDblink, { sapWerks: SAP_WERKS }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    if (resultDblink.rows.length === 0) {
      return res.status(404).json({
        error: 'No encontrado',
        mensaje: `No se encontro DBLINK activo para SAP_WERKS: ${SAP_WERKS}`
      });
    }

    const DBLINK = resultDblink.rows[0].DBLINK;
    requestedDblink = DBLINK;
    if (!/^[a-zA-Z0-9_.]+$/.test(DBLINK)) {
      return res.status(400).json({
        error: 'Dato invalido',
        mensaje: 'El valor de DBLINK contiene caracteres no permitidos'
      });
    }

    const store = { sapWerks: SAP_WERKS, sbsNo: SBS_NO, storeNo: STORE_NO };

    // Las consultas de identificacion ya terminaron. No se debe conservar esta
    // conexion mientras otro proceso genera el cache de la misma tienda.
    await closeConnection(connection);
    connection = null;

    const { products: productos, source } = await getOrCreateStoreProducts({
      store,
      dblink: DBLINK,
      loadProducts: async () => {
        let generationConnection;
        const generationStart = Date.now();
        try {
          generationConnection = await db.getConnection();
          generationConnection.callTimeout = getDblinkTimeoutMs();

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
          const result2 = await generationConnection.execute(query2, {
            sbs_no: SBS_NO,
            store_no: STORE_NO
          }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

          console.log(`Cache UPC generado para ${SAP_WERKS}/${STORE_NO}; duracion_ms=${Date.now() - generationStart}`);
          return result2.rows.map(row => ({
            upc: row.LOCAL_UPC,
            descripcion: row.DESCRIPCION ? row.DESCRIPCION.trim() : ''
          }));
        } finally {
          await closeConnection(generationConnection);
        }
      }
    });

    console.log(`UPCs para tienda ${SAP_WERKS}/${STORE_NO}: ${productos.length}; origen=${source}`);

    return res.json({
      success: true,
      mensaje: productos.length === 0
        ? 'No se encontraron productos con inventario disponible'
        : 'Productos obtenidos exitosamente',
      cedula,
      tienda: { sbs_no: SBS_NO, store_no: STORE_NO },
      total_productos: productos.length,
      productos
    });
  } catch (error) {
    if (error instanceof CacheGenerationInProgressError) {
      res.set('Retry-After', String(RETRY_AFTER_SECONDS));
      return res.status(503).json({
        error: 'Servicio temporalmente no disponible',
        mensaje: 'El catalogo UPC de esta tienda se esta generando. Intente nuevamente dentro de un minuto.',
        codigo: error.code,
        detalle: `Reintentar en ${RETRY_AFTER_SECONDS} segundos`
      });
    }

    if (error.code === 'NJS-040') {
      console.error('Pool Oracle saturado al solicitar conexion para UPC', {
        dblink_solicitado: requestedDblink || 'aun_no_determinado',
        generaciones_activas: getActiveGenerations()
      });
    }
    console.error('Error al obtener UPCs:', error);
    if (error.errorNum) {
      return res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al consultar la base de datos',
        codigo: error.errorNum,
        detalle: error.message
      });
    }
    return res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al procesar la solicitud',
      detalle: error.message
    });
  } finally {
    await closeConnection(connection);
  }
}

module.exports = { obtenerUpcsPorCedula };
