const db = require('../../config/database');
const oracledb = require('oracledb');

/**
 * Registrar tercer conteo con sus detalles
 * Inserta en:
 * 1. tercer_conteo_tbl (tabla principal)
 * 2. tercer_conteo_detalle_tbl (detalles por ubicación)
 */
async function registrarTercerConteo(req, res) {
  let connection;

  try {
    const {
      id_registro,
      numero_conteo,
      ean,
      descripcion,
      marca,
      talla,
      ubicacion_fisica_original,
      total_escaneado,
      detalles
    } = req.body;

    // Validaciones
    if (!id_registro || !numero_conteo || !ean) {
      return res.status(400).json({
        error: 'Parámetros inválidos',
        mensaje: 'Los campos id_registro, numero_conteo y ean son obligatorios'
      });
    }

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        error: 'Parámetros inválidos',
        mensaje: 'El campo detalles debe ser un array con al menos un elemento'
      });
    }

    // Validar estructura de detalles
    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i];
      if (!detalle.ubicacion || detalle.cantidad === undefined) {
        return res.status(400).json({
          error: 'Parámetros inválidos',
          mensaje: `El detalle en la posición ${i} debe contener ubicacion y cantidad`
        });
      }
    }

    console.log(`📝 Registrando tercer conteo para EAN: ${ean}`);

    // Obtener conexión
    connection = await db.getConnection();
    console.log('✅ Conexión a BD establecida');

    // INSERTAR EN TABLA PRINCIPAL
    const insertPrincipal = `
      INSERT INTO tercer_conteo_tbl (
        id_registro_original,
        numero_conteo,
        ean,
        descripcion,
        marca,
        talla,
        ubicacion_fisica_original,
        total_escaneado
      ) VALUES (
        :id_registro,
        :numero_conteo,
        :ean,
        :descripcion,
        :marca,
        :talla,
        :ubicacion_fisica_original,
        :total_escaneado
      ) RETURNING cd_tercer_conteo INTO :cd_tercer_conteo
    `;

    const bindsPrincipal = {
      id_registro: id_registro,
      numero_conteo: numero_conteo,
      ean: ean,
      descripcion: descripcion || null,
      marca: marca || null,
      talla: talla || null,
      ubicacion_fisica_original: ubicacion_fisica_original || null,
      total_escaneado: total_escaneado || 0,
      cd_tercer_conteo: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
    };

    console.log('📊 Insertando registro principal...');
    const resultPrincipal = await connection.execute(insertPrincipal, bindsPrincipal);

    const cd_tercer_conteo = resultPrincipal.outBinds.cd_tercer_conteo[0];
    console.log(`✅ Registro principal insertado con ID: ${cd_tercer_conteo}`);

    // INSERTAR DETALLES
    const insertDetalle = `
      INSERT INTO tercer_conteo_detalle_tbl (
        cd_tercer_conteo,
        ubicacion,
        cantidad_escaneada
      ) VALUES (
        :cd_tercer_conteo,
        :ubicacion,
        :cantidad
      )
    `;

    let detallesInsertados = 0;

    for (const detalle of detalles) {
      const bindsDetalle = {
        cd_tercer_conteo: cd_tercer_conteo,
        ubicacion: detalle.ubicacion,
        cantidad: detalle.cantidad
      };

      await connection.execute(insertDetalle, bindsDetalle);
      detallesInsertados++;
    }

    console.log(`✅ ${detallesInsertados} detalles insertados`);

    // COMMIT de la transacción
    await connection.commit();
    console.log('✅ Transacción confirmada (COMMIT)');

    // Cerrar conexión
    await connection.close();
    console.log('✅ Conexión cerrada');

    // Respuesta exitosa
    res.status(201).json({
      success: true,
      mensaje: 'Tercer conteo registrado exitosamente',
      data: {
        cd_tercer_conteo: cd_tercer_conteo,
        id_registro_original: id_registro,
        numero_conteo: numero_conteo,
        ean: ean,
        total_escaneado: total_escaneado,
        detalles_insertados: detallesInsertados
      }
    });

  } catch (error) {
    console.error('❌ Error al registrar tercer conteo:', error);

    // Hacer ROLLBACK en caso de error
    if (connection) {
      try {
        await connection.rollback();
        console.log('⚠️ ROLLBACK ejecutado');
        await connection.close();
      } catch (rollbackError) {
        console.error('Error en ROLLBACK:', rollbackError);
      }
    }

    // Manejo de errores específicos de Oracle
    if (error.errorNum) {
      // Error de constraint (ej: FK no existe)
      if (error.errorNum === 2291) {
        return res.status(400).json({
          error: 'Error de integridad referencial',
          mensaje: 'El id_registro_original no existe en la tabla de origen',
          codigo: error.errorNum
        });
      }

      // Error de duplicado
      if (error.errorNum === 1) {
        return res.status(409).json({
          error: 'Registro duplicado',
          mensaje: 'Ya existe un registro con estos datos',
          codigo: error.errorNum
        });
      }

      return res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al insertar en la base de datos',
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

/**
 * Obtener tercer conteo por ID
 */
async function obtenerTercerConteoPorId(req, res) {
  let connection;

  try {
    const { cd_tercer_conteo } = req.params;

    if (!cd_tercer_conteo) {
      return res.status(400).json({
        error: 'Parámetro requerido',
        mensaje: 'El parámetro cd_tercer_conteo es obligatorio'
      });
    }

    connection = await db.getConnection();

    // Consultar registro principal
    const queryPrincipal = `
      SELECT 
        cd_tercer_conteo,
        id_registro_original,
        numero_conteo,
        ean,
        descripcion,
        marca,
        talla,
        ubicacion_fisica_original,
        total_escaneado,
        TO_CHAR(fecha_registro, 'DD/MM/YYYY HH24:MI:SS') as fecha_registro
      FROM tercer_conteo_tbl
      WHERE cd_tercer_conteo = :cd_tercer_conteo
    `;

    const resultPrincipal = await connection.execute(
      queryPrincipal, 
      { cd_tercer_conteo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (resultPrincipal.rows.length === 0) {
      await connection.close();
      return res.status(404).json({
        error: 'No encontrado',
        mensaje: 'No se encontró el registro de tercer conteo'
      });
    }

    const registro = resultPrincipal.rows[0];

    // Consultar detalles
    const queryDetalles = `
      SELECT 
        cd_tercer_conteo_deta,
        ubicacion,
        cantidad_escaneada
      FROM tercer_conteo_detalle_tbl
      WHERE cd_tercer_conteo = :cd_tercer_conteo
      ORDER BY ubicacion
    `;

    const resultDetalles = await connection.execute(
      queryDetalles,
      { cd_tercer_conteo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    await connection.close();

    const detalles = resultDetalles.rows.map(row => ({
      cd_detalle: row.CD_TERCER_CONTEO_DETA,
      ubicacion: row.UBICACION,
      cantidad: row.CANTIDAD_ESCANEADA
    }));

    res.json({
      success: true,
      data: {
        cd_tercer_conteo: registro.CD_TERCER_CONTEO,
        id_registro_original: registro.ID_REGISTRO_ORIGINAL,
        numero_conteo: registro.NUMERO_CONTEO,
        ean: registro.EAN,
        descripcion: registro.DESCRIPCION,
        marca: registro.MARCA,
        talla: registro.TALLA,
        ubicacion_fisica_original: registro.UBICACION_FISICA_ORIGINAL,
        total_escaneado: registro.TOTAL_ESCANEADO,
        fecha_registro: registro.FECHA_REGISTRO,
        detalles: detalles
      }
    });

  } catch (error) {
    console.error('Error al obtener tercer conteo:', error);
    
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error cerrando conexión:', closeError);
      }
    }

    res.status(500).json({
      error: 'Error interno del servidor',
      mensaje: 'Error al obtener el registro'
    });
  }
}

module.exports = {
  registrarTercerConteo,
  obtenerTercerConteoPorId
};