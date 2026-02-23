const winston = require('winston');
const { trace, context } = require('@opentelemetry/api');

// Custom format to inject trace context into logs
const traceContextFormat = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span) {
    const spanContext = span.spanContext();
    info.traceId = spanContext.traceId;
    info.spanId = spanContext.spanId;
    info.traceFlags = spanContext.traceFlags;
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    traceContextFormat(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'api-gateway',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'production',
  },
  transports: [
    new winston.transports.Console(),
  ],
});

module.exports = logger;
