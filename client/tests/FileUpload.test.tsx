import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { ChatArea } from '../src/components/ChatArea';
import { useAppStore } from '../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

describe('File Upload Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            activeServerId: 'server1',
            activeChannelId: 'chan1',
            activeChannelName: 'general',
            serverMap: { 'server1': 'http://localhost' },
            currentAccount: { id: 'acc1', email: 'test@test.com' },
            claimedProfiles: [{ id: 'prof1', server_id: 'server1', role: 'USER' }],
            currentUserPermissions: 0xFFFFFFFF, // Full perms for testing
            presenceMap: {},
            serverRoles: [],
        });

        // Mock window.alert
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        
        // Mock scrollIntoView
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('successfully uploads a file and appends the returned URL to pending attachments', async () => {
        (global.fetch as any).mockImplementation((url: string, options: any) => {
            if (url.includes('/attachments') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ urls: ['/uploads/image1.png'] })
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        const { container } = render(<ChatArea />);
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

        const file = new File(['hello'], 'hello.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            const preview = screen.getByAltText('preview');
            expect(preview).toBeInTheDocument();
            expect(preview).toHaveAttribute('src', 'http://localhost/uploads/image1.png');
        });
    });

    it('displays an error alert if the server rejects a file', async () => {
        (global.fetch as any).mockImplementation((url: string, options: any) => {
            if (url.includes('/attachments') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 400,
                    json: () => Promise.resolve({ error: 'Invalid file type' })
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        const { container } = render(<ChatArea />);
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

        const file = new File(['bad'], 'script.js', { type: 'text/javascript' });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(window.alert).toHaveBeenCalledWith('Invalid file type');
        });
    });
});
