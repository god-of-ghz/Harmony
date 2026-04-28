/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../../../src/App';
import { useAppStore } from '../../../src/store/appStore';

// Mock the store
vi.mock('../../../src/store/appStore', () => {
    const mock = vi.fn();
    (mock as any).getState = vi.fn(() => ({
        setConnectedServers: vi.fn(),
        setReadStates: vi.fn(),
        setCurrentAccount: vi.fn(),
        setClaimedProfiles: vi.fn(),
        setActiveServerId: vi.fn(),
        setSessionPrivateKey: vi.fn(),
        setServerStatus: vi.fn(),
        setAccountSettings: vi.fn(),
        clientSettings: { theme: 'dark' },
    }));
    (mock as any).setState = vi.fn();
    return { useAppStore: mock };
});

// Mock sub-components purely to detect if they mount
vi.mock('../../../src/components/ServerSidebar', () => ({
    ServerSidebar: () => <div data-testid="server-sidebar" />
}));
vi.mock('../../../src/components/ChannelSidebar', () => ({
    ChannelSidebar: () => <div data-testid="channel-sidebar" />
}));
vi.mock('../../../src/components/ChatArea', () => ({
    ChatArea: () => <div data-testid="chat-area" />
}));
vi.mock('../../../src/components/ClaimProfile', () => ({
    ClaimProfile: () => <div data-testid="claim-profile" />
}));
vi.mock('../../../src/components/LoginSignup', () => ({
    LoginSignup: () => <div data-testid="login-signup" />
}));
vi.mock('../../../src/components/DMSidebar', () => ({
    DMSidebar: () => <div data-testid="dm-sidebar" />
}));
vi.mock('../../../src/components/GlobalClaimProfile', () => ({
    GlobalClaimProfile: () => null
}));
vi.mock('../../../src/components/FriendsList', () => ({
    FriendsList: () => <div data-testid="friends-list" />
}));
vi.mock('../../../src/components/ImageModal', () => ({
    ImageModal: () => null
}));

// Intercept any fetch calls that leak through
const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as any));

describe('App Component Layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders LoginSignup if no current user', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: null,
            activeGuildId: null,

            activeServerId: null,
            claimedProfiles: [],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        render(<App />);
        expect(screen.getByTestId('login-signup')).toBeInTheDocument();
        expect(screen.queryByTestId('server-sidebar')).toBeNull();
    });

    it('renders select server if user is logged in but no active server', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeGuildId: null,

            activeServerId: null,
            claimedProfiles: [],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            profilesLoaded: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        render(<App />);
        expect(screen.queryByTestId('login-signup')).toBeNull();
        expect(screen.getByTestId('server-sidebar')).toBeInTheDocument();
        expect(screen.getByText('Select a Server')).toBeInTheDocument();
    });

    it('renders ClaimProfile if server is active but no profile claimed', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',

            activeServerId: 'srv1',
            claimedProfiles: [],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            profilesLoaded: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        render(<App />);
        expect(screen.getByTestId('claim-profile')).toBeInTheDocument();
    });

    it('renders ChatArea and ChannelSidebar if profile is claimed', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',

            activeServerId: 'srv1',
            claimedProfiles: [{ server_id: 'srv1' }],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            profilesLoaded: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        render(<App />);
        expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('chat-area')).toBeInTheDocument();
    });

    it('maintains layout boundaries when window is resized', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeGuildId: 'srv1',

            activeServerId: 'srv1',
            claimedProfiles: [{ server_id: 'srv1' }],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: true,
            profilesLoaded: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        const { container } = render(<App />);

        // Assert container structurally exists
        const rootApp = container.querySelector('.app-container');
        expect(rootApp).toBeInTheDocument();

        // In this test, ChatArea is mocked, so we just check the wrapper mounting successfully.
        const chatAreaWrapper = screen.getByTestId('chat-area');
        expect(chatAreaWrapper).toBeDefined();

        // Trigger a fake horizontal squish
        global.innerWidth = 500;
        global.dispatchEvent(new Event('resize'));

        // Assert container structurally survives shrink without a crash
        expect(chatAreaWrapper).toBeInTheDocument();
        expect(rootApp).toBeInTheDocument();
    });

    it('BUG REGRESSION: does not render blank screen after signup (dismissedGlobalClaim=false, no profiles)', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: 'new-signup', email: 'new@test.com', token: 'tok' },
            activeGuildId: null,

            activeServerId: null,
            activeChannelId: null,
            claimedProfiles: [],
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            isGuestSession: false,
            dismissedGlobalClaim: false,
            profilesLoaded: true,
            setCurrentAccount: vi.fn(),
            setIsGuestSession: vi.fn(),
            primaryOfflineMessage: null,
            setServerStatus: vi.fn(),
        });

        const { container } = render(<App />);

        // The app must not be blank — ServerSidebar and content should be present
        expect(screen.getByTestId('server-sidebar')).toBeInTheDocument();

        // Should show "Select a Server" or similar — NOT a blank void
        const appContainer = container.querySelector('.app-container');
        expect(appContainer).toBeInTheDocument();
        expect(appContainer!.textContent!.length).toBeGreaterThan(0);
    });
});
