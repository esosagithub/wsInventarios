require('dotenv').config();
const oracledb = require('oracledb');

try {
  oracledb.initOracleClient({
    libDir: process.env.ORACLE_LIB_DIR || 'C:\\oracle\\instantclient_19_28'
  });
  console.log('Cliente Oracle inicializado');
} catch (err) {
  console.warn('Advertencia initOracleClient (puede ser seguro si ya está configurado):', err.message || err);
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function testConnection() {
  const user = process.env.REPORT_DB_USER;
  const password = process.env.REPORT_DB_PASSWORD;
  const connectString = process.env.REPORT_DB_CONNECT_STRING ||
    (process.env.REPORT_DB_HOST && process.env.REPORT_DB_PORT ? `${process.env.REPORT_DB_HOST}:${process.env.REPORT_DB_PORT}` : null);

  if (!user || !password || !connectString) {
    console.error('Faltan variables de entorno. Define REPORT_DB_USER, REPORT_DB_PASSWORD y REPORT_DB_CONNECT_STRING o REPORT_DB_HOST/REPORT_DB_PORT');
    process.exit(1);
  }

  let connection;
  try {
    connection = await oracledb.getConnection({ user, password, connectString });
    console.log('Conexión exitosa a', connectString);
    const result = await connection.execute('SELECT 1 FROM DUAL');
    console.log('Resultado de consulta de prueba:', result.rows);
  } catch (err) {
    console.error('Error al conectar o ejecutar la consulta:', err);
    process.exit(1);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { /* ignore */ }
    }
  }
}

testConnection();
