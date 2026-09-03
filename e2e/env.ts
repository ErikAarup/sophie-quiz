// Shared constants for the e2e harness (ports, token, paths). Keep in sync with e2e/wrangler.e2e.jsonc.
import { resolve } from 'node:path';

export const E2E_PORT = 8788;
export const MOCK_PORT = 8790;
export const ADMIN_TOKEN = 'e2e-admin-token';
export const QUESTION_SECONDS = 15;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const WS_URL = `ws://127.0.0.1:${E2E_PORT}/ws`;
export const CONTROL_URL = `http://127.0.0.1:${MOCK_PORT}/__control`;
export const ROOT = resolve(import.meta.dirname, '..');
export const PERSIST_DIR = resolve(ROOT, '.wrangler', 'e2e-state');
export const LOG_DIR = resolve(ROOT, 'test-results');
