/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalClaimProfile } from '../../../src/components/GlobalClaimProfile';
import { useAppStore } from '../../../src/store/appStore';

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

const buildMockState = (overrides: Record<string, any> = {}) => ({
    currentAccount: { id: 'account1', token: 'mock-token' },
    setDismissedGlobalClaim: vi.fn(),
    setUnclaimedProfiles: vi.fn(),
    unclaimedProfiles: [],
    isGuestSession: false,
    dismissedGlobalClaim: false,
    connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
    ...overrides,
});

vi.mock('../../../src/store/appStore', () => {
    let currentMockState: any = {};

    const mockUseStore: any = vi.fn((selector?: any) => {
        if (typeof selector === 'function') {
            return selector(currentMockState);
        }
        return currentMockState;
    });

    mockUseStore.getState = () => currentMockState;
    mockUseStore.setState = vi.fn();
    mockUseStore.__setMockState = (state: any) => { currentMockState = state; };

    return { useAppStore: mockUseStore };
});

describe('GlobalClaimProfile Component', () => {
    let mockState: ReturnType<typeof buildMockState>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockState = buildMockState();
        (useAppStore as any).__setMockState(mockState);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders nothing when no unclaimed profiles exist', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([])
        });

        render(<GlobalClaimProfile />);

        // When the server returns zero unclaimed imports, the component should
        // auto-dismiss by calling setDismissedGlobalClaim(true).
        await waitFor(() => {
            expect(mockState.setDismissedGlobalClaim).toHaveBeenCalledWith(true);
        });

        // And never render the setup UI
        expect(screen.queryByText(/Setup Global Profile/i)).not.toBeInTheDocument();
    });

    it('renders tabs with available profiles hidden until claim is clicked', async () => {
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' },
            { id: 'd2', global_name: 'DiscordUser2', avatar: 'a2.png' }
        ];

        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockUnclaimed)
        });

        const stateWithProfiles = buildMockState({ unclaimedProfiles: mockUnclaimed });
        (useAppStore as any).__setMockState(stateWithProfiles);

        render(<GlobalClaimProfile />);

        await waitFor(() => {
            expect(screen.getByText('Claim Existing Identity')).toBeInTheDocument();
        });
    });

    it('calls dismiss-claim and sets store state when Fresh Start is used', async () => {
        const user = userEvent.setup();
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' }
        ];

        fetchMock.mockImplementation((url: string) => {
            if (url.includes('unclaimed-imports')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockUnclaimed) });
            }
            if (url.includes('dismiss-claim')) {
                return Promise.resolve({ ok: true });
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        const stateWithProfiles = buildMockState({ unclaimedProfiles: mockUnclaimed });
        (useAppStore as any).__setMockState(stateWithProfiles);

        render(<GlobalClaimProfile />);

        const input = await screen.findByTestId('fresh-nickname');
        await user.type(input, 'MyGlobalName');
        
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('dismiss-claim'), expect.any(Object));
            expect(stateWithProfiles.setDismissedGlobalClaim).toHaveBeenCalledWith(true);
        });
    });

    it('calls link-discord when a profile is clicked', async () => {
        const user = userEvent.setup();
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' }
        ];

        const mockProfiles = [{ id: 'p1', account_id: 'account1' }];

        fetchMock.mockImplementation((url: string) => {
            if (url.includes('unclaimed-imports')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockUnclaimed) });
            }
            if (url.includes('link-discord')) {
                return Promise.resolve({ ok: true });
            }
            if (url.includes('/api/accounts/account1/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProfiles) });
            }
            return Promise.reject(new Error('Unknown URL: ' + url));
        });

        const stateWithProfiles = buildMockState({ 
            unclaimedProfiles: mockUnclaimed,
            setClaimedProfiles: vi.fn(),
        });
        (useAppStore as any).__setMockState(stateWithProfiles);

        render(<GlobalClaimProfile />);

        // Must click 'Claim Existing Identity' tab to see profiles
        const claimTabBtn = await screen.findByText('Claim Existing Identity');
        await user.click(claimTabBtn);

        expect(await screen.findByText('DiscordUser1')).toBeInTheDocument();

        await user.click(screen.getByText('DiscordUser1'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('link-discord'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ discord_id: 'd1' })
                })
            );
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/accounts/account1/profiles'),
                expect.any(Object)
            );
            expect(stateWithProfiles.setClaimedProfiles).toHaveBeenCalledWith(mockProfiles);
        });
    });
});
