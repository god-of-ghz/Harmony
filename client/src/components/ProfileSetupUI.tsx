import React, { useState } from 'react';
import { ClaimCard } from './ui/ClaimCard';
import { ProfileGrid } from './ui/ProfileGrid';

interface ProfileInfo {
    id: string;
    name: string;
    avatar?: string;
}

export interface ProfileSetupUIProps {
    title: string;
    description: string;
    profiles: ProfileInfo[];
    serverUrl?: string; // used for prepending relative avatar paths
    onClaim: (id: string) => void;
    onFreshStart: (nickname: string) => void;
    isGuestSession?: boolean;
}

export const ProfileSetupUI: React.FC<ProfileSetupUIProps> = ({
    title,
    description,
    profiles,
    serverUrl = '',
    onClaim,
    onFreshStart,
    isGuestSession = false
}) => {
    const [tab, setTab] = useState<'create' | 'claim'>('create');
    const [nickname, setNickname] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!nickname.trim()) {
            setError('Please enter a nickname.');
            return;
        }
        onFreshStart(nickname);
    };

    return (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--bg-primary)', position: 'absolute', inset: 0, zIndex: 3000 }}>
            <div className="glass-panel" style={{ 
                width: '600px', padding: '40px', borderRadius: '16px',
                display: 'flex', flexDirection: 'column', gap: '24px',
                animation: 'modalSlideUp 0.3s ease-out',
                maxWidth: '90%'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--header-primary)' }}>{title}</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>{description}</p>
                </div>

                {error && (
                    <div style={{ color: '#ed4245', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                        {error}
                    </div>
                )}

                {profiles.length > 0 && !isGuestSession && (
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button
                            style={{
                                flex: 1, padding: '10px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold',
                                backgroundColor: tab === 'create' ? 'var(--brand-experiment)' : 'var(--bg-tertiary)', color: 'white',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => setTab('create')}
                        >
                            Create Profile
                        </button>
                        <button
                            style={{
                                flex: 1, padding: '10px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold',
                                backgroundColor: tab === 'claim' ? 'var(--brand-experiment)' : 'var(--bg-tertiary)', color: 'white',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => setTab('claim')}
                        >
                            Claim Existing Identity
                        </button>
                    </div>
                )}

                {tab === 'claim' && profiles.length > 0 && !isGuestSession ? (
                    <ProfileGrid>
                        {profiles.map(p => (
                            <ClaimCard 
                                key={p.id}
                                id={p.id}
                                original_username={p.name}
                                avatar={p.avatar}
                                serverUrl={serverUrl}
                                onClick={onClaim}
                            />
                        ))}
                    </ProfileGrid>
                ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label htmlFor="fresh-nickname" style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Choose a Nickname / Name</label>
                            <input
                                id="fresh-nickname"
                                data-testid="fresh-nickname"
                                type="text"
                                value={nickname}
                                onChange={e => setNickname(e.target.value)}
                                required
                                placeholder="What should we call you?"
                                style={{ padding: '12px', fontSize: '16px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button type="submit" className="btn" style={{ flex: 2, padding: '12px', fontWeight: 'bold', fontSize: '16px' }}>Continue</button>
                        </div>
                    </form>
                )}
            </div>

            <style>{`
                @keyframes modalSlideUp {
                    from { transform: translateY(30px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};
