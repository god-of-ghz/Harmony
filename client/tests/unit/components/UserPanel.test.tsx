import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { UserPanel } from '../../../src/components/UserPanel';
import { useAppStore } from '../../../src/store/appStore';

// Mock UserSettings child component
vi.mock('../../../src/components/UserSettings', () => ({
    UserSettings: ({ onClose }: any) => (
        <div data-testid="user-settings-modal">
            <button onClick={onClose}>Close Settings</button>
        </div>
    ),
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
    Settings: (props: any) => <span data-testid="settings-icon" {...props}>Settings</span>,
    Mic: (props: any) => <span data-testid="mic-icon" {...props}>Mic</span>,
    MicOff: (props: any) => <span data-testid="mic-off-icon" {...props}>MicOff</span>,
    Headphones: (props: any) => <span data-testid="headphones-icon" {...props}>Headphones</span>,
}));

describe('UserPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        useAppStore.setState({
            currentAccount: {
                id: 'account1',
                email: 'testuser@example.com',
                is_creator: false,
                token: 'test-jwt-token',
            },
            globalProfiles: {},
            isMuted: false,
            isDeafened: false,
        });
    });

    it('renders nothing when currentAccount is null', () => {
        useAppStore.setState({ currentAccount: null });

        const { container } = render(<UserPanel />);
        expect(container.innerHTML).toBe('');
    });

    it('renders username derived from email', () => {
        render(<UserPanel />);
        expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('renders "Online" status text', () => {
        render(<UserPanel />);
        expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('shows initial letter avatar when no global profile avatar', () => {
        render(<UserPanel />);
        // Should show 'T' (first letter of 'testuser')
        expect(screen.getByText('T')).toBeInTheDocument();
    });

    it('shows avatar image when global profile has avatar_url', () => {
        useAppStore.setState({
            globalProfiles: {
                account1: {
                    account_id: 'account1',
                    display_name: '',
                    bio: '',
                    status_message: '',
                    avatar_url: 'http://localhost/avatar.png',
                    banner_url: '',
                },
            },
        });

        render(<UserPanel />);
        const img = screen.getByAltText('avatar');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'http://localhost/avatar.png');
    });

    // =======================================================================
    // display_name regression tests
    // =======================================================================

    it('shows global display_name instead of email prefix', () => {
        useAppStore.setState({
            globalProfiles: {
                account1: {
                    account_id: 'account1',
                    display_name: 'GHz',
                    bio: '',
                    status_message: '',
                    avatar_url: '',
                    banner_url: '',
                },
            },
        });

        render(<UserPanel />);
        expect(screen.getByText('GHz')).toBeInTheDocument();
        expect(screen.queryByText('testuser')).not.toBeInTheDocument();
    });

    it('falls back to email prefix when display_name is empty', () => {
        useAppStore.setState({
            globalProfiles: {
                account1: {
                    account_id: 'account1',
                    display_name: '',
                    bio: '',
                    status_message: '',
                    avatar_url: '',
                    banner_url: '',
                },
            },
        });

        render(<UserPanel />);
        expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('shows initial letter from display_name in avatar (no avatar_url)', () => {
        useAppStore.setState({
            globalProfiles: {
                account1: {
                    account_id: 'account1',
                    display_name: 'GHz',
                    bio: '',
                    status_message: '',
                    avatar_url: '',
                    banner_url: '',
                },
            },
        });

        render(<UserPanel />);
        // Should show 'G' (first letter of 'GHz'), not 'T' (from email)
        expect(screen.getByText('G')).toBeInTheDocument();
    });

    it('mic button shows Mic icon when not muted', () => {
        render(<UserPanel />);
        expect(screen.getByTestId('mic-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('mic-off-icon')).not.toBeInTheDocument();
    });

    it('mic button shows MicOff icon when muted', () => {
        useAppStore.setState({ isMuted: true });

        render(<UserPanel />);
        expect(screen.getByTestId('mic-off-icon')).toBeInTheDocument();
    });

    it('clicking mic button toggles mute state', () => {
        render(<UserPanel />);
        
        const micBtn = screen.getByTestId('mic-icon').closest('.icon-btn');
        expect(micBtn).toBeTruthy();

        act(() => {
            fireEvent.click(micBtn!);
        });

        expect(useAppStore.getState().isMuted).toBe(true);
    });

    it('clicking mute button twice toggles back to unmuted', () => {
        render(<UserPanel />);
        
        const micBtn = screen.getByTestId('mic-icon').closest('.icon-btn');

        act(() => { fireEvent.click(micBtn!); });
        expect(useAppStore.getState().isMuted).toBe(true);

        // Re-render to pick up new icon
        const micOffBtn = screen.getByTestId('mic-off-icon').closest('.icon-btn');
        act(() => { fireEvent.click(micOffBtn!); });
        expect(useAppStore.getState().isMuted).toBe(false);
    });

    it('clicking deafen button toggles deafen state and auto-mutes', () => {
        render(<UserPanel />);
        
        const deafenBtn = screen.getByTestId('headphones-icon').closest('.icon-btn');
        expect(deafenBtn).toBeTruthy();

        act(() => {
            fireEvent.click(deafenBtn!);
        });

        // Deafening should also mute
        expect(useAppStore.getState().isDeafened).toBe(true);
        expect(useAppStore.getState().isMuted).toBe(true);
    });

    it('settings icon opens UserSettings modal', () => {
        render(<UserPanel />);

        const settingsBtn = screen.getByTestId('settings-icon').closest('.icon-btn');
        expect(settingsBtn).toBeTruthy();

        act(() => {
            fireEvent.click(settingsBtn!);
        });

        expect(screen.getByTestId('user-settings-modal')).toBeInTheDocument();
    });

    it('clicking the user info area also opens settings', () => {
        render(<UserPanel />);

        // Click on the username text area (which opens settings on the parent div click)
        const usernameElement = screen.getByText('testuser');
        const clickableArea = usernameElement.closest('div[style]');
        
        act(() => {
            fireEvent.click(clickableArea!);
        });

        expect(screen.getByTestId('user-settings-modal')).toBeInTheDocument();
    });

    it('handles missing email gracefully (shows "User")', () => {
        useAppStore.setState({
            currentAccount: {
                id: 'account1',
                email: '',
                is_creator: false,
                token: 'test-jwt-token',
            },
        });

        render(<UserPanel />);
        // When email is empty, split('@')[0] returns '', fallback is 'User'
        expect(screen.getByText('User')).toBeInTheDocument();
    });

    it('deafen indicator slash line appears when deafened', () => {
        useAppStore.setState({ isDeafened: true, isMuted: true });

        const { container } = render(<UserPanel />);
        
        // The deafen slash is a small div with transform: rotate(-45deg)
        const slashLines = container.querySelectorAll('div');
        const deafenSlash = Array.from(slashLines).find(
            d => d.style.transform === 'rotate(-45deg)'
        );
        expect(deafenSlash).toBeTruthy();
    });

    it('green online dot is rendered', () => {
        const { container } = render(<UserPanel />);
        
        const dots = container.querySelectorAll('div');
        const greenDot = Array.from(dots).find(
            d => d.style.backgroundColor === 'rgb(35, 165, 89)' && d.style.borderRadius === '50%'
        );
        expect(greenDot).toBeTruthy();
    });
});
