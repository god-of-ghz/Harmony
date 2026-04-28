/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginSignup } from '../../../src/components/LoginSignup';
import { useAppStore } from '../../../src/store/appStore';

global.fetch = vi.fn();

describe('LoginSignup Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().setCurrentAccount(null);
        useAppStore.getState().setConnectedServers([]);
        useAppStore.getState().setClaimedProfiles([]);
        (global.fetch as any).mockImplementation((url: string, options?: any) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/login')) {
                const body = options?.body ? JSON.parse(options.body) : {};
                return Promise.resolve({ ok: true, json: async () => ({
                    id: 'acc1', email: body.email || 'test@test.com', token: 'token1',
                    servers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }]
                }) });
            }
            if (url.includes('/api/accounts/signup')) return Promise.resolve({ ok: true, json: async () => ({
                id: 'acc1', email: 'test@test.com', token: 'token1',
                servers: []
            }) });
            if (url.includes('/api/accounts/password')) return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
            if (url.includes('/api/accounts/') && url.includes('/profiles')) return Promise.resolve({ ok: true, json: async () => ([]) });
            if (url.includes('/api/accounts/') && url.includes('/state')) return Promise.resolve({ ok: true, json: async () => ({ servers: [], dismissed_global_claim: false }) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    });

    it('renders login form by default', async () => {
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();
    });

    it('handles successful login without remembering (no harmony_session)', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);

        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Password/i), 'password');
        await user.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount?.email).toBe('test@test.com');
        });

        // Without "Remember me", no session should be stored
        expect(localStorage.getItem('harmony_session')).toBeNull();
        // Old key should never exist
        expect(localStorage.getItem('harmony_account')).toBeNull();
    });

    it('stores harmony_session when Remember Me is checked', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);

        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Email/i), 'rem@test.com');
        await user.type(screen.getByLabelText(/Password/i), 'password');
        await user.click(screen.getByLabelText(/Remember me/i));
        await user.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            const session = localStorage.getItem('harmony_session');
            expect(session).not.toBeNull();
            const parsed = JSON.parse(session!);
            expect(parsed.accountId).toBe('acc1');
            expect(parsed.token).toBe('token1');
            expect(parsed.serverUrl).toBe('http://localhost:3001');
        });

        // Old key should never exist
        expect(localStorage.getItem('harmony_account')).toBeNull();
    });

    it('automatically stores harmony_session upon signup', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();
        
        await user.click(screen.getByText('Register')); // Switch to signup mode

        await user.type(screen.getByLabelText(/Email/i), 'signup@test.com');
        await user.type(screen.getByLabelText(/^Password$/i), 'password123');
        await user.type(screen.getByLabelText(/Confirm Password/i), 'password123');

        await user.click(screen.getByRole('button', { name: 'Signup' }));

        await waitFor(() => {
            const session = localStorage.getItem('harmony_session');
            expect(session).not.toBeNull();
            const parsed = JSON.parse(session!);
            expect(parsed.accountId).toBe('acc1');
        });
    });

    it('signup populates connectedServers with initial server URL', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.click(screen.getByText('Register'));
        await user.type(screen.getByLabelText(/Email/i), 'newtrust@test.com');
        await user.type(screen.getByLabelText(/^Password$/i), 'password123');
        await user.type(screen.getByLabelText(/Confirm Password/i), 'password123');

        await user.click(screen.getByRole('button', { name: 'Signup' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount).not.toBeNull();
        });

        // The initial server URL should be in connectedServers
        const connected = useAppStore.getState().connectedServers;
        expect(connected.length).toBeGreaterThanOrEqual(1);
        expect(connected.some(s => s.url === 'http://localhost:3001')).toBe(true);
        expect(connected[0].trust_level).toBe('trusted');
    });

    it('auto-logins via harmony_session + GET /api/accounts/:id/state', async () => {
        localStorage.setItem('harmony_session', JSON.stringify({ serverUrl: 'http://localhost:3001', accountId: 'acc3', token: 'valid-token' }));

        render(<LoginSignup />);

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount?.id).toBe('acc3');
        });
    });

    it('clears stale harmony_session when server rejects the token', async () => {
        localStorage.setItem('harmony_session', JSON.stringify({ serverUrl: 'http://localhost:3001', accountId: 'stale1', token: 'expired-token' }));

        // Override fetch to reject auth for the validation call
        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/accounts/stale1/state')) {
                return Promise.resolve({ ok: false, status: 401 });
            }
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<LoginSignup />);

        // Should NOT auto-login — should clear the stale session
        await waitFor(() => {
            expect(localStorage.getItem('harmony_session')).toBeNull();
        });

        // currentAccount should remain null (login form visible)
        expect(useAppStore.getState().currentAccount).toBeNull();
    });

    it('blocks signup if passwords do not match', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();
        
        await user.click(screen.getByText('Register')); // Switch to signup mode

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/^Password$/i), 'password123');
        await user.type(screen.getByLabelText(/Confirm Password/i), 'password456');

        await user.click(screen.getByRole('button', { name: 'Signup' }));

        expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledTimes(2); // owner-exists check and health ping
    });

    it('change-password mode shows "Current Password" field', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.click(screen.getByText('Forgot / Change Password?'));

        expect(await screen.findByLabelText(/Current Password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^New Password$/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Confirm New Password/i)).toBeInTheDocument();
    });

    it('updates password via unauthenticated endpoint and shows success message', async () => {
        (global.fetch as any).mockImplementation((url: string, options?: any) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/password/unauthenticated')) return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.click(screen.getByText('Forgot / Change Password?'));

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Current Password/i), 'currentpassword');
        await user.type(screen.getByLabelText(/^New Password$/i), 'newpass123');
        await user.type(screen.getByLabelText(/Confirm New Password/i), 'newpass123');

        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Password updated successfully! You can now login.')).toBeInTheDocument();

        expect(global.fetch).toHaveBeenCalledWith(
            'http://localhost:3001/api/accounts/password/unauthenticated',
            expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining('oldServerAuthKey'),
            })
        );

        const callArgs = (global.fetch as any).mock.calls.find(
            (c: any[]) => c[0].includes('/api/accounts/password/unauthenticated')
        );
        const body = JSON.parse(callArgs[1].body);
        expect(body.oldServerAuthKey).toBeDefined();
        expect(body.serverAuthKey).toBeDefined();
        expect(body.email).toBe('test@test.com');
    });

    it('blocks change-password if new password is shorter than 8 characters', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.click(screen.getByText('Forgot / Change Password?'));

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Current Password/i), 'correctcurrent');
        await user.type(screen.getByLabelText(/^New Password$/i), 'short');
        await user.type(screen.getByLabelText(/Confirm New Password/i), 'short');

        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
        const pwCalls = (global.fetch as any).mock.calls.filter(
            (c: any[]) => c[0]?.includes('/api/accounts/password')
        );
        expect(pwCalls.length).toBe(0);
    });

    it('shows server error when current password is wrong in pre-login change-password flow', async () => {
        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/password/unauthenticated')) {
                return Promise.resolve({ ok: false, json: async () => ({ error: 'Current password is incorrect' }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.click(screen.getByText('Forgot / Change Password?'));

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Current Password/i), 'wrongpassword');
        await user.type(screen.getByLabelText(/^New Password$/i), 'newpassword123');
        await user.type(screen.getByLabelText(/Confirm New Password/i), 'newpassword123');

        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    });


    it('updates local state for the custom Network Server URL', async () => {
        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();
        
        // Find the server URL input by its placeholder text
        const urlInput = screen.getByPlaceholderText('http://localhost:3001 or https://example.com');

        await user.clear(urlInput);
        await user.type(urlInput, 'http://96.230.218.248:3001');
        expect(urlInput).toHaveValue('http://96.230.218.248:3001');
    });
});

describe('fetchAllProfiles — multi-server parallel fetch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().setCurrentAccount(null);
        useAppStore.getState().setClaimedProfiles([]);
        useAppStore.getState().setConnectedServers([]);
    });

    it('queries multiple servers in parallel and deduplicates profiles by id:server_id', async () => {
        const profileA = { id: 'p1', server_id: 'sA', account_id: 'acc1', original_username: 'user1', nickname: '', avatar: '', role: '', aliases: '' };
        const profileB = { id: 'p2', server_id: 'sB', account_id: 'acc1', original_username: 'user2', nickname: '', avatar: '', role: '', aliases: '' };
        const profileDup = { id: 'p1', server_id: 'sA', account_id: 'acc1', original_username: 'user1-dup', nickname: '', avatar: '', role: '', aliases: '' };

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/login')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: 'acc1', email: 'test@test.com', token: 'token1',
                        servers: [
                            { url: 'https://serverA.com', trust_level: 'trusted', status: 'active' },
                            { url: 'https://serverB.com', trust_level: 'trusted', status: 'active' }
                        ]
                    })
                });
            }
            // Server A returns profileA
            if (url.startsWith('https://serverA.com') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [profileA] });
            }
            // Server B returns profileB + duplicate of profileA
            if (url.startsWith('https://serverB.com') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [profileB, profileDup] });
            }
            // The initialServerUrl (localhost) returns empty
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [] });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Password/i), 'password');
        await user.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount).not.toBeNull();
        });

        const profiles = useAppStore.getState().claimedProfiles;
        // Should have deduplicated profileA and profileDup (same id:server_id 'p1:sA')
        expect(profiles.length).toBe(2);
        const ids = profiles.map(p => p.id);
        expect(ids).toContain('p1');
        expect(ids).toContain('p2');
    });

    it('a fetch failure on one server does not prevent other servers from being queried', async () => {
        const profileB = { id: 'p2', server_id: 'sB', account_id: 'acc1', original_username: 'user2', nickname: '', avatar: '', role: '', aliases: '' };

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/login')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: 'acc1', email: 'test@test.com', token: 'token1',
                        servers: [
                            { url: 'https://serverA.com', trust_level: 'trusted', status: 'active' },
                            { url: 'https://serverB.com', trust_level: 'trusted', status: 'active' }
                        ]
                    })
                });
            }
            // Server A throws network error
            if (url.startsWith('https://serverA.com') && url.includes('/profiles')) {
                return Promise.reject(new Error('Network error'));
            }
            // Server B works fine
            if (url.startsWith('https://serverB.com') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [profileB] });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [] });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Password/i), 'password');
        await user.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount).not.toBeNull();
        });

        const profiles = useAppStore.getState().claimedProfiles;
        // Even though serverA failed, serverB's profile should be present
        expect(profiles.length).toBe(1);
        expect(profiles[0].id).toBe('p2');
    });

    it('BUG REGRESSION: profiles with same ID but different server_id are NOT collapsed (cross-server Discord snowflake collision)', async () => {
        const discordSnowflake = '1753384195566644';
        const profileServerA = {
            id: discordSnowflake, server_id: 'guild-AAA-111', account_id: 'acc1',
            original_username: 'godofghz', nickname: 'godofghz', avatar: '', role: 'USER', aliases: ''
        };
        const profileServerB = {
            id: discordSnowflake, server_id: 'guild-BBB-222', account_id: 'acc1',
            original_username: 'godofghz', nickname: 'godofghz', avatar: '', role: 'USER', aliases: ''
        };

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/accounts/owner-exists')) return Promise.resolve({ ok: true, json: async () => ({ exists: true }) });
            if (url.includes('/api/accounts/salt')) return Promise.resolve({ ok: true, json: async () => ({ salt: 'dGVzdHNhbHQ=' }) });
            if (url.includes('/api/accounts/login')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: 'acc1', email: 'test@test.com', token: 'token1',
                        servers: [
                            { url: 'https://serverA.com', trust_level: 'trusted', status: 'active' },
                            { url: 'https://serverB.com', trust_level: 'trusted', status: 'active' }
                        ]
                    })
                });
            }
            if (url.startsWith('https://serverA.com') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [profileServerA] });
            }
            if (url.startsWith('https://serverB.com') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [profileServerB] });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: async () => [] });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        const user = userEvent.setup();
        render(<LoginSignup />);
        expect(await screen.findByText('Welcome back!')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Email/i), 'test@test.com');
        await user.type(screen.getByLabelText(/Password/i), 'password');
        await user.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount).not.toBeNull();
        });

        const profiles = useAppStore.getState().claimedProfiles;
        // CRITICAL: Both profiles must exist despite having the same p.id
        expect(profiles.length).toBe(2);

        // Both server_id values must be represented
        const serverIds = profiles.map(p => p.server_id);
        expect(serverIds).toContain('guild-AAA-111');
        expect(serverIds).toContain('guild-BBB-222');

        // Both should share the same discord snowflake ID
        expect(profiles.every(p => p.id === discordSnowflake)).toBe(true);
    });
});
