import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';
import { SaveBanner } from '../common/SaveBanner';

interface NodeSettingsData {
    guild_creation_policy?: 'provision_code' | 'open';
    max_members_per_guild?: number;
    max_guilds?: number;
}

export const NodeSettings = () => {
    const { currentAccount, connectedServers } = useAppStore();
    const [initialSettings, setInitialSettings] = useState<NodeSettingsData>({
        guild_creation_policy: 'provision_code',
        max_members_per_guild: 0,
        max_guilds: 0,
    });
    const [settings, setSettings] = useState<NodeSettingsData>({
        guild_creation_policy: 'provision_code',
        max_members_per_guild: 0,
        max_guilds: 0,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    
    const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings);

    const getNodeUrl = (): string => {
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return currentAccount?.primary_server_url || safe[0]?.url || '';
    };

    useEffect(() => {
        const fetchSettings = async () => {
            const nodeUrl = getNodeUrl();
            if (!nodeUrl || !currentAccount?.token) { setLoading(false); return; }
            try {
                const res = await apiFetch(`${nodeUrl}/api/node/settings`, {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const newSettings = {
                        guild_creation_policy: data.guild_creation_policy || 'provision_code',
                        max_members_per_guild: data.max_members_per_guild ?? 0,
                        max_guilds: data.max_guilds ?? 0,
                    };
                    setSettings(newSettings);
                    setInitialSettings(newSettings);
                }
            } catch {
                setError('Failed to load node settings');
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, [currentAccount]);

    const handleSave = async () => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl || !currentAccount?.token) return;
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            const res = await apiFetch(`${nodeUrl}/api/node/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`,
                },
                body: JSON.stringify(settings),
            });
            if (res.ok) {
                setSaved(true);
                setInitialSettings(settings);
                setTimeout(() => setSaved(false), 3000);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to save settings');
            }
        } catch {
            setError('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div>
                <h2 className="admin-section-title">Node Settings</h2>
                <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading settings...</div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="admin-section-title">Node Settings</h2>

            {error && (
                <div style={{ color: '#ed4245', fontSize: '14px', marginBottom: '16px', padding: '10px 12px', backgroundColor: 'rgba(237,66,69,0.1)', borderRadius: '6px' }}>
                    {error}
                </div>
            )}

            {/* Guild Creation Policy */}
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: '12px' }}>
                Guild Creation Policy
            </div>
            <div className="admin-radio-group" data-testid="creation-policy">
                <label
                    className={`admin-radio-option ${settings.guild_creation_policy === 'provision_code' ? 'selected' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, guild_creation_policy: 'provision_code' }))}
                >
                    <input
                        type="radio"
                        name="creation-policy"
                        checked={settings.guild_creation_policy === 'provision_code'}
                        onChange={() => setSettings(s => ({ ...s, guild_creation_policy: 'provision_code' }))}
                        data-testid="policy-provision"
                    />
                    <div>
                        <div className="option-label">Require provision code</div>
                        <div className="option-desc">Only users with a valid provision code can create guilds.</div>
                    </div>
                </label>
                <label
                    className={`admin-radio-option ${settings.guild_creation_policy === 'open' ? 'selected' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, guild_creation_policy: 'open' }))}
                >
                    <input
                        type="radio"
                        name="creation-policy"
                        checked={settings.guild_creation_policy === 'open'}
                        onChange={() => setSettings(s => ({ ...s, guild_creation_policy: 'open' }))}
                        data-testid="policy-open"
                    />
                    <div>
                        <div className="option-label">Open guild creation</div>
                        <div className="option-desc">Any authenticated user can create guilds on this node.</div>
                        <div className="option-warn">⚠ Warning: This allows anyone to use your server's resources.</div>
                    </div>
                </label>
            </div>

            {/* Resource Limits */}
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: '12px' }}>
                Default Resource Limits
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>Max members per guild</div>
                    <input
                        type="number"
                        min={0}
                        value={settings.max_members_per_guild ?? 0}
                        onChange={e => setSettings(s => ({ ...s, max_members_per_guild: parseInt(e.target.value) || 0 }))}
                        style={{
                            padding: '8px 12px', border: 'none', borderRadius: '4px',
                            backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                            fontFamily: 'inherit', fontSize: '14px', width: '120px',
                        }}
                        data-testid="max-members-setting"
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>0 = unlimited</span>
                </div>
                <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>Max guilds on this node</div>
                    <input
                        type="number"
                        min={0}
                        value={settings.max_guilds ?? 0}
                        onChange={e => setSettings(s => ({ ...s, max_guilds: parseInt(e.target.value) || 0 }))}
                        style={{
                            padding: '8px 12px', border: 'none', borderRadius: '4px',
                            backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                            fontFamily: 'inherit', fontSize: '14px', width: '120px',
                        }}
                        data-testid="max-guilds-setting"
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>0 = unlimited</span>
                </div>
            </div>

            {/* Save Button */}
            <SaveBanner 
                show={hasUnsavedChanges}
                isSaving={saving}
                errorMessage={error}
                onSave={handleSave}
                onReset={() => {
                    setSettings(initialSettings);
                    setError('');
                }}
            />
        </div>
    );
};
