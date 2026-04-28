import { useRef } from 'react';
import { Camera } from 'lucide-react';

export interface WizardStepNameProps {
    guildName: string;
    setGuildName: (name: string) => void;
    guildIcon: File | null;
    setGuildIcon: (file: File | null) => void;
    guildIconPreview: string | null;
    setGuildIconPreview: (url: string | null) => void;
    guildDescription: string;
    setGuildDescription: (desc: string) => void;
}

const MAX_ICON_SIZE = 8 * 1024 * 1024; // 8 MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const WizardStepName = ({
    guildName, setGuildName,
    guildIcon, setGuildIcon,
    guildIconPreview, setGuildIconPreview,
    guildDescription, setGuildDescription,
}: WizardStepNameProps) => {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!ACCEPTED_TYPES.includes(file.type)) {
            alert('Please select a valid image file (PNG, JPG, GIF, or WebP).');
            return;
        }
        if (file.size > MAX_ICON_SIZE) {
            alert('Image must be under 8 MB.');
            return;
        }

        setGuildIcon(file);
        setGuildIconPreview(URL.createObjectURL(file));
    };

    const initials = guildName.trim()
        ? guildName.trim().substring(0, 2).toUpperCase()
        : '??';

    return (
        <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', color: 'var(--header-primary)' }}>
                ✨ Create Your Guild
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
                Give your new community a personality with a name and icon. You can always change these later.
            </p>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '20px' }}>
                {/* Icon upload area */}
                <div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        data-testid="icon-file-input"
                        aria-label="Upload guild icon"
                    />
                    <div
                        className="wizard-icon-upload"
                        onClick={() => fileRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        aria-label="Click to upload guild icon"
                        data-testid="icon-upload-area"
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
                    >
                        {guildIconPreview ? (
                            <img
                                src={guildIconPreview}
                                alt="Guild icon preview"
                                className="wizard-icon-preview"
                                data-testid="icon-preview-img"
                            />
                        ) : (
                            <Camera size={28} />
                        )}
                    </div>
                    {guildIconPreview && (
                        <button
                            onClick={() => {
                                setGuildIcon(null);
                                setGuildIconPreview(null);
                                if (fileRef.current) fileRef.current.value = '';
                            }}
                            style={{
                                display: 'block', marginTop: '6px', background: 'none',
                                border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                                fontSize: '11px', width: '100%', textAlign: 'center',
                            }}
                        >
                            Remove
                        </button>
                    )}
                </div>

                {/* Name + Fallback preview */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                        <label
                            htmlFor="wizard-guild-name"
                            style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}
                        >
                            Guild Name <span style={{ color: '#ed4245' }}>*</span>
                        </label>
                        <input
                            id="wizard-guild-name"
                            className="input-field"
                            type="text"
                            placeholder="My Awesome Guild"
                            value={guildName}
                            onChange={e => setGuildName(e.target.value)}
                            maxLength={100}
                            autoFocus
                            data-testid="guild-name-input"
                            aria-label="Guild name"
                        />
                        <div style={{ fontSize: '11px', color: guildName.length > 90 ? '#faa61a' : 'var(--text-muted)', textAlign: 'right', marginTop: '4px' }}>
                            {guildName.length}/100
                        </div>
                    </div>

                    {/* Fallback preview — how it'll look in sidebar */}
                    {!guildIconPreview && guildName.trim().length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div className="wizard-icon-fallback" style={{ width: '36px', height: '36px', fontSize: '14px' }}>
                                {initials}
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sidebar preview</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Description */}
            <div>
                <label
                    htmlFor="wizard-guild-desc"
                    style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}
                >
                    Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                    id="wizard-guild-desc"
                    className="input-field"
                    placeholder="A place for friends to hang out"
                    value={guildDescription}
                    onChange={e => setGuildDescription(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    data-testid="guild-desc-input"
                    aria-label="Guild description"
                    style={{ resize: 'vertical', minHeight: '60px' }}
                />
                <div style={{ fontSize: '11px', color: guildDescription.length > 900 ? '#faa61a' : 'var(--text-muted)', textAlign: 'right', marginTop: '4px' }}>
                    {guildDescription.length}/1000
                </div>
            </div>
        </div>
    );
};
