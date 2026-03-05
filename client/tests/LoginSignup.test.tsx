/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginSignup } from '../src/components/LoginSignup';
import { useAppStore } from '../src/store/appStore';

global.fetch = vi.fn();

describe('LoginSignup Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({ currentAccount: null, claimedProfiles: [] });
    });

    it('renders login form by default', () => {
        render(<LoginSignup />);
        expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    });

    it('handles successful login without remembering', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'acc1', email: 'test@test.com' })
        }).mockResolvedValueOnce({
            ok: true,
            json: async () => ([])
        });

        render(<LoginSignup />);
        fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
        fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount?.email).toBe('test@test.com');
        });

        expect(localStorage.getItem('harmony_account')).toBeNull();
    });

    it('remembers user if checkbox is checked', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'acc2', email: 'rem@test.com' })
        }).mockResolvedValueOnce({
            ok: true,
            json: async () => ([])
        });

        render(<LoginSignup />);
        fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'rem@test.com' } });
        fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password' } });
        fireEvent.click(screen.getByLabelText(/Remember me/i));
        fireEvent.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(localStorage.getItem('harmony_account')).toContain('rem@test.com');
        });
    });

    it('auto-logins if valid local storage cache is present', async () => {
        localStorage.setItem('harmony_account', JSON.stringify({ id: 'acc3', email: 'auto@test.com' }));
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ([])
        });

        render(<LoginSignup />);

        await waitFor(() => {
            expect(useAppStore.getState().currentAccount?.email).toBe('auto@test.com');
        });
    });

    it('blocks signup if passwords do not match', async () => {
        render(<LoginSignup />);
        fireEvent.click(screen.getByText('Register')); // Switch to signup mode

        fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
        fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'password456' } });

        fireEvent.click(screen.getByRole('button', { name: 'Signup' }));

        expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('changes password successfully', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true })
        });

        render(<LoginSignup />);
        fireEvent.click(screen.getByText('Forgot / Change Password?')); // Switch to change password mode

        fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
        fireEvent.change(screen.getByLabelText(/^New Password$/i), { target: { value: 'newpass123' } });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), { target: { value: 'newpass123' } });

        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(await screen.findByText('Password updated successfully! You can now login.')).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/accounts/password', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ email: 'test@test.com', newPassword: 'newpass123' })
        }));
    });

    it('updates and persists the custom Network Server URL', () => {
        render(<LoginSignup />);
        const urlInput = screen.getByLabelText(/Network Server URL/i);

        fireEvent.change(urlInput, { target: { value: 'http://96.230.218.248:3001' } });

        expect(useAppStore.getState().serverUrl).toBe('http://96.230.218.248:3001');
        expect(localStorage.getItem('harmony_server_url')).toBe('http://96.230.218.248:3001');
    });
});
