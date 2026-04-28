import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { DMSidebar } from '../../../src/components/DMSidebar';
import { useAppStore } from '../../../src/store/appStore';

// Mock UserPanel since it's a child component with its own complex dependencies
vi.mock('../../../src/components/UserPanel', () => ({
    UserPanel: () => <div data-testid="user-panel">UserPanel</div>,
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
    MessageSquare: (props: any) => <span data-testid="message-icon" {...props}>MessageSquare</span>,
    Plus: ({ onClick, ...props }: any) => <span data-testid="plus-icon" onClick={onClick} {...props}>Plus</span>,
}));

global.fetch = vi.fn();

describe('DMSidebar', () => {
    const mockDMs = [
        {
            id: 'dm-1',
            name: 'Alice',
            participants: ['account1', 'account-alice'],
        },
        {
            id: 'dm-2',
            name: 'Bob',
            participants: ['account1', 'account-bob'],
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();

        useAppStore.setState({
            currentAccount: {
                id: 'account1',
                email: 'test@example.com',
                is_creator: false,
                token: 'test-jwt-token',
            },
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            activeChannelId: null,
            presenceMap: {},
            unreadChannels: new Set(),
        });
    });

    it('renders "Direct Messages" header', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(screen.getByText('Direct Messages')).toBeInTheDocument();
    });

    it('renders DM conversations list from fetch', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockDMs),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
            expect(screen.getByText('Bob')).toBeInTheDocument();
        });
    });

    it('handles empty DM list gracefully', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(screen.getByText('Direct Messages')).toBeInTheDocument();
        expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });

    it('handles fetch failure gracefully (no crash)', async () => {
        (global.fetch as any).mockRejectedValue(new Error('Network error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(screen.getByText('Direct Messages')).toBeInTheDocument();
        consoleSpy.mockRestore();
    });

    it('handles non-ok fetch response gracefully', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 500,
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(screen.getByText('Direct Messages')).toBeInTheDocument();
    });

    it('navigates to DM channel on click (calls setActiveChannelId)', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockDMs),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Alice'));

        expect(useAppStore.getState().activeChannelId).toBe('dm-1');
    });

    it('shows online indicator when peer is present in presenceMap', async () => {
        useAppStore.setState({
            presenceMap: {
                'account-alice': {
                    accountId: 'account-alice',
                    status: 'online',
                    lastUpdated: Date.now(),
                },
            },
        });

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockDMs),
        });

        let container: HTMLElement;
        await act(async () => {
            const result = render(<DMSidebar />);
            container = result.container;
        });

        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
        });

        // The online indicator should exist (a small green dot)
        const greenDots = container!.querySelectorAll('div');
        const onlineDot = Array.from(greenDots).find(
            d => d.style.backgroundColor === 'rgb(35, 165, 89)' && d.style.borderRadius === '50%'
        );
        expect(onlineDot).toBeTruthy();
    });

    it('shows unread indicator badge for unread DMs', async () => {
        useAppStore.setState({ unreadChannels: new Set(['dm-2']) });

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockDMs),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        await waitFor(() => {
            expect(screen.getByText('Bob')).toBeInTheDocument();
        });

        expect(screen.getByText('!')).toBeInTheDocument();
    });

    it('opens "Start a Conversation" modal when plus icon is clicked', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        const plusIcon = screen.getByTestId('plus-icon');
        fireEvent.click(plusIcon);

        expect(screen.getByText('Start a Conversation')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Account ID')).toBeInTheDocument();
    });

    it('closes new DM modal when Cancel button is clicked', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        fireEvent.click(screen.getByTestId('plus-icon'));
        expect(screen.getByText('Start a Conversation')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('Start a Conversation')).not.toBeInTheDocument();
    });

    it('renders UserPanel at the bottom', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(screen.getByTestId('user-panel')).toBeInTheDocument();
    });

    it('does not fetch DMs if currentAccount is null', async () => {
        useAppStore.setState({ currentAccount: null });

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('DM with empty name shows peer ID or "Unknown User"', async () => {
        const dmWithNoName = [
            { id: 'dm-anon', name: '', participants: ['account1'] },
        ];

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(dmWithNoName),
        });

        await act(async () => {
            render(<DMSidebar />);
        });

        await waitFor(() => {
            // The component renders: dm.name || peerId || 'Unknown User'
            // With participants=['account1'], peerId = undefined (no other participant), so fallback is 'Unknown User'
            expect(screen.getByText('Unknown User')).toBeInTheDocument();
        });
    });
});
