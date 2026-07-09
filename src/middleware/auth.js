require('dotenv').config();

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="API"');
    return res.status(401).json({ error: 'Autenticación requerida' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username === process.env.AUTH_USERNAME && password === process.env.AUTH_PASSWORD) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="API"');
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
}

module.exports = { basicAuth };