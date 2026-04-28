/**
 * Shared mock fetch factory for Harmony client tests.
 *
 * Eliminates duplicated URL routing logic that was previously copy-pasted
 * across 6+ test files with slight variations. Provides sensible defaults
 * for all common Harmony API endpoints and allows per-test overrides.
 *
 * Usage:
 *   import { createMockFetch } from './helpers/mockFetch';
 *
 *   beforeEach(() => {
 *     global.fetch = createMockFetch();
 *   });
 *
 *   // Or with overrides:
 *   global.fetch = createMockFetch({
 *     '/messages': () => jsonResponse([{ id: 'msg1', content: 'Hello' }]),
 *   });
 */
import { vi } from 'vitest';

/** Default token returned by login/signup/guest mock responses. */
export const MOCK_TOKEN = 'test-jwt-token';

/** Default account ID returned by login/signup mock responses. */
export const MOCK_ACCOUNT_ID = 'acc1';

/**
 * Wraps data in a fetch Response-like object.
 * @param data - The JSON body to return
 * @param ok - Whether the response should indicate success (default: true)
 * @param status - HTTP status code (default: 200 if ok, 401 if not)
 */
export function jsonResponse(data: any, ok = true, status?: number) {
    return Promise.resolve({
        ok,
        status: status ?? (ok ? 200 : 401),
        json: () => Promise.resolve(data),
    });
}

/** Signature for a fetch override handler. */
export type FetchOverride = (url: string, options?: RequestInit) => any;

/**
 * Creates a vi.fn() mock for global.fetch with default Harmony API routing.
 *
 * Override specific endpoints by passing a map of URL substring → handler.
 * Overrides are checked first (in insertion order), then defaults apply.
 *
 * @param overrides - Map of URL substrings to response handlers
 * @returns A vi.fn() suitable for assigning to global.fetch
 */
export function createMockFetch(overrides: Record<string, FetchOverride> = {}) {
    return vi.fn((url: string, options?: RequestInit) => {
        // Check overrides first (matched by URL substring)
        for (const [pattern, handler] of Object.entries(overrides)) {
            if (url.includes(pattern)) {
                return handler(url, options);
            }
        }

        // ── Auth endpoints ──────────────────────────────────────────
        if (url.includes('/api/accounts/owner-exists')) {
            return jsonResponse({ exists: true });
        }
        if (url.includes('/api/accounts/salt')) {
            return jsonResponse({ salt: 'dGVzdHNhbHQ=' });
        }
        if (url.includes('/api/accounts/login')) {
            return jsonResponse({
                id: MOCK_ACCOUNT_ID,
                email: 'test@test.com',
                token: MOCK_TOKEN,
                is_creator: false,
                trusted_servers: [],
            });
        }
        if (url.includes('/api/accounts/signup')) {
            return jsonResponse({
                id: MOCK_ACCOUNT_ID,
                email: 'test@test.com',
                token: MOCK_TOKEN,
                is_creator: false,
                trusted_servers: [],
            });
        }
        if (url.includes('/api/guest/login')) {
            return jsonResponse({
                id: 'guest-123',
                email: 'Guest',
                isGuest: true,
                trusted_servers: [],
                token: MOCK_TOKEN,
            });
        }
        if (url.includes('/api/accounts/password')) {
            return jsonResponse({ success: true });
        }

        // ── Data endpoints (default: empty arrays) ──────────────────
        if (url.includes('/profiles')) {
            return jsonResponse([]);
        }
        if (url.includes('/channels')) {
            return jsonResponse([]);
        }
        if (url.includes('/messages')) {
            return jsonResponse([]);
        }
        if (url.includes('/api/servers') || url.includes('/api/guilds')) {
            return jsonResponse([]);
        }
        if (url.includes('/roles')) {
            return jsonResponse([]);
        }
        if (url.includes('/read_states') || url.includes('/read')) {
            return jsonResponse([]);
        }

        // ── Infrastructure endpoints ────────────────────────────────
        if (url.includes('/api/health') || url.includes('/api/ping')) {
            return jsonResponse({ status: 'ok' });
        }
        if (url.includes('/api/node/status')) {
            return jsonResponse({ hasOwner: true });
        }

        // ── Fallback ────────────────────────────────────────────────
        return jsonResponse({});
    });
}
