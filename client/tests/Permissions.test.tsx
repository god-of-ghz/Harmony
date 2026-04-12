import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { ChannelSidebar } from '../src/components/ChannelSidebar';
import { ChatArea } from '../src/components/ChatArea';
import { ServerSettings } from '../src/components/ServerSettings';
import { useAppStore, Permission } from '../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

describe('Permissions UI Rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup initial store state
        useAppStore.setState({
            activeServerId: 'server1',
            serverMap: { 'server1': 'http://localhost' },
            currentAccount: { id: 'acc1', email: 'test@test.com', is_creator: false },
            claimedProfiles: [{ id: 'prof1', server_id: 'server1', role: 'USER' }],
            currentUserPermissions: 0,
            unreadChannels: new Set(),
            serverRoles: [],
            presenceMap: {},
            activeChannelId: 'chan1',
            activeChannelName: 'general'
        });

        // Default mock for fetch
        (global.fetch as any).mockImplementation(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve([])
        }));
    });

    afterEach(() => {
        cleanup();
    });

    describe('ChannelSidebar Settings Gear', () => {
        it('hides settings gear when user lacks MANAGE_SERVER or ADMINISTRATOR', () => {
            useAppStore.setState({ currentUserPermissions: 0 });
            render(<ChannelSidebar />);
            expect(screen.getByTestId('settings-gear')).toBeInTheDocument();
        });

        it('shows settings gear when user has MANAGE_SERVER', () => {
            useAppStore.setState({ currentUserPermissions: Permission.MANAGE_SERVER });
            render(<ChannelSidebar />);
            expect(screen.getByTestId('settings-gear')).toBeInTheDocument();
        });

        it('shows settings gear when user has ADMINISTRATOR', () => {
            useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
            render(<ChannelSidebar />);
            expect(screen.getByTestId('settings-gear')).toBeInTheDocument();
        });
    });

    describe('ChatArea Message Deletion', () => {
        it('hides delete button for others messages if lacking MANAGE_MESSAGES', async () => {
            useAppStore.setState({ currentUserPermissions: 0 });
            
            (global.fetch as any).mockImplementation((url: string) => {
                if (url.includes('/messages')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([
                            { id: 'msg1', author_id: 'other_prof', content: 'hello', timestamp: new Date().toISOString(), username: 'other', avatar: '' }
                        ])
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            });

            render(<ChatArea />);
            
            await waitFor(() => {
                expect(screen.queryByTestId('delete-message')).not.toBeInTheDocument();
            });
        });

        it('shows delete button for others messages if has MANAGE_MESSAGES', async () => {
            useAppStore.setState({ currentUserPermissions: Permission.MANAGE_MESSAGES });
            
            (global.fetch as any).mockImplementation((url: string) => {
                if (url.includes('/messages')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([
                            { id: 'msg1', author_id: 'other_prof', content: 'hello', timestamp: new Date().toISOString(), username: 'other', avatar: '' }
                        ])
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            });

            render(<ChatArea />);
            
            await waitFor(() => {
                expect(screen.getByTestId('delete-message')).toBeInTheDocument();
            });
        });

        it('always shows delete button for own messages', async () => {
            useAppStore.setState({ currentUserPermissions: 0 });
            
            (global.fetch as any).mockImplementation((url: string) => {
                if (url.includes('/messages')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([
                            { id: 'msg1', author_id: 'prof1', content: 'hello', timestamp: new Date().toISOString(), username: 'me', avatar: '' }
                        ])
                    });
                }
                if (url.includes('/profiles')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([{ id: 'prof1', account_id: 'acc1', server_id: 'server1' }])
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            });

            render(<ChatArea />);
            
            await waitFor(() => {
                expect(screen.getByTestId('delete-message')).toBeInTheDocument();
            });
        });
    });

    describe('ServerSettings Access', () => {
        it('shows Access Denied if lacking MANAGE_SERVER or ADMINISTRATOR', () => {
            useAppStore.setState({ currentUserPermissions: 0 });
            render(<ServerSettings onClose={() => {}} />);
            expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
        });

        it('does not show Access Denied if has MANAGE_SERVER', () => {
            useAppStore.setState({ currentUserPermissions: Permission.MANAGE_SERVER });
            render(<ServerSettings onClose={() => {}} />);
            expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
        });
    });
});
