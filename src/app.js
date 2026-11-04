require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./docs/openapi.json');
const routes = require('./routes');
const proxyRoutes = require('./routes/proxy.routes');
const notFoundHandler = require('./middleware/notFound.middleware');
const errorHandler = require('./middleware/error.middleware');

const app = express();

// Security and utility middleware
const allowedOrigins = [
  'https://koya-clinic-beta.vercel.app',
  'https://koyaclinic.onrender.com',
  'https://koya-clinic-booking-api.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Idempotency-Key', 'x-debug-token'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// Expose OpenAPI specification JSON
app.get('/openapi.json', (req, res) => {
  res.status(200).json(swaggerDocument);
});

// Interactive Swagger UI documentation
const swaggerUiOptions = {
  customSiteTitle: 'Clinic Booking API Documentation',
};
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerUiOptions));

// Serve static frontend assets
const publicDirectoryPath = path.join(__dirname, '../public');
app.use(express.static(publicDirectoryPath));

// Placeholder GET / endpoint for future frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDirectoryPath, 'index.html'));
});

// Temporary protected debug route (Step 1)
app.get('/debug-auth', (req, res) => {
  const debugToken = process.env.DEBUG_TOKEN;
  const receivedToken = req.get('x-debug-token');
  if (!debugToken || !receivedToken || receivedToken !== debugToken) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const rawHeaderVal = req.get('x-api-key') || req.headers['x-api-key'];
  return res.status(200).json({
    hasApiKeyEnv: !!process.env.API_KEY,
    apiKeyLength: (process.env.API_KEY || '').length,
    apiKeyFirst4: (process.env.API_KEY || '').slice(0, 4),
    receivedHeaderNames: Object.keys(req.headers).filter(h => h.toLowerCase().includes('key')),
    receivedXApiKey: rawHeaderVal ? `[present, length ${rawHeaderVal.length}]` : '[absent]',
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
});

// Mount secure client proxy routes for frontend
app.use('/api', proxyRoutes);

// Mount API routes
app.use(routes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;
