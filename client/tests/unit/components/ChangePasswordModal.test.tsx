/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChangePasswordModal } from '../../../src/components/ChangePasswordModal';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock all crypto util functions — we test the component behavior, not the
// crypto implementation (which has its own unit tests).
vi.mock('../../../src/utils/crypto', () => ({
    deriveAuthKeys: vi.fn().mockResolvedValue({
        serverAuthKey: 'mock-server-auth-key',
        clientWrapKey: 'mock-client-wrap-key',
    }),
    generateIdentity: vi.fn().mockResolvedValue({
        publicKey: 'mock-public-key',
        privateKey: 'mock-private-key',
    }),
    exportPublicKey: vi.fn().mockResolvedValue('mock-exported-public-key'),
    encryptPrivateKey: vi.fn().mockResolvedValue({
        encryptedKey: 'mock-encrypted-key',
        iv: 'mock-iv',
    }),
}));

vi.mock('../../../src/utils/apiFetch', () => ({
    apiFetch: vi.fn(),
}));

global.fetch = vi.fn();

import { apiFetch } from '../../../src/utils/apiFetch';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps = {
    email: 'test@example.com',
    serverUrl: 'http://localhost:3001',
    token: 'test-jwt-token',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
};

function setup(props = defaultProps) {
    const user = userEvent.setup();
    const utils = render(<ChangePasswordModal {...props} />);
    return { user, ...utils };
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, current: string, newPw: string, confirm: string) {
    await user.type(screen.getByTestId('change-password-current'), current);
    await user.type(screen.getByTestId('change-password-new'), newPw);
    await user.type(screen.getByTestId('change-password-confirm'), confirm);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChangePasswordModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default: salt endpoint succeeds, change endpoint succeeds
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ salt: 'dGVzdHNhbHQ=' }),
        });
        (apiFetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
    });

    // ── Rendering ──────────────────────────────────────────────────────────────

    it('renders all three password fields', () => {
        setup();
        expect(screen.getByTestId('change-password-current')).toBeInTheDocument();
        expect(screen.getByTestId('change-password-new')).toBeInTheDocument();
        expect(screen.getByTestId('change-password-confirm')).toBeInTheDocument();
    });

    it('renders the "Change Password" submit button', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
    });

    it('renders the Cancel button', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('submit button is disabled when fields are empty', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Change Password' })).toBeDisabled();
    });

    // ── Escape key ─────────────────────────────────────────────────────────────

    it('calls onCancel when Escape key is pressed', async () => {
        const onCancel = vi.fn();
        setup({ ...defaultProps, onCancel });
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // ── Overlay click ──────────────────────────────────────────────────────────

    it('calls onCancel when clicking the overlay background', async () => {
        const onCancel = vi.fn();
        setup({ ...defaultProps, onCancel });
        const overlay = screen.getByTestId('change-password-overlay');
        await userEvent.click(overlay);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // ── Cancel button ──────────────────────────────────────────────────────────

    it('calls onCancel when Cancel button is clicked', async () => {
        const onCancel = vi.fn();
        const { user } = setup({ ...defaultProps, onCancel });
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // ── Validation: min length ─────────────────────────────────────────────────

    it('shows error when new password is shorter than 8 characters', async () => {
        const { user } = setup();
        await fillForm(user, 'correctcurrent', 'short', 'short');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));
        expect(await screen.findByText('New password must be at least 8 characters.')).toBeInTheDocument();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    // ── Validation: mismatch ───────────────────────────────────────────────────

    it('shows error when new and confirm passwords do not match', async () => {
        const { user } = setup();
        await fillForm(user, 'correctcurrent', 'newpassword123', 'differentpassword');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));
        expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    // ── Validation: same password ──────────────────────────────────────────────

    it('shows error when new password is the same as current password', async () => {
        const { user } = setup();
        await fillForm(user, 'samepassword123', 'samepassword123', 'samepassword123');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));
        expect(await screen.findByText('New password must be different from your current password.')).toBeInTheDocument();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    // ── Server error: wrong current password ───────────────────────────────────

    it('shows server error when current password is wrong (401)', async () => {
        (apiFetch as any).mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'Current password is incorrect' }),
        });

        const { user } = setup();
        await fillForm(user, 'wrongcurrent', 'newpassword123', 'newpassword123');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    });

    // ── Server error: salt fetch fails ─────────────────────────────────────────

    it('shows error when salt fetch fails (server unreachable)', async () => {
        (global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) });

        const { user } = setup();
        await fillForm(user, 'currentpass', 'newpassword123', 'newpassword123');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Failed to retrieve account data. Is the primary server reachable?')).toBeInTheDocument();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    // ── Success path ───────────────────────────────────────────────────────────

    it('shows success state and calls onSuccess after successful change', async () => {
        const onSuccess = vi.fn();
        // Use userEvent with delay:null to avoid timing issues with async crypto mocks
        const user = userEvent.setup({ delay: null });
        render(<ChangePasswordModal {...defaultProps} onSuccess={onSuccess} />);

        await user.type(screen.getByTestId('change-password-current'), 'currentpassword');
        await user.type(screen.getByTestId('change-password-new'), 'newpassword123');
        await user.type(screen.getByTestId('change-password-confirm'), 'newpassword123');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        // Success message should appear (apiFetch returns ok:true)
        await waitFor(() =>
            expect(screen.getByText('Password changed successfully!')).toBeInTheDocument(),
            { timeout: 10000 }
        );

        // onSuccess is wired to a 1200ms setTimeout — advance real timers
        // by waiting a bit for the real timer to fire
        await new Promise(resolve => setTimeout(resolve, 1300));
        expect(onSuccess).toHaveBeenCalledTimes(1);
    }, 15000);

    it('sends the correct payload to PUT /api/accounts/password', async () => {
        const user = userEvent.setup({ delay: null });
        render(<ChangePasswordModal {...defaultProps} />);

        await user.type(screen.getByTestId('change-password-current'), 'currentpassword');
        await user.type(screen.getByTestId('change-password-new'), 'newpassword123');
        await user.type(screen.getByTestId('change-password-confirm'), 'newpassword123');
        await user.click(screen.getByRole('button', { name: 'Change Password' }));

        await waitFor(() => {
            expect(apiFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/accounts/password',
                expect.objectContaining({
                    method: 'PUT',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-jwt-token',
                        'Content-Type': 'application/json',
                    }),
                    body: expect.stringContaining('oldServerAuthKey'),
                })
            );
        }, { timeout: 10000 });

        // Body should contain both old and new key fields
        const callArgs = (apiFetch as any).mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.oldServerAuthKey).toBeDefined();
        expect(body.serverAuthKey).toBeDefined();
        // Both keys are derived from the mocked deriveAuthKeys, so they're the same
        // mock value — what matters is they're both present in the request body
        expect(typeof body.oldServerAuthKey).toBe('string');
        expect(typeof body.serverAuthKey).toBe('string');
    });

    // ── Password strength indicator ────────────────────────────────────────────

    it('shows strength indicator when new password field has content', async () => {
        const { user } = setup();
        await user.type(screen.getByTestId('change-password-new'), 'abc');
        expect(await screen.findByText('Too short')).toBeInTheDocument();
    });

    it('shows Strong indicator for a complex password', async () => {
        const { user } = setup();
        await user.type(screen.getByTestId('change-password-new'), 'CorrectHorse#Battery99!');
        expect(await screen.findByText('Strong')).toBeInTheDocument();
    });
});
