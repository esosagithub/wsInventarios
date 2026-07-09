const oracledb = require('oracledb');
const dbVtex = require('../../config/databaseVtex');

const SQL_INSERT_LOG = `
  INSERT INTO ventas_web_log_ws (
    endpoint, metodo_http, usuario,
    json_request, query_ejecutado, json_response,
    http_status, duracion_ms, ip_origen, mensaje_error
  ) VALUES (
    :endpoint, :metodo_http, :usuario,
    :json_request, :query_ejecutado, :json_response,
    :http_status, :duracion_ms, :ip_origen, :mensaje_error
  )`;

function stringifyJson(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

async function logWs({
  endpoint,
  metodo_http,
  usuario,
  json_request,
  query_ejecutado,
  json_response,
  http_status,
  duracion_ms,
  ip_origen,
  mensaje_error
}) {
  let conn;
  try {
    conn = await dbVtex.getConnection();
    await conn.execute(SQL_INSERT_LOG, {
      endpoint: { val: endpoint || null, type: oracledb.STRING },
      metodo_http: { val: metodo_http || null, type: oracledb.STRING },
      usuario: { val: usuario || null, type: oracledb.STRING },
      json_request: { val: stringifyJson(json_request), type: oracledb.CLOB },
      query_ejecutado: { val: query_ejecutado || null, type: oracledb.CLOB },
      json_response: { val: stringifyJson(json_response), type: oracledb.CLOB },
      http_status: { val: http_status ?? null, type: oracledb.NUMBER },
      duracion_ms: { val: duracion_ms ?? null, type: oracledb.NUMBER },
      ip_origen: { val: ip_origen || null, type: oracledb.STRING },
      mensaje_error: { val: mensaje_error || null, type: oracledb.CLOB }
    }, { autoCommit: true });
  } catch (logErr) {
    console.error('wsLogger error:', logErr.message);
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }
}

module.exports = { logWs };
