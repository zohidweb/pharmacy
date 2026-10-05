// Shared by the Jest global setup (parent process) and the test files (workers): where the API under
// test listens and which web origin it trusts. Values only, never secrets.

export const E2E_API_HOST = '127.0.0.1';
export const E2E_API_PORT = Number(process.env['E2E_API_PORT'] ?? 3300);

// The origin the CSRF guard accepts (WEB_ORIGIN of the API). The default is the one of .env.example.
export const WEB_ORIGIN = process.env['WEB_ORIGIN'] ?? 'http://localhost:4200';
export const ADMIN_ORIGIN =
  process.env['ADMIN_ORIGIN'] ?? 'http://localhost:4300';

export const API_BASE_URL = `http://${E2E_API_HOST}:${E2E_API_PORT}`;
