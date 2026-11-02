/**
 * Email validation regex following standard email format.
 * Checks for non-empty local part, @ symbol, domain name and valid TLD.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and sanitizes booking input fields.
 *
 * Rules:
 * - Required fields: slot_id, name, email
 * - All fields must be non-empty strings.
 * - Trim whitespace.
 * - Normalize email to lowercase.
 * - Validate email format.
 * - Reject missing fields (HTTP 400).
 * - Reject empty strings (HTTP 400).
 * - Reject invalid data types (HTTP 400).
 */
function validateBookingInput(req, res, next) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'invalid booking payload' });
  }

  const { slot_id, name, email } = body;

  // Check types: must be string
  if (
    typeof slot_id !== 'string' ||
    typeof name !== 'string' ||
    typeof email !== 'string'
  ) {
    return res.status(400).json({ error: 'invalid or missing fields' });
  }

  // Trim values
  const trimmedSlotId = slot_id.trim();
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  // Reject empty strings after trim
  if (!trimmedSlotId || !trimmedName || !trimmedEmail) {
    return res.status(400).json({ error: 'fields cannot be empty' });
  }

  // Normalize email to lowercase
  const normalizedEmail = trimmedEmail.toLowerCase();

  // Validate email format
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  // Attach sanitized fields to req.body
  req.body = {
    ...body,
    slot_id: trimmedSlotId,
    name: trimmedName,
    email: normalizedEmail,
  };

  next();
}

module.exports = {
  validateBookingInput,
};
