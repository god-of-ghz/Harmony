import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { deriveAuthKeys, generateIdentity, exportPublicKey, encryptPrivateKey } from '../utils/crypto';
import { apiFetch } from '../utils/apiFetch';

interface ChangePasswordModalProps {
    /** The account's email (used to fetch the auth salt) */
    email: string;
    /** The primary server URL to send the change request to */
    serverUrl: string;
    /** Bearer token for the authenticated request */
    token: string;
    /** Called when the password change succeeds */
    onSuccess: () => void;
    /** Called when the user cancels */
    onCancel: () => void;
}

/**
 * A reusable floating modal for changing a user's password.
 * - Verifies the current password against the server before submitting
 * - Derives auth keys client-side (PBKDF2) before sending
 * - Re-generates the identity keypair and re-encrypts it with the new password
 * - Sends: oldServerAuthKey, serverAuthKey (new), public_key, encrypted_private_key,
 *   key_salt, key_iv to PUT /api/accounts/password
 *
 * Built on the same overlay style as FloatingInput.
 */
export const ChangePasswordModal = ({
    email,
    serverUrl,
    token,
    onSuccess,
    onCancel,
}: ChangePasswordModalProps) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const currentRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        currentRef.current?.focus();
    }, []);

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onCancel]);

    // Password strength
    const getStrength = (pw: string): { label: string; color: string; width: string } => {
        if (!pw) return { label: '', color: 'transparent', width: '0%' };
        if (pw.length < 8) return { label: 'Too short', color: '#ed4245', width: '20%' };
        const hasUpper = /[A-Z]/.test(pw);
        const hasDigit = /\d/.test(pw);
        const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
        const score = [hasUpper, hasDigit, hasSpecial, pw.length >= 12].filter(Boolean).length;
        if (score <= 1) return { label: 'Weak', color: '#faa61a', width: '35%' };
        if (score === 2) return { label: 'Fair', color: '#f0b232', width: '55%' };
        if (score === 3) return { label: 'Good', color: '#57F287', width: '75%' };
        return { label: 'Strong', color: '#23a559', width: '100%' };
    };

    const strength = getStrength(newPassword);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword.length < 8) {
            setError('New password must be at least 8 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }
        if (currentPassword === newPassword) {
            setError('New password must be different from your current password.');
            return;
        }

        setLoading(true);

        try {
            // 1. Fetch the auth salt (needed to derive both old and new keys)
            const saltRes = await fetch(`${serverUrl}/api/accounts/salt?email=${encodeURIComponent(email)}`);
            if (!saltRes.ok) {
                setError('Failed to retrieve account data. Is the primary server reachable?');
                return;
            }
            const { salt } = await saltRes.json();

            // 2. Derive the old serverAuthKey from the current password
            const { serverAuthKey: oldServerAuthKey } = await deriveAuthKeys(currentPassword, salt);

            // 3. Derive the new serverAuthKey and clientWrapKey from the new password
            //    (we reuse the same salt — the server will create a fresh scrypt salt on its end)
            const { serverAuthKey: newServerAuthKey, clientWrapKey } = await deriveAuthKeys(newPassword, salt);

            // 4. Generate a fresh identity keypair and encrypt the private key with new wrap key
            const { publicKey, privateKey } = await generateIdentity();
            const pubKeyStr = await exportPublicKey(publicKey);
            const { encryptedKey, iv } = await encryptPrivateKey(privateKey, clientWrapKey);

            // 5. Send the authenticated password change request
            const res = await apiFetch(`${serverUrl}/api/accounts/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    oldServerAuthKey,
                    serverAuthKey: newServerAuthKey,
                    public_key: pubKeyStr,
                    encrypted_private_key: encryptedKey,
                    key_salt: salt,
                    key_iv: iv,
                }),
            });

            if (res.ok) {
                setSuccess(true);
                setTimeout(onSuccess, 1200);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to change password. Please try again.');
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    }, [currentPassword, newPassword, confirmPassword, email, serverUrl, token, onSuccess]);

    return (
        <div
            data-testid="change-password-overlay"
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            style={{
                position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 10001, animation: 'fadeIn 0.15s ease-out',
            }}
        >
            <div
                className="glass-panel"
                style={{
                    padding: '32px 36px', borderRadius: '12px', width: '440px',
                    color: 'var(--text-normal)', boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '8px',
                        backgroundColor: 'rgba(88, 101, 242, 0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <Lock size={18} color="var(--brand-experiment)" />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: 'var(--text-focus)' }}>
                        Change Password
                    </h3>
                </div>
                <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    Enter your current password and choose a new one. Your account security keys will be re-generated automatically.
                </p>

                {/* Success state */}
                {success && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px', borderRadius: '6px',
                        backgroundColor: 'rgba(87, 242, 135, 0.12)',
                        border: '1px solid rgba(87, 242, 135, 0.4)',
                        color: '#57F287', marginBottom: '16px',
                    }}>
                        <ShieldCheck size={18} />
                        <span style={{ fontSize: '14px', fontWeight: '500' }}>Password changed successfully!</span>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div style={{
                        color: '#ed4245', marginBottom: '14px', fontSize: '13px',
                        padding: '8px 10px', backgroundColor: 'rgba(237, 66, 69, 0.1)',
                        border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px',
                    }}>
                        {error}
                    </div>
                )}

                {!success && (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Current Password */}
                        <PasswordField
                            id="current-password"
                            label="Current Password"
                            value={currentPassword}
                            onChange={setCurrentPassword}
                            show={showPasswords}
                            onToggleShow={() => setShowPasswords(s => !s)}
                            inputRef={currentRef}
                            disabled={loading}
                            testId="change-password-current"
                        />

                        <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />

                        {/* New Password */}
                        <PasswordField
                            id="new-password"
                            label="New Password"
                            value={newPassword}
                            onChange={setNewPassword}
                            show={showPasswords}
                            onToggleShow={() => setShowPasswords(s => !s)}
                            disabled={loading}
                            testId="change-password-new"
                        />

                        {/* Strength bar */}
                        {newPassword && (
                            <div style={{ marginTop: '-6px' }}>
                                <div style={{
                                    height: '3px', backgroundColor: 'var(--bg-tertiary)',
                                    borderRadius: '2px', overflow: 'hidden',
                                }}>
                                    <div style={{
                                        height: '100%', width: strength.width,
                                        backgroundColor: strength.color,
                                        transition: 'width 0.3s ease, background-color 0.3s ease',
                                    }} />
                                </div>
                                {strength.label && (
                                    <div style={{ fontSize: '11px', color: strength.color, marginTop: '2px' }}>
                                        {strength.label}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Confirm Password */}
                        <PasswordField
                            id="confirm-password"
                            label="Confirm New Password"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            show={showPasswords}
                            onToggleShow={() => setShowPasswords(s => !s)}
                            disabled={loading}
                            testId="change-password-confirm"
                        />

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button
                                type="button"
                                onClick={onCancel}
                                disabled={loading}
                                style={{
                                    flex: 1, padding: '10px',
                                    border: '1px solid var(--background-modifier-accent)',
                                    backgroundColor: 'transparent', color: 'var(--text-normal)',
                                    cursor: 'pointer', borderRadius: '4px', fontWeight: '500', fontSize: '14px',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn"
                                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                                style={{
                                    flex: 2, padding: '10px', fontWeight: 'bold', fontSize: '14px',
                                    opacity: (loading || !currentPassword || !newPassword || !confirmPassword) ? 0.6 : 1,
                                }}
                            >
                                {loading ? 'Changing...' : 'Change Password'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

// ─── Sub-component: individual password field ─────────────────────────────────

interface PasswordFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    show: boolean;
    onToggleShow: () => void;
    disabled?: boolean;
    inputRef?: React.RefObject<HTMLInputElement | null>;
    testId?: string;
}

const PasswordField = ({ id, label, value, onChange, show, onToggleShow, disabled, inputRef, testId }: PasswordFieldProps) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label
            htmlFor={id}
            style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}
        >
            {label}
        </label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
                id={id}
                ref={inputRef as any}
                data-testid={testId}
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required
                disabled={disabled}
                style={{
                    flex: 1, padding: '10px 40px 10px 12px',
                    borderRadius: '4px', border: 'none',
                    backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                    fontSize: '15px', outline: 'none',
                    opacity: disabled ? 0.6 : 1,
                }}
            />
            <button
                type="button"
                onClick={onToggleShow}
                tabIndex={-1}
                style={{
                    position: 'absolute', right: '10px',
                    background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--text-muted)',
                    display: 'flex', padding: '0',
                }}
            >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </div>
);
