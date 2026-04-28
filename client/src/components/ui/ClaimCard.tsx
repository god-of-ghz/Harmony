import React from 'react';

export interface ClaimCardProps {
    id: string;
    original_username: string;
    avatar?: string;
    serverUrl?: string; // Used to prepend if avatar is a relative path
    onClick: (id: string) => void;
}

export const ClaimCard: React.FC<ClaimCardProps> = ({ id, original_username, avatar, serverUrl = '', onClick }) => {
    return (
        <div 
            key={id}
            onClick={() => onClick(id)}
            className="claim-card"
            style={{
                backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
                cursor: 'pointer', transition: 'all 0.2s', border: '1px solid rgba(255,255,255,0.05)',
                position: 'relative', overflow: 'hidden'
            }}
        >
            {avatar ? (
                <img 
                    src={(avatar.startsWith('http') ? avatar : `${serverUrl}${avatar}`)} 
                    alt={original_username} 
                    style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }} 
                />
            ) : (
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                    {original_username.substring(0, 2).toUpperCase()}
                </div>
            )}
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--header-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100px' }}>
                    {original_username}
                </div>
            </div>
        </div>
    );
};
