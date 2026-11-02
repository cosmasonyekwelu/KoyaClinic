const { checkExistingIdempotencyKey, recordIdempotentError } = require('../services/booking.service');

/**
 * Email validation regex following standard email format.
 * Checks for non-empty local part, @ symbol, domain name and valid TLD.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and sanitizes booking input fields.
 * If Idempotency-Key is provided, checks for key reuse / replay before returning validation errors,
 * and records validation errors in idempotency store if applicable.
 */
async function validateBookingInput(req, res, next) {
  const idempotencyKey = req.header('idempotency-key') || req.header('Idempotency-Key');
  const rawBody = req.body;

  // 1. If an idempotency key was supplied, check if it already exists
  if (idempotencyKey) {
    try {
      const existing = await checkExistingIdempotencyKey(idempotencyKey, rawBody);
      if (existing) {
        // Return cached response directly
        return res.status(existing.statusCode).json(existing.body);
      }
    } catch (err) {
      if (err.statusCode === 422) {
        return res.status(422).json({ error: err.message });
      }
      return next(err);
    }
  }

  // 2. Helper to respond with 400 error and record in idempotency table if key present
  const sendValidationError = async (message) => {
    if (idempotencyKey) {
      await recordIdempotentError(idempotencyKey, rawBody, 400, message);
    }
    return res.status(400).json({ error: message });
  };

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return await sendValidationError('invalid booking payload');
  }

  const { slot_id, name, email } = rawBody;

  // Check types: must be string
  if (
    typeof slot_id !== 'string' ||
    typeof name !== 'string' ||
    typeof email !== 'string'
  ) {
    return await sendValidationError('invalid or missing fields');
  }

  // Trim values
  const trimmedSlotId = slot_id.trim();
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  // Reject empty strings after trim
  if (!trimmedSlotId || !trimmedName || !trimmedEmail) {
    return await sendValidationError('fields cannot be empty');
  }

  // Normalize email to lowercase
  const normalizedEmail = trimmedEmail.toLowerCase();

  // Validate email format
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return await sendValidationError('invalid email format');
  }

  // Store raw and sanitized fields
  req.rawBody = rawBody;
  req.idempotencyKey = idempotencyKey;
  req.body = {
    ...rawBody,
    slot_id: trimmedSlotId,
    name: trimmedName,
    email: normalizedEmail,
  };

  next();
}

module.exports = {
  validateBookingInput,
};
