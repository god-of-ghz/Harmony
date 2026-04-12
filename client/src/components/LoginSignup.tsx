import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { Eye, EyeOff } from 'lucide-react';
import { getDeterministicSalt, deriveAuthKeys, generateIdentity, exportPublicKey, encryptPrivateKey, decryptPrivateKey } from '../utils/crypto';
import { saveSessionKey, loadSessionKey } from '../utils/keyStore';

export const LoginSignup = () => {
    const [mode, setMode] = useState<'login' | 'signup' | 'change-password'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [ownerExists, setOwnerExists] = useState(true);
    const [shouldClaimOwnership, setShouldClaimOwnership] = useState(false);

    const { setCurrentAccount, setClaimedProfiles, knownServers, addKnownServer, setTrustedServers, setIsGuestSession, setSessionPrivateKey } = useAppStore();
    const [initialServerUrl, setInitialServerUrl] = useState(knownServers[0] || 'http://localhost:3001');

    const fetchOwnerStatus = async (baseUrl: string) => {
        try {
            const res = await fetch(`${baseUrl}/api/accounts/owner-exists`);
            if (res.ok) {
                const data = await res.json();
                setOwnerExists(data.exists);
                if (!data.exists) {
                    setShouldClaimOwnership(true);
                }
            }
        } catch (err) {
            console.error(err);
        }
    };

    const fetchProfiles = async (accountId: string, baseUrl: string, token?: string) => {
        try {
            const res = await fetch(`${baseUrl}/api/accounts/${accountId}/profiles`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const profiles = await res.json();
                setClaimedProfiles(profiles);
            }
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        const cached = localStorage.getItem('harmony_account');
        if (cached) {
            try {
                const account = JSON.parse(cached);
                setIsGuestSession(account.isGuest || false);
                setTrustedServers(account.trusted_servers || []);
                // Restore the session private key from IndexedDB
                loadSessionKey().then(key => {
                    if (key) setSessionPrivateKey(key);
                }).catch(console.error);
                // Wait for sidebar to fetch profiles from all servers
                setCurrentAccount(account);
            } catch (e) { }
        }
    }, []);

    useEffect(() => {
        fetchOwnerStatus(initialServerUrl);
    }, [initialServerUrl]);

    // Developer Auto-Login support via environment variables
    useEffect(() => {
        const env = (window as any).process?.env;
        if (env) {
            const autoEmail = env.HARMONY_AUTO_EMAIL;
            const autoPass = env.HARMONY_AUTO_PASS;
            const autoServer = env.HARMONY_AUTO_SERVER;
            
            if (autoEmail && autoPass) {
                setEmail(autoEmail);
                setPassword(autoPass);
                if (autoServer) setInitialServerUrl(autoServer);
                
                // Trigger login automatically by passing values directly
                // (Avoids race condition with async state updates)
                const timer = setTimeout(() => {
                    handleSubmit(undefined, autoEmail, autoPass);
                }, 500);
                return () => clearTimeout(timer);
            }
        }
    }, []);

    const handleSubmit = async (e?: React.FormEvent, overrideEmail?: string, overridePass?: string) => {
        if (e) e.preventDefault();
        setError('');
        setSuccessMessage('');

        const currentEmail = overrideEmail || email;
        const currentPass = overridePass || password;

        if (mode === 'signup' || mode === 'change-password') {
            if (currentPass !== confirmPassword) {
                setError('Passwords do not match.');
                return;
            }
        }

        if (mode === 'change-password') {
            try {
                const salt = await getDeterministicSalt(currentEmail);
                const { serverAuthKey, clientWrapKey } = await deriveAuthKeys(currentPass, salt);
                const { publicKey, privateKey } = await generateIdentity();
                const pubKeyStr = await exportPublicKey(publicKey);
                const { encryptedKey, iv } = await encryptPrivateKey(privateKey, clientWrapKey);

                const res = await fetch(`${initialServerUrl}/api/accounts/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: currentEmail,
                        serverAuthKey,
                        public_key: pubKeyStr,
                        encrypted_private_key: encryptedKey,
                        key_salt: salt,
                        key_iv: iv
                    })
                });
                const data = await res.json();
                if (res.ok) {
                    setSuccessMessage('Password updated successfully! You can now login.');
                    setPassword('');
                    setConfirmPassword('');
                    setMode('login');
                } else {
                    setError(data.error || 'Failed to update password');
                }
            } catch (err: any) {
                setError(err.message);
            }
            return;
        }

        const endpoint = mode === 'login' ? '/api/accounts/login' : '/api/accounts/signup';

        try {
            const salt = await getDeterministicSalt(currentEmail);
            const { serverAuthKey, clientWrapKey } = await deriveAuthKeys(currentPass, salt);

            let payload: any = { email: currentEmail, serverAuthKey };

            if (mode === 'signup' && !ownerExists) {
                payload.claimOwnership = shouldClaimOwnership;
            }

            let tempPrivateKey: CryptoKey | null = null;

            if (mode === 'signup') {
                const { publicKey, privateKey } = await generateIdentity();
                const pubKeyStr = await exportPublicKey(publicKey);
                const { encryptedKey, iv } = await encryptPrivateKey(privateKey, clientWrapKey);

                payload.public_key = pubKeyStr;
                payload.encrypted_private_key = encryptedKey;
                payload.key_salt = salt;
                payload.key_iv = iv;

                tempPrivateKey = privateKey;
            } else {
                payload.initialServerUrl = initialServerUrl;
            }

            const res = await fetch(`${initialServerUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (res.ok) {
                if (mode === 'login' && data.encrypted_private_key && data.key_iv) {
                    try {
                        const privateKey = await decryptPrivateKey(data.encrypted_private_key, data.key_iv, clientWrapKey);
                        tempPrivateKey = privateKey;
                    } catch (decryptErr) {
                        setError("Failed to unlock local identity key. Invalid password?");
                        return;
                    }
                }

                if (tempPrivateKey) {
                    setSessionPrivateKey(tempPrivateKey);
                    saveSessionKey(tempPrivateKey).catch(console.error);
                }

                if (rememberMe) {
                    localStorage.setItem('harmony_account', JSON.stringify(data));
                }
                setTrustedServers(data.trusted_servers || []);
                addKnownServer(initialServerUrl);
                setIsGuestSession(false);
                await fetchProfiles(data.id, initialServerUrl, data.token);
                setCurrentAccount(data);
            } else {
                setError(data.error || 'An error occurred');
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleGuestLogin = async () => {
        try {
            const res = await fetch(`${initialServerUrl}/api/guest/login`, {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok) {
                setIsGuestSession(true);
                addKnownServer(initialServerUrl);
                setCurrentAccount(data);
            } else {
                setError(data.error || 'Failed to login as guest');
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh',
            backgroundColor: 'var(--bg-primary)', color: 'var(--text-normal)'
        }}>
            <form onSubmit={handleSubmit} style={{
                backgroundColor: 'var(--bg-secondary)', padding: '32px', borderRadius: '8px',
                width: '400px', display: 'flex', flexDirection: 'column', gap: '16px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
            }}>
                <h2 style={{ textAlign: 'center', color: 'var(--text-focus)', margin: 0 }}>
                    {mode === 'login' ? 'Welcome back!' : mode === 'signup' ? 'Create an Account' : 'Change Password'}
                </h2>
                {error && <div style={{ color: '#ed4245', textAlign: 'center' }}>{error}</div>}
                {successMessage && <div style={{ color: '#57F287', textAlign: 'center' }}>{successMessage}</div>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label htmlFor="email" style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Email</label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        style={{
                            backgroundColor: 'var(--bg-tertiary)', border: 'none', borderRadius: '3px',
                            color: 'var(--text-normal)', padding: '10px', fontSize: '16px', outline: 'none'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label htmlFor="password" style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        {mode === 'change-password' ? 'New Password' : 'Password'}
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            style={{
                                flex: 1, backgroundColor: 'var(--bg-tertiary)', border: 'none', borderRadius: '3px',
                                color: 'var(--text-normal)', padding: '10px', fontSize: '16px', outline: 'none', paddingRight: '40px'
                            }}
                        />
                        <div
                            style={{ position: 'absolute', right: '10px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                            onClick={() => setShowPassword(!showPassword)}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </div>
                    </div>
                </div>

                {(mode === 'signup' || mode === 'change-password') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label htmlFor="confirmPassword" style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                            Confirm {mode === 'change-password' ? 'New Password' : 'Password'}
                        </label>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                                id="confirmPassword"
                                type={showPassword ? "text" : "password"}
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                style={{
                                    flex: 1, backgroundColor: 'var(--bg-tertiary)', border: 'none', borderRadius: '3px',
                                    color: 'var(--text-normal)', padding: '10px', fontSize: '16px', outline: 'none', paddingRight: '40px'
                                }}
                            />
                            <div
                                style={{ position: 'absolute', right: '10px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                                onClick={() => setShowPassword(!showPassword)}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'login' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            id="rememberMe"
                            checked={rememberMe}
                            onChange={e => setRememberMe(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="rememberMe" style={{ fontSize: '14px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            Remember me
                        </label>
                    </div>
                )}

                {mode === 'signup' && !ownerExists && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            id="claimOwnership"
                            checked={shouldClaimOwnership}
                            onChange={e => setShouldClaimOwnership(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="claimOwnership" style={{ fontSize: '14px', color: 'var(--text-focus)', cursor: 'pointer', fontWeight: 'bold' }}>
                            Claim Server Ownership (Creator)
                        </label>
                    </div>
                )}

                <button type="submit" style={{
                    backgroundColor: 'var(--brand-experiment)', color: 'white', border: 'none',
                    borderRadius: '3px', padding: '10px', fontSize: '16px', fontWeight: 'bold',
                    cursor: 'pointer', marginTop: '8px', transition: 'background-color 0.2s'
                }}>
                    {mode === 'login' ? 'Login' : mode === 'signup' ? 'Signup' : 'Change Password'}
                </button>

                <div style={{ fontSize: '14px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>
                            {mode === 'login' ? 'Need an account? ' : 'Already have an account? '}
                        </span>
                        <span
                            style={{ color: 'var(--text-link)', cursor: 'pointer' }}
                            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccessMessage(''); setPassword(''); setConfirmPassword(''); }}
                        >
                            {mode === 'login' ? 'Register' : 'Login'}
                        </span>
                    </div>
                    {mode === 'login' && (
                        <div>
                            <span
                                style={{ color: 'var(--text-link)', cursor: 'pointer' }}
                                onClick={() => { setMode('change-password'); setError(''); setSuccessMessage(''); setPassword(''); setConfirmPassword(''); }}
                            >
                                Forgot / Change Password?
                            </span>
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '16px', borderTop: '1px solid var(--background-modifier-accent)', paddingTop: '16px' }}>
                    <label htmlFor="initialServerUrl" style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Initial Network Server URL</label>
                    <input
                        id="initialServerUrl"
                        type="text"
                        value={initialServerUrl}
                        onChange={e => setInitialServerUrl(e.target.value)}
                        placeholder="http://localhost:3001 or https://example.com"
                        style={{
                            width: '100%', backgroundColor: 'var(--bg-tertiary)', border: 'none', borderRadius: '3px',
                            color: 'var(--text-normal)', padding: '8px', fontSize: '12px', outline: 'none', marginTop: '4px',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '16px' }}>
                    <div style={{ height: '1px', backgroundColor: 'var(--background-modifier-accent)', flex: 1 }}></div>
                    <span style={{ padding: '0 10px', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold' }}>OR USE STANDALONE</span>
                    <div style={{ height: '1px', backgroundColor: 'var(--background-modifier-accent)', flex: 1 }}></div>
                </div>

                <button
                    type="button"
                    onClick={handleGuestLogin}
                    className="btn"
                    style={{ backgroundColor: 'var(--background-modifier-accent)', color: 'var(--text-normal)', border: 'none', borderRadius: '3px', padding: '10px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s' }}
                >
                    Continue as Guest
                </button>
            </form>
            <div style={{ position: 'absolute', bottom: '24px', textAlign: 'center' }}>
                <button type="button" onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: '12px' }}>
                    Clear Local Cache & Reset Client
                </button>
            </div>
        </div>
    );
};
