'use strict';

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'LootRush'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || 'YOUR_LICENSE_KEY_HERE',
  distributed_tracing: { enabled: true },
  transaction_tracer: {
    enabled: true,
    record_sql: 'obfuscated',
    explain_threshold: 50, // ms — capture explain plans for slow queries
  },
  slow_sql: {
    enabled: true,
    max_samples: 20,
  },
  error_collector: {
    enabled: true,
    ignore_status_codes: [404],
  },
  // Logs in context — auto-decorates logs with trace IDs
  application_logging: {
    enabled: true,
    forwarding: {
      enabled: true,
      max_samples_stored: 10000,
    },
    local_decorating: { enabled: true },
  },
  logging: {
    level: 'info',
  },
  allow_all_headers: true,
  attributes: {
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
    ],
  },
};
