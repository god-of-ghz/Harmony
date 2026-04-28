import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';

interface AdminGuildData {
    id: string;
    name: string;
    owner_email?: string;
    status: 'active' | 'suspended' | 'stopped';
    member_count?: number;
    storage_bytes?: number;
    fingerprint?: string;
    created_at?: string;
}

interface GuildDetail {
    id: string;
    name: string;
    fingerprint?: string;
    created_at?: string;
    owner_email?: string;
    owner_account_id?: string;
    members?: { id: string; username: string }[];
    storage_db?: number;
    storage_uploads?: number;
}

const formatStorage = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const GuildManagement = () => {
    const { currentAccount, connectedServers } = useAppStore();
    const [guilds, setGuilds] = useState<AdminGuildData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<AdminGuildData | null>(null);
    const [deleteConfirmName, setDeleteConfirmName] = useState('');
    const [selectedGuild, setSelectedGuild] = useState<GuildDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const getNodeUrl = (): string => {
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return currentAccount?.primary_server_url || safe[0]?.url || '';
    };

    const fetchGuilds = async () => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) { setLoading(false); return; }
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const list: AdminGuildData[] = (Array.isArray(data) ? data : []).map((g: any) => ({
                    id: g.id,
                    name: g.name || g.id,
                    owner_email: g.owner_email,
                    status: g.status || 'active',
                    member_count: g.member_count,
                    storage_bytes: g.storage_bytes,
                    fingerprint: g.fingerprint,
                    created_at: g.created_at,
                }));
                setGuilds(list);
            } else {
                setError('Failed to load guilds');
            }
        } catch {
            setError('Failed to load guilds');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchGuilds(); }, [currentAccount]);

    const handleSuspend = async (guild: AdminGuildData) => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        setActionLoading(guild.id);
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds/${guild.id}/suspend`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                setGuilds(prev => prev.map(g => g.id === guild.id ? { ...g, status: 'suspended' as const } : g));
            }
        } catch (err) {
            console.error('Suspend failed:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleResume = async (guild: AdminGuildData) => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        setActionLoading(guild.id);
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds/${guild.id}/resume`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                setGuilds(prev => prev.map(g => g.id === guild.id ? { ...g, status: 'active' as const } : g));
            }
        } catch (err) {
            console.error('Resume failed:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        setActionLoading(deleteTarget.id);
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds/${deleteTarget.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                setGuilds(prev => prev.filter(g => g.id !== deleteTarget.id));
                setDeleteTarget(null);
                setDeleteConfirmName('');
            }
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleViewDetail = async (guild: AdminGuildData) => {
        setDetailLoading(true);
        setSelectedGuild({ id: guild.id, name: guild.name, fingerprint: guild.fingerprint, created_at: guild.created_at, owner_email: guild.owner_email });
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) { setDetailLoading(false); return; }
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds/${guild.id}`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSelectedGuild({
                    id: guild.id,
                    name: data.name || guild.name,
                    fingerprint: data.fingerprint || guild.fingerprint,
                    created_at: data.created_at || guild.created_at,
                    owner_email: data.owner_email || guild.owner_email,
                    owner_account_id: data.owner_account_id,
                    members: data.members,
                    storage_db: data.storage_db,
                    storage_uploads: data.storage_uploads,
                });
            }
        } catch {
            // Keep partial data
        } finally {
            setDetailLoading(false);
        }
    };

    if (loading) {
        return (
            <div>
                <h2 className="admin-section-title">Guild Management</h2>
                <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading guilds...</div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="admin-section-title">Guild Management</h2>

            {error && (
                <div style={{ color: '#ed4245', fontSize: '14px', marginBottom: '16px', padding: '10px 12px', backgroundColor: 'rgba(237,66,69,0.1)', borderRadius: '6px' }}>
                    {error}
                </div>
            )}

            {/* Guild Table */}
            <table className="admin-table" data-testid="guild-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Owner</th>
                        <th>Status</th>
                        <th>Members</th>
                        <th>Storage</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {guilds.length === 0 && (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                                No guilds found
                            </td>
                        </tr>
                    )}
                    {guilds.map(guild => (
                        <tr key={guild.id} data-testid={`guild-row-${guild.id}`}>
                            <td>
                                <span
                                    className="guild-name-link"
                                    onClick={() => handleViewDetail(guild)}
                                    data-testid={`guild-name-${guild.id}`}
                                >
                                    {guild.name}
                                </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                                {guild.owner_email || '—'}
                            </td>
                            <td>
                                <span className={`admin-status-dot ${guild.status}`} />
                                <span style={{ textTransform: 'capitalize' }}>{guild.status}</span>
                            </td>
                            <td>{guild.member_count ?? '—'}</td>
                            <td>{guild.storage_bytes != null ? formatStorage(guild.storage_bytes) : '—'}</td>
                            <td>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {guild.status === 'active' ? (
                                        <button
                                            className="admin-action-btn"
                                            title="Suspend guild"
                                            onClick={() => handleSuspend(guild)}
                                            disabled={actionLoading === guild.id}
                                            data-testid={`suspend-${guild.id}`}
                                        >
                                            ⏸
                                        </button>
                                    ) : guild.status === 'suspended' ? (
                                        <button
                                            className="admin-action-btn"
                                            title="Resume guild"
                                            onClick={() => handleResume(guild)}
                                            disabled={actionLoading === guild.id}
                                            data-testid={`resume-${guild.id}`}
                                        >
                                            ▶
                                        </button>
                                    ) : null}
                                    <button
                                        className="admin-action-btn danger"
                                        title="Delete guild"
                                        onClick={() => { setDeleteTarget(guild); setDeleteConfirmName(''); }}
                                        disabled={actionLoading === guild.id}
                                        data-testid={`delete-${guild.id}`}
                                    >
                                        🗑
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Guild Detail Panel */}
            {selectedGuild && (
                <div className="glass-panel" style={{ padding: '20px', borderRadius: '8px', marginTop: '24px' }} data-testid="guild-detail">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', margin: 0 }}>{selectedGuild.name}</h3>
                        <button
                            className="admin-action-btn"
                            onClick={() => setSelectedGuild(null)}
                            aria-label="Close detail"
                        >
                            ✕
                        </button>
                    </div>
                    {detailLoading ? (
                        <div style={{ color: 'var(--text-muted)' }}>Loading details...</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: '14px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Guild ID</span>
                            <span className="admin-code" style={{ maxWidth: 'none' }}>{selectedGuild.id}</span>
                            {selectedGuild.fingerprint && (<>
                                <span style={{ color: 'var(--text-muted)' }}>Fingerprint</span>
                                <span className="admin-code" style={{ maxWidth: 'none' }}>{selectedGuild.fingerprint}</span>
                            </>)}
                            {selectedGuild.created_at && (<>
                                <span style={{ color: 'var(--text-muted)' }}>Created</span>
                                <span>{new Date(selectedGuild.created_at).toLocaleDateString()}</span>
                            </>)}
                            {selectedGuild.owner_email && (<>
                                <span style={{ color: 'var(--text-muted)' }}>Owner</span>
                                <span>{selectedGuild.owner_email}{selectedGuild.owner_account_id ? ` (${selectedGuild.owner_account_id})` : ''}</span>
                            </>)}
                            {selectedGuild.members && (<>
                                <span style={{ color: 'var(--text-muted)' }}>Members</span>
                                <span>{selectedGuild.members.map(m => m.username).join(', ') || 'None'}</span>
                            </>)}
                            {(selectedGuild.storage_db != null || selectedGuild.storage_uploads != null) && (<>
                                <span style={{ color: 'var(--text-muted)' }}>Storage</span>
                                <span>
                                    {selectedGuild.storage_db != null && `DB: ${formatStorage(selectedGuild.storage_db)}`}
                                    {selectedGuild.storage_db != null && selectedGuild.storage_uploads != null && ' · '}
                                    {selectedGuild.storage_uploads != null && `Uploads: ${formatStorage(selectedGuild.storage_uploads)}`}
                                </span>
                            </>)}
                        </div>
                    )}
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {deleteTarget && (
                <div className="admin-confirm-overlay" data-testid="delete-confirm-dialog">
                    <div className="admin-confirm-dialog glass-panel">
                        <h3>⚠️ Delete Guild</h3>
                        <p>
                            This will permanently delete <strong>"{deleteTarget.name}"</strong> and all its data. This action cannot be undone.
                        </p>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            Type the guild name to confirm:
                        </div>
                        <input
                            type="text"
                            value={deleteConfirmName}
                            onChange={e => setDeleteConfirmName(e.target.value)}
                            placeholder={deleteTarget.name}
                            data-testid="delete-confirm-input"
                            autoFocus
                        />
                        <div className="admin-confirm-actions">
                            <button
                                className="admin-btn-cancel"
                                onClick={() => { setDeleteTarget(null); setDeleteConfirmName(''); }}
                                data-testid="delete-cancel-btn"
                            >
                                Cancel
                            </button>
                            <button
                                className="admin-btn-danger"
                                disabled={deleteConfirmName !== deleteTarget.name || actionLoading === deleteTarget.id}
                                onClick={handleDelete}
                                data-testid="delete-confirm-btn"
                            >
                                {actionLoading === deleteTarget.id ? 'Deleting...' : 'Delete Guild'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
