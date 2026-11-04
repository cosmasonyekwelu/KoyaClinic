require('dotenv').config();

// Startup assertion for production security (Step 4b / Step 6)
if (process.env.NODE_ENV === 'production') {
  if (!process.env.API_KEY || process.env.API_KEY.length < 16) {
    throw new Error('FATAL: API_KEY must be set and at least 16 characters long in production.');
  }
}

const app = require('./app');
const prisma = require('./db');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Clinic Booking API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log('Database disconnected.');
    } catch (err) {
      console.error('Error during database disconnection:', err);
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
