require('./instrumentation');

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { trace, metrics, context, propagation } = require('@opentelemetry/api');
require('dotenv').config();
const logger = require('./logger');

const app = express();
app.use(cors());
app.use(express.json());

// Service URLs
const SERVICES = {
  claims:       process.env.CLAIMS_SERVICE_URL       || 'http://localhost:3001',
  policy:       process.env.POLICY_SERVICE_URL       || 'http://localhost:8080',
  investment:   process.env.INVESTMENT_SERVICE_URL   || 'http://localhost:3002',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003',
  chaos:        process.env.CHAOS_CONTROLLER_URL     || 'http://localhost:3004',
};

// OTel Meter for custom metrics
const meter = metrics.getMeter('api-gateway', '1.0.0');
const requestCounter = meter.createCounter('gateway.requests.total', {
  description: 'Total requests through the API gateway',
});
const errorCounter = meter.createCounter('gateway.errors.total', {
  description: 'Total errors through the API gateway',
});
const requestDuration = meter.createHistogram('gateway.request.duration', {
  description: 'Request duration in milliseconds',
  unit: 'ms',
});

// Middleware: metrics + logging per request
app.use((req, res, next) => {
  const start = Date.now();
  const span = trace.getActiveSpan();

  if (span) {
    span.setAttribute('http.route', req.path);
    span.setAttribute('gateway.version', '1.0.0');
  }

  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const labels = { method: req.method, route: req.path, status: res.statusCode.toString() };
    requestCounter.add(1, labels);
    requestDuration.record(duration, labels);
    if (res.statusCode >= 400) errorCounter.add(1, labels);

    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
});

// Helper: forward request with trace context propagation
async function forwardRequest(serviceUrl, path, method, data, headers = {}) {
  const tracer = trace.getTracer('api-gateway');
  const span = tracer.startSpan(`forward ${path}`);

  // Inject trace context into outgoing headers
  const outgoingHeaders = { ...headers };
  propagation.inject(context.active(), outgoingHeaders);

  try {
    const response = await axios({
      method,
      url: `${serviceUrl}${path}`,
      data,
      headers: outgoingHeaders,
      timeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000,
    });
    span.setAttribute('http.status_code', response.status);
    span.end();
    return response.data;
  } catch (err) {
    span.recordException(err);
    span.setAttribute('error', true);
    span.end();
    throw err;
  }
}

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// ── Claims ───────────────────────────────────────────────────────────────────
app.post('/api/claims', async (req, res) => {
  try {
    logger.info('Forwarding claim submission', { body: req.body });
    const result = await forwardRequest(SERVICES.claims, '/claims', 'POST', req.body);
    res.json(result);
  } catch (err) {
    logger.error('Claims service error', { error: err.message, code: err.code });
    res.status(err.response?.status || 503).json({
      error: 'Claims service unavailable',
      details: err.message,
    });
  }
});

app.get('/api/claims/:id', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.claims, `/claims/${req.params.id}`, 'GET', null);
    res.json(result);
  } catch (err) {
    logger.error('Claims fetch error', { error: err.message });
    res.status(err.response?.status || 503).json({ error: 'Claims service unavailable' });
  }
});

app.get('/api/claims', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.claims, '/claims', 'GET', null);
    res.json(result);
  } catch (err) {
    logger.error('Claims list error', { error: err.message });
    res.status(err.response?.status || 503).json({ error: 'Claims service unavailable' });
  }
});

// ── Policy ───────────────────────────────────────────────────────────────────
app.get('/api/policy/:customerId', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.policy, `/policy/${req.params.customerId}`, 'GET', null);
    res.json(result);
  } catch (err) {
    logger.error('Policy service error', { error: err.message });
    res.status(err.response?.status || 503).json({ error: 'Policy service unavailable' });
  }
});

app.get('/api/policy/:customerId/coverage', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.policy, `/policy/${req.params.customerId}/coverage`, 'GET', null);
    res.json(result);
  } catch (err) {
    logger.error('Coverage fetch error', { error: err.message });
    res.status(err.response?.status || 503).json({ error: 'Policy service unavailable' });
  }
});

// ── Investment ───────────────────────────────────────────────────────────────
app.get('/api/investments/:customerId', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.investment, `/investments/${req.params.customerId}`, 'GET', null);
    res.json(result);
  } catch (err) {
    logger.error('Investment service error', { error: err.message });
    res.status(err.response?.status || 503).json({ error: 'Investment service unavailable' });
  }
});

// ── Chaos Controller proxy ────────────────────────────────────────────────────
app.get('/api/chaos/status', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.chaos, '/chaos/status', 'GET', null);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'Chaos controller unavailable' });
  }
});

app.post('/api/chaos/toggle', async (req, res) => {
  try {
    const result = await forwardRequest(SERVICES.chaos, '/chaos/toggle', 'POST', req.body);
    logger.warn('Chaos toggle activated', { toggle: req.body });
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'Chaos controller unavailable' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`API Gateway started`, { port: PORT, services: SERVICES });
});
