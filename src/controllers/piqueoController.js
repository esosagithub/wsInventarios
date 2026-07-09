const db = require('../../config/database');

async function obtenerPiqueosPorCedula(req, res) {
  const { cedula } = req.body;

  if (!cedula) {
    return res.status(400).json({ error: 'La cédula es requerida' });
  }

  const query = `
    SELECT 
      a.id,
      a.numero_conteo, 
      a.descripcion, 
      a.marca, 
      a.TALLA,
      a.ENA AS EAN, 
      a.ubicacion_fisica,
      a.conteo_fisico,
      a.stock_sistema,
      a.diferencia,
      a.diferencia_RPRO
    FROM inv_inventario_fisico_vs_sistema a, inv_piqueos_inventario_tbl b
    WHERE a.numero_conteo = b.NUMERO_CONTEO
      and a.estado_comparacion = 'DIFERENCIA'
      AND a.cedula_colaborador = :cedula
      AND a.proceso_segundo_conteo IS NULL
      and b.ESTADO = 'PRIMER_CONTEO'
    ORDER BY a.numero_conteo
  `;

  try {
    const result = await db.executeQuery(query, { cedula });
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        mensaje: 'No se encontraron registros para esta cédula',
        data: [] 
      });
    }

    res.json({
      mensaje: 'Registros obtenidos exitosamente',
      cantidad: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al obtener registros:', error);
    res.status(500).json({ error: 'Error al consultar la base de datos' });
  }
}

async function actualizarSegundoConteo(req, res) {
  const { id, proceso, observaciones, cantidad } = req.body;
  let connection;

  // Validar que los campos requeridos estén presentes
  if (!id) {
    return res.status(400).json({ error: 'El campo "id" es requerido' });
  }

  if (!proceso) {
    return res.status(400).json({ error: 'El campo "proceso" es requerido' });
  }

  if (cantidad === undefined || cantidad === null) {
    return res.status(400).json({ error: 'El campo "cantidad" es requerido' });
  }

  // observaciones es opcional, si no viene se pone null
  const observacionesValue = observaciones || null;

  try {
    // Obtener conexión para manejar transacción
    connection = await db.getConnection();
    connection.autoCommit = false;

    // 1. Primer UPDATE: inv_inventario_fisico_vs_sistema (SIN conteo)
    const updateQuery1 = `
      UPDATE inv_inventario_fisico_vs_sistema
      SET PROCESO_SEGUNDO_CONTEO = :proceso,
          OBSERVACIONES_SEGUNDO_CONTEO = :observaciones
      WHERE id = :id
    `;

    const result1 = await connection.execute(updateQuery1, { 
      proceso, 
      observaciones: observacionesValue,
      id 
    });

    // Verificar si se actualizó algún registro en la primera tabla
    if (result1.rowsAffected === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: 'Registro no encontrado',
        mensaje: `No se encontró un registro con el id: ${id}`
      });
    }

    // 2. Segundo UPDATE: inv_piqueo_toma_fisica_2_tbl (CON conteo)
    const updateQuery2 = `
      UPDATE inv_piqueo_toma_fisica_2_tbl
      SET PROCESO_SEGUNDO_CONTEO = :proceso,
          OBSERVACIONES_SEGUNDO_CONTEO = :observaciones,
          conteo = :cantidad,
          CEDULA_COLABORADOR = (SELECT CEDULA_COLABORADOR FROM inv_inventario_fisico_vs_sistema WHERE id = :id),
          NOMBRE_COLABORADOR = (SELECT NOMBRE_COLABORADOR FROM inv_inventario_fisico_vs_sistema WHERE id = :id)
      WHERE (numero_conteo, codigo_barras, codigo_sap) = (
          SELECT numero_conteo, codigo_barras, codigo_sap 
          FROM inv_inventario_fisico_vs_sistema 
          WHERE id = :id
      )
    `;

    const result2 = await connection.execute(updateQuery2, { 
      proceso, 
      observaciones: observacionesValue,
      cantidad,
      id 
    });

    // Commit de la transacción
    await connection.commit();

    res.json({
      success: true,
      mensaje: 'Segundo conteo actualizado exitosamente en ambas tablas',
      data: {
        id: id,
        proceso: proceso,
        observaciones: observacionesValue,
        cantidad: cantidad,
        tabla1_actualizados: result1.rowsAffected,
        tabla2_actualizados: result2.rowsAffected
      }
    });

  } catch (error) {
    // Rollback en caso de error
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
    }

    console.error('Error al actualizar segundo conteo:', error);
    
    if (error.errorNum) {
      // Error de Oracle
      res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al actualizar los registros en la base de datos',
        codigo: error.errorNum,
        detalle: error.message
      });
    } else {
      // Error general
      res.status(500).json({
        error: 'Error interno del servidor',
        mensaje: 'Error al procesar la solicitud de actualización',
        detalle: error.message
      });
    }

  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error al cerrar la conexión:', closeError);
      }
    }
  }
}

module.exports = { 
  obtenerPiqueosPorCedula,
  actualizarSegundoConteo
};