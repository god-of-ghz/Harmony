import { Hash, Volume2, Globe, User } from 'lucide-react';

export interface WizardStepConfirmProps {
    guildName: string;
    guildIconPreview: string | null;
    guildDescription: string;
    textChannels: { name: string; id: string }[];
    voiceChannels: { name: string; id: string }[];
    ownerEmail: string;
    ownerMode: 'self' | 'other';
    currentEmail: string;
    targetNodeUrl?: string;
    isCreating: boolean;
    error: string;
}

export const WizardStepConfirm = ({
    guildName, guildIconPreview, guildDescription,
    textChannels, voiceChannels,
    ownerEmail, ownerMode, currentEmail,
    targetNodeUrl,
}: WizardStepConfirmProps) => {
    const initials = guildName.trim()
        ? guildName.trim().substring(0, 2).toUpperCase()
        : '??';

    const displayOwner = ownerMode === 'other' && ownerEmail ? ownerEmail : currentEmail;

    return (
        <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', color: 'var(--header-primary)' }}>
                🎉 Ready to Create!
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
                Review your guild settings before creating.
            </p>

            {/* Guild identity card */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '16px',
                padding: '16px', borderRadius: '10px',
                backgroundColor: 'var(--bg-tertiary)', marginBottom: '20px',
            }}>
                {guildIconPreview ? (
                    <img
                        src={guildIconPreview}
                        alt={`${guildName} icon`}
                        style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                        data-testid="confirm-icon-preview"
                    />
                ) : (
                    <div className="wizard-icon-fallback" style={{ width: '56px', height: '56px', fontSize: '20px' }}>
                        {initials}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--header-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        data-testid="confirm-guild-name"
                    >
                        {guildName}
                    </div>
                    {guildDescription && (
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {guildDescription}
                        </div>
                    )}
                </div>
            </div>

            {/* Channels summary */}
            <div className="wizard-section-label">Channels</div>
            <div style={{
                backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px',
                padding: '12px 16px', marginBottom: '16px',
                display: 'flex', flexDirection: 'column', gap: '6px',
            }}
                data-testid="confirm-channels"
            >
                {textChannels.filter(c => c.name.trim()).map(ch => (
                    <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-normal)' }}>
                        <Hash size={14} color="var(--text-muted)" />
                        <span>{ch.name}</span>
                    </div>
                ))}
                {voiceChannels.filter(c => c.name.trim()).map(ch => (
                    <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-normal)' }}>
                        <Volume2 size={14} color="var(--text-muted)" />
                        <span>{ch.name}</span>
                    </div>
                ))}
            </div>

            {/* Meta info */}
            <div style={{
                display: 'flex', flexDirection: 'column', gap: '8px',
                fontSize: '13px', color: 'var(--text-muted)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <User size={14} />
                    <span>Owner: <span style={{ color: 'var(--text-normal)' }} data-testid="confirm-owner">{displayOwner}</span></span>
                </div>
                {targetNodeUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Globe size={14} />
                        <span>Server: <span style={{ color: 'var(--text-normal)' }} data-testid="confirm-node">{targetNodeUrl}</span></span>
                    </div>
                )}
            </div>
        </div>
    );
};
