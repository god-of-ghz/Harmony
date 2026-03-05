import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ChatArea } from '../src/components/ChatArea';
import { useAppStore } from '../src/store/appStore';

global.fetch = vi.fn();

describe('ChatArea component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup initial Zustand state
        useAppStore.setState({
            activeServerId: 'server1',
            activeChannelId: 'channel1',
            activeChannelName: 'general',
            claimedProfiles: [{
                id: 'profile1',
                server_id: 'server1',
                account_id: 'account1',
                original_username: 'me',
                nickname: 'me',
                avatar: '',
                role: 'USER',
                aliases: ''
            }]
        });
    });

    it('renders @UnknownProfileOrRole for unknown mention tags containing ! or missing from profiles', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
            if (url.includes('/profiles')) {
                return Promise.resolve({
                    json: () => Promise.resolve([
                        { id: 'profile1', nickname: 'me' } // Only "me" exists
                    ])
                });
            }
            if (url.includes('/messages')) {
                return Promise.resolve({
                    json: () => Promise.resolve([
                        {
                            id: 'msg1',
                            channel_id: 'channel1',
                            author_id: 'someone',
                            content: 'testing unknown mention <@!999> string',
                            timestamp: new Date().toISOString(),
                            username: 'UnknownProfileOrRole',
                            avatar: ''
                        }
                    ])
                });
            }
            return Promise.resolve({ json: () => Promise.resolve([]) });
        });

        render(<ChatArea />);

        await waitFor(() => {
            // Evaluates parsed segment return value: @UnknownProfileOrRole
            expect(screen.getByText('@UnknownProfileOrRole')).toBeInTheDocument();
        });

        // Evaluates that orphaned author mapped as UnknownProfileOrRole appears visually above the message block
        expect(screen.getByText('UnknownProfileOrRole')).toBeInTheDocument();
    });
});
