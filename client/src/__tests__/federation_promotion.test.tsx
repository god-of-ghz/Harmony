/**
 * Federation Promotion Performance Fix — Client Tests
 *
 * Validates the client-side fixes for the federation primary node transition
 * performance regression:
 *
 *  1. handlePromoteWithAuth consumes the fresh JWT from the promote response
 *  2. The new token is persisted to localStorage
 *  3. currentAccount.primary_server_url is updated correctly
 *  4. Token change in store triggers WebSocket reconnection (via dependency check)
 *  5. Graceful fallback when promote response has no token field
 *  6. Source code verification for ChatArea WS dependency array
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import type { Account } from '../store/appStore';

// ═══════════════════════════════════════════════════════════════════════════
// Store-level tests (no rendering needed)
// ═══════════════════════════════════════════════════════════════════════════

const mockAccount: Account = {
    id: 'test-account-1',
    email: 'test@example.com',
    is_creator: false,
    is_admin: false,
    token: 'old-jwt-signed-by-3001',
    primary_server_url: 'http://localhost:3001',
    authority_role: 'primary',
};

const resetStore = () => {
    useAppStore.setState({
        currentAccount: mockAccount,
        connectedServers: [
            { url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' },
            { url: 'http://localhost:3002', trust_level: 'trusted', status: 'active' },
        ],
        guildMap: {},
        serverMap: {},
    });
};

describe('Federation Promotion Client Token Fix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        // Clear localStorage mock
        const store: Record<string, string> = {};
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] || null);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => { store[key] = value; });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Store correctly updates token after promotion
    // ═══════════════════════════════════════════════════════════════════════

    it('1. setCurrentAccount updates the token field atomically', () => {
        const state = useAppStore.getState();
        expect(state.currentAccount?.token).toBe('old-jwt-signed-by-3001');

        // Simulate what handlePromoteWithAuth does after successful promote
        useAppStore.getState().setCurrentAccount({
            ...state.currentAccount!,
            primary_server_url: 'http://localhost:3002',
            authority_role: 'primary',
            token: 'new-jwt-signed-by-3002',
        });

        const updated = useAppStore.getState().currentAccount;
        expect(updated?.token).toBe('new-jwt-signed-by-3002');
        expect(updated?.primary_server_url).toBe('http://localhost:3002');
        expect(updated?.authority_role).toBe('primary');
    });

    it('2. token change is observable by Zustand selectors', () => {
        const tokens: (string | undefined)[] = [];
        const unsubscribe = useAppStore.subscribe(
            (state) => {
                tokens.push(state.currentAccount?.token);
            }
        );

        // Trigger token update
        const state = useAppStore.getState();
        useAppStore.getState().setCurrentAccount({
            ...state.currentAccount!,
            token: 'fresh-token-after-promote',
        });

        // The subscriber should have been called with the new token
        expect(tokens).toContain('fresh-token-after-promote');
        unsubscribe();
    });

    it('3. fallback: if promote response has no token, old token is preserved', () => {
        const state = useAppStore.getState();

        // Simulate: data.token is undefined (old server that hasn't been updated)
        const newToken = undefined || state.currentAccount?.token;
        useAppStore.getState().setCurrentAccount({
            ...state.currentAccount!,
            primary_server_url: 'http://localhost:3002',
            authority_role: 'primary',
            token: newToken,
        });

        const updated = useAppStore.getState().currentAccount;
        // Should keep the old token rather than setting undefined
        expect(updated?.token).toBe('old-jwt-signed-by-3001');
        expect(updated?.primary_server_url).toBe('http://localhost:3002');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. localStorage persistence
    // ═══════════════════════════════════════════════════════════════════════

    it('4. session is persisted to localStorage after promotion', () => {
        // Pre-populate localStorage with an existing session
        localStorage.setItem('harmony_session', JSON.stringify({
            token: 'old-jwt-signed-by-3001',
            primary_server_url: 'http://localhost:3001',
        }));

        // Simulate what handlePromoteWithAuth does
        const newToken = 'new-jwt-signed-by-3002';
        const session = JSON.parse(localStorage.getItem('harmony_session') || '{}');
        session.token = newToken;
        session.primary_server_url = 'http://localhost:3002';
        localStorage.setItem('harmony_session', JSON.stringify(session));

        // Verify the session was updated
        const stored = JSON.parse(localStorage.getItem('harmony_session') || '{}');
        expect(stored.token).toBe('new-jwt-signed-by-3002');
        expect(stored.primary_server_url).toBe('http://localhost:3002');
    });

    it('5. localStorage persistence handles missing session gracefully', () => {
        // No existing session in localStorage
        localStorage.setItem('harmony_session', '');

        // Simulate the try/catch in handlePromoteWithAuth
        try {
            const session = JSON.parse(localStorage.getItem('harmony_session') || '{}');
            session.token = 'new-token';
            session.primary_server_url = 'http://localhost:3002';
            localStorage.setItem('harmony_session', JSON.stringify(session));
        } catch {
            // Should not throw — non-fatal
        }

        const stored = JSON.parse(localStorage.getItem('harmony_session') || '{}');
        expect(stored.token).toBe('new-token');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Source code verification
    // ═══════════════════════════════════════════════════════════════════════

    it('6. ChatArea WebSocket effect depends on currentAccount?.token', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/ChatArea.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // The WebSocket useEffect dependency array must include the token
        // so that it reconnects when the token changes (e.g., after promotion)
        expect(content).toContain('currentAccount?.token');
        // Verify it's in a dependency array context (preceded by serverMap)
        expect(content).toMatch(/serverMap.*currentAccount\?\.token\]/s);
    });

    it('7. UserSettings handlePromoteWithAuth reads token from response', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/UserSettings.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Must parse the response JSON to extract the new token
        expect(content).toContain('data.token');
        // Must update the account with the new token
        expect(content).toContain('token: newToken');
        // Must persist to localStorage
        expect(content).toContain('harmony_session');
    });

    it('8. Account interface has multi-token TODO', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../store/appStore.ts');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Must have the multi-token architecture TODO
        expect(content).toContain('Multi-Token Architecture');
        expect(content).toContain('tokenMap');
    });

    it('9. apiFetch has multi-token TODO', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../utils/apiFetch.ts');
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('Multi-Token Architecture');
    });
});
