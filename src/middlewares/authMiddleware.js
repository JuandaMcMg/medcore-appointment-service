const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const DEBUG_AUTH = (process.env.DEBUG_AUTH || "false").toLowerCase() === "true";

if (DEBUG_AUTH) {
  const s = process.env.JWT_SECRET || '';
  console.log('[MR][SECRET] bytes.len =', Buffer.from(s, 'utf8').length);
  console.log('[MR][SECRET] bytes.tail=', Buffer.from(s, 'utf8').toString('hex').slice(-16));
}


function safeStr(str, n = 24) {
  if (!str) return "(empty)";
  return str.length <= n ? str : str.slice(0, n) + "...";
}

function fpSecret(s) {
  if (!s) return "EMPTY";
  return crypto.createHash("sha256").update(s).digest("hex");
}

const verifyToken = (req, res, next) => {
  try {
    if (DEBUG_AUTH) {
      console.log("[AUTH][mr] Authorization.raw =", safeStr(req.headers.authorization, 48));
    }
    // Obtener el token del header
    const token = req.headers.authorization?.split(" ")[1];
    if (DEBUG_AUTH) {
      console.log("[AUTH][mr] token.preview =", safeStr(token, 32));
    }

    if (!token) {
      return res.status(401).json({
        message: "No se proporcionó token de autenticación",
        service: "medical-records-service"
      });
    }
    
    if (DEBUG_AUTH && token) {
      try {
        const [h, p, sig] = token.split(".");
        const hdotp = `${h}.${p}`;

        // Recalcula la firma HMAC-SHA256 con TU secreto
        const expected = crypto
          .createHmac("sha256", process.env.JWT_SECRET)
          .update(hdotp)
          .digest();

        // Pásala a base64url como hace JWT
        const expectedB64url = expected
          .toString("base64")
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");

        console.log("[AUTH][mr] sig.actual.tail  =", sig ? sig.slice(-12) : "(none)");
        console.log("[AUTH][mr] sig.expect.tail  =", expectedB64url.slice(-12));
        console.log("[AUTH][mr] sig.equals       =", sig === expectedB64url);

        // Info de entorno/lib
        const jwv = (() => { try { return require("jsonwebtoken/package.json").version; } catch { return "(unknown)"; }})();
        console.log("[AUTH][mr] node =", process.version, "jsonwebtoken =", jwv);
      } catch (e) {
        console.log("[AUTH][mr] sig.recalc.error =", e.message);
      }
    }

    // Verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const normalizedId = decoded.id || decoded._id || decoded.userId || decoded.sub || null;
    if (!normalizedId) return res.status(400).json({ message: "El token no contiene un identificador de usuario" });

    // Añadir la información del usuario decodificada al request
    req.user = {...decoded, id: String(normalizedId)};
    
    return next();
  } catch (error) {
    console.error("Error de autenticación:", error.message);
    
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Token expirado",
        service: "medical-records-service"
      });
    }
    
    console.error("[AUTH][mr] verify error:", error.name, error.message);
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Token inválido",
        service: "medical-records-service"
      });
    }
    
    console.error("[AUTH][mr] verify error:", error.name, error.message);
    return res.status(500).json({
      message: "Error al procesar la autenticación",
      service: "medical-records-service"
    });
  }
};

const authorizeRoles = (...rolesPermitidos) => (req, res, next) => {
  const role = req.user?.role;
  if (!role || !rolesPermitidos.includes(role)) {
    return res.status(403).json({ message: "Forbidden (role)" });
  }
  next();
};

/*const { hasPermission } = require("./permissions");
const permission = (permName) => (req, res, next) => {
  if (!hasPermission(req.user?.role, permName)) {
    return res.status(403).json({ message: `Forbidden (permission: ${permName})` });
  }
  next();
};*/

module.exports = {
  verifyToken,
  authorizeRoles
};