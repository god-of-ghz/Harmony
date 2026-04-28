import { useState, useEffect } from 'react';
import { useAppStore, type Profile, type ConnectedServer } from '../store/appStore';
import { Eye, EyeOff } from 'lucide-react';
import { generateSalt, deriveAuthKeys, generateIdentity, exportPublicKey, encryptPrivateKey, decryptPrivateKey } from '../utils/crypto';
import { saveSessionKey, loadSessionKey } from '../utils/keyStore';
import { pingServerHealth } from '../utils/slaTracker';

export const LoginSignup = () => {
    const [mode, setMode] = useState<'login' | 'signup' | 'change-password'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [oldPassword, setOldPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [ownerExists, setOwnerExists] = useState(true);
    const [shouldClaimOwnership, setShouldClaimOwnership] = useState(false);

    const { setCurrentAccount, setConnectedServers, setIsGuestSession, setSessionPrivateKey, setProfilesLoaded, setDismissedGlobalClaim } = useAppStore();
    // TODO [VISION:V1] The client connects to initialServerUrl without verifying the
    // server's cryptographic identity. V1 should fetch /api/federation/key on first
    // contact, compute the Ed25519 fingerprint, display it to the user (TOFU prompt),
    // and pin it for all future connections. Without this, a DNS hijack or MITM could
    // redirect the user to an impostor server and steal credentials.
    // This is a V1 feature — do NOT attempt during alpha stabilization.
    const [initialServerUrl, setInitialServerUrl] = useState(
        localStorage.getItem('harmony_last_server_url') || 'http://localhost:3001'
    );
    const [serverHealth, setServerHealth] = useState<'pending' | 'online' | 'offline'>('pending');

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

    const fetchAllProfiles = async (accountId: string, serverUrls: string[], token?: string): Promise<void> => {
        const results = await Promise.all(
            serverUrls.map(async (url) => {
                try {
                    const res = await fetch(`${url}/api/accounts/${accountId}/profiles`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const profiles = (await res.json()) as Profile[];
                        return profiles;
                    }
                } catch (err) {
                    console.error(`Failed to fetch profiles from ${url}:`, err);
                }
                return [] as Profile[];
            })
        );
        const byId = new Map<string, Profile>();
        for (const batch of results) {
            for (const profile of batch) {
                const key = `${profile.id}:${profile.server_id}`;
                if (!byId.has(key)) {
                    byId.set(key, profile);
                }
            }
        }
        const newProfiles = Array.from(byId.values());
        // Merge with existing profiles instead of replacing, to avoid race
        // conditions with GuildSidebar's fetchGuilds which also populates this.
        useAppStore.setState((state) => {
            const combined = [...state.claimedProfiles, ...newProfiles];
            const unique = Array.from(new Map(combined.map(p => [`${p.id}:${p.server_id}`, p])).values());
            return { claimedProfiles: unique };
        });
    };

    // Auto-login: validate stored session via GET /api/accounts/:id/state
    useEffect(() => {
        const sessionStr = localStorage.getItem('harmony_session');
        if (!sessionStr) return;

        try {
            const session = JSON.parse(sessionStr);
            const { serverUrl, accountId, token } = session;
            if (!serverUrl || !accountId || !token) {
                localStorage.removeItem('harmony_session');
                return;
            }

            (async () => {
                try {
                    const res = await fetch(`${serverUrl}/api/accounts/${accountId}/state`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!res.ok) {
                        // Token is invalid — clear stale session and bail
                        console.warn('[Auto-Login] Cached session is invalid (server returned', res.status, '), clearing session.');
                        localStorage.removeItem('harmony_session');
                        return;
                    }

                    const stateData = await res.json();

                    // Session is valid — restore it
                    const servers: ConnectedServer[] = stateData.servers || [];
                    setConnectedServers(servers);
                    setDismissedGlobalClaim(!!stateData.dismissed_global_claim);
                    setIsGuestSession(false);

                    // Restore the session private key from IndexedDB
                    loadSessionKey().then(key => {
                        if (key) setSessionPrivateKey(key);
                    }).catch(console.error);

                    // Fetch profiles from all connected servers
                    const allServerUrls = Array.from(new Set([serverUrl, ...servers.map(s => s.url)]));
                    await fetchAllProfiles(accountId, allServerUrls, token);
                    setProfilesLoaded(true);

                    // Fetch global profile (display_name, avatar) so UserPanel shows correct identity
                    try {
                        const globalRes = await fetch(`${serverUrl}/api/federation/profile/${accountId}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (globalRes.ok) {
                            const globalProfile = await globalRes.json();
                            useAppStore.getState().updateGlobalProfile(globalProfile);
                        }
                    } catch (gpErr) {
                        console.error('Failed to fetch global profile on auto-login:', gpErr);
                    }

                    setCurrentAccount({
                        id: accountId,
                        email: '', // Will be populated from server if needed
                        is_creator: false,
                        token,
                        authority_role: stateData.authority_role,
                        primary_server_url: stateData.primary_server_url,
                        dismissed_global_claim: !!stateData.dismissed_global_claim,
                    });
                } catch (err) {
                    // Server unreachable — show login form with message
                    console.warn('[Auto-Login] Server unreachable, clearing cached session.');
                    localStorage.removeItem('harmony_session');
                    setError('Server unreachable. Please log in again.');
                }
            })();
        } catch (e) {
            localStorage.removeItem('harmony_session');
        }
    }, []);

    useEffect(() => {
        fetchOwnerStatus(initialServerUrl);
        
        let isCancelled = false;
        const checkHealth = async () => {
            setServerHealth('pending');
            const isOnline = await pingServerHealth(initialServerUrl);
            if (!isCancelled) {
                setServerHealth(isOnline ? 'online' : 'offline');
            }
        };
        checkHealth();
        return () => { isCancelled = true; };
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
            if (currentPass.length < 8) {
                setError('Password must be at least 8 characters.');
                return;
            }
        }

        if (mode === 'change-password') {
            if (!oldPassword) {
                setError('Please enter your current password.');
                return;
            }
            try {
                const saltRes = await fetch(`${initialServerUrl}/api/accounts/salt?email=${encodeURIComponent(currentEmail)}`);
                if (!saltRes.ok) {
                    const saltData = await saltRes.json();
                    setError(saltData.error || 'Failed to retrieve account salt. Ensure this email is registered.');
                    return;
                }
                const { salt } = await saltRes.json();

                // Derive the old key from the CURRENT password for server-side verification
                const { serverAuthKey: oldServerAuthKey } = await deriveAuthKeys(oldPassword, salt);

                // Derive the new key from the NEW password
                const { serverAuthKey: newServerAuthKey, clientWrapKey } = await deriveAuthKeys(currentPass, salt);

                // Re-generate identity keypair encrypted with new wrap key
                const { publicKey, privateKey } = await generateIdentity();
                const pubKeyStr = await exportPublicKey(publicKey);
                const { encryptedKey, iv } = await encryptPrivateKey(privateKey, clientWrapKey);

                // This endpoint now requires authentication; for the pre-login flow we
                // don't have a token. The server validates via oldServerAuthKey instead.
                // We POST to the public-facing change endpoint that accepts email + both keys.
                const res = await fetch(`${initialServerUrl}/api/accounts/password/unauthenticated`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: currentEmail,
                        oldServerAuthKey,
                        serverAuthKey: newServerAuthKey,
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
                    setOldPassword('');
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
            let salt: string;
            if (mode === 'signup') {
                salt = await generateSalt(16);
            } else {
                const saltRes = await fetch(`${initialServerUrl}/api/accounts/salt?email=${encodeURIComponent(currentEmail)}`);
                if (!saltRes.ok) {
                    const saltData = await saltRes.json();
                    setError(saltData.error || 'Invalid credentials');
                    return;
                }
                const saltData = await saltRes.json();
                salt = saltData.salt;
            }

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
                payload.auth_salt = salt;

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

                // Populate connectedServers from the login response's servers array
                const responseServers: ConnectedServer[] = data.servers || [];
                // On signup, include the initial server URL as a trusted connected server
                if (mode === 'signup') {
                    const alreadyIncluded = responseServers.some(s => s.url === initialServerUrl);
                    if (!alreadyIncluded) {
                        responseServers.push({ url: initialServerUrl, trust_level: 'trusted', status: 'active' });
                    }
                }
                setConnectedServers(responseServers);

                // Set dismissed_global_claim from server response
                if (data.dismissed_global_claim !== undefined) {
                    setDismissedGlobalClaim(!!data.dismissed_global_claim);
                }

                // Store session and last server URL
                if (rememberMe) {
                    // TODO [VISION:Mobile] Storing the JWT in localStorage is acceptable for
                    // Electron (desktop). When the React Native mobile client is built, use
                    // iOS Keychain / Android Keystore instead. See HARMONY_VISION.md.
                    localStorage.setItem('harmony_session', JSON.stringify({
                        serverUrl: initialServerUrl,
                        accountId: data.id,
                        token: data.token,
                    }));
                }
                localStorage.setItem('harmony_last_server_url', initialServerUrl);

                setIsGuestSession(false);

                // Fetch profiles from all connected server URLs
                const allServerUrls = Array.from(new Set([initialServerUrl, ...responseServers.map(s => s.url)]));
                await fetchAllProfiles(data.id, allServerUrls, data.token);
                setProfilesLoaded(true);

                // Fetch global profile (display_name, avatar) so UserPanel shows correct identity
                try {
                    const globalRes = await fetch(`${initialServerUrl}/api/federation/profile/${data.id}`, {
                        headers: { 'Authorization': `Bearer ${data.token}` }
                    });
                    if (globalRes.ok) {
                        const globalProfile = await globalRes.json();
                        useAppStore.getState().updateGlobalProfile(globalProfile);
                    }
                } catch (gpErr) {
                    console.error('Failed to fetch global profile:', gpErr);
                }

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
                setConnectedServers([{ url: initialServerUrl, trust_level: 'trusted', status: 'active' }]);
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

                {mode === 'change-password' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label htmlFor="oldPassword" style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                            Current Password
                        </label>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                                id="oldPassword"
                                type={showPassword ? "text" : "password"}
                                value={oldPassword}
                                onChange={e => setOldPassword(e.target.value)}
                                required
                                placeholder="Your existing password"
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
                            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccessMessage(''); setPassword(''); setConfirmPassword(''); setOldPassword(''); }}
                        >
                            {mode === 'login' ? 'Register' : 'Login'}
                        </span>
                    </div>
                    {mode === 'login' && (
                        <div>
                            <span
                                style={{ color: 'var(--text-link)', cursor: 'pointer' }}
                                onClick={() => { setMode('change-password'); setError(''); setSuccessMessage(''); setPassword(''); setConfirmPassword(''); setOldPassword(''); }}
                            >
                                Forgot / Change Password?
                            </span>
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '16px', borderTop: '1px solid var(--background-modifier-accent)', paddingTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <label htmlFor="initialServerUrl" style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Initial Network Server URL</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                {serverHealth === 'pending' ? 'Pinging...' : serverHealth === 'online' ? 'Online' : 'Offline'}
                            </span>
                            <div className={`status-indicator ${serverHealth}`} style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                backgroundColor: serverHealth === 'pending' ? 'var(--text-muted)' : serverHealth === 'online' ? '#57F287' : '#ed4245',
                            }} />
                        </div>
                    </div>
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
