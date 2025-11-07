const crypto = require('crypto');

// Helper to convert a Buffer to a base64url string (URL-safe variant
// of base64 as defined in RFC 7515).  We remove padding and replace
// characters that are not URL safe.
function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Sign a JWT payload using HS256.  Adds an expiration claim based on
 * expiresInSeconds.  The payload should be a plain object.  Returns a
 * compact JWT string.
 *
 * @param {Object} payload - Payload to include in the token
 * @param {string} secret - Secret key for HMAC
 * @param {number} expiresInSeconds - Expiration time in seconds
 * @returns {string} - JWT
 */
function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 24) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const fullPayload = { ...payload, iat, exp };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(fullPayload)));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest();
  const encodedSignature = base64url(signature);
  return `${data}.${encodedSignature}`;
}

/**
 * Verify a JWT signed with HS256.  Returns the decoded payload if valid
 * and not expired, otherwise returns null.
 *
 * @param {string} token - JWT string
 * @param {string} secret - Secret key
 * @returns {Object|null} - Decoded payload or null if invalid
 */
function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = base64url(
      crypto.createHmac('sha256', secret).update(data).digest()
    );
    if (signatureB64 !== expectedSig) {
      return null;
    }
    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Generate a salted password hash using PBKDF2.  Returns a string in the
 * format `salt:hash`, where both components are base64 encoded.
 *
 * @param {string} password - Plain-text password
 * @returns {string} - Combined salt and hash
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const iterations = 100000;
  const keylen = 32;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a password against a stored salt:hash string.
 *
 * @param {string} password - Plain-text password
 * @param {string} stored - Stored salt:hash
 * @returns {boolean} - True if the password matches, false otherwise
 */
function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iterations = 100000;
  const keylen = 32;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

module.exports = {
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword
};