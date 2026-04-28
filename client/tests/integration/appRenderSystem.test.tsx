/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../../src/App';
import { useAppStore } from '../../src/store/appStore';

// We do NOT mock any internal UI components (like ServerSidebar, ChatArea, etc.).
// This is a true rendering system test designed to catch things like:
// - React Hook ordering violations
// - White screens of death when transitioning auth states
// - Layout crashes

const originalFetch = global.fetch;

describe('App Component Rendering System Test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().setCurrentAccount(null);
        useAppStore.getState().setConnectedServers([{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }]);
        useAppStore.getState().setClaimedProfiles([]);
        useAppStore.getState().setActiveServerId(null);
        useAppStore.getState().setActiveChannelId(null);
        useAppStore.getState().setDismissedGlobalClaim(true);
        useAppStore.getState().setIsGuestSession(false);
        
        global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
            // Accounts & Auth Validation
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/login')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: 'acc1',
                        email: 'test@system.com',
                        token: 'token1',
                        servers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }]
                    })
                });
            }
            // Profiles (pretend the user already claimed a profile on localhost:3001)
            if (url.includes('/profiles') && options?.method === 'POST') {
                return Promise.resolve({ ok: true, json: async () => ({
                    id: 'p1', server_id: 's1', account_id: 'acc1',
                    original_username: 'TestNickname', nickname: 'TestNickname', avatar: '', role: 'USER', aliases: ''
                })});
            }
            if (url.includes('/profiles')) {
                if (url.includes('localhost:3001')) {
                    return Promise.resolve({ ok: true, json: async () => [{
                        id: 'p1', server_id: 'http://localhost:3001', account_id: 'acc1',
                        original_username: 'systemuser', nickname: 'systemuser', avatar: '', role: 'USER', aliases: ''
                    }]});
                }
                return Promise.resolve({ ok: true, json: async () => ([]) });
            }

            // Chat & Channel State
            if (url.endsWith('/read_states') || url.includes('/read')) return Promise.resolve({ ok: true, json: async () => ([]) });
            if (url.includes('/messages')) return Promise.resolve({ ok: true, json: async () => ([])});
            if (url.includes('/channels')) return Promise.resolve({ ok: true, json: async () => ([{ id: 'chan1', name: 'general', type: 'TEXT', category_id: null }])});
            if (url.includes('/members')) return Promise.resolve({ ok: true, json: async () => ([{ id: 'p1', account_id: 'acc1', nickname: 'systemuser' }])});

            
            // Server Node Status
            if (url.includes('/api/ping')) return Promise.resolve({ ok: true, json: async () => ({ health: 'ok' }) });
            if (url.includes('/api/servers')) return Promise.resolve({ ok: true, json: async () => ([{ id: 's1', url: 'http://localhost:3001', name: 'Local Server', icon: '' }]) });

            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('renders the complete user flow gracefully: Login -> Server Select -> Channel Navigation', async () => {
        // This test proves that the App component will not throw Uncaught Errors (like hook violations)
        // when experiencing dynamic auth state transitions in the full DOM.
        const user = userEvent.setup();
        const { container } = render(<App />);

        // 1. Initial State: Unauthenticated, should show Login Form
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        // 2. Perform Login
        await user.type(screen.getByLabelText(/Email/i), 'test@system.com');
        await user.type(screen.getByLabelText(/Password/i), 'password123');
        await user.click(screen.getByRole('button', { name: 'Login' }));

        // 3. Await Auth State Completion
        await waitFor(() => {
            expect(useAppStore.getState().currentAccount).not.toBeNull();
            expect(useAppStore.getState().profilesLoaded).toBe(true);
        });

        // 4. Verify Server Sidebar Renders (User is logged in now)
        // Since we return a mocked server 'Local Server', its initials 'LO' will appear
        const serverIcon = await screen.findByText('LO', { selector: 'div' });
        expect(serverIcon).toBeInTheDocument();

        // 5. Navigate to the Server
        await user.click(serverIcon);

        // 6. Complete the Claim Profile Flow
        await waitFor(() => {
            expect(screen.getByText('Join Server')).toBeInTheDocument();
        });
        await user.type(screen.getByTestId('fresh-nickname'), 'SystemTester');
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        // 7. Verify main chat UI appears without throwing Hook errors
        await waitFor(() => {
            expect(container.querySelector('.channel-sidebar')).toBeInTheDocument();
        }, { timeout: 3000 });

        // 8. Success! If we reached this point, the `<App />` component correctly handled 
        // early returns vs dynamic component mounting across multiple state ticks.
    });
});
