/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlobalClaimProfile } from '../src/components/GlobalClaimProfile';
import { useAppStore } from '../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

// Mock Zustand store
vi.mock('../src/store/appStore', () => ({
    useAppStore: vi.fn(),
}));

describe('GlobalClaimProfile Component', () => {
    const mockSetDismissedGlobalClaim = vi.fn();
    const mockSetUnclaimedProfiles = vi.fn();
    const mockState = {
        currentAccount: { id: 'account1', token: 'mock-token' },
        setDismissedGlobalClaim: mockSetDismissedGlobalClaim,
        setUnclaimedProfiles: mockSetUnclaimedProfiles,
        unclaimedProfiles: [],
        isGuestSession: false,
        dismissedGlobalClaim: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as any).mockReturnValue(mockState);
    });

    it('renders nothing when no unclaimed profiles exist', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([])
        });

        render(<GlobalClaimProfile />);

        await waitFor(() => {
            expect(screen.queryByText(/Claim Your Profiles/i)).not.toBeInTheDocument();
        });
    });

    it('renders grid with available profiles', async () => {
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' },
            { id: 'd2', global_name: 'DiscordUser2', avatar: 'a2.png' }
        ];

        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockUnclaimed)
        });

        (useAppStore as any).mockReturnValue({
            ...mockState,
            unclaimedProfiles: mockUnclaimed
        });

        render(<GlobalClaimProfile />);

        await waitFor(() => {
            expect(screen.getByText('DiscordUser1')).toBeInTheDocument();
            expect(screen.getByText('DiscordUser2')).toBeInTheDocument();
        });
    });

    it('calls dismiss-claim and sets store state when "Start Fresh" is clicked', async () => {
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' }
        ];

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('unclaimed-imports')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockUnclaimed) });
            }
            if (url.includes('dismiss-claim')) {
                return Promise.resolve({ ok: true });
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        (useAppStore as any).mockReturnValue({
            ...mockState,
            unclaimedProfiles: mockUnclaimed
        });

        render(<GlobalClaimProfile />);

        await waitFor(() => {
            expect(screen.getByText('DiscordUser1')).toBeInTheDocument();
        });

        const dismissBtn = screen.getByText(/Start Fresh/i);
        fireEvent.click(dismissBtn);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('dismiss-claim'), expect.any(Object));
            expect(mockSetDismissedGlobalClaim).toHaveBeenCalledWith(true);
        });
    });

    it('calls link-discord when a profile is clicked', async () => {
        const mockUnclaimed = [
            { id: 'd1', global_name: 'DiscordUser1', avatar: 'a1.png' }
        ];

        const mockReload = vi.fn();
        vi.stubGlobal('location', { reload: mockReload });

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('unclaimed-imports')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockUnclaimed) });
            }
            if (url.includes('link-discord')) {
                return Promise.resolve({ ok: true });
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        (useAppStore as any).mockReturnValue({
            ...mockState,
            unclaimedProfiles: mockUnclaimed
        });

        render(<GlobalClaimProfile />);

        await waitFor(() => {
            expect(screen.getByText('DiscordUser1')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('DiscordUser1'));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('link-discord'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ discord_id: 'd1' })
                })
            );
            expect(mockReload).toHaveBeenCalled();
        });

        vi.unstubAllGlobals();
    });
});
