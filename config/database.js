const oracledb = require('oracledb');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

try {
  oracledb.initOracleClient({
    libDir: process.env.ORACLE_LIB_DIR || 'C:\\app\\instantclient_23_0'
  });
  console.log('Cliente Oracle configurado correctamente');
} catch (err) {
  console.error('Error al inicializar el cliente Oracle:', err);
  process.exit(1);
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = true;

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectString: process.env.DB_CONNECT_STRING,
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 2
};

async function initialize() {
  try {
    await oracledb.createPool(dbConfig);
    console.log('Pool de conexiones a Oracle creado');
  } catch (err) {
    console.error('Error al crear el pool de conexiones:', err);
    process.exit(1);
  }
}

async function getConnection() {
  try {
    return await oracledb.getPool().getConnection();
  } catch (err) {
    console.error('Error al obtener la conexión:', err);
    throw err;
  }
}

async function close() {
  try {
    await oracledb.getPool().close();
    console.log('Pool de conexiones cerrado');
  } catch (err) {
    console.error('Error al cerrar el pool:', err);
  }
}

async function executeQuery(sql, binds = [], options = {}) {
  let connection;
  try {
    connection = await getConnection();
    return await connection.execute(sql, binds, options);
  } catch (err) {
    console.error('Error en la consulta:', err);
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error al cerrar la conexión:', err);
      }
    }
  }
}

module.exports = {
  initialize,
  getConnection,
  close,
  executeQuery
};