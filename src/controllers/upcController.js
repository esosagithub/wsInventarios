const db = require('../../config/database');
const oracledb = require('oracledb');
const { getOrCreateStoreProducts } = require('../services/upcCacheService');

async function obtenerUpcsPorCedula(req, res) {
  let connection;

  try {
    const { cedula } = req.body;
    if (typeof cedula !== 'string' || cedula.trim() === '') {
      return res.status(400).json({
        error: 'Parametro invalido',
        mensaje: 'El campo "cedula" es requerido y no puede estar vacio'
      });
    }

    connection = await db.getConnection();

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
    if (!/^[a-zA-Z0-9_.]+$/.test(DBLINK)) {
      return res.status(400).json({
        error: 'Dato invalido',
        mensaje: 'El valor de DBLINK contiene caracteres no permitidos'
      });
    }

    const store = { sapWerks: SAP_WERKS, sbsNo: SBS_NO, storeNo: STORE_NO };
    const { products: productos, source } = await getOrCreateStoreProducts({
      store,
      dblink: DBLINK,
      loadProducts: async () => {
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
        const result2 = await connection.execute(query2, {
          sbs_no: SBS_NO,
          store_no: STORE_NO
        }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        return result2.rows.map(row => ({
          upc: row.LOCAL_UPC,
          descripcion: row.DESCRIPCION ? row.DESCRIPCION.trim() : ''
        }));
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
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexion:', closeError);
      }
    }
  }
}

module.exports = { obtenerUpcsPorCedula };
