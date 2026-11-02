const express = require('express');
const router = express.Router();

const DEPLOYED_API_URL = (
  process.env.DEPLOYED_API_URL || 'https://koya-clinic-booking-api.onrender.com'
).replace(/\/+$/, '');

const API_KEY = process.env.API_KEY || 'koya-secret-key-2026';

/**
 * Helper to forward requests to the deployed API
 */
async function forwardRequest(path, options = {}) {
  const url = `${DEPLOYED_API_URL}${path}`;
  const headers = {
    'X-API-Key': API_KEY,
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

/**
 * GET /api/slots
 * Forward to deployed GET /slots with query parameters
 */
router.get('/slots', async (req, res) => {
  try {
    const searchParams = new URLSearchParams(req.query).toString();
    const targetPath = `/slots${searchParams ? `?${searchParams}` : ''}`;
    const result = await forwardRequest(targetPath, {
      method: 'GET',
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy GET /slots error:', err);
    return res.status(502).json({ error: 'Failed to fetch slots from booking service' });
  }
});

/**
 * POST /api/bookings
 * Forward to deployed POST /bookings
 */
router.post('/bookings', async (req, res) => {
  try {
    const { slot_id, name, email } = req.body || {};
    const idempotencyKey = req.header('Idempotency-Key') || `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await forwardRequest('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ slot_id, name, email }),
    });

    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy POST /bookings error:', err);
    return res.status(502).json({ error: 'Failed to submit booking to booking service' });
  }
});

/**
 * GET /api/bookings/:id
 * Forward to deployed GET /bookings/:id
 */
router.get('/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await forwardRequest(`/bookings/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy GET /bookings/:id error:', err);
    return res.status(502).json({ error: 'Failed to retrieve booking from booking service' });
  }
});

module.exports = router;
