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
app.use(cors());
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

// Mount secure client proxy routes for frontend
app.use('/api', proxyRoutes);

// Mount API routes
app.use(routes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;
