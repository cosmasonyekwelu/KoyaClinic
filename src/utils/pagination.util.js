/**
 * Utilities for keyset / cursor pagination.
 *
 * Requirements:
 * - Sort oldest first using created_at ASC, id ASC.
 * - Encode the cursor as base64url containing created_at and id.
 * - Decode cursor and validate. Throw error on invalid cursor.
 */

/**
 * Encodes created_at and id into a base64url cursor.
 * @param {{ created_at: Date | string, id: string }} param0
 * @returns {string} base64url encoded cursor
 */
function encodeCursor({ created_at, id }) {
  const createdAtIso = created_at instanceof Date ? created_at.toISOString() : new Date(created_at).toISOString();
  const payload = JSON.stringify({
    created_at: createdAtIso,
    id,
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodes and validates a base64url cursor.
 * Supports JSON object { created_at, id }, JSON array [created_at, id], or delimited string.
 * Throws an Error with statusCode 400 if cursor is invalid.
 * @param {string} cursor
 * @returns {{ createdAt: Date, id: string }}
 */
function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string' || !cursor.trim()) {
    const error = new Error('invalid cursor');
    error.statusCode = 400;
    throw error;
  }

  let decodedStr;
  try {
    const buf = Buffer.from(cursor, 'base64url');
    // Ensure input was valid base64url
    if (buf.toString('base64url') !== cursor) {
      const error = new Error('invalid cursor');
      error.statusCode = 400;
      throw error;
    }
    decodedStr = buf.toString('utf8');
  } catch (err) {
    const error = new Error('invalid cursor');
    error.statusCode = 400;
    throw error;
  }

  let createdAtStr;
  let idStr;

  try {
    const parsed = JSON.parse(decodedStr);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      createdAtStr = parsed[0];
      idStr = parsed[1];
    } else if (parsed && typeof parsed === 'object') {
      createdAtStr = parsed.created_at || parsed.createdAt;
      idStr = parsed.id;
    }
  } catch (err) {
    // Attempt delimited fallback e.g. "ISO_DATE,id"
    if (decodedStr.includes(',')) {
      const parts = decodedStr.split(',');
      createdAtStr = parts[0];
      idStr = parts.slice(1).join(',');
    }
  }

  if (!createdAtStr || !idStr || typeof idStr !== 'string' || !idStr.trim()) {
    const error = new Error('invalid cursor');
    error.statusCode = 400;
    throw error;
  }

  const createdAt = new Date(createdAtStr);
  if (isNaN(createdAt.getTime())) {
    const error = new Error('invalid cursor');
    error.statusCode = 400;
    throw error;
  }

  return {
    createdAt,
    id: idStr.trim(),
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
};
