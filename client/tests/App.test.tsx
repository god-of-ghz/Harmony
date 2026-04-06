/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../src/App';
import { useAppStore } from '../src/store/appStore';

// Mock the store
vi.mock('../src/store/appStore', () => ({
    useAppStore: vi.fn(),
}));

// Mock sub-components purely to detect if they mount
vi.mock('../src/components/ServerSidebar', () => ({
    ServerSidebar: () => <div data-testid="server-sidebar" />
}));
vi.mock('../src/components/ChannelSidebar', () => ({
    ChannelSidebar: () => <div data-testid="channel-sidebar" />
}));
vi.mock('../src/components/ChatArea', () => ({
    ChatArea: () => <div data-testid="chat-area" />
}));
vi.mock('../src/components/ClaimProfile', () => ({
    ClaimProfile: () => <div data-testid="claim-profile" />
}));
vi.mock('../src/components/LoginSignup', () => ({
    LoginSignup: () => <div data-testid="login-signup" />
}));
vi.mock('../src/components/DMSidebar', () => ({
    DMSidebar: () => <div data-testid="dm-sidebar" />
}));

describe('App Component Layout', () => {
    it('renders LoginSignup if no current user', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: null,
            activeServerId: null,
            claimedProfiles: [],
            knownServers: ['http://localhost:3001'],
            trustedServers: [],
            isGuestSession: false
        });

        render(<App />);
        expect(screen.getByTestId('login-signup')).toBeInTheDocument();
        expect(screen.queryByTestId('server-sidebar')).toBeNull();
    });

    it('renders select server if user is logged in but no active server', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeServerId: null,
            claimedProfiles: [],
            knownServers: ['http://localhost:3001'],
            trustedServers: [],
            isGuestSession: false
        });

        render(<App />);
        expect(screen.queryByTestId('login-signup')).toBeNull();
        expect(screen.getByTestId('server-sidebar')).toBeInTheDocument();
        expect(screen.getByText('Select a Server')).toBeInTheDocument();
    });

    it('renders ClaimProfile if server is active but no profile claimed', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeServerId: 'srv1',
            claimedProfiles: [],
            knownServers: ['http://localhost:3001'],
            trustedServers: [],
            isGuestSession: false
        });

        render(<App />);
        expect(screen.getByTestId('claim-profile')).toBeInTheDocument();
    });

    it('renders ChatArea and ChannelSidebar if profile is claimed', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeServerId: 'srv1',
            claimedProfiles: [{ server_id: 'srv1' }],
            knownServers: ['http://localhost:3001'],
            trustedServers: [],
            isGuestSession: false
        });

        render(<App />);
        expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('chat-area')).toBeInTheDocument();
    });

    it('maintains layout boundaries when window is resized', () => {
        (useAppStore as any).mockReturnValue({
            currentAccount: { id: '1' },
            activeServerId: 'srv1',
            claimedProfiles: [{ server_id: 'srv1' }],
            knownServers: ['http://localhost:3001'],
            trustedServers: [],
            isGuestSession: false
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
});
