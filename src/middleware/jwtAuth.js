const jwt = require('jsonwebtoken');

function jwtAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'ERROR',
      error: { code: 'NO_TOKEN', message: 'Token de autorización requerido' }
    });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type === 'refresh') {
      return res.status(401).json({
        status: 'ERROR',
        error: { code: 'INVALID_TOKEN', message: 'No se puede usar un refresh token para esta operación' }
      });
    }

    req.user = payload;
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({
      status: 'ERROR',
      error: { code, message: err.message }
    });
  }
}

module.exports = { jwtAuth };
