import { browserTracingIntegrationShim, feedbackIntegrationShim, replayIntegrationShim } from '@sentry-internal/integration-shims';
export * from './index.bundle.base';
export { logger, consoleLoggingIntegration } from '@sentry/core';
export { elementTimingIntegration } from '@sentry-internal/browser-utils';
export { browserTracingIntegrationShim as browserTracingIntegration, feedbackIntegrationShim as feedbackAsyncIntegration, feedbackIntegrationShim as feedbackIntegration, replayIntegrationShim as replayIntegration, };
//# sourceMappingURL=index.bundle.logs.metrics.d.ts.map