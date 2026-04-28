import { useState, useEffect } from 'react';
import { useAppStore, type ConnectedServer } from '../store/appStore';
import { useMicrophoneLevel } from '../hooks/useMicrophoneLevel';
import { X, Shield, Server, Globe, Lock } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { PasswordChallenge } from './PasswordChallenge';
import { ChangePasswordModal } from './ChangePasswordModal';
import { SaveBanner } from './common/SaveBanner';

interface Props {
    onClose: () => void;
}

export const UserSettings = ({ onClose }: Props) => {
    const { currentAccount, connectedServers, setConnectedServers, setCurrentAccount, audioSettings, setAudioSettings, serverStatus, accountSettings, updateAccountSettings, clientSettings, setClientSettings } = useAppStore();
    const [activeTab, setActiveTab] = useState<'profile' | 'account' | 'appearance' | 'voice-video' | 'notifications' | 'federation'>('account');
    
    // Local State for adding replicas
    const [newReplicaUrl, setNewReplicaUrl] = useState('');
    const [replicaError, setReplicaError] = useState('');
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [promoteTarget, setPromoteTarget] = useState<string | null>(null);
    const [showChangePassword, setShowChangePassword] = useState(false);

    // Profile State
    const [initialGlobalDisplayName, setInitialGlobalDisplayName] = useState('');
    const [initialGlobalBio, setInitialGlobalBio] = useState('');
    const [initialGlobalAvatar, setInitialGlobalAvatar] = useState('');
    const [initialGlobalStatus, setInitialGlobalStatus] = useState('');
    
    const [globalDisplayName, setGlobalDisplayName] = useState('');
    const [globalBio, setGlobalBio] = useState('');
    const [globalAvatar, setGlobalAvatar] = useState('');
    const [globalStatus, setGlobalStatus] = useState('');
    
    const profileIsDirty = globalDisplayName !== initialGlobalDisplayName || 
                           globalBio !== initialGlobalBio || 
                           globalAvatar !== initialGlobalAvatar || 
                           globalStatus !== initialGlobalStatus;
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [avatarUploading, setAvatarUploading] = useState(false);

    const handleAvatarUpload = async (file: File) => {
        setAvatarUploading(true);
        setProfileError('');
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        const primary = currentAccount?.primary_server_url || safe[0]?.url || localStorage.getItem('harmony_last_server_url') || '';
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const res = await apiFetch(`${primary}/api/accounts/avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` },
                body: formData
            });
            const data = await res.json();
            if (res.ok && data.avatar_url) {
                const absoluteUrl = data.avatar_url.startsWith('http') ? data.avatar_url : `${primary}${data.avatar_url}`;
                setGlobalAvatar(absoluteUrl);
            } else {
                setProfileError(data.error || 'Avatar upload failed');
            }
        } catch (err: any) {
            setProfileError(err.message);
        } finally {
            setAvatarUploading(false);
        }
    };

    // Hardware devices
    const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
    const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
    const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);

    useEffect(() => {
        if (activeTab === 'voice-video') {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                setAudioInputs(devices.filter(d => d.kind === 'audioinput'));
                setAudioOutputs(devices.filter(d => d.kind === 'audiooutput'));
                setVideoInputs(devices.filter(d => d.kind === 'videoinput'));
            }).catch(e => console.error("Could not enumerate devices:", e));
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'profile' && currentAccount) {
            const safe = Array.isArray(connectedServers) ? connectedServers : [];
            const actualPrimary = currentAccount.primary_server_url || safe[0]?.url || localStorage.getItem('harmony_last_server_url') || '';
            if (!actualPrimary) return;
            apiFetch(`${actualPrimary}/api/federation/profile/${currentAccount.id}`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) {
                    setGlobalDisplayName(data.display_name || '');
                    setInitialGlobalDisplayName(data.display_name || '');
                    setGlobalBio(data.bio || '');
                    setInitialGlobalBio(data.bio || '');
                    
                    let fetchedAvatar = data.avatar_url || '';
                    if (fetchedAvatar && !fetchedAvatar.startsWith('http') && !fetchedAvatar.startsWith('data:')) {
                        fetchedAvatar = `${actualPrimary}${fetchedAvatar}`;
                    }
                    setGlobalAvatar(fetchedAvatar);
                    setInitialGlobalAvatar(fetchedAvatar);
                    
                    setGlobalStatus(data.status_message || '');
                    setInitialGlobalStatus(data.status_message || '');
                }
            })
            .catch(console.error);
        }
    }, [activeTab, currentAccount, connectedServers]);

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setProfileSaving(true);
        setProfileError('');
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        const primary = currentAccount?.primary_server_url || safe[0]?.url || localStorage.getItem('harmony_last_server_url') || '';
        try {
            const res = await apiFetch(`${primary}/api/profiles/global`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount?.token}` },
                body: JSON.stringify({ display_name: globalDisplayName, bio: globalBio, avatar_url: globalAvatar, status_message: globalStatus })
            });
            if (res.ok) {
                const data = await res.json();
                // Update global profile in store so UserPanel and other components reflect the change
                useAppStore.getState().updateGlobalProfile({
                    account_id: currentAccount!.id,
                    display_name: data.display_name ?? globalDisplayName,
                    bio: data.bio ?? globalBio,
                    avatar_url: data.avatar_url ?? globalAvatar,
                    status_message: data.status_message ?? globalStatus,
                    banner_url: data.banner_url ?? ''
                });
                
                setInitialGlobalDisplayName(data.display_name ?? globalDisplayName);
                setInitialGlobalBio(data.bio ?? globalBio);
                setInitialGlobalAvatar(data.avatar_url ?? globalAvatar);
                setInitialGlobalStatus(data.status_message ?? globalStatus);
            } else {
                const data = await res.json();
                setProfileError(data.error || 'Failed to save profile');
            }
        } catch (err: any) {
            setProfileError(err.message);
        } finally {
            setProfileSaving(false);
        }
    };

    if (!currentAccount) return null;

    const safe = Array.isArray(connectedServers) ? connectedServers : [];
    const trustedServers = safe.filter(s => s.trust_level === 'trusted');
    const untrustedServers = safe.filter(s => s.trust_level !== 'trusted');

    const actualPrimary = currentAccount.primary_server_url || trustedServers[0]?.url || safe[0]?.url || localStorage.getItem('harmony_last_server_url') || '';

    const isPrimaryNode = currentAccount.authority_role === 'primary' || !currentAccount.authority_role;

    const handleAddReplica = async (e: React.FormEvent) => {
        e.preventDefault();
        setReplicaError('');
        const trimmedUrl = newReplicaUrl.trim().replace(/\/$/, "");
        if (!trimmedUrl) return;

        setLoadingAction('add');
        try {
            const res = await apiFetch(`${actualPrimary}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ serverUrl: trimmedUrl })
            });
            if (res.ok) {
                const updated: ConnectedServer[] = [...safe, { url: trimmedUrl, trust_level: 'trusted', status: 'active' }];
                setConnectedServers(updated);
                setNewReplicaUrl('');
            } else {
                const text = await res.text();
                let errorMsg = 'Failed to add replica server';
                try {
                    const data = JSON.parse(text);
                    if (data.error) errorMsg = data.error;
                } catch {
                    if (text) errorMsg = text;
                }
                setReplicaError(errorMsg);
            }
        } catch (err: any) {
            setReplicaError(err.message || 'Network error');
        } finally {
            setLoadingAction(null);
        }
    };

    const handleRemoveReplica = async (urlToRemove: string) => {
        if (!window.confirm(`Are you sure you want to fully disconnect from ${urlToRemove}?`)) return;
        setLoadingAction(`remove-${urlToRemove}`);
        try {
            await apiFetch(`${actualPrimary}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'DELETE',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ serverUrl: urlToRemove })
            });
            const updated = safe.filter(s => s.url !== urlToRemove);
            setConnectedServers(updated);
        } catch (err) {
            console.error('Failed to remove server', err);
        } finally {
            setLoadingAction(null);
        }
    };

    const handleUntrustServer = async (urlToUntrust: string) => {
        setLoadingAction(`untrust-${urlToUntrust}`);
        try {
            await apiFetch(`${actualPrimary}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'DELETE',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ serverUrl: urlToUntrust })
            });
            // Move from trusted to untrusted in connectedServers
            const updated = safe.map(s => s.url === urlToUntrust ? { ...s, trust_level: 'untrusted' as const } : s);
            setConnectedServers(updated);
        } catch (err) {
            console.error('Failed to untrust server', err);
        } finally {
            setLoadingAction(null);
        }
    };

    const handleTrustServer = async (urlToTrust: string) => {
        setLoadingAction(`trust-${urlToTrust}`);
        setReplicaError('');
        try {
            const res = await apiFetch(`${actualPrimary}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ serverUrl: urlToTrust })
            });
            if (res.ok) {
                const updated = safe.map(s => s.url === urlToTrust ? { ...s, trust_level: 'trusted' as const } : s);
                setConnectedServers(updated);
            } else {
                const data = await res.json().catch(() => ({}));
                setReplicaError(data.error || 'Failed to trust server');
            }
        } catch (err: any) {
            setReplicaError(err.message || 'Network error');
        } finally {
            setLoadingAction(null);
        }
    };

    const handlePromote = (targetReplicaUrl: string) => {
        setPromoteTarget(targetReplicaUrl);
    };

    const handlePromoteWithAuth = async (serverAuthKey: string) => {
        if (!promoteTarget || !currentAccount) return;
        setLoadingAction(`promote-${promoteTarget}`);
        try {
            // Step 1: Request a fresh delegation certificate from the current primary
            const delegateRes = await apiFetch(`${actualPrimary}/api/accounts/delegate`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ targetServerUrl: promoteTarget })
            });
            if (!delegateRes.ok) {
                const delegateData = await delegateRes.json().catch(() => ({}));
                alert(delegateData.error || 'Failed to obtain delegation certificate from primary server.');
                return;
            }
            const { delegationCert } = await delegateRes.json();

            // Step 2: Send the fresh cert + serverAuthKey to the target server for promotion
            const res = await apiFetch(`${promoteTarget}/api/federation/promote`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    delegationCert,
                    serverAuthKey,
                    oldPrimaryUrl: actualPrimary
                })
            });
            if (res.ok) {
                const data = await res.json();
                // Use the fresh JWT from the new primary — this token has
                // iss=newPrimary so all nodes will verify it locally instead
                // of making expensive remote key fetches to the old primary.
                const newToken = data.token || currentAccount.token;
                setCurrentAccount({
                    ...currentAccount,
                    primary_server_url: promoteTarget,
                    authority_role: 'primary',
                    token: newToken,
                });
                // Persist the new session so page refresh uses the new token
                try {
                    const session = JSON.parse(localStorage.getItem('harmony_session') || '{}');
                    session.token = newToken;
                    session.primary_server_url = promoteTarget;
                    localStorage.setItem('harmony_session', JSON.stringify(session));
                } catch { /* non-fatal */ }
                alert("Successfully promoted to Primary.");
            } else {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Promotion failed.');
            }
        } catch (err: any) {
             alert(err.message || 'Network Error during promotion');
        } finally {
            setLoadingAction(null);
            setPromoteTarget(null);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'var(--bg-primary)', display: 'flex', zIndex: 10000,
            animation: 'fadeIn 0.2s ease-out'
        }}>
            {/* Sidebar */}
            <div style={{
                width: '240px', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column',
                alignItems: 'flex-end', paddingTop: '60px', paddingRight: '20px'
            }}>
                <div style={{ width: '192px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        User Settings
                    </div>
                    <div 
                        onClick={() => setActiveTab('account')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'account' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'account' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'account') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'account') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        My Account
                    </div>
                    <div 
                        onClick={() => setActiveTab('profile')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'profile' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'profile' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'profile') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'profile') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        Profile
                    </div>
                    <div 
                        onClick={() => setActiveTab('appearance')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'appearance' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'appearance' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'appearance') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'appearance') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        Appearance
                    </div>
                    <div 
                        onClick={() => setActiveTab('voice-video')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'voice-video' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'voice-video' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'voice-video') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'voice-video') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        Voice & Video
                    </div>
                    <div 
                        onClick={() => setActiveTab('notifications')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'notifications' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'notifications' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'notifications') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'notifications') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        Notifications
                    </div>
                    <div 
                        onClick={() => setActiveTab('federation')}
                        style={{
                            padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '15px', fontWeight: 500,
                            backgroundColor: activeTab === 'federation' ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeTab === 'federation' ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                        }}
                        onMouseEnter={e => { if (activeTab !== 'federation') e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; }}
                        onMouseLeave={e => { if (activeTab !== 'federation') e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        Network & Federation
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', padding: '60px 40px', overflowY: 'auto' }}>
                <div style={{ maxWidth: '700px', display: 'flex', flexDirection: 'column' }}>
                    {activeTab === 'account' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>My Account</h2>
                            <div style={{
                                backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '16px',
                                display: 'flex', flexDirection: 'column', gap: '16px'
                            }}>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Email</div>
                                    <div style={{ fontSize: '16px' }}>{currentAccount.email}</div>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />
                                <div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Account ID</div>
                                    <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{currentAccount.id}</div>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />

                                {/* Change Password */}
                                <div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Security</div>
                                    {(() => {
                                        const primaryStatus = serverStatus?.[actualPrimary] || 'unknown';
                                        const primaryOnline = primaryStatus === 'online';
                                        return (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '14px 16px', borderRadius: '6px',
                                                backgroundColor: 'var(--bg-primary)', border: '1px solid var(--divider)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <Lock size={18} color={primaryOnline ? 'var(--text-normal)' : 'var(--text-muted)'} />
                                                    <div>
                                                        <div style={{ fontSize: '14px', fontWeight: '500' }}>Password</div>
                                                        {!primaryOnline && (
                                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                                Primary server must be online to change password
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    data-testid="change-password-btn"
                                                    className="btn"
                                                    onClick={() => setShowChangePassword(true)}
                                                    disabled={!primaryOnline}
                                                    style={{
                                                        padding: '7px 16px', fontSize: '13px',
                                                        opacity: primaryOnline ? 1 : 0.4,
                                                        cursor: primaryOnline ? 'pointer' : 'not-allowed',
                                                    }}
                                                >
                                                    Change Password
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'federation' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Federation & Trust</h2>
                            
                            <div className="glass-panel" style={{ padding: '24px', borderRadius: '8px', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Shield size={22} color="white" />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>Primary Authenticator</div>
                                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>The authoritative server holding your master identity and keys.</div>
                                    </div>
                                    {!isPrimaryNode && (
                                        <span style={{ backgroundColor: '#faa61a', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                                            You are viewing from a Replica
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '4px', borderLeft: '4px solid #57F287',
                                    display: 'flex', alignItems: 'center', gap: '12px'
                                }}>
                                    <Globe size={18} color="var(--text-muted)" />
                                    <span style={{ fontSize: '15px', color: 'var(--text-normal)', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                        {actualPrimary}
                                    </span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>Trusted Servers</h3>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Found {trustedServers.length} trusted</span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
                                {trustedServers.map(srv => {
                                    const isPrimary = srv.url === actualPrimary;
                                    const status = serverStatus?.[srv.url] || 'unknown';
                                    const dotColor = status === 'online' ? '#23a559' : status === 'offline' ? '#ed4245' : 'var(--text-muted)';

                                    return (
                                        <div key={srv.url} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            backgroundColor: isPrimary ? 'rgba(88, 101, 242, 0.1)' : 'var(--bg-secondary)', padding: '16px', borderRadius: '8px',
                                            border: isPrimary ? '1px solid var(--brand-experiment)' : '1px solid var(--divider)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: dotColor }} title={`Status: ${status}`} />
                                                <Server size={18} color="var(--text-muted)" />
                                                <span style={{ fontSize: '15px', fontFamily: 'monospace' }}>{srv.url}</span>
                                                {isPrimary && (
                                                    <span style={{ backgroundColor: 'var(--brand-experiment)', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                                                        PRIMARY
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {!isPrimary && (
                                                    <>
                                                        <button 
                                                            className="btn" 
                                                            onClick={() => handlePromote(srv.url)}
                                                            disabled={loadingAction !== null}
                                                            style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: 'var(--brand-experiment)' }}
                                                        >
                                                            {loadingAction === `promote-${srv.url}` ? 'Promoting...' : 'Promote to Primary'}
                                                        </button>
                                                        <button 
                                                            onClick={() => handleUntrustServer(srv.url)}
                                                            disabled={loadingAction !== null}
                                                            style={{ 
                                                                padding: '6px 12px', fontSize: '13px', backgroundColor: 'transparent',
                                                                color: '#faa61a', border: '1px solid #faa61a', borderRadius: '4px', cursor: 'pointer'
                                                            }}
                                                        >
                                                            {loadingAction === `untrust-${srv.url}` ? 'Untrusting...' : 'Untrust'}
                                                        </button>
                                                        <button 
                                                            onClick={() => handleRemoveReplica(srv.url)}
                                                            disabled={loadingAction !== null}
                                                            style={{ 
                                                                padding: '6px 12px', fontSize: '13px', backgroundColor: 'transparent',
                                                                color: '#ed4245', border: '1px solid #ed4245', borderRadius: '4px', cursor: 'pointer'
                                                            }}
                                                        >
                                                            {loadingAction === `remove-${srv.url}` ? 'Removing...' : 'Remove'}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {trustedServers.length === 0 && (
                                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
                                        No trusted servers configured.
                                    </div>
                                )}
                            </div>

                            {/* Connected (Untrusted) Servers */}
                            {untrustedServers.length > 0 && (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>Connected (Untrusted) Servers</h3>
                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{untrustedServers.length} untrusted</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
                                        {untrustedServers.map(srv => {
                                            const url = srv.url;
                                            const status = serverStatus?.[url] || 'unknown';
                                            const dotColor = status === 'online' ? '#23a559' : status === 'offline' ? '#ed4245' : 'var(--text-muted)';

                                            return (
                                                <div key={url} style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px',
                                                    border: '1px solid var(--divider)', opacity: 0.85
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: dotColor }} title={`Status: ${status}`} />
                                                        <Server size={18} color="var(--text-muted)" />
                                                        <span style={{ fontSize: '15px', fontFamily: 'monospace' }}>{url}</span>
                                                        <span style={{ backgroundColor: 'var(--bg-modifier-active)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                                                            UNTRUSTED
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button 
                                                            className="btn" 
                                                            onClick={() => handleTrustServer(url)}
                                                            disabled={loadingAction !== null}
                                                            style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#23a559' }}
                                                        >
                                                            {loadingAction === `trust-${url}` ? 'Trusting...' : 'Trust'}
                                                        </button>
                                                        <button 
                                                            onClick={() => handleRemoveReplica(url)}
                                                            disabled={loadingAction !== null}
                                                            style={{ 
                                                                padding: '6px 12px', fontSize: '13px', backgroundColor: 'transparent',
                                                                color: '#ed4245', border: '1px solid #ed4245', borderRadius: '4px', cursor: 'pointer'
                                                            }}
                                                        >
                                                            {loadingAction === `remove-${url}` ? 'Removing...' : 'Remove'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            <form onSubmit={handleAddReplica} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                    Add New Replica
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                        type="url" 
                                        placeholder="https://example-replica.com" 
                                        required
                                        value={newReplicaUrl}
                                        onChange={e => setNewReplicaUrl(e.target.value)}
                                        style={{ 
                                            flex: 1, padding: '10px 12px', borderRadius: '4px', border: 'none',
                                            backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)'
                                        }}
                                    />
                                    <button 
                                        type="submit" className="btn" disabled={loadingAction === 'add'}
                                        style={{ padding: '0 24px', fontWeight: 'bold' }}
                                    >
                                        {loadingAction === 'add' ? 'Adding...' : 'Add Server'}
                                    </button>
                                </div>
                                {replicaError && <div style={{ color: '#ed4245', fontSize: '13px', marginTop: '4px' }}>{replicaError}</div>}
                            </form>

                            {promoteTarget && currentAccount && (
                                <PasswordChallenge
                                    title="Authenticate to Promote"
                                    description={`You are promoting ${promoteTarget} to be your Primary Authenticator. Re-enter your password to confirm this sensitive action.`}
                                    email={currentAccount.email}
                                    serverUrl={actualPrimary}
                                    onSuccess={handlePromoteWithAuth}
                                    onCancel={() => setPromoteTarget(null)}
                                />
                            )}

                            {showChangePassword && currentAccount && (
                                <ChangePasswordModal
                                    email={currentAccount.email}
                                    serverUrl={actualPrimary}
                                    token={currentAccount.token || ''}
                                    onSuccess={() => {
                                        setShowChangePassword(false);
                                    }}
                                    onCancel={() => setShowChangePassword(false)}
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'profile' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Global Profile</h2>
                            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                {/* Avatar Section */}
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '12px', display: 'block' }}>Avatar</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                        <div 
                                            style={{ 
                                                width: '100px', height: '100px', borderRadius: '50%', 
                                                backgroundColor: 'var(--bg-tertiary)', 
                                                backgroundImage: globalAvatar ? `url(${globalAvatar.startsWith('/') ? (actualPrimary + globalAvatar) : globalAvatar})` : 'none',
                                                backgroundSize: 'cover', backgroundPosition: 'center',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'var(--text-muted)', fontSize: '36px', fontWeight: 'bold',
                                                border: '3px solid var(--bg-modifier-accent)',
                                                position: 'relative', overflow: 'hidden', cursor: 'pointer',
                                                flexShrink: 0
                                            }}
                                            onClick={() => document.getElementById('avatar-file-input')?.click()}
                                        >
                                            {!globalAvatar && (currentAccount?.email?.[0]?.toUpperCase() || '?')}
                                            <div style={{
                                                position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                opacity: 0, transition: 'opacity 0.2s', fontSize: '11px', fontWeight: 'bold',
                                                color: 'white', textTransform: 'uppercase', letterSpacing: '0.5px',
                                                flexDirection: 'column', gap: '2px'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                            onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                                            >
                                                Change<br/>Avatar
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <button 
                                                type="button" className="btn" 
                                                disabled={avatarUploading}
                                                onClick={() => document.getElementById('avatar-file-input')?.click()}
                                                style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 'bold' }}
                                            >
                                                {avatarUploading ? 'Uploading...' : 'Change Avatar'}
                                            </button>
                                            {globalAvatar && (
                                                <button 
                                                    type="button"
                                                    onClick={() => setGlobalAvatar('')}
                                                    style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 'bold', backgroundColor: 'transparent', color: '#ed4245', border: '1px solid #ed4245', borderRadius: '4px', cursor: 'pointer' }}
                                                >
                                                    Remove Avatar
                                                </button>
                                            )}
                                        </div>
                                        <input 
                                            id="avatar-file-input"
                                            type="file" 
                                            accept="image/png,image/jpeg,image/gif,image/webp" 
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleAvatarUpload(file);
                                                e.target.value = '';
                                            }}
                                        />
                                    </div>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Display Name</label>
                                    <input 
                                        type="text" 
                                        value={globalDisplayName} 
                                        onChange={e => setGlobalDisplayName(e.target.value)}
                                        placeholder="Your display name"
                                        maxLength={50}
                                        style={{ padding: '10px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                                    />
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>This is how others see you when you join guilds.</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Status Message</label>
                                    <input 
                                        type="text" 
                                        value={globalStatus} 
                                        onChange={e => setGlobalStatus(e.target.value)}
                                        placeholder="What's on your mind?"
                                        maxLength={100}
                                        style={{ padding: '10px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>About Me</label>
                                    <textarea 
                                        value={globalBio} 
                                        onChange={e => setGlobalBio(e.target.value)}
                                        placeholder="Tell people a little about yourself..."
                                        rows={4}
                                        style={{ padding: '10px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', resize: 'none' }}
                                    />
                                </div>
                            </form>
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Appearance</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Theme</h3>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input type="radio" name="theme" value="dark" checked={clientSettings.theme !== 'light'} onChange={() => setClientSettings({ theme: 'dark' })} />
                                            Dark
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input type="radio" name="theme" value="light" checked={clientSettings.theme === 'light'} onChange={() => setClientSettings({ theme: 'light' })} />
                                            Light
                                        </label>
                                    </div>
                                    <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>Theme settings are specific to this device.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'notifications' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Notifications</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Global Notification Settings</h3>
                                    <ToggleSwitch 
                                        label="Mute All Notifications" 
                                        description="Completely mute all incoming notification sounds and alerts globally."
                                        checked={!!accountSettings?.notifications?.muteAll}
                                        onChange={(c) => updateAccountSettings({ notifications: { ...accountSettings?.notifications, muteAll: c } })}
                                    />
                                    <ToggleSwitch 
                                        label="Mute @everyone & @here" 
                                        description="Ignore mass mentions across all servers."
                                        checked={!!accountSettings?.notifications?.muteEveryone}
                                        onChange={(c) => updateAccountSettings({ notifications: { ...accountSettings?.notifications, muteEveryone: c } })}
                                    />
                                    <ToggleSwitch 
                                        label="Mute Mentions" 
                                        description="Ignore notifications when someone explicitly mentions you."
                                        checked={!!accountSettings?.notifications?.muteMentions}
                                        onChange={(c) => updateAccountSettings({ notifications: { ...accountSettings?.notifications, muteMentions: c } })}
                                    />
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sounds</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>Notification Sound</label>
                                        <select 
                                            value={accountSettings?.notifications?.sound || 'default'} 
                                            onChange={(e) => updateAccountSettings({ notifications: { ...accountSettings?.notifications, sound: e.target.value } })}
                                            style={{ padding: '10px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', outline: 'none', cursor: 'pointer', maxWidth: '300px' }}
                                        >
                                            <option value="default">Default</option>
                                            <option value="chime">Chime</option>
                                            <option value="subtle">Subtle</option>
                                        </select>
                                    </div>
                                    <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>These settings are saved to your account and sync across devices.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'voice-video' && (
                        <div style={{ color: 'var(--text-normal)' }}>
                            <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Voice & Video Settings</h2>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Hardware Devices</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <DeviceSelect 
                                            label="Microphone" 
                                            value={audioSettings.inputDeviceId || 'default'} 
                                            devices={audioInputs} 
                                            onChange={(id) => setAudioSettings({ inputDeviceId: id })} 
                                        />
                                        <DeviceSelect 
                                            label="Speaker" 
                                            value={audioSettings.outputDeviceId || 'default'} 
                                            devices={audioOutputs} 
                                            onChange={(id) => setAudioSettings({ outputDeviceId: id })} 
                                        />
                                        <DeviceSelect 
                                            label="Camera" 
                                            value={audioSettings.videoCameraId || 'default'} 
                                            devices={videoInputs} 
                                            onChange={(id) => setAudioSettings({ videoCameraId: id })} 
                                        />
                                    </div>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Input Mode</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>Input Mode</label>
                                            <select 
                                                value={audioSettings.inputMode || 'voiceActivity'} 
                                                onChange={(e) => setAudioSettings({ inputMode: e.target.value as any })}
                                                style={{ padding: '10px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', outline: 'none', cursor: 'pointer' }}
                                            >
                                                <option value="voiceActivity">Voice Activity</option>
                                                <option value="pushToTalk">Push to Talk</option>
                                            </select>
                                        </div>
                                        {audioSettings.inputMode === 'pushToTalk' && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>Shortcut</label>
                                                <button 
                                                    onClick={(e) => {
                                                        const target = e.currentTarget;
                                                        target.innerText = 'Listening for key...';
                                                        const onKeyDown = (ev: KeyboardEvent) => {
                                                            ev.preventDefault();
                                                            setAudioSettings({ pttKey: ev.code });
                                                            window.removeEventListener('keydown', onKeyDown);
                                                        };
                                                        window.addEventListener('keydown', onKeyDown);
                                                    }}
                                                    style={{ padding: '10px 12px', borderRadius: '4px', border: '1px solid var(--divider)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', textAlign: 'left', cursor: 'pointer' }}
                                                >
                                                    {audioSettings.pttKey || 'Click to set shortcut'}
                                                </button>
                                            </div>
                                        )}
                                        {audioSettings.inputMode !== 'pushToTalk' && (
                                            <>
                                                <ToggleSwitch 
                                                    label="Automatically determine input sensitivity" 
                                                    description="If disabled, you can manually set the decibel threshold."
                                                    checked={audioSettings.voiceActivityMode === 'auto'}
                                                    onChange={(c) => setAudioSettings({ voiceActivityMode: c ? 'auto' : 'manual' })}
                                                />
                                                {audioSettings.voiceActivityMode === 'manual' && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>Sensitivity Threshold: {audioSettings.voiceActivityThreshold} dB</label>
                                                        <input 
                                                            type="range" 
                                                            min="-100" 
                                                            max="0" 
                                                            value={audioSettings.voiceActivityThreshold ?? -50} 
                                                            onChange={e => setAudioSettings({ voiceActivityThreshold: parseInt(e.target.value) })}
                                                            style={{ width: '100%', cursor: 'pointer' }}
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        
                                        <MicTest deviceId={audioSettings.inputDeviceId} noiseSuppression={audioSettings.noiseSuppression} echoCancellation={audioSettings.echoCancellation} autoGainControl={audioSettings.autoGainControl} />
                                    </div>
                                </div>
                                <div style={{ height: '1px', backgroundColor: 'var(--divider)' }} />
                                <div>
                                    <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Audio Processing</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <ToggleSwitch 
                                            label="Echo Cancellation" 
                                            description="Prevents your microphone from picking up audio from your speakers."
                                            checked={audioSettings.echoCancellation}
                                            onChange={(c) => setAudioSettings({ echoCancellation: c })}
                                        />
                                        <ToggleSwitch 
                                            label="Noise Suppression" 
                                            description="Filters out background noise from your microphone."
                                            checked={audioSettings.noiseSuppression}
                                            onChange={(c) => setAudioSettings({ noiseSuppression: c })}
                                        />
                                        <ToggleSwitch 
                                            label="Automatic Gain Control" 
                                            description="Automatically adjusts your microphone volume to keep it consistent."
                                            checked={audioSettings.autoGainControl}
                                            onChange={(c) => setAudioSettings({ autoGainControl: c })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showChangePassword && (
                <ChangePasswordModal 
                    email={currentAccount!.email}
                    serverUrl={actualPrimary}
                    token={currentAccount!.token || ''}
                    onSuccess={() => setShowChangePassword(false)}
                    onCancel={() => setShowChangePassword(false)}
                />
            )}

            {/* Close Button Container */}
            <div style={{ position: 'absolute', top: '32px', right: '32px' }}>
                <div onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                    <X size={20} />
                </div>
                <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', marginTop: '8px' }}>
                    ESC
                </div>
            </div>
            
            <SaveBanner 
                show={activeTab === 'profile' && profileIsDirty}
                isSaving={profileSaving}
                errorMessage={profileError}
                onSave={(e: any) => handleSaveProfile(e || { preventDefault: () => {} })}
                onReset={() => {
                    setGlobalDisplayName(initialGlobalDisplayName);
                    setGlobalBio(initialGlobalBio);
                    setGlobalAvatar(initialGlobalAvatar);
                    setGlobalStatus(initialGlobalStatus);
                }}
            />
        </div>
    );
};

const ToggleSwitch = ({ checked, onChange, label, description }: { checked: boolean, onChange: (c: boolean) => void, label: string, description: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--divider)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '15px', fontWeight: 'bold' }}>{label}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{description}</span>
        </div>
        <div 
            onClick={() => onChange(!checked)}
            style={{ width: '40px', height: '24px', borderRadius: '12px', backgroundColor: checked ? 'var(--brand-experiment)' : 'var(--bg-modifier-active)', position: 'relative', cursor: 'pointer', transition: 'background-color 0.2s', flexShrink: 0 }}
        >
            <div style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'white', position: 'absolute', top: '3px', left: checked ? '19px' : '3px', transition: 'left 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
        </div>
    </div>
);

const DeviceSelect = ({ label, value, devices, onChange }: { label: string, value: string, devices: MediaDeviceInfo[], onChange: (id: string) => void }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>{label}</label>
        <select 
            value={value} 
            onChange={(e) => onChange(e.target.value)}
            style={{ 
                padding: '10px 12px', 
                borderRadius: '4px', 
                border: 'none',
                backgroundColor: 'var(--bg-tertiary)', 
                color: 'var(--text-normal)',
                outline: 'none',
                cursor: 'pointer'
            }}
        >
            <option value="default">System Default</option>
            {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} (${d.deviceId.substring(0, 5)})`}</option>
            ))}
        </select>
    </div>
);

const MicTest = ({ deviceId, noiseSuppression, echoCancellation, autoGainControl }: { deviceId?: string, noiseSuppression: boolean, echoCancellation: boolean, autoGainControl: boolean }) => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const levelDb = useMicrophoneLevel(stream);

    const toggleTest = async () => {
        if (isTesting) {
            stream?.getTracks().forEach(t => t.stop());
            setStream(null);
            setIsTesting(false);
        } else {
            try {
                const s = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
                        noiseSuppression,
                        echoCancellation,
                        autoGainControl
                    }
                });
                setStream(s);
                setIsTesting(true);
            } catch(e) {
                console.error("Mic test failed", e);
            }
        }
    };

    useEffect(() => {
        return () => {
            stream?.getTracks().forEach(t => t.stop());
        };
    }, [stream]);

    const percentage = Math.max(0, Math.min(100, levelDb + 100));
    
    return (
        <div style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '15px', fontWeight: 'bold' }}>Mic Test</span>
                <button onClick={toggleTest} className="btn" style={{ padding: '6px 12px', fontSize: '13px' }}>
                    {isTesting ? 'Stop Testing' : 'Let\'s Check'}
                </button>
            </div>
            <div style={{ height: '8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ 
                    height: '100%', 
                    width: `${percentage}%`, 
                    backgroundColor: percentage > 80 ? '#f23f42' : percentage > 50 ? '#faa61a' : '#23a559',
                    transition: 'width 0.1s ease-out, background-color 0.2s'
                }} />
            </div>
            {isTesting && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Level: {levelDb === -100 ? '-∞' : levelDb.toFixed(1)} dB</div>}
        </div>
    );
};

