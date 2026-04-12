import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSidebar } from '../src/components/ServerSidebar';
import App from '../src/App';
import { useAppStore } from '../src/store/appStore';

// Mock fetch
global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as any));

// Mock Zustand store
vi.mock('../src/store/appStore', () => {
    const mockState: any = {
        activeServerId: null,
        setActiveServerId: vi.fn(),
        currentAccount: { id: 'acc1', token: 'token' },
        knownServers: [],
        trustedServers: [],
        claimedProfiles: [],
        serverMap: {},
        setServerMap: vi.fn(),
        setTrustedServers: vi.fn(),
        setCurrentAccount: vi.fn(),
        setIsGuestSession: vi.fn(),
    };
    
    const mockUseStore = vi.fn((selector) => (typeof selector === 'function' ? selector(mockState) : mockState));
    (mockUseStore as any).getState = () => mockState;
    (mockUseStore as any).setState = vi.fn();
    
    return {
        useAppStore: mockUseStore
    };
});

describe('Component Resiliency (Blank Client protection)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ServerSidebar renders without crashing even if knownServers is null', () => {
        const mockState = (useAppStore as any).getState();
        mockState.knownServers = null as any;
        mockState.trustedServers = null as any;

        // This would have previously crashed with "Cannot read properties of null (reading 'join')"
        expect(() => render(<ServerSidebar />)).not.toThrow();
    });

    it('App renders without crashing even if server arrays are malformed', () => {
        const mockState = (useAppStore as any).getState();
        mockState.knownServers = null as any;
        mockState.trustedServers = undefined as any;
        mockState.claimedProfiles = null as any;

        // This would have crashed previously during activeProfile calculation
        expect(() => render(<App />)).not.toThrow();
    });
});
