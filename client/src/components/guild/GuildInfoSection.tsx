import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';

/** API response shape for guild details */
export interface GuildDetails {
    id: string;
    name: string;
    fingerprint?: string;
    created_at?: string;
    owner_email?: string;
    host?: string;
}

interface Props {
    guildId: string;
    serverUrl: string;
    userRole: string;
}

export const GuildInfoSection = ({ guildId, serverUrl, userRole }: Props) => {
    const { currentAccount } = useAppStore();
    const [details, setDetails] = useState<GuildDetails | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!guildId || !serverUrl || !currentAccount?.token) return;
        setLoading(true);
        fetch(`${serverUrl}/api/guilds/${guildId}`, {
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setDetails(data); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [guildId, serverUrl, currentAccount?.token]);

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'N/A';
        try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
        catch { return dateStr; }
    };

    if (loading) {
        return <div data-testid="guild-info-loading" style={{ color: 'var(--text-muted)', padding: '24px' }}>Loading guild information…</div>;
    }

    return (
        <div data-testid="guild-info-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '20px', fontSize: '18px' }}>Guild Information</h3>
                <div className="guild-info-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '12px 24px',
                    fontSize: '14px'
                }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Name</span>
                    <span data-testid="guild-info-name">{details?.name || 'Unknown'}</span>

                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>ID</span>
                    <span data-testid="guild-info-id" style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{details?.id || guildId}</span>

                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Fingerprint</span>
                    <span data-testid="guild-info-fingerprint" style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {details?.fingerprint ? `ed25519:${details.fingerprint}` : 'N/A'}
                    </span>

                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Created</span>
                    <span data-testid="guild-info-created">{formatDate(details?.created_at)}</span>

                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Hosted on</span>
                    <span data-testid="guild-info-host">{details?.host || new URL(serverUrl).hostname}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--divider)', marginTop: '20px', paddingTop: '16px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 24px', fontSize: '14px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Owner</span>
                    <span data-testid="guild-info-owner">{details?.owner_email || 'N/A'}</span>

                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Your Role</span>
                    <span data-testid="guild-info-role" style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px'
                    }}>
                        <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: userRole === 'OWNER' ? 'rgba(250, 166, 26, 0.15)' :
                                userRole === 'ADMIN' ? 'rgba(88, 101, 242, 0.15)' : 'var(--bg-modifier-hover)',
                            color: userRole === 'OWNER' ? '#faa61a' :
                                userRole === 'ADMIN' ? '#7289da' : 'var(--text-muted)',
                            border: `1px solid ${userRole === 'OWNER' ? 'rgba(250, 166, 26, 0.3)' :
                                userRole === 'ADMIN' ? 'rgba(88, 101, 242, 0.3)' : 'var(--divider)'}`
                        }}>
                            {userRole || 'USER'}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
};
