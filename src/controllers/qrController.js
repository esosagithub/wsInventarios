const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require('canvas');
const qrcode = require('qrcode');

const QR_DIR = 'C:\\java\\wildfly-20.0.1.Final\\welcome-content\\QR';

// Función para consumir el servicio de certificadoQRcode
async function getCertificadoQRcode(cedula) {
  try {
    const response = await axios.post('https://ns.aseyco.com:444/MSWebServiceNomina/rest/service/certificadoQRcode', {
      cedula: cedula
    }, {
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error en certificadoQRcode:', error.message);
    throw new Error('Error al consumir servicio certificadoQRcode');
  }
}

// Función para consumir el servicio bonoTeleshop
async function getBonoTeleshop(cedula) {
  try {
    const response = await axios.post('https://ns.aseyco.com:444/MSWebServiceNomina/rest/service/bonoTeleshop', {
      cedula: cedula
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error en bonoTeleshop:', error.message);
    throw new Error('Error al consumir servicio bonoTeleshop');
  }
}

// Función para generar la imagen completa
async function generateQRImage(cedula, certificados) {
  const itemHeight = 260; // espacio por certificado (QR + texto)
  const canvasHeight = certificados.length * itemHeight + 20; // margen extra abajo
  const canvas = createCanvas(500, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 500, canvasHeight);

  let yOffset = 10; // margen superior
  for (const cert of certificados) {
    // Generar código QR como buffer
    const buffer = await qrcode.toBuffer(cert.certificado, { type: 'png', width: 150, margin: 1 });

    // Dibujar el código QR en el canvas
    const img = new Image();
    img.src = buffer;
    ctx.drawImage(img, 50, yOffset);

    // Texto del QR (una sola columna, debajo del código)
    ctx.fillStyle = 'black';
    ctx.font = '16px Arial';

    const baseX = 50;
    const textYStart = yOffset + 170; // abajo del QR de 150px + 20px de margen
    const lineHeight = 22;

    ctx.fillText(`QR: ${cert.motivo}`, baseX, textYStart);
    ctx.fillText(`monto Utilizado: ${cert.monto_utilizado}`, baseX, textYStart + lineHeight);
    ctx.fillText(`Cupo: ${cert.cupo}`, baseX, textYStart + lineHeight * 2);
    ctx.fillText(`fecha Vencimiento: ${cert.fecha_vencimiento}`, baseX, textYStart + lineHeight * 3);

    yOffset += itemHeight; // espacio suficiente para QR + texto
  }

  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(QR_DIR, `${cedula}.png`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Controlador principal
const generarQR = async (req, res) => {
  try {
    const { cedula } = req.body;

    // Validar entrada
    if (!cedula || typeof cedula !== 'string' || !/^\d{10}$/.test(cedula)) {
      return res.status(400).json({ error: 'Cédula inválida. Debe ser un string numérico de 10 dígitos.' });
    }

    // Consumir servicios
    const [certificados, bonos] = await Promise.all([
      getCertificadoQRcode(cedula),
      getBonoTeleshop(cedula)
    ]);

    // Combinar datos
    const allCertificados = [...certificados, ...bonos];

    // Generar imagen
    await generateQRImage(cedula, allCertificados);

    // Retornar URL
    const url = `https://ns.aseyco.com:444/QR/${cedula}.png`;
    res.json({ url });

  } catch (error) {
    console.error('Error en generarQR:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { generarQR };