const oracledb = require('oracledb');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const vtexConfig = {
  user: process.env.DB_USER_VTEX,
  password: process.env.DB_PASSWORD_VTEX,
  connectString: process.env.DB_CONNECT_STRING_VTEX,
  poolAlias: 'vtex',
  poolMin: 0,
  poolMax: 5,
  poolIncrement: 1
};

async function initialize() {
  try {
    await oracledb.createPool(vtexConfig);
    console.log('Pool de conexiones VTEX creado');
  } catch (err) {
    console.error('⚠️  Pool VTEX no pudo iniciarse:', err.message);
    // No se mata el servidor — el error se reportará al insertar
  }
}

async function getConnection() {
  try {
    return await oracledb.getPool('vtex').getConnection();
  } catch (err) {
    console.error('Error al obtener conexión VTEX:', err);
    throw err;
  }
}

async function close() {
  try {
    await oracledb.getPool('vtex').close();
    console.log('Pool VTEX cerrado');
  } catch (err) {
    console.error('Error al cerrar el pool VTEX:', err);
  }
}

module.exports = { initialize, getConnection, close };
