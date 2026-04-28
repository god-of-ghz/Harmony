/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaimProfile } from '../../../src/components/ClaimProfile';
import { useAppStore } from '../../../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

// Mock Zustand store
vi.mock('../../../src/store/appStore', () => ({
    useAppStore: vi.fn(),
}));

describe('ClaimProfile Component', () => {
    const mockAddClaimedProfile = vi.fn();
    const mockState = {
        currentAccount: { id: 'account1', token: 'mock-token' },
        addClaimedProfile: mockAddClaimedProfile,
        guildMap: { 's1': 'http://localhost' },
        serverMap: { 's1': 'http://localhost' },
        isGuestSession: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as any).mockReturnValue(mockState);
    });

    it('renders loading state initially', () => {
        (global.fetch as any).mockImplementationOnce(() => new Promise(() => { }));
        render(<ClaimProfile serverId="s1" />);
        expect(screen.getByText(/Loading available profiles/i)).toBeInTheDocument();
    });

    it('completes "Fresh Start" flow successfully by default', async () => {
        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'new-p', nickname: 'NewGuy' }) });
        });

        render(<ClaimProfile serverId="s1" />);

        await waitFor(() => {
            expect(screen.getByTestId('fresh-nickname')).toBeInTheDocument();
        });

        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: 'NewGuy' } });
        
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/profiles'), expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('NewGuy')
            }));
            expect(mockAddClaimedProfile).toHaveBeenCalled();
        });
    });

    it('completes "Claim Existing" flow successfully', async () => {
        const unclaimedProfiles = [
            { id: 'p1', original_username: 'OldUser', account_id: null, nickname: 'OldUser', avatar: '' }
        ];

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/profiles') && !url.includes('claim')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(unclaimedProfiles) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        });

        render(<ClaimProfile serverId="s1" />);

        // Wait for the UI to load entirely
        await waitFor(() => {
            expect(screen.getByText('Claim Existing Identity')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Claim Existing Identity'));

        await waitFor(() => {
            expect(screen.getByText('OldUser')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('OldUser'));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/profiles/claim'), expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('p1')
            }));
            expect(mockAddClaimedProfile).toHaveBeenCalled();
        });
    });

    it('displays error message on joining failure (500 status)', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/profiles')) {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({ error: 'Server error' })
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        render(<ClaimProfile serverId="s1" />);

        // "Fresh Start" flow is default, wait for input
        let input;
        await waitFor(() => {
            input = screen.getByTestId('fresh-nickname');
            expect(input).toBeInTheDocument();
        });

        fireEvent.change(input!, { target: { value: 'NewGuy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });

        consoleErrorSpy.mockRestore();
    });

    it('includes authorization header in API calls', async () => {
        (global.fetch as any).mockImplementationOnce(() => 
            Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        );

        render(<ClaimProfile serverId="s1" />);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/profiles'),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer mock-token'
                    })
                })
            );
        });
    });
});
