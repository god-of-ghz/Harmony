import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';

interface ProvisionCode {
    code: string;
    expires_at?: string | null;
    max_members?: number;
    used?: boolean;
    used_by?: string;
    guild_name?: string;
}

export const ProvisionCodes = () => {
    const { currentAccount, connectedServers } = useAppStore();
    const [codes, setCodes] = useState<ProvisionCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showGenerate, setShowGenerate] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [newCode, setNewCode] = useState<string | null>(null);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    // Generate form state
    const [expiry, setExpiry] = useState('never');
    const [maxMembers, setMaxMembers] = useState(0);

    const getNodeUrl = (): string => {
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return currentAccount?.primary_server_url || safe[0]?.url || '';
    };

    const fetchCodes = async () => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) { setLoading(false); return; }
        try {
            const res = await apiFetch(`${nodeUrl}/api/provision-codes`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setCodes(Array.isArray(data) ? data : []);
            } else {
                setError('Failed to load provision codes');
            }
        } catch {
            setError('Failed to load provision codes');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchCodes(); }, [currentAccount]);

    const handleGenerate = async () => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        setGenerating(true);
        setError('');

        const body: any = {};
        if (expiry !== 'never') {
            const hoursMap: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
            const hours = hoursMap[expiry];
            if (hours) {
                const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
                body.expires_at = expiresAt;
            }
        }
        if (maxMembers > 0) body.max_members = maxMembers;

        try {
            const res = await apiFetch(`${nodeUrl}/api/provision-codes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`,
                },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const data = await res.json();
                const code = data.code || data.provision_code || '';
                setNewCode(code);
                setCodes(prev => [{ code, expires_at: body.expires_at || null, max_members: maxMembers || undefined, used: false }, ...prev]);
                setShowGenerate(false);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to generate provision code');
            }
        } catch {
            setError('Failed to generate provision code');
        } finally {
            setGenerating(false);
        }
    };

    const handleCopy = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopyFeedback(code);
            setTimeout(() => setCopyFeedback(null), 2000);
        } catch {
            // Fallback
            setCopyFeedback(null);
        }
    };

    const handleRevoke = async (code: string) => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        try {
            const res = await apiFetch(`${nodeUrl}/api/provision-codes/${code}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` },
            });
            if (res.ok) {
                setCodes(prev => prev.filter(c => c.code !== code));
            }
        } catch (err) {
            console.error('Revoke failed:', err);
        }
    };

    const formatExpiry = (expiresAt?: string | null): string => {
        if (!expiresAt) return 'Never';
        const date = new Date(expiresAt);
        const now = new Date();
        const diff = date.getTime() - now.getTime();
        if (diff <= 0) return 'Expired';
        const hours = Math.floor(diff / 3600000);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    };

    const activeCodes = codes.filter(c => !c.used);
    const usedCodes = codes.filter(c => c.used);

    if (loading) {
        return (
            <div>
                <h2 className="admin-section-title">Provision Codes</h2>
                <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading codes...</div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="admin-section-title">Provision Codes</h2>

            {error && (
                <div style={{ color: '#ed4245', fontSize: '14px', marginBottom: '16px', padding: '10px 12px', backgroundColor: 'rgba(237,66,69,0.1)', borderRadius: '6px' }}>
                    {error}
                </div>
            )}

            {/* Newly generated code banner */}
            {newCode && (
                <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }} data-testid="new-code-banner">
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>New Code:</span>
                    <span className="admin-code" style={{ maxWidth: 'none', flex: 1 }}>{newCode}</span>
                    <button
                        className="admin-action-btn"
                        title="Copy code"
                        onClick={() => handleCopy(newCode)}
                    >
                        {copyFeedback === newCode ? '✓' : '📋'}
                    </button>
                    <button
                        className="admin-action-btn"
                        onClick={() => setNewCode(null)}
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Active Codes */}
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: '12px' }}>
                Active Codes
            </div>
            <table className="admin-table" data-testid="active-codes-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Expires</th>
                        <th>Max Members</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {activeCodes.length === 0 && (
                        <tr>
                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                                No active codes
                            </td>
                        </tr>
                    )}
                    {activeCodes.map(c => (
                        <tr key={c.code} data-testid={`code-row-${c.code}`}>
                            <td>
                                <span className="admin-code" title={c.code}>{c.code}</span>
                            </td>
                            <td>{formatExpiry(c.expires_at)}</td>
                            <td>{c.max_members && c.max_members > 0 ? c.max_members : 'Unlimited'}</td>
                            <td>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <button
                                        className="admin-action-btn"
                                        title="Copy code"
                                        onClick={() => handleCopy(c.code)}
                                        data-testid={`copy-${c.code}`}
                                    >
                                        {copyFeedback === c.code ? '✓' : '📋'}
                                    </button>
                                    <button
                                        className="admin-action-btn danger"
                                        title="Revoke code"
                                        onClick={() => handleRevoke(c.code)}
                                        data-testid={`revoke-${c.code}`}
                                    >
                                        🗑
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Used Codes */}
            {usedCodes.length > 0 && (
                <>
                    <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginTop: '32px', marginBottom: '12px' }}>
                        Used Codes
                    </div>
                    <table className="admin-table" data-testid="used-codes-table">
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Used By</th>
                                <th>Created Guild</th>
                            </tr>
                        </thead>
                        <tbody>
                            {usedCodes.map(c => (
                                <tr key={c.code}>
                                    <td><span className="admin-code" title={c.code}>{c.code}</span></td>
                                    <td>{c.used_by || '—'}</td>
                                    <td>{c.guild_name || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {/* Generate Form */}
            {showGenerate ? (
                <div className="admin-generate-form" data-testid="generate-form">
                    <div>
                        <label>Expiry</label>
                        <select
                            value={expiry}
                            onChange={e => setExpiry(e.target.value)}
                            data-testid="expiry-select"
                            style={{ display: 'block', marginTop: '6px', width: '100%' }}
                        >
                            <option value="never">Never</option>
                            <option value="1h">1 hour</option>
                            <option value="24h">24 hours</option>
                            <option value="7d">7 days</option>
                            <option value="30d">30 days</option>
                        </select>
                    </div>
                    <div>
                        <label>Max Members</label>
                        <input
                            type="number"
                            min={0}
                            value={maxMembers}
                            onChange={e => setMaxMembers(parseInt(e.target.value) || 0)}
                            placeholder="0 = unlimited"
                            data-testid="max-members-input"
                            style={{ display: 'block', marginTop: '6px', width: '100%' }}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>0 = unlimited</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className="btn"
                            onClick={handleGenerate}
                            disabled={generating}
                            data-testid="generate-btn"
                        >
                            {generating ? 'Generating...' : 'Generate'}
                        </button>
                        <button
                            className="admin-btn-cancel"
                            onClick={() => setShowGenerate(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    className="admin-quick-action-btn"
                    style={{ marginTop: '20px' }}
                    onClick={() => setShowGenerate(true)}
                    data-testid="show-generate-btn"
                >
                    + Generate New Code
                </button>
            )}
        </div>
    );
};
