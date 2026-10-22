import { API_URL } from '../shared/messages';

const routes = new Map([
  ['/api/resume/file', 'GET'],
  ['/api/profile', 'GET'], ['/api/stats', 'GET'],
  ['/api/match-fields', 'POST'], ['/api/log-application', 'POST'],
  ['/api/generate-answer', 'POST'], ['/api/generate-cover-letter', 'POST'],
]);

export function apiRequest(rawUrl: unknown, rawOptions: unknown): [string, RequestInit] {
  if (typeof rawUrl !== 'string') throw new Error('Invalid API URL');
  const url = new URL(rawUrl);
  if (url.origin !== API_URL || url.username || url.password || url.search || url.hash) {
    throw new Error('Only the configured local API is allowed');
  }
  if (rawOptions != null && (typeof rawOptions !== 'object' || Array.isArray(rawOptions))) {
    throw new Error('Invalid API options');
  }
  const options = (rawOptions || {}) as RequestInit;
  const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET';
  if (!routes.has(url.pathname) || routes.get(url.pathname) !== method) {
    throw new Error('API endpoint or method is not allowed');
  }
  if (options.body != null && (typeof options.body !== 'string' || options.body.length > 250_000)) {
    throw new Error('Invalid API body');
  }
  // Reconstruct options: callers cannot supply credentials, redirects or headers.
  return [url.href, {
    method, body: method === 'POST' ? options.body : undefined,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  }];
}
