const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const config = require('./config');

const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const dataRoutes = require('./routes/data');
const attendanceRoutes = require('./routes/attendance');
const requestRoutes = require('./routes/requests');
const { startCloudNotificationWorker } = require('./lib/cloudNotificationWorker');
const { startTokenHousekeeping } = require('./lib/tokenHousekeeping');

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  }
}));
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/requests', requestRoutes);

app.use((error, _req, res, _next) => {
  console.error('[cloud-backend] unhandled error', error);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await mongoose.connect(config.mongoUri);
  const notificationWorker = startCloudNotificationWorker(console);
  const tokenHousekeeping = startTokenHousekeeping(console);
  const server = app.listen(config.port, () => {
    console.log(`[cloud-backend] running on http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`[cloud-backend] received ${signal}, shutting down`);
    notificationWorker.stop();
    tokenHousekeeping.stop();
    server.close();
    await mongoose.connection.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

start().catch((error) => {
  console.error('[cloud-backend] startup failed', error);
  process.exit(1);
});
