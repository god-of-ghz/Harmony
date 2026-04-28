import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Settings, Mic, MicOff, Headphones } from 'lucide-react';
import { UserSettings } from './UserSettings';

export const UserPanel = () => {
    const { currentAccount, globalProfiles, isMuted, setIsMuted, isDeafened, setIsDeafened, connectedServers, showUserSettings, setShowUserSettings } = useAppStore();
    const [showSettings, setShowSettings] = useState(false);

    if (!currentAccount) return null;

    const globalProfile = globalProfiles?.[currentAccount.id];
    const username = globalProfile?.display_name || currentAccount.email?.split('@')[0] || 'User';
    const rawAvatar = globalProfile?.avatar_url;
    const safe = Array.isArray(connectedServers) ? connectedServers : [];
    const primaryUrl = currentAccount.primary_server_url || safe[0]?.url || '';
    const avatar = rawAvatar ? (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:') ? rawAvatar : `${primaryUrl}${rawAvatar}`) : null;

    return (
        <>
            <div style={{
                height: '52px',
                backgroundColor: 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                boxShadow: '0 -1px 2px rgba(0,0,0,0.2)',
                flexShrink: 0
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flex: 1,
                    padding: '4px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    overflow: 'hidden'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => setShowSettings(true)}>
                    <div style={{ position: 'relative', width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', overflow: 'hidden' }}>
                        {avatar ? (
                            <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                                {username.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: '#23a559',
                            border: '2px solid var(--bg-tertiary)'
                        }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-normal)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            {username}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            Online
                        </span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '4px' }}>
                    <div className="icon-btn" style={{ padding: '6px', borderRadius: '4px', cursor: 'pointer', color: isMuted ? '#ed4245' : 'var(--text-muted)' }}
                        onClick={() => setIsMuted(!isMuted)}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; if (!isMuted) e.currentTarget.style.color = 'var(--text-normal)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; if (!isMuted) e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                    </div>
                    <div className="icon-btn" style={{ padding: '6px', borderRadius: '4px', cursor: 'pointer', color: isDeafened ? '#ed4245' : 'var(--text-muted)', position: 'relative' }}
                        onClick={() => { setIsDeafened(!isDeafened); if (!isDeafened) setIsMuted(true); }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; if (!isDeafened) e.currentTarget.style.color = 'var(--text-normal)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; if (!isDeafened) e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        <Headphones size={18} />
                        {isDeafened && (
                            <div style={{ position: 'absolute', top: '15px', left: '4px', width: '22px', height: '2px', backgroundColor: '#ed4245', transform: 'rotate(-45deg)', borderRadius: '2px', pointerEvents: 'none' }} />
                        )}
                    </div>
                    <div className="icon-btn" style={{ padding: '6px', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}
                        onClick={() => setShowSettings(true)}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'; e.currentTarget.style.color = 'var(--text-normal)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        <Settings size={18} />
                    </div>
                </div>
            </div>

            {(showSettings || showUserSettings) && <UserSettings onClose={() => { setShowSettings(false); setShowUserSettings(false); }} />}
        </>
    );
};
