/**
 * Envia un XML SOAP crudo a SAP sin usar el armado de sapService.
 *
 * Uso:
 *   node scripts/sendRawSapXml.js ruta/al/xml.xml
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const XML_PATH = process.argv[2];
const SAP_ENDPOINT = process.env.SAP_ENDPOINT
  || 'https://mths4qas.ec.aseyco.com:8100/sap/bc/srt/rfc/sap/z_ws_mm_crea_pedidos_ora/300/z_ws_mm_crea_pedidos_ora/z_ws_mm_crea_pedidos_ora';
const SOAP_ACTION = process.env.SAP_SOAP_ACTION
  || 'urn:sap-com:document:sap:soap:functions:mc-style:Z_WS_MM_CREA_PEDIDOS_ORA:ZMmCreaPedidosOrlRequest';

if (!XML_PATH) {
  console.error('Uso: node scripts/sendRawSapXml.js ruta/al/xml.xml');
  process.exit(1);
}

if (!process.env.SAP_USER || !process.env.SAP_PASSWORD) {
  console.error('Faltan SAP_USER y/o SAP_PASSWORD en .env');
  process.exit(1);
}

async function main() {
  const xml = fs.readFileSync(path.resolve(XML_PATH), 'utf8');

  console.log('=== Enviando XML crudo a SAP ===');
  console.log(`Endpoint: ${SAP_ENDPOINT}`);
  console.log(`Archivo : ${path.resolve(XML_PATH)}`);

  const response = await axios.post(SAP_ENDPOINT, xml, {
    auth: {
      username: process.env.SAP_USER,
      password: process.env.SAP_PASSWORD
    },
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
      SOAPAction: `"${SOAP_ACTION}"`
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      ciphers: 'DEFAULT@SECLEVEL=0'
    }),
    timeout: Number(process.env.SAP_TIMEOUT_MS || 60000),
    validateStatus: () => true
  });

  console.log('\n=== Respuesta SAP ===');
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(response.data);

  if (response.status >= 400) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\n=== Error enviando XML crudo ===');
  console.error(err.message);
  if (err.response?.data) console.error(err.response.data);
  process.exit(1);
});
