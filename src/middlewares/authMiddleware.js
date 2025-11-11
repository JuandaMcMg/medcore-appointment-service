const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const DEBUG_AUTH = (process.env.DEBUG_AUTH || 'false').toLowerCase() === 'true';

if (DEBUG_AUTH) {
  const s = process.env.JWT_SECRET || '';
  console.log('[APPT][SECRET] bytes.len =', Buffer.from(s, 'utf8').length);
  console.log('[APPT][SECRET] bytes.tail=', Buffer.from(s, 'utf8').toString('hex').slice(-16));
}

function safeStr(str, n = 24) {
  if (!str) return '(empty)';
  return str.length <= n ? str : str.slice(0, n) + '...';
}

const verifyToken = (req, res, next) => {
  try {
    if (DEBUG_AUTH) {
      console.log('[AUTH][appt] Authorization.raw =', safeStr(req.headers.authorization, 48));
    }
    const token = req.headers.authorization?.split(' ')[1];
    if (DEBUG_AUTH) {
      console.log('[AUTH][appt] token.preview =', safeStr(token, 32));
    }
    if (!token) {
      return res.status(401).json({
        message: 'No se proporcionó token de autenticación',
        service: 'medcore-appointment-service'
      });
    }

    // Debug firma (opcional)
    if (DEBUG_AUTH && token) {
      try {
        const [h, p, sig] = token.split('.');
        const hdotp = `${h}.${p}`;
        const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(hdotp).digest();
        const expectedB64url = expected.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        console.log('[AUTH][appt] sig.equals =', sig === expectedB64url);
      } catch {}
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const normalizedId = decoded.id || decoded._id || decoded.userId || decoded.sub || null;
    if (!normalizedId) return res.status(400).json({ message: 'El token no contiene un identificador de usuario' });
    req.user = { ...decoded, id: String(normalizedId) };
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expirado', service: 'medcore-appointment-service' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token inválido', service: 'medcore-appointment-service' });
    }
    return res.status(500).json({ message: 'Error al procesar la autenticación', service: 'medcore-appointment-service' });
  }
};

const authorizeRoles = (...rolesPermitidos) => (req, res, next) => {
  const role = req.user?.role;
  if (!role || !rolesPermitidos.includes(role)) {
    return res.status(403).json({ message: 'Forbidden (role)' });
  }
  next();
};

module.exports = { verifyToken, authorizeRoles };
