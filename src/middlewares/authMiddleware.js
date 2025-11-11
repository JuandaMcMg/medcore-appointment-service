const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'No autorizado: token faltante' });
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Esperamos al menos { id, role }
    req.user = { id: payload.id, role: payload.role, ...payload };
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Prohibido' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
