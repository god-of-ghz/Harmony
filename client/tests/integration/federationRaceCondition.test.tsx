/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../../src/App';
import { useAppStore } from '../../src/store/appStore';

// Mock the store — must support both destructured usage and selector usage
vi.mock('../../src/store/appStore', () => {
    let currentMockState: any = {};
    const mock: any = vi.fn((selector?: any) => {
        if (typeof selector === 'function') return selector(currentMockState);
        return currentMockState;
    });
    mock.getState = vi.fn(() => ({
        setConnectedServers: vi.fn(),
        setReadStates: vi.fn(),
        setCurrentAccount: vi.fn(),
        setClaimedProfiles: vi.fn(),
        setActiveServerId: vi.fn(),
        setSessionPrivateKey: vi.fn(),
        setServerStatus: vi.fn(),
        setProfilesLoaded: vi.fn(),
        setAccountSettings: vi.fn(),
        clientSettings: { theme: 'dark' },
    }));
    mock.setState = vi.fn();
    mock._setMockState = (state: any) => { currentMockState = state; };
    return { useAppStore: mock };
});

// Mock sub-components
vi.mock('../../src/components/ServerSidebar', () => ({
    ServerSidebar: () => <div data-testid="server-sidebar" />
}));
vi.mock('../../src/components/ChannelSidebar', () => ({
    ChannelSidebar: () => <div data-testid="channel-sidebar" />
}));
vi.mock('../../src/components/ChatArea', () => ({
    ChatArea: () => <div data-testid="chat-area" />
}));
vi.mock('../../src/components/ClaimProfile', () => ({
    ClaimProfile: () => <div data-testid="claim-profile" />
}));
vi.mock('../../src/components/LoginSignup', () => ({
    LoginSignup: () => <div data-testid="login-signup" />
}));
vi.mock('../../src/components/DMSidebar', () => ({
    DMSidebar: () => <div data-testid="dm-sidebar" />
}));
vi.mock('../../src/components/GlobalClaimProfile', () => ({
    GlobalClaimProfile: () => null
}));
vi.mock('../../src/components/FriendsList', () => ({
    FriendsList: () => <div data-testid="friends-list" />
}));
vi.mock('../../src/components/ImageModal', () => ({
    ImageModal: () => null
}));

const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as any));

describe('App — Federation Race Condition Regressions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('BUG REGRESSION: shows loading spinner (not ClaimProfile) when profilesLoaded is false', () => {
        const state = {
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',
            activeServerId: 'srv1',
            activeChannelId: null,
            claimedProfiles: [],              // Empty — but profiles haven't loaded yet
            profilesLoaded: false,             // KEY: profiles not loaded
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        };
        (useAppStore as any)._setMockState(state);
        (useAppStore as any).mockImplementation((selector?: any) => {
            if (typeof selector === 'function') return selector(state);
            return state;
        });

        render(<App />);

        // Should show loading, NOT ClaimProfile
        expect(screen.getByText('Loading profiles...')).toBeInTheDocument();
        expect(screen.queryByTestId('claim-profile')).toBeNull();
    });

    it('BUG REGRESSION: shows ClaimProfile only after profilesLoaded is true AND no profile found', () => {
        const state = {
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',
            activeServerId: 'srv1',
            activeChannelId: null,
            claimedProfiles: [],              // Empty — legitimately no profile
            profilesLoaded: true,              // KEY: profiles have loaded
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        };
        (useAppStore as any)._setMockState(state);
        (useAppStore as any).mockImplementation((selector?: any) => {
            if (typeof selector === 'function') return selector(state);
            return state;
        });

        render(<App />);

        // Now it's legitimate to show ClaimProfile
        expect(screen.getByTestId('claim-profile')).toBeInTheDocument();
        expect(screen.queryByText('Loading profiles...')).toBeNull();
    });

    it('renders ChatArea when profilesLoaded is true AND profile exists for active server', () => {
        const state = {
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',
            activeServerId: 'srv1',
            activeChannelId: null,
            claimedProfiles: [{ server_id: 'srv1', id: 'p1' }],
            profilesLoaded: true,
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        };
        (useAppStore as any)._setMockState(state);
        (useAppStore as any).mockImplementation((selector?: any) => {
            if (typeof selector === 'function') return selector(state);
            return state;
        });

        render(<App />);
        expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('chat-area')).toBeInTheDocument();
        expect(screen.queryByTestId('claim-profile')).toBeNull();
    });
});
