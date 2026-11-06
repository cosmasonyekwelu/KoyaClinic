const express = require('express');
const router = express.Router();

/**
 * Helper to forward requests to the backend API.
 * Uses DEPLOYED_API_URL if configured; otherwise defaults to the local server instance.
 */
function getTargetBaseUrl(req) {
  if (process.env.DEPLOYED_API_URL) {
    return process.env.DEPLOYED_API_URL.replace(/\/+$/, '');
  }
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
}

async function forwardRequest(req, path, options = {}) {
  const baseUrl = getTargetBaseUrl(req);
  const url = `${baseUrl}${path}`;
  const headers = {
    ...(options.headers || {}),
  };

  if (process.env.API_KEY) {
    headers['X-API-Key'] = process.env.API_KEY;
  }

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
    const result = await forwardRequest(req, targetPath, {
      method: 'GET',
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy GET /slots error:', err);
    return res.status(502).json({ error: 'Failed to fetch slots' });
  }
});

/**
 * POST /api/bookings
 * Forward to POST /bookings
 */
router.post('/bookings', async (req, res) => {
  try {
    const { slot_id, name, email } = req.body || {};
    const idempotencyKey = req.header('Idempotency-Key') || `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await forwardRequest(req, '/bookings', {
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
    return res.status(502).json({ error: 'Failed to submit booking' });
  }
});

/**
 * GET /api/bookings/:id
 * Forward to GET /bookings/:id
 */
router.get('/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await forwardRequest(req, `/bookings/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy GET /bookings/:id error:', err);
    return res.status(502).json({ error: 'Failed to retrieve booking' });
  }
});

/**
 * DELETE /api/bookings/:id
 * Forward to DELETE /bookings/:id
 */
router.delete('/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await forwardRequest(req, `/bookings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Proxy DELETE /bookings/:id error:', err);
    return res.status(502).json({ error: 'Failed to cancel booking' });
  }
});

module.exports = router;
