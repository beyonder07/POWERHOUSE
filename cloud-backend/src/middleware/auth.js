const jwt = require('jsonwebtoken');
const config = require('../config');
const { isAccessTokenRevoked } = require('../lib/tokenService');

async function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = authorization.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.typ !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const revoked = await isAccessTokenRevoked(decoded.jti);
    if (revoked) {
      return res.status(401).json({ error: 'Token revoked' });
    }

    req.user = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function optionalAuthMiddleware(req, _res, next) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return next();
  }

  const token = authorization.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.typ !== 'access') {
      return next();
    }

    const revoked = await isAccessTokenRevoked(decoded.jti);
    if (!revoked) {
      req.user = decoded;
    }
  } catch (_error) {
    // Ignore invalid tokens in optional auth mode.
  }

  return next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Unauthorized: Role missing' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Unauthorized: Only ${allowedRoles.join(' or ')} can perform this action` });
    }
    next();
  };
}

module.exports = { authMiddleware, optionalAuthMiddleware, requireRole };
