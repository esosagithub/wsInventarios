const db = require('../../config/database');
const oracledb = require('oracledb');

// Función para validar la estructura del JSON
function validarEstructuraJSON(data) {
  const errores = [];

  // Validar campos principales
  if (!data.timestamp) errores.push('Campo "timestamp" es requerido');
  if (!data.device_info) errores.push('Campo "device_info" es requerido');
  if (!data.process_summary) errores.push('Campo "process_summary" es requerido');
  if (!data.sessions || !Array.isArray(data.sessions)) errores.push('Campo "sessions" debe ser un array');

  // Validar device_info
  if (data.device_info) {
    if (!data.device_info.device_id) errores.push('Campo "device_info.device_id" es requerido');
    if (!data.device_info.platform) errores.push('Campo "device_info.platform" es requerido');
  }

  // Validar process_summary
  if (data.process_summary) {
    if (data.process_summary.total_sessions === undefined) errores.push('Campo "process_summary.total_sessions" es requerido');
    if (data.process_summary.total_scans === undefined) errores.push('Campo "process_summary.total_scans" es requerido');
    if (!data.process_summary.start_time) errores.push('Campo "process_summary.start_time" es requerido');
    if (!data.process_summary.end_time) errores.push('Campo "process_summary.end_time" es requerido');
  }

  // Validar sesiones
  if (data.sessions && Array.isArray(data.sessions)) {
    data.sessions.forEach((session, index) => {
      if (session.id === undefined) errores.push(`Session[${index}]: Campo "id" es requerido`);
      if (!session.section) errores.push(`Session[${index}]: Campo "section" es requerido`);
      if (!session.cedula) errores.push(`Session[${index}]: Campo "cedula" es requerido`);
      if (!session.start_time) errores.push(`Session[${index}]: Campo "start_time" es requerido`);
      if (!session.end_time) errores.push(`Session[${index}]: Campo "end_time" es requerido`);
      if (session.scan_count === undefined) errores.push(`Session[${index}]: Campo "scan_count" es requerido`);
      if (!session.barcodes || !Array.isArray(session.barcodes)) errores.push(`Session[${index}]: Campo "barcodes" debe ser un array`);
    });
  }

  return errores;
}

// Función para validar si section_name ya existe y obtener su cédula
async function validarSectionNameUnico(connection, sessions) {
  const sectionsToCheck = sessions.map(session => session.section);
  
  if (sectionsToCheck.length === 0) return [];
  
  // Crear placeholders para la consulta IN
  const placeholders = sectionsToCheck.map((_, index) => `:section${index}`).join(',');
  
  const checkQuery = `
    SELECT DISTINCT section_name, cedula 
    FROM sesiones_escaneo_tbl 
    WHERE section_name IN (${placeholders})
  `;
  
  // Crear objeto de parámetros dinámicamente
  const params = {};
  sectionsToCheck.forEach((section, index) => {
    params[`section${index}`] = section;
  });
  
  const result = await connection.execute(checkQuery, params);
  
  return result.rows.map(row => ({ section_name: row.SECTION_NAME, cedula: row.CEDULA }));
}

// Función para validar conflictos de cédula en secciones existentes
function validarConflictoCedula(sectionsExistentes, sessions) {
  for (const session of sessions) {
    const existente = sectionsExistentes.find(s => s.section_name === session.section);
    if (existente && existente.cedula !== session.cedula) {
      return {
        section_name: session.section,
        cedula_existente: existente.cedula,
        cedula_recibida: session.cedula
      };
    }
  }
  return null;
}

async function procesarEscaneo(req, res) {
  let connection;
  
  try {
    const data = req.body;

    // Validar estructura JSON
    const erroresValidacion = validarEstructuraJSON(data);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({
        error: 'Estructura JSON inválida',
        errores: erroresValidacion
      });
    }

    // Obtener conexión para transacción
    connection = await db.getConnection();
    
    // Validar qué secciones ya existen
    const sectionsExistentes = await validarSectionNameUnico(connection, data.sessions);
    
    // Validar conflictos de cédula antes de cualquier insert
    const conflicto = validarConflictoCedula(sectionsExistentes, data.sessions);
    if (conflicto) {
      await connection.close();
      connection = null;
      return res.status(409).json({
        error: 'Conflicto de cédula',
        mensaje: `La sección ${conflicto.section_name} ya está asignada a otra cédula`,
        section_name: conflicto.section_name,
        cedula_existente: conflicto.cedula_existente,
        cedula_recibida: conflicto.cedula_recibida
      });
    }

    // Deshabilitar autoCommit para manejar transacciones manualmente
    connection.autoCommit = false;

    // 1. Insertar en procesos_escaneo_tbl (siempre se registra el proceso)
    const insertProceso = `
      INSERT INTO procesos_escaneo_tbl (
        proceso_id, timestamp_proceso, device_id, platform, 
        total_sessions, total_scans, start_time, end_time, 
        json_completo, estado, fecha_creacion
      ) VALUES (
        SEQ_PROCESOS_ESCANEO.NEXTVAL, 
        TO_TIMESTAMP_TZ(:timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
        :device_id, :platform, :total_sessions, :total_scans,
        TO_TIMESTAMP_TZ(:start_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
        TO_TIMESTAMP_TZ(:end_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
        :json_completo, 'RECIBIDO', CURRENT_TIMESTAMP
      ) RETURNING proceso_id INTO :proceso_id
    `;

    const procesoResult = await connection.execute(insertProceso, {
      timestamp: data.timestamp,
      device_id: data.device_info.device_id,
      platform: data.device_info.platform,
      total_sessions: data.process_summary.total_sessions,
      total_scans: data.process_summary.total_scans,
      start_time: data.process_summary.start_time,
      end_time: data.process_summary.end_time,
      json_completo: JSON.stringify(data),
      proceso_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
    });

    const procesoId = procesoResult.outBinds.proceso_id[0];

    // 2. Insertar sesiones y códigos de barras
    for (const session of data.sessions) {
      if (sectionsExistentes.some(s => s.section_name === session.section)) {
        // Si la sección ya existe (misma cédula, ya validado), buscar la sesión existente
        const querySesion = `SELECT sesion_id FROM sesiones_escaneo_tbl WHERE section_name = :section_name`;
        const resultSesion = await connection.execute(querySesion, { section_name: session.section });
        if (resultSesion.rows.length === 0) {
          throw new Error('No se encontró la sesión existente para la sección: ' + session.section);
        }
        const sesionId = resultSesion.rows[0].SESION_ID;
        // Insertar todos los códigos recibidos en la sesión existente
        for (let i = 0; i < session.barcodes.length; i++) {
          const insertBarcode = `
            INSERT INTO barcodes_escaneo_tbl (
              barcode_id, sesion_id, proceso_id, codigo_barras, 
              orden_escaneo, fecha_creacion
            ) VALUES (
              SEQ_BARCODES_ESCANEO.NEXTVAL, :sesion_id, :proceso_id, 
              :codigo_barras, :orden_escaneo, CURRENT_TIMESTAMP
            )
          `;
          await connection.execute(insertBarcode, {
            sesion_id: sesionId,
            proceso_id: procesoId,
            codigo_barras: session.barcodes[i],
            orden_escaneo: i + 1
          });
        }
      } else {
        // Insertar nueva sesión y sus códigos
        const insertSesion = `
          INSERT INTO sesiones_escaneo_tbl (
            sesion_id, proceso_id, session_app_id, section_name, cedula,
            start_time, end_time, scan_count, fecha_creacion
          ) VALUES (
            SEQ_SESIONES_ESCANEO.NEXTVAL, :proceso_id, :session_app_id, :section_name, :cedula,
            TO_TIMESTAMP_TZ(:start_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
            TO_TIMESTAMP_TZ(:end_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
            :scan_count, CURRENT_TIMESTAMP
          ) RETURNING sesion_id INTO :sesion_id
        `;

        const sesionResult = await connection.execute(insertSesion, {
          proceso_id: procesoId,
          session_app_id: session.id,
          section_name: session.section,
          cedula: session.cedula,
          start_time: session.start_time,
          end_time: session.end_time,
          scan_count: session.scan_count,
          sesion_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        });

        const sesionId = sesionResult.outBinds.sesion_id[0];

        for (let i = 0; i < session.barcodes.length; i++) {
          const insertBarcode = `
            INSERT INTO barcodes_escaneo_tbl (
              barcode_id, sesion_id, proceso_id, codigo_barras, 
              orden_escaneo, fecha_creacion
            ) VALUES (
              SEQ_BARCODES_ESCANEO.NEXTVAL, :sesion_id, :proceso_id, 
              :codigo_barras, :orden_escaneo, CURRENT_TIMESTAMP
            )
          `;
          await connection.execute(insertBarcode, {
            sesion_id: sesionId,
            proceso_id: procesoId,
            codigo_barras: session.barcodes[i],
            orden_escaneo: i + 1
          });
        }
      }
    }

    // Commit de la transacción
    await connection.commit();

    // Respuesta exitosa
    res.status(201).json({
      success: true,
      mensaje: 'Proceso de escaneo guardado exitosamente',
      data: {
        proceso_id: procesoId,
        timestamp: data.timestamp,
        device_id: data.device_info.device_id,
        total_sessions: data.process_summary.total_sessions,
        total_scans: data.process_summary.total_scans
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

    console.error('Error al procesar escaneo:', error);
    
    if (error.errorNum) {
      // Error de Oracle
      res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al guardar los datos en la base de datos',
        codigo: error.errorNum,
        detalle: error.message
      });
    } else {
      // Error general
      res.status(500).json({
        error: 'Error interno del servidor',
        mensaje: 'Error al procesar la solicitud',
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

module.exports = { procesarEscaneo };