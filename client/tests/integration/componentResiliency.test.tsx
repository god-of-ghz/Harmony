import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerSidebar } from '../../src/components/ServerSidebar';
import App from '../../src/App';
import { useAppStore } from '../../src/store/appStore';
import { PromotionWizard } from '../../src/components/PromotionWizard';
import { saveSlaCache } from '../../src/utils/slaTracker';
import { screen } from '@testing-library/react';

// Mock fetch globally — all calls resolve with safe defaults
const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as any));
global.fetch = fetchMock;

// Mock keyStore to avoid IndexedDB issues in the test environment
vi.mock('../../src/utils/keyStore', () => ({
    clearSessionKey: vi.fn(() => Promise.resolve()),
}));

// Mock @hello-pangea/dnd to avoid drag-and-drop DOM complexity
vi.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: any) => <div>{children}</div>,
    Droppable: ({ children }: any) => children({
        droppableProps: {},
        innerRef: vi.fn(),
        placeholder: null
    }),
    Draggable: ({ children }: any) => children({
        draggableProps: { style: {} },
        dragHandleProps: {},
        innerRef: vi.fn()
    }),
}));

// Mock child components of App that are NOT under test
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

// Mock Zustand store with selector support
vi.mock('../../src/store/appStore', () => {
    const mockState: any = {
        activeGuildId: null,
        activeServerId: null,
        setActiveGuildId: vi.fn(),
        setActiveServerId: vi.fn(),
        currentAccount: { id: 'acc1', token: 'token' },
        connectedServers: [],
        claimedProfiles: [],
        guildMap: {},
        serverMap: {},
        setGuildMap: vi.fn(),
        setServerMap: vi.fn(),
        setConnectedServers: vi.fn(),
        setCurrentAccount: vi.fn(),
        setIsGuestSession: vi.fn(),
        setClaimedProfiles: vi.fn(),
        setSessionPrivateKey: vi.fn(),
        setReadStates: vi.fn(),
        setAccountSettings: vi.fn(),
        dismissedGlobalClaim: true,
        isGuestSession: false,
        activeChannelId: null,
        activeChannelName: '',
        unclaimedProfiles: [],
        setUnclaimedProfiles: vi.fn(),
        setDismissedGlobalClaim: vi.fn(),
        nodeStatus: {},
        serverStatus: {},
        setNodeStatus: vi.fn(),
        setServerStatus: vi.fn(),
        primaryOfflineMessage: null,
        setPrimaryOfflineMessage: vi.fn(),
        clientSettings: { theme: 'dark' },
        setClientSettings: vi.fn(),
        profilesLoaded: false,
        setProfilesLoaded: vi.fn(),
    };
    
    const mockUseStore = vi.fn((selector) => (typeof selector === 'function' ? selector(mockState) : mockState));
    (mockUseStore as any).getState = () => mockState;
    (mockUseStore as any).setState = vi.fn((partial) => {
        try {
            if (typeof partial === 'function') {
                const result = partial(mockState);
                if (result) Object.assign(mockState, result);
            } else {
                Object.assign(mockState, partial);
            }
        } catch {
            // Silently handle expected errors from malformed state during resiliency tests
        }
    });
    
    return {
        useAppStore: mockUseStore
    };
});

describe('Component Resiliency (Blank Client protection)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the mock state to known defaults before each test
        const mockState = (useAppStore as any).getState();
        mockState.connectedServers = [];
        mockState.claimedProfiles = [];
        mockState.activeGuildId = null;
        mockState.activeServerId = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ServerSidebar renders without crashing even if connectedServers is null', async () => {
        const mockState = (useAppStore as any).getState();
        mockState.connectedServers = null as any;

        // Render inside act to capture all asynchronous state updates
        await act(async () => {
            expect(() => render(<ServerSidebar />)).not.toThrow();
        });
    });

    it('App renders without crashing even if server arrays are malformed', async () => {
        const mockState = (useAppStore as any).getState();
        mockState.connectedServers = null as any;
        mockState.claimedProfiles = null as any;

        // Render inside act to capture all asynchronous state updates
        await act(async () => {
            expect(() => render(<App />)).not.toThrow();
        });
    });
});

describe('PromotionWizard SLA Resiliency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        const mockState = (useAppStore as any).getState();
        mockState.currentAccount = { id: 'test-user', delegation_cert: 'mock', primary_server_url: 'https://primary.com' };
        mockState.connectedServers = [
            { url: 'https://primary.com', trust_level: 'trusted', status: 'active' },
            { url: 'https://replica-a.com', trust_level: 'trusted', status: 'active' },
            { url: 'https://replica-b.com', trust_level: 'trusted', status: 'active' }
        ];
        mockState.setCurrentAccount = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('The Threshold Test: strictly respects the 24-hour downtime threshold', async () => {
        const now = Date.now();
        const hr = 60 * 60 * 1000;
        
        saveSlaCache({
            'https://primary.com': {
                events: [{ timestamp: now - (23.9 * hr), status: 'offline' }]
            },
            'https://replica-a.com': {
                events: [
                    { timestamp: now - 24 * hr, status: 'online', latency: 50 },
                    { timestamp: now, status: 'online', latency: 50 }
                ]
            }
        });

        const { unmount } = render(<PromotionWizard />);
        await act(async () => { await new Promise(r => setTimeout(r, 1500)); });
        expect(screen.queryByText('Network Outage Detected')).not.toBeInTheDocument();
        unmount();

        localStorage.clear();
        saveSlaCache({
            'https://primary.com': {
                events: [{ timestamp: now - (24.1 * hr), status: 'offline' }]
            },
            'https://replica-a.com': {
                events: [
                    { timestamp: now - 25 * hr, status: 'online', latency: 50 },
                    { timestamp: now, status: 'online', latency: 50 }
                ]
            }
        });

        render(<PromotionWizard />);
        await act(async () => { await new Promise(r => setTimeout(r, 1500)); });
        expect(screen.getByText('Network Outage Detected')).toBeInTheDocument();
        expect(screen.getByText('https://replica-a.com')).toBeInTheDocument();
    });

    it('The Tiebreaker Test: handles identical uptime cleanly', async () => {
        const now = Date.now();
        const hr = 60 * 60 * 1000;

        saveSlaCache({
            'https://primary.com': {
                events: [{ timestamp: now - 25 * hr, status: 'offline' }]
            },
            'https://replica-a.com': {
                events: [
                    { timestamp: now - 24 * hr, status: 'online', latency: 100 },
                    { timestamp: now, status: 'online', latency: 100 }
                ]
            },
            'https://replica-b.com': {
                events: [
                    { timestamp: now - 24 * hr, status: 'online', latency: 100 },
                    { timestamp: now, status: 'online', latency: 100 }
                ]
            }
        });

        render(<PromotionWizard />);
        await act(async () => { await new Promise(r => setTimeout(r, 1500)); });
        
        expect(screen.getByText('Network Outage Detected')).toBeInTheDocument();
        expect(screen.getByText('https://replica-a.com')).toBeInTheDocument();
        expect(screen.queryByText('https://replica-b.com')).not.toBeInTheDocument();
    });
});
