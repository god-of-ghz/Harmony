import { Crown } from 'lucide-react';

export interface WizardStepOwnerProps {
    ownerMode: 'self' | 'other';
    setOwnerMode: (mode: 'self' | 'other') => void;
    ownerEmail: string;
    setOwnerEmail: (email: string) => void;
    currentEmail: string;
}

export const WizardStepOwner = ({
    ownerMode, setOwnerMode,
    ownerEmail, setOwnerEmail,
    currentEmail,
}: WizardStepOwnerProps) => {
    return (
        <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', color: 'var(--header-primary)' }}>
                👑 Guild Ownership
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
                As the node operator, you can assign ownership of this guild to yourself or another registered user.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Self option */}
                <label
                    style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '14px 16px', borderRadius: '8px',
                        border: `1px solid ${ownerMode === 'self' ? 'var(--brand-experiment)' : 'rgba(255,255,255,0.08)'}`,
                        background: ownerMode === 'self' ? 'rgba(88, 101, 242, 0.08)' : 'transparent',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                    data-testid="owner-self-option"
                >
                    <input
                        type="radio"
                        name="owner-mode"
                        checked={ownerMode === 'self'}
                        onChange={() => setOwnerMode('self')}
                        style={{ accentColor: 'var(--brand-experiment)' }}
                    />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--header-primary)', fontSize: '14px' }}>
                            I'll be the owner
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {currentEmail}
                        </div>
                    </div>
                    <Crown size={20} color={ownerMode === 'self' ? 'var(--brand-experiment)' : 'var(--text-muted)'} />
                </label>

                {/* Other user option */}
                <label
                    style={{
                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                        padding: '14px 16px', borderRadius: '8px',
                        border: `1px solid ${ownerMode === 'other' ? 'var(--brand-experiment)' : 'rgba(255,255,255,0.08)'}`,
                        background: ownerMode === 'other' ? 'rgba(88, 101, 242, 0.08)' : 'transparent',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                    data-testid="owner-other-option"
                >
                    <input
                        type="radio"
                        name="owner-mode"
                        checked={ownerMode === 'other'}
                        onChange={() => setOwnerMode('other')}
                        style={{ accentColor: 'var(--brand-experiment)', marginTop: '3px' }}
                    />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--header-primary)', fontSize: '14px' }}>
                            Assign to another user
                        </div>
                        {ownerMode === 'other' && (
                            <input
                                className="input-field"
                                type="email"
                                placeholder="user@example.com"
                                value={ownerEmail}
                                onChange={e => setOwnerEmail(e.target.value)}
                                autoFocus
                                data-testid="owner-email-input"
                                aria-label="Owner email address"
                                onClick={e => e.stopPropagation()}
                                style={{ marginTop: '10px', fontSize: '14px', padding: '10px' }}
                            />
                        )}
                    </div>
                </label>
            </div>
        </div>
    );
};
