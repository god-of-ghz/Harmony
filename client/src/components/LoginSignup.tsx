import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { Eye, EyeOff } from 'lucide-react';

export const LoginSignup = () => {
    const [mode, setMode] = useState<'login' | 'signup' | 'change-password'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [rememberMe, setRememberMe] = useState(false);

    const { setCurrentAccount, setClaimedProfiles, knownServers, addKnownServer, setTrustedServers, setIsGuestSession } = useAppStore();
    const [initialServerUrl, setInitialServerUrl] = useState(knownServers[0] || 'http://localhost:3001');

    const fetchProfiles = async (accountId: string, baseUrl: string) => {
        try {
            const res = await fetch(`${baseUrl}/api/accounts/${accountId}/profiles`);
            if (res.ok) {
                const profiles = await res.json();
                // Since this might be called on login for the initial server, we should append.
                // We will handle full multi-server profile syncing in App/Sidebar.
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
                // Wait for sidebar to fetch profiles from all servers
                setCurrentAccount(account);
            } catch (e) { }
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        if (mode === 'signup' || mode === 'change-password') {
            if (password !== confirmPassword) {
                setError('Passwords do not match.');
                return;
            }
        }

        if (mode === 'change-password') {
            try {
                const res = await fetch(`${initialServerUrl}/api/accounts/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, newPassword: password })
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
            const res = await fetch(`${initialServerUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, initialServerUrl })
            });
            const data = await res.json();

            if (res.ok) {
                if (rememberMe) {
                    localStorage.setItem('harmony_account', JSON.stringify(data));
                }
                setTrustedServers(data.trusted_servers || []);
                addKnownServer(initialServerUrl);
                setIsGuestSession(false);
                await fetchProfiles(data.id, initialServerUrl);
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
                        placeholder="http://96.230.218.248:3001"
                        style={{
                            width: '100%', backgroundColor: 'var(--bg-tertiary)', border: 'none', borderRadius: '3px',
                            color: 'var(--text-normal)', padding: '8px', fontSize: '12px', outline: 'none', marginTop: '4px',
                            boxSizing: 'border-box'
                        }}
                    />

                    <button type="button" onClick={handleGuestLogin} style={{
                        width: '100%', backgroundColor: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--background-modifier-accent)',
                        borderRadius: '3px', padding: '10px', fontSize: '14px', fontWeight: 'bold',
                        cursor: 'pointer', marginTop: '16px', transition: 'color 0.2s, border-color 0.2s'
                    }}>
                        Continue as Guest (No Profile)
                    </button>
                </div>
            </form>
        </div>
    );
};
