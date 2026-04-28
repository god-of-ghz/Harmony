import { Hash, Volume2, X, Plus, LayoutTemplate } from 'lucide-react';

export interface WizardStepChannelsProps {
    textChannels: { name: string; id: string }[];
    setTextChannels: (channels: { name: string; id: string }[]) => void;
    voiceChannels: { name: string; id: string }[];
    setVoiceChannels: (channels: { name: string; id: string }[]) => void;
}

let addCounter = 0;
const nextId = () => `add-${++addCounter}-${Date.now()}`;

export const WizardStepChannels = ({
    textChannels, setTextChannels,
    voiceChannels, setVoiceChannels,
}: WizardStepChannelsProps) => {

    // ── Text channel helpers ──
    const updateTextName = (id: string, name: string) => {
        // Auto-sanitize for text channels: lowercase, spaces → hyphens
        const sanitized = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
        setTextChannels(textChannels.map(c => c.id === id ? { ...c, name: sanitized } : c));
    };

    const removeText = (id: string) => {
        setTextChannels(textChannels.filter(c => c.id !== id));
    };

    const addText = () => {
        const n = textChannels.length + 1;
        setTextChannels([...textChannels, { name: `new-channel-${n}`, id: nextId() }]);
    };

    // ── Voice channel helpers ──
    const updateVoiceName = (id: string, name: string) => {
        setVoiceChannels(voiceChannels.map(c => c.id === id ? { ...c, name } : c));
    };

    const removeVoice = (id: string) => {
        setVoiceChannels(voiceChannels.filter(c => c.id !== id));
    };

    const addVoice = () => {
        const n = voiceChannels.length + 1;
        setVoiceChannels([...voiceChannels, { name: `Voice ${n}`, id: nextId() }]);
    };

    return (
        <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', color: 'var(--header-primary)' }}>
                📝 Set Up Channels
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px', lineHeight: 1.5 }}>
                We've created some default channels to get you started. You can add, remove, or rename them.
            </p>

            {/* ── Text Channels ── */}
            <div className="wizard-section-label">Text Channels</div>
            <div
                style={{
                    backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px',
                    padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px',
                }}
                data-testid="text-channels-list"
            >
                {textChannels.map(ch => (
                    <div key={ch.id} className="wizard-channel-row" data-testid={`text-channel-${ch.id}`}>
                        <Hash size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <input
                            value={ch.name}
                            onChange={e => updateTextName(ch.id, e.target.value)}
                            placeholder="channel-name"
                            maxLength={100}
                            aria-label={`Text channel name: ${ch.name}`}
                            data-testid={`text-channel-input-${ch.id}`}
                        />
                        <button
                            className="channel-delete"
                            onClick={() => removeText(ch.id)}
                            aria-label={`Remove text channel ${ch.name}`}
                            data-testid={`text-channel-delete-${ch.id}`}
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
                <button
                    className="wizard-channel-add"
                    onClick={addText}
                    data-testid="add-text-channel-btn"
                    type="button"
                >
                    <Plus size={14} /> Add Channel
                </button>
            </div>

            {/* ── Voice Channels ── */}
            <div className="wizard-section-label" style={{ marginTop: '20px' }}>Voice Channels</div>
            <div
                style={{
                    backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px',
                    padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px',
                }}
                data-testid="voice-channels-list"
            >
                {voiceChannels.map(ch => (
                    <div key={ch.id} className="wizard-channel-row" data-testid={`voice-channel-${ch.id}`}>
                        <Volume2 size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <input
                            value={ch.name}
                            onChange={e => updateVoiceName(ch.id, e.target.value)}
                            placeholder="Channel Name"
                            maxLength={100}
                            aria-label={`Voice channel name: ${ch.name}`}
                            data-testid={`voice-channel-input-${ch.id}`}
                        />
                        <button
                            className="channel-delete"
                            onClick={() => removeVoice(ch.id)}
                            aria-label={`Remove voice channel ${ch.name}`}
                            data-testid={`voice-channel-delete-${ch.id}`}
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
                <button
                    className="wizard-channel-add"
                    onClick={addVoice}
                    data-testid="add-voice-channel-btn"
                    type="button"
                >
                    <Plus size={14} /> Add Channel
                </button>
            </div>

            {/* Template placeholder */}
            <div className="wizard-template-placeholder">
                <LayoutTemplate size={16} />
                <span>Templates (Gaming, Community, Study Group)</span>
                <span className="badge">Coming Soon</span>
            </div>
        </div>
    );
};
