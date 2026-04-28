/**
 * P13 — Guild Setup Wizard Tests
 *
 * Validates:
 * 1.  Renders wizard when isOpen=true
 * 2.  Step navigation forward (Next)
 * 3.  Step navigation backward (Back preserves data)
 * 4.  Name validation — empty name shows error
 * 5.  Icon upload — selecting a file shows preview
 * 6.  Default channels — step 2 has general, announcements, General voice
 * 7.  Add channel — new row appears
 * 8.  Remove channel — channel removed
 * 9.  Min channel validation — all text channels removed → error
 * 10. Confirmation summary — shows configured values
 * 11. Owner step visibility — operator vs non-operator
 * 12. Create API call — correct JSON payload sent
 * 13. Error display — API error shown in wizard
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account } from '../store/appStore';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
    Camera: () => 'CameraIcon',
    Crown: () => 'CrownIcon',
    Hash: () => '#',
    Volume2: () => '🔊',
    X: () => '✕',
    Plus: () => '+',
    LayoutTemplate: () => 'TemplateIcon',
    Globe: () => 'GlobeIcon',
    User: () => 'UserIcon',
}));

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({
    apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock URL.createObjectURL / revokeObjectURL without breaking the URL constructor
const mockCreateObjectURL = vi.fn(() => 'blob:mock-preview-url');
const mockRevokeObjectURL = vi.fn();
globalThis.URL.createObjectURL = mockCreateObjectURL;
globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

const mockOperatorAccount: Account = {
    id: 'account-1',
    email: 'operator@example.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const mockRegularAccount: Account = {
    id: 'account-2',
    email: 'user@example.com',
    is_creator: false,
    is_admin: false,
    token: 'test-token-2',
    primary_server_url: 'http://localhost:3001',
};

describe('P13 — Guild Setup Wizard', () => {
    let onClose: ReturnType<typeof vi.fn>;
    let fetchGuilds: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        onClose = vi.fn();
        fetchGuilds = vi.fn().mockResolvedValue(undefined);

        useAppStore.setState({
            activeGuildId: null,
            currentAccount: mockOperatorAccount,
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            guildMap: {},
        });

        mockApiFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'new-guild-123' }),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const renderWizard = async (props: Partial<Parameters<typeof import('../components/guild/GuildSetupWizard').GuildSetupWizard>[0]> = {}) => {
        const { GuildSetupWizard } = await import('../components/guild/GuildSetupWizard');
        return render(
            <GuildSetupWizard
                isOpen={true}
                onClose={onClose}
                targetNodeUrl="http://localhost:3001"
                fetchGuilds={fetchGuilds}
                {...props}
            />
        );
    };

    // ──────────────────────────────────────────────────
    // 1. Renders when open
    // ──────────────────────────────────────────────────
    it('renders wizard when isOpen=true', async () => {
        await renderWizard();
        expect(screen.getByTestId('guild-setup-wizard')).toBeTruthy();
        expect(screen.getByText('✨ Create Your Guild')).toBeTruthy();
    });

    it('does not render when isOpen=false', async () => {
        await renderWizard({ isOpen: false });
        expect(screen.queryByTestId('guild-setup-wizard')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 2. Step navigation forward
    // ──────────────────────────────────────────────────
    it('clicking Next advances to next step when name is valid', async () => {
        await renderWizard();

        // Fill in a valid name
        const nameInput = screen.getByTestId('guild-name-input');
        await act(async () => {
            fireEvent.change(nameInput, { target: { value: 'Test Guild' } });
        });

        // Click Next
        const nextBtn = screen.getByTestId('wizard-next-btn');
        await act(async () => {
            fireEvent.click(nextBtn);
        });

        // Operator sees owner step next
        expect(screen.getByText('👑 Guild Ownership')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 3. Step navigation backward (preserves data)
    // ──────────────────────────────────────────────────
    it('clicking Back returns to previous step and preserves data', async () => {
        await renderWizard();

        // Fill name and advance
        const nameInput = screen.getByTestId('guild-name-input');
        await act(async () => {
            fireEvent.change(nameInput, { target: { value: 'My Cool Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Now on owner step — click Back
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-back-btn'));
        });

        // Back on name step, data preserved
        expect(screen.getByText('✨ Create Your Guild')).toBeTruthy();
        expect(screen.getByTestId('guild-name-input')).toHaveValue('My Cool Guild');
    });

    // ──────────────────────────────────────────────────
    // 4. Name validation — empty name
    // ──────────────────────────────────────────────────
    it('shows error when trying to advance with empty name', async () => {
        await renderWizard();

        // Don't fill name, click Next
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        expect(screen.getByTestId('wizard-error')).toBeTruthy();
        expect(screen.getByText(/Guild name must be at least 2 characters/)).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 5. Icon upload
    // ──────────────────────────────────────────────────
    it('selecting an image file shows preview', async () => {
        await renderWizard();

        const fileInput = screen.getByTestId('icon-file-input');
        const file = new File(['test'], 'icon.png', { type: 'image/png' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [file] } });
        });

        expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
        expect(screen.getByTestId('icon-preview-img')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 6. Default channels
    // ──────────────────────────────────────────────────
    it('step 2 shows default channels', async () => {
        // Use regular account to skip owner step
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        // Fill name and advance to channels
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'My Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Should be on channels step
        expect(screen.getByText('📝 Set Up Channels')).toBeTruthy();

        // Check for default channel names in inputs
        const textList = screen.getByTestId('text-channels-list');
        const voiceList = screen.getByTestId('voice-channels-list');
        expect(textList).toBeTruthy();
        expect(voiceList).toBeTruthy();

        // Should have 'general' and 'announcements' as text channels
        const textInputs = textList.querySelectorAll('input');
        const textValues = Array.from(textInputs).map(i => (i as HTMLInputElement).value);
        expect(textValues).toContain('general');
        expect(textValues).toContain('announcements');

        // Should have 'General' as voice channel
        const voiceInputs = voiceList.querySelectorAll('input');
        const voiceValues = Array.from(voiceInputs).map(i => (i as HTMLInputElement).value);
        expect(voiceValues).toContain('General');
    });

    // ──────────────────────────────────────────────────
    // 7. Add channel
    // ──────────────────────────────────────────────────
    it('clicking Add Channel adds a new row', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'My Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        const textList = screen.getByTestId('text-channels-list');
        const initialCount = textList.querySelectorAll('.wizard-channel-row').length;

        await act(async () => {
            fireEvent.click(screen.getByTestId('add-text-channel-btn'));
        });

        const newCount = textList.querySelectorAll('.wizard-channel-row').length;
        expect(newCount).toBe(initialCount + 1);
    });

    // ──────────────────────────────────────────────────
    // 8. Remove channel
    // ──────────────────────────────────────────────────
    it('clicking delete removes a channel', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'My Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        const textList = screen.getByTestId('text-channels-list');
        const initialCount = textList.querySelectorAll('.wizard-channel-row').length;

        // Click the first delete button
        const deleteBtn = textList.querySelector('.channel-delete') as HTMLElement;
        expect(deleteBtn).toBeTruthy();
        await act(async () => {
            fireEvent.click(deleteBtn);
        });

        const newCount = textList.querySelectorAll('.wizard-channel-row').length;
        expect(newCount).toBe(initialCount - 1);
    });

    // ──────────────────────────────────────────────────
    // 9. Min channel validation
    // ──────────────────────────────────────────────────
    it('shows error when all text channels are removed', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        // Advance to channels step
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'My Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Remove all text channels
        const textList = screen.getByTestId('text-channels-list');
        const deleteBtns = textList.querySelectorAll('.channel-delete');
        for (const btn of Array.from(deleteBtns)) {
            await act(async () => {
                fireEvent.click(btn);
            });
        }

        // Try to advance
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        expect(screen.getByTestId('wizard-error')).toBeTruthy();
        expect(screen.getByText(/At least one text channel is required/)).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 10. Confirmation summary
    // ──────────────────────────────────────────────────
    it('confirmation step shows summary of configured values', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        // Step 1: Name
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'My Test Guild' } });
        });
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-desc-input'), { target: { value: 'A test description' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Step 2: Channels (keep defaults), advance
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Should be on confirm step
        expect(screen.getByText('🎉 Ready to Create!')).toBeTruthy();
        expect(screen.getByTestId('confirm-guild-name').textContent).toBe('My Test Guild');
        expect(screen.getByTestId('confirm-owner').textContent).toBe('user@example.com');

        // Channel list should contain default channels
        const channelList = screen.getByTestId('confirm-channels');
        expect(channelList.textContent).toContain('general');
        expect(channelList.textContent).toContain('announcements');
        expect(channelList.textContent).toContain('General');
    });

    // ──────────────────────────────────────────────────
    // 11. Owner step visibility
    // ──────────────────────────────────────────────────
    it('operator sees the owner step, non-operator skips it', async () => {
        // Operator path
        useAppStore.setState({ currentAccount: mockOperatorAccount });
        const { unmount } = await renderWizard();

        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'Op Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        expect(screen.getByText('👑 Guild Ownership')).toBeTruthy();
        unmount();

        // Non-operator path
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'User Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Should skip to channels
        expect(screen.queryByText('👑 Guild Ownership')).toBeNull();
        expect(screen.getByText('📝 Set Up Channels')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 12. Create API call — correct payload
    // ──────────────────────────────────────────────────
    it('sends correct API payload on Create Guild', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard({ provisionCode: 'PROV-123' });

        // Step 1: Name
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'API Test Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Step 2: Channels (defaults)
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Step 3: Confirm — click Create
        expect(screen.getByText('🎉 Ready to Create!')).toBeTruthy();
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-create-btn'));
        });

        await waitFor(() => {
            expect(mockApiFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/guilds',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test-token-2',
                    }),
                })
            );
        });

        // Verify payload
        const callArgs = mockApiFetch.mock.calls.find(
            (c: any[]) => c[0] === 'http://localhost:3001/api/guilds'
        );
        expect(callArgs).toBeTruthy();
        const payload = JSON.parse(callArgs![1].body);
        expect(payload.name).toBe('API Test Guild');
        expect(payload.provisionCode).toBe('PROV-123');
        expect(payload.channels.text).toEqual(['general', 'announcements']);
        expect(payload.channels.voice).toEqual(['General']);

        // Should close wizard on success
        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });

        // Should refresh guild list
        expect(fetchGuilds).toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────
    // 13. Error display — API error
    // ──────────────────────────────────────────────────
    it('shows error when API returns failure', async () => {
        mockApiFetch.mockResolvedValueOnce({
            ok: false,
            status: 409,
            json: () => Promise.resolve({ error: 'Guild name already exists' }),
        });

        useAppStore.setState({ currentAccount: mockRegularAccount });
        await renderWizard();

        // Navigate to confirm step
        await act(async () => {
            fireEvent.change(screen.getByTestId('guild-name-input'), { target: { value: 'Dupe Guild' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-next-btn'));
        });

        // Click Create
        await act(async () => {
            fireEvent.click(screen.getByTestId('wizard-create-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('wizard-error')).toBeTruthy();
            expect(screen.getByText('Guild name already exists')).toBeTruthy();
        });

        // Wizard should NOT close
        expect(onClose).not.toHaveBeenCalled();
    });
});
