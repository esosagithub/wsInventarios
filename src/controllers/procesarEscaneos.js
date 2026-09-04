const crypto = require('crypto');
const db = require('../../config/database');
const oracledb = require('oracledb');

const TRANSACTION_OPTIONS = { autoCommit: false };
const TRANSACTION_OBJECT_OPTIONS = {
  ...TRANSACTION_OPTIONS,
  outFormat: oracledb.OUT_FORMAT_OBJECT
};

function validarEstructuraJSON(data) {
  const errores = [];

  if (!data || typeof data !== 'object') return ['El cuerpo JSON es requerido'];
  if (!data.timestamp) errores.push('Campo "timestamp" es requerido');
  if (!data.device_info) errores.push('Campo "device_info" es requerido');
  if (!data.process_summary) errores.push('Campo "process_summary" es requerido');
  if (!Array.isArray(data.sessions)) errores.push('Campo "sessions" debe ser un array');

  if (data.device_info) {
    if (!data.device_info.device_id) errores.push('Campo "device_info.device_id" es requerido');
    if (!data.device_info.platform) errores.push('Campo "device_info.platform" es requerido');
  }

  if (data.process_summary) {
    if (data.process_summary.total_sessions === undefined) errores.push('Campo "process_summary.total_sessions" es requerido');
    if (data.process_summary.total_scans === undefined) errores.push('Campo "process_summary.total_scans" es requerido');
    if (!data.process_summary.start_time) errores.push('Campo "process_summary.start_time" es requerido');
    if (!data.process_summary.end_time) errores.push('Campo "process_summary.end_time" es requerido');
  }

  if (Array.isArray(data.sessions)) {
    data.sessions.forEach((session, index) => {
      if (session.id === undefined) errores.push(`Session[${index}]: Campo "id" es requerido`);
      if (!session.section) errores.push(`Session[${index}]: Campo "section" es requerido`);
      if (!session.cedula) errores.push(`Session[${index}]: Campo "cedula" es requerido`);
      if (!session.start_time) errores.push(`Session[${index}]: Campo "start_time" es requerido`);
      if (!session.end_time) errores.push(`Session[${index}]: Campo "end_time" es requerido`);
      if (session.scan_count === undefined) errores.push(`Session[${index}]: Campo "scan_count" es requerido`);
      if (!Array.isArray(session.barcodes)) errores.push(`Session[${index}]: Campo "barcodes" debe ser un array`);
    });
  }

  return errores;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function calcularFingerprint(data) {
  // Se omite timestamp porque Flutter puede regenerarlo al reintentar.
  // Los tiempos del proceso y de las sesiones permanecen como identidad funcional.
  const contenidoEstable = {
    version: 1,
    device_id: data.device_info.device_id,
    platform: data.device_info.platform,
    process_start_time: data.process_summary.start_time,
    process_end_time: data.process_summary.end_time,
    sessions: data.sessions.map(session => ({
      id: session.id,
      section: session.section,
      cedula: session.cedula,
      start_time: session.start_time,
      end_time: session.end_time,
      barcodes: session.barcodes
    }))
  };

  return crypto.createHash('sha256').update(stableStringify(contenidoEstable)).digest('hex');
}

function agruparSesiones(sessions) {
  const agrupadas = new Map();

  for (const session of sessions) {
    const key = String(session.section);
    const existente = agrupadas.get(key);

    if (existente && String(existente.cedula) !== String(session.cedula)) {
      return {
        conflicto: {
          section_name: session.section,
          cedula_existente: existente.cedula,
          cedula_recibida: session.cedula
        }
      };
    }

    if (existente) {
      existente.barcodes.push(...session.barcodes);
      existente.end_time = session.end_time;
    } else {
      agrupadas.set(key, {
        id: session.id,
        section: session.section,
        cedula: session.cedula,
        start_time: session.start_time,
        end_time: session.end_time,
        barcodes: [...session.barcodes]
      });
    }
  }

  return { sessions: [...agrupadas.values()] };
}

function crearBindsIn(values, prefix) {
  const binds = {};
  const placeholders = values.map((value, index) => {
    binds[`${prefix}${index}`] = value;
    return `:${prefix}${index}`;
  });
  return { binds, placeholders: placeholders.join(',') };
}

async function buscarLoteProcesado(connection, fingerprint) {
  const result = await connection.execute(`
    SELECT proceso_id
    FROM procesos_escaneo_lotes_tbl
    WHERE fingerprint = :fingerprint
      AND estado = 'PROCESADO'
  `, { fingerprint }, TRANSACTION_OBJECT_OPTIONS);

  return result.rows.length ? result.rows[0].PROCESO_ID : null;
}

async function obtenerSesionesExistentes(connection, sessions) {
  const sections = [...new Set(sessions.map(session => session.section))];
  if (sections.length === 0) return [];

  const { binds, placeholders } = crearBindsIn(sections, 'section');
  const result = await connection.execute(`
    SELECT section_name, cedula, sesion_id
    FROM sesiones_escaneo_tbl
    WHERE section_name IN (${placeholders})
    FOR UPDATE
  `, binds, TRANSACTION_OBJECT_OPTIONS);

  const sessionIds = result.rows.map(row => row.SESION_ID);
  const ordenes = new Map();

  if (sessionIds.length > 0) {
    const orderBinds = crearBindsIn(sessionIds, 'sesion');
    const orderResult = await connection.execute(`
      SELECT sesion_id, NVL(MAX(orden_escaneo), 0) AS ultimo_orden
      FROM barcodes_escaneo_tbl
      WHERE sesion_id IN (${orderBinds.placeholders})
      GROUP BY sesion_id
    `, orderBinds.binds, TRANSACTION_OBJECT_OPTIONS);

    orderResult.rows.forEach(row => ordenes.set(String(row.SESION_ID), Number(row.ULTIMO_ORDEN)));
  }

  return result.rows.map(row => ({
    section_name: row.SECTION_NAME,
    cedula: row.CEDULA,
    sesion_id: row.SESION_ID,
    ultimo_orden: ordenes.get(String(row.SESION_ID)) || 0
  }));
}

function validarConflictoCedula(sectionsExistentes, sessions) {
  const existentes = new Map(sectionsExistentes.map(item => [String(item.section_name), item]));
  for (const session of sessions) {
    const existente = existentes.get(String(session.section));
    if (existente && String(existente.cedula) !== String(session.cedula)) {
      return {
        section_name: session.section,
        cedula_existente: existente.cedula,
        cedula_recibida: session.cedula
      };
    }
  }
  return null;
}

function responderExito(res, data, procesoId) {
  return res.status(201).json({
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
}

async function procesarEscaneo(req, res) {
  let connection;
  const inicio = Date.now();

  try {
    const data = req.body;
    const erroresValidacion = validarEstructuraJSON(data);
    if (erroresValidacion.length > 0) {
      return res.status(400).json({ error: 'Estructura JSON invalida', errores: erroresValidacion });
    }

    const agrupacion = agruparSesiones(data.sessions);
    if (agrupacion.conflicto) {
      return res.status(409).json({
        error: 'Conflicto de cedula',
        mensaje: `La seccion ${agrupacion.conflicto.section_name} aparece con cedulas diferentes`,
        ...agrupacion.conflicto
      });
    }

    const sessions = agrupacion.sessions;
    const fingerprint = calcularFingerprint(data);
    const itemsRecibidos = sessions.reduce((total, session) => total + session.barcodes.length, 0);

    connection = await db.getConnection();

    const procesoExistente = await buscarLoteProcesado(connection, fingerprint);
    if (procesoExistente !== null) {
      console.log(`process-scan duplicado; proceso=${procesoExistente}; items=${itemsRecibidos}`);
      return responderExito(res, data, procesoExistente);
    }

    const sectionsExistentes = await obtenerSesionesExistentes(connection, sessions);
    const conflicto = validarConflictoCedula(sectionsExistentes, sessions);
    if (conflicto) {
      return res.status(409).json({
        error: 'Conflicto de cedula',
        mensaje: `La seccion ${conflicto.section_name} ya esta asignada a otra cedula`,
        ...conflicto
      });
    }

    const procesoResult = await connection.execute(`
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
    `, {
      timestamp: data.timestamp,
      device_id: data.device_info.device_id,
      platform: data.device_info.platform,
      total_sessions: data.process_summary.total_sessions,
      total_scans: data.process_summary.total_scans,
      start_time: data.process_summary.start_time,
      end_time: data.process_summary.end_time,
      json_completo: JSON.stringify(data),
      proceso_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
    }, TRANSACTION_OPTIONS);

    const procesoId = procesoResult.outBinds.proceso_id[0];

    try {
      await connection.execute(`
        INSERT INTO procesos_escaneo_lotes_tbl (
          lote_id, fingerprint, proceso_id, device_id,
          items_recibidos, estado, fecha_creacion
        ) VALUES (
          seq_procesos_escaneo_lotes.NEXTVAL, :fingerprint, :proceso_id, :device_id,
          :items_recibidos, 'PROCESANDO', CURRENT_TIMESTAMP
        )
      `, {
        fingerprint,
        proceso_id: procesoId,
        device_id: data.device_info.device_id,
        items_recibidos: itemsRecibidos
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error.errorNum !== 1) throw error;

      await connection.rollback();
      const idProcesado = await buscarLoteProcesado(connection, fingerprint);
      if (idProcesado === null) throw error;

      console.log(`process-scan duplicado concurrente; proceso=${idProcesado}; items=${itemsRecibidos}`);
      return responderExito(res, data, idProcesado);
    }

    const sesionesPorSeccion = new Map(
      sectionsExistentes.map(item => [String(item.section_name), { ...item }])
    );
    const barcodeBinds = [];

    for (const session of sessions) {
      const key = String(session.section);
      let sesion = sesionesPorSeccion.get(key);

      if (sesion) {
        await connection.execute(`
          UPDATE sesiones_escaneo_tbl
          SET scan_count = NVL(scan_count, 0) + :cantidad,
              end_time = TO_TIMESTAMP_TZ(:end_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
          WHERE sesion_id = :sesion_id
        `, {
          cantidad: session.barcodes.length,
          end_time: session.end_time,
          sesion_id: sesion.sesion_id
        }, TRANSACTION_OPTIONS);
      } else {
        const sesionResult = await connection.execute(`
          INSERT INTO sesiones_escaneo_tbl (
            sesion_id, proceso_id, session_app_id, section_name, cedula,
            start_time, end_time, scan_count, fecha_creacion
          ) VALUES (
            SEQ_SESIONES_ESCANEO.NEXTVAL, :proceso_id, :session_app_id, :section_name, :cedula,
            TO_TIMESTAMP_TZ(:start_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
            TO_TIMESTAMP_TZ(:end_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF6'),
            :scan_count, CURRENT_TIMESTAMP
          ) RETURNING sesion_id INTO :sesion_id
        `, {
          proceso_id: procesoId,
          session_app_id: session.id,
          section_name: session.section,
          cedula: session.cedula,
          start_time: session.start_time,
          end_time: session.end_time,
          scan_count: session.barcodes.length,
          sesion_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        }, TRANSACTION_OPTIONS);

        sesion = {
          sesion_id: sesionResult.outBinds.sesion_id[0],
          ultimo_orden: 0
        };
        sesionesPorSeccion.set(key, sesion);
      }

      session.barcodes.forEach((barcode, index) => {
        barcodeBinds.push({
          sesion_id: sesion.sesion_id,
          proceso_id: procesoId,
          codigo_barras: String(barcode),
          orden_escaneo: sesion.ultimo_orden + index + 1
        });
      });
      sesion.ultimo_orden += session.barcodes.length;
    }

    if (barcodeBinds.length > 0) {
      await connection.executeMany(`
        INSERT INTO barcodes_escaneo_tbl (
          barcode_id, sesion_id, proceso_id, codigo_barras,
          orden_escaneo, fecha_creacion
        ) VALUES (
          SEQ_BARCODES_ESCANEO.NEXTVAL, :sesion_id, :proceso_id,
          :codigo_barras, :orden_escaneo, CURRENT_TIMESTAMP
        )
      `, barcodeBinds, TRANSACTION_OPTIONS);
    }

    await connection.execute(`
      UPDATE procesos_escaneo_lotes_tbl
      SET estado = 'PROCESADO', fecha_procesado = CURRENT_TIMESTAMP
      WHERE fingerprint = :fingerprint
    `, { fingerprint }, TRANSACTION_OPTIONS);

    await connection.commit();
    console.log(`process-scan guardado; proceso=${procesoId}; items=${itemsRecibidos}; duracion_ms=${Date.now() - inicio}`);
    return responderExito(res, data, procesoId);
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
    }

    console.error('Error al procesar escaneo:', error);
    if (error.errorNum) {
      return res.status(500).json({
        error: 'Error de base de datos',
        mensaje: 'Error al guardar los datos en la base de datos',
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
        console.error('Error al cerrar la conexion:', closeError);
      }
    }
  }
}

module.exports = {
  procesarEscaneo,
  validarEstructuraJSON,
  calcularFingerprint
};
