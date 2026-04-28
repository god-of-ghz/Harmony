import { useState, useCallback } from 'react';
import { FloatingInput } from './FloatingInput';
import { deriveAuthKeys } from '../utils/crypto';

interface PasswordChallengeProps {
    /** Title for the challenge modal */
    title?: string;
    /** Description text explaining why re-auth is needed */
    description?: string;
    /** The user's email (needed for salt lookup) */
    email: string;
    /** The server URL to fetch the salt from */
    serverUrl: string;
    /** Called with the derived serverAuthKey on success */
    onSuccess: (serverAuthKey: string) => void | Promise<void>;
    /** Called when the user cancels */
    onCancel: () => void;
}

/**
 * A reusable password re-authentication component.
 * Fetches the user's auth salt, derives serverAuthKey from the entered password,
 * and returns it via onSuccess. Built on FloatingInput.
 *
 * Use cases: promote server, change password (in-app), manage primary, etc.
 */
export const PasswordChallenge = ({
    title = 'Verify Your Identity',
    description = 'Please re-enter your password to continue with this sensitive action.',
    email,
    serverUrl,
    onSuccess,
    onCancel,
}: PasswordChallengeProps) => {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleConfirm = useCallback(async (password: string) => {
        setError('');
        setLoading(true);

        try {
            // Fetch the user's auth salt from their server
            const saltRes = await fetch(`${serverUrl}/api/accounts/salt?email=${encodeURIComponent(email)}`);
            if (!saltRes.ok) {
                setError('Failed to retrieve account salt. Server may be unreachable.');
                setLoading(false);
                return;
            }
            const { salt } = await saltRes.json();

            // Derive the serverAuthKey from the password
            const { serverAuthKey } = await deriveAuthKeys(password, salt);

            await onSuccess(serverAuthKey);
        } catch (err: any) {
            setError(err.message || 'Failed to verify password');
        } finally {
            setLoading(false);
        }
    }, [email, serverUrl, onSuccess]);

    return (
        <FloatingInput
            title={title}
            description={description}
            label="Password"
            type="password"
            placeholder="Enter your password"
            confirmText="Authenticate"
            onConfirm={handleConfirm}
            onCancel={onCancel}
            error={error}
            loading={loading}
        />
    );
};
