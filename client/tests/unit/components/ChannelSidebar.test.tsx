/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelSidebar } from '../../../src/components/ChannelSidebar';
import { useAppStore } from '../../../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

// Mock Zustand store
vi.mock('../../../src/store/appStore', () => ({
    useAppStore: vi.fn(),
    Permission: {
        ADMINISTRATOR: 1 << 0,
        MANAGE_SERVER: 1 << 1,
        MANAGE_ROLES: 1 << 2,
        MANAGE_CHANNELS: 1 << 3,
        SEND_MESSAGES: 1 << 7,
        VIEW_CHANNEL: 1 << 10
    }
}));

// Mock contextMenuStore to prevent import issues
vi.mock('../../../src/store/contextMenuStore', () => ({
    useContextMenuStore: Object.assign(vi.fn((selector?: any) => {
        const state = { isOpen: false, position: { x: 0, y: 0 }, items: [], openContextMenu: vi.fn(), closeContextMenu: vi.fn(), toasts: [], profilePopup: null, showToast: vi.fn(), removeToast: vi.fn(), openProfilePopup: vi.fn(), closeProfilePopup: vi.fn() };
        return selector ? selector(state) : state;
    }), { getState: () => ({ isOpen: false, openContextMenu: vi.fn(), closeContextMenu: vi.fn(), toasts: [], showToast: vi.fn(), removeToast: vi.fn(), profilePopup: null, openProfilePopup: vi.fn(), closeProfilePopup: vi.fn() }), setState: vi.fn(), subscribe: vi.fn() }),
}));

describe('ChannelSidebar Component', () => {
    const mockSetActiveChannelId = vi.fn();
    const mockSetCurrentUserPermissions = vi.fn();

    const mockState = {
        activeGuildId: 's1',
        activeServerId: 's1',
        activeChannelId: 'c1',
        setActiveChannelId: mockSetActiveChannelId,
        guildMap: { 's1': 'http://localhost:3001' },
        serverMap: { 's1': 'http://localhost:3001' },
        activeVoiceChannelId: null,
        setActiveVoiceChannelId: vi.fn(),
        unreadChannels: new Set(['c2']),
        currentUserPermissions: 0,
        setCurrentUserPermissions: mockSetCurrentUserPermissions,
        currentAccount: { id: 'account1', is_creator: true },
        claimedProfiles: [],
        showGuildSettings: false,
        setShowGuildSettings: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Support both destructured access and selector-based access
        (useAppStore as any).mockImplementation((selector?: any) => {
            if (typeof selector === 'function') return selector(mockState);
            return mockState;
        });
        (useAppStore as any).getState = () => mockState;
        
        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/categories')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{ id: 'cat1', name: 'TEXT CHANNELS', server_id: 's1', position: 0 }])
                });
            }
            if (url.includes('/channels')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([
                        { id: 'c1', name: 'general', server_id: 's1', category_id: 'cat1' },
                        { id: 'c2', name: 'random', server_id: 's1', category_id: 'cat1' }
                    ])
                });
            }
            if (url.includes('/roles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    it('groups channels under categories correctly', async () => {
        render(<ChannelSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TEXT CHANNELS')).toBeInTheDocument();
            expect(screen.getByText('general')).toBeInTheDocument();
            expect(screen.getByText('random')).toBeInTheDocument();
        });
    });

    it('handles channel navigation on click', async () => {
        render(<ChannelSidebar />);

        await waitFor(() => {
            const channelLink = screen.getByText('random');
            fireEvent.click(channelLink);
            expect(mockSetActiveChannelId).toHaveBeenCalledWith('c2', 'random');
        });
    });

    it('shows unread indicator for channels in unreadChannels set', async () => {
        render(<ChannelSidebar />);

        await waitFor(() => {
            const unreadChannel = screen.getByText('random');
            expect(unreadChannel).toHaveStyle('font-weight: bold');
        });
        
        const selectedChannel = screen.getByText('general');
        expect(selectedChannel).not.toHaveStyle('font-weight: bold');
    });

    it('applies correct spacing styles to channels and categories', async () => {
        render(<ChannelSidebar />);

        await waitFor(() => {
            const channelItems = screen.getAllByText(/general|random/).map(el => el.closest('div[style*="margin-bottom"]'));
            channelItems.forEach(item => {
                expect(item).toHaveStyle('margin-bottom: 2px');
            });

            const category = screen.getByText('TEXT CHANNELS').closest('div[style*="margin-top"]');
            // Mock state has 1 category and 2 channels belonging to it, so uncategorizedChannels.length is 0.
            // index 0 && 0 length => marginTop: 0px
            expect(category).toHaveStyle('margin-top: 0px');
        });
    });
});
