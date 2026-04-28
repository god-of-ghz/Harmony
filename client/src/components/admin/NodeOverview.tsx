import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';

interface NodeStatusResponse {
    uptime?: number;
    version?: string;
    user_count?: number;
    total_storage?: number;
}

interface AdminGuild {
    id: string;
    name: string;
    status?: 'active' | 'suspended' | 'stopped';
}

interface Props {
    onNavigate: (section: 'overview' | 'guilds' | 'provisions' | 'settings') => void;
}

const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
    return parts.join(', ');
};

const formatStorage = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const NodeOverview = ({ onNavigate }: Props) => {
    const { currentAccount, connectedServers } = useAppStore();
    const [status, setStatus] = useState<NodeStatusResponse | null>(null);
    const [guilds, setGuilds] = useState<AdminGuild[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const getNodeUrl = (): string => {
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return currentAccount?.primary_server_url || safe[0]?.url || '';
    };

    useEffect(() => {
        const fetchData = async () => {
            const nodeUrl = getNodeUrl();
            if (!nodeUrl || !currentAccount?.token) {
                setLoading(false);
                return;
            }

            try {
                const [statusRes, guildsRes] = await Promise.all([
                    apiFetch(`${nodeUrl}/api/node/status`, {
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                    }),
                    apiFetch(`${nodeUrl}/api/guilds`, {
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                    }),
                ]);

                if (statusRes.ok) {
                    const data = await statusRes.json();
                    setStatus(data);
                }
                if (guildsRes.ok) {
                    const data = await guildsRes.json();
                    setGuilds(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                setError('Failed to fetch node data');
                console.error('NodeOverview fetch error:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [currentAccount]);

    const nodeUrl = getNodeUrl();
    const activeGuilds = guilds.filter(g => (g.status || 'active') === 'active').length;
    const suspendedGuilds = guilds.filter(g => g.status === 'suspended').length;
    const stoppedGuilds = guilds.filter(g => g.status === 'stopped').length;

    if (loading) {
        return (
            <div>
                <h2 className="admin-section-title">Node Overview</h2>
                <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading node data...</div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="admin-section-title">Node Overview</h2>

            {error && (
                <div style={{ color: '#ed4245', fontSize: '14px', marginBottom: '16px', padding: '10px 12px', backgroundColor: 'rgba(237,66,69,0.1)', borderRadius: '6px' }}>
                    {error}
                </div>
            )}

            {/* Status Banner */}
            <div className="glass-panel" style={{ padding: '20px', borderRadius: '8px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <span className="admin-status-dot active" />
                    <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--header-primary)' }}>Online</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '14px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Node URL</span>
                    <span style={{ fontFamily: 'monospace' }}>{nodeUrl || 'N/A'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>Uptime</span>
                    <span>{status?.uptime ? formatUptime(status.uptime) : 'N/A'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>Version</span>
                    <span>{status?.version || 'N/A'}</span>
                </div>
            </div>

            {/* Statistics */}
            <div style={{ height: '1px', backgroundColor: 'var(--divider)', margin: '8px 0 24px 0' }} />

            <div className="admin-stats-grid" data-testid="overview-stats">
                <div className="admin-stat-card">
                    <div className="label">Guilds</div>
                    <div className="value">{guilds.length}</div>
                    <div className="sub">
                        {activeGuilds} active
                        {suspendedGuilds > 0 && ` · ${suspendedGuilds} suspended`}
                        {stoppedGuilds > 0 && ` · ${stoppedGuilds} stopped`}
                    </div>
                </div>
                <div className="admin-stat-card">
                    <div className="label">Users</div>
                    <div className="value">{status?.user_count ?? 'N/A'}</div>
                    <div className="sub">registered accounts</div>
                </div>
                <div className="admin-stat-card">
                    <div className="label">Storage</div>
                    <div className="value">{status?.total_storage != null ? formatStorage(status.total_storage) : 'N/A'}</div>
                    <div className="sub">total across all guilds</div>
                </div>
            </div>

            {/* Quick Actions */}
            <div style={{ height: '1px', backgroundColor: 'var(--divider)', margin: '8px 0 24px 0' }} />

            <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>
                Quick Actions
            </div>
            <div className="admin-quick-actions">
                <button
                    className="admin-quick-action-btn"
                    onClick={() => onNavigate('guilds')}
                    data-testid="quick-create-guild"
                >
                    + Create Guild
                </button>
                <button
                    className="admin-quick-action-btn"
                    onClick={() => onNavigate('provisions')}
                    data-testid="quick-gen-code"
                >
                    📋 Generate Provision Code
                </button>
            </div>
        </div>
    );
};
