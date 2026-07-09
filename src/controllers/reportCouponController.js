const database = require('../../config/database');
const oracledb = require('oracledb');
const crypto = require('crypto');

// Nombre de la tabla donde insertar — configurado a la tabla indicada por el usuario
const REPORT_TABLE = process.env.REPORT_DB_TABLE || 'CERTIFICADOS_PREDICTOR';

function validatePayload(body) {
  const required = ['requestId','promotionCode','validFrom','validTo','campaignId','webSite','codigoCupon'];
  for (const f of required) {
    if (!body[f]) return { valid: false, missing: f };
  }
  return { valid: true };
}

async function createCoupon(req, res) {
  const payload = req.body || {};
  const v = validatePayload(payload);
  if (!v.valid) {
    return res.status(400).json({
      status: 'ERROR',
      error: { code: 'MISSING_FIELD', message: `Falta campo ${v.missing}` }
    });
  }

  // Validaciones adicionales según estructura de tabla
  // En la tabla: CODIGOCUPON VARCHAR2(100), NUMEROIDCLIENTE VARCHAR2(50), ESTADO VARCHAR2(1)
  if (payload.codigoCupon && String(payload.codigoCupon).length > 100) {
    return res.status(400).json({ status: 'ERROR', error: { code: 'INVALID_FIELD', message: 'codigoCupon excede 100 caracteres' } });
  }
  if (payload.numeroIdCliente && String(payload.numeroIdCliente).length > 50) {
    return res.status(400).json({ status: 'ERROR', error: { code: 'INVALID_FIELD', message: 'numeroIdCliente excede 50 caracteres' } });
  }

  // Mapear campos
  const binds = {
    requestId: payload.requestId,
    promotionCode: payload.promotionCode,
    validFrom: payload.validFrom ? new Date(payload.validFrom) : null,
    validTo: payload.validTo ? new Date(payload.validTo) : null,
    campaignId: payload.campaignId || null,
    website: payload.webSite || null,
    codigocupon: payload.codigoCupon,
    dsctoporcentaje: payload.dsctoPorcentaje || null,
    montomaximodscto: payload.montoMaximoDscto || null,
    numeroidcliente: payload.numeroIdCliente || null,
    // DB columna ESTADO tiene tamaño 1 -> usar 'A' para ACTIVE, 'I' para INACTIVE
    estado: 'A'
  };

  try {
    const sql = `INSERT INTO ${REPORT_TABLE} (
      requestid, promotioncode, validfrom, validto, campaignid, website,
      codigocupon, dsctoporcentaje, montomaximodscto, numeroidcliente, estado
    ) VALUES (
      :requestId, :promotionCode, :validFrom, :validTo, :campaignId, :website,
      :codigocupon, :dsctoporcentaje, :montomaximodscto, :numeroidcliente, :estado
    )`;

    // Ejecutar insert usando el pool principal
    const options = { bindDefs: {
      requestId: { type: oracledb.STRING, maxSize: 100 },
      promotionCode: { type: oracledb.STRING, maxSize: 100 },
      validFrom: { type: oracledb.DATE },
      validTo: { type: oracledb.DATE },
      campaignId: { type: oracledb.STRING, maxSize: 100 },
      website: { type: oracledb.STRING, maxSize: 100 },
      codigocupon: { type: oracledb.STRING, maxSize: 100 },
      dsctoporcentaje: { type: oracledb.NUMBER },
      montomaximodscto: { type: oracledb.NUMBER },
      numeroidcliente: { type: oracledb.STRING, maxSize: 50 },
      estado: { type: oracledb.STRING, maxSize: 1 }
    }};

    await database.executeQuery(sql, binds, { autoCommit: true, ...options });

    // Generar respuesta: usamos el código de cupón ingresado como couponCode
    const couponCode = binds.codigocupon;
    const couponId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    return res.json({
      status: 'SUCCESS',
      couponId,
      couponCode,
      couponStatus: 'ACTIVE',
      validFrom: binds.validFrom ? binds.validFrom.toISOString() : null,
      validTo: binds.validTo ? binds.validTo.toISOString() : null,
      createdAt: now,
      createdBy: process.env.DB_USER || process.env.REPORT_DB_USER || 'MS_INVENTARIOS',
      error: null
    });

  } catch (err) {
    console.error('Error inserción REPORT DB:', err);
    return res.status(500).json({
      status: 'ERROR',
      couponId: null,
      couponCode: payload.codigoCupon || null,
      couponStatus: null,
      validFrom: payload.validFrom || null,
      validTo: payload.validTo || null,
      createdAt: new Date().toISOString(),
      createdBy: process.env.DB_USER || process.env.REPORT_DB_USER || 'MS_INVENTARIOS',
      error: { code: err.errorNum ? String(err.errorNum) : 'UNKNOWN', message: err.message || String(err) }
    });
  } finally {
    // executeQuery closes the connection
  }
}

module.exports = {
  createCoupon
};
