import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';
import { WizardStepName } from './WizardStepName';
import { WizardStepOwner } from './WizardStepOwner';
import { WizardStepChannels } from './WizardStepChannels';
import { WizardStepConfirm } from './WizardStepConfirm';

export type WizardStepId = 'name' | 'owner' | 'channels' | 'confirm';

export interface WizardState {
    step: WizardStepId;
    guildName: string;
    guildIcon: File | null;
    guildIconPreview: string | null;
    guildDescription: string;
    ownerMode: 'self' | 'other';
    ownerEmail: string;
    textChannels: { name: string; id: string }[];
    voiceChannels: { name: string; id: string }[];
    isCreating: boolean;
    error: string;
}

export interface GuildSetupWizardProps {
    isOpen: boolean;
    onClose: () => void;
    provisionCode?: string;
    targetNodeUrl?: string;
    fetchGuilds?: () => Promise<void>;
}

let channelCounter = 0;
const nextChannelId = () => `ch-${++channelCounter}-${Date.now()}`;

const initialState = (): WizardState => ({
    step: 'name',
    guildName: '',
    guildIcon: null,
    guildIconPreview: null,
    guildDescription: '',
    ownerMode: 'self',
    ownerEmail: '',
    textChannels: [
        { name: 'general', id: nextChannelId() },
        { name: 'announcements', id: nextChannelId() },
    ],
    voiceChannels: [
        { name: 'General', id: nextChannelId() },
    ],
    isCreating: false,
    error: '',
});

export const GuildSetupWizard = ({
    isOpen, onClose, provisionCode, targetNodeUrl, fetchGuilds,
}: GuildSetupWizardProps) => {
    const [state, setState] = useState<WizardState>(initialState);
    const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

    const currentAccount = useAppStore(s => s.currentAccount);
    const setActiveGuildId = useAppStore(s => s.setActiveGuildId);
    const connectedServers = useAppStore(s => s.connectedServers);

    const isOperator = !!currentAccount?.is_creator;

    const nodeUrl = useMemo(() => {
        if (targetNodeUrl) return targetNodeUrl;
        if (currentAccount?.primary_server_url) return currentAccount.primary_server_url;
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return safe[0]?.url || localStorage.getItem('harmony_last_server_url') || '';
    }, [targetNodeUrl, currentAccount, connectedServers]);

    // Build the step sequence — owner step only for operators
    const steps = useMemo<WizardStepId[]>(() => {
        const s: WizardStepId[] = ['name'];
        if (isOperator) s.push('owner');
        s.push('channels', 'confirm');
        return s;
    }, [isOperator]);

    const currentIdx = steps.indexOf(state.step);
    const isFirst = currentIdx === 0;
    const isLast = currentIdx === steps.length - 1;

    // Reset state when wizard opens
    useEffect(() => {
        if (isOpen) {
            channelCounter = 0;
            setState(initialState());
            setDirection('forward');
        }
    }, [isOpen]);

    // Validation per step
    const validateStep = useCallback((): string | null => {
        switch (state.step) {
            case 'name':
                if (state.guildName.trim().length < 2) return 'Guild name must be at least 2 characters.';
                if (state.guildName.trim().length > 100) return 'Guild name must be under 100 characters.';
                return null;
            case 'owner':
                if (state.ownerMode === 'other' && (!state.ownerEmail.trim() || !state.ownerEmail.includes('@')))
                    return 'Please enter a valid email address.';
                return null;
            case 'channels': {
                const validText = state.textChannels.filter(c => c.name.trim().length > 0);
                if (validText.length === 0) return 'At least one text channel is required.';
                // Check duplicates within each type separately (text and voice are different namespaces)
                const textNames = state.textChannels.map(c => c.name.trim().toLowerCase()).filter(Boolean);
                const textDupes = textNames.filter((n, i) => textNames.indexOf(n) !== i);
                if (textDupes.length > 0) return `Duplicate text channel name: "${textDupes[0]}"`;
                const voiceNames = state.voiceChannels.map(c => c.name.trim().toLowerCase()).filter(Boolean);
                const voiceDupes = voiceNames.filter((n, i) => voiceNames.indexOf(n) !== i);
                if (voiceDupes.length > 0) return `Duplicate voice channel name: "${voiceDupes[0]}"`;
                const tooLong = [...state.textChannels, ...state.voiceChannels].find(c => c.name.length > 100);
                if (tooLong) return `Channel name "${tooLong.name}" exceeds 100 characters.`;
                return null;
            }
            default:
                return null;
        }
    }, [state]);

    const handleNext = useCallback(() => {
        const err = validateStep();
        if (err) {
            setState(s => ({ ...s, error: err }));
            return;
        }
        setState(s => ({ ...s, error: '' }));
        if (!isLast) {
            setDirection('forward');
            setState(s => ({ ...s, step: steps[currentIdx + 1] }));
        }
    }, [validateStep, isLast, steps, currentIdx]);

    const handleBack = useCallback(() => {
        if (!isFirst) {
            setDirection('backward');
            setState(s => ({ ...s, step: steps[currentIdx - 1], error: '' }));
        }
    }, [isFirst, steps, currentIdx]);

    // Create guild — two-step: JSON create, then multipart icon upload
    const handleCreate = useCallback(async () => {
        if (!currentAccount?.token) return;
        setState(s => ({ ...s, isCreating: true, error: '' }));

        const createPayload = {
            name: state.guildName.trim(),
            description: state.guildDescription.trim() || undefined,
            provisionCode: provisionCode || undefined,
            ownerEmail: state.ownerMode === 'other' ? state.ownerEmail.trim() : undefined,
            channels: {
                text: state.textChannels.filter(c => c.name.trim()).map(c => c.name.trim()),
                voice: state.voiceChannels.filter(c => c.name.trim()).map(c => c.name.trim()),
            },
        };

        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`,
                },
                body: JSON.stringify(createPayload),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setState(s => ({ ...s, isCreating: false, error: body.error || `Server error (${res.status})` }));
                return;
            }

            const { id: newGuildId } = await res.json();

            // Step 2: Upload icon (non-fatal)
            if (state.guildIcon && newGuildId) {
                try {
                    const iconForm = new FormData();
                    iconForm.append('icon', state.guildIcon);
                    await apiFetch(`${nodeUrl}/api/guilds/${newGuildId}/icon`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` },
                        body: iconForm,
                    });
                } catch (iconErr) {
                    console.warn('Icon upload failed (non-fatal):', iconErr);
                }
            }

            // Success — refresh guild list, select the new guild, close wizard
            if (fetchGuilds) await fetchGuilds();
            setActiveGuildId(newGuildId);
            onClose();
        } catch (err: any) {
            setState(s => ({ ...s, isCreating: false, error: err.message || 'Network error' }));
        }
    }, [state, currentAccount, nodeUrl, provisionCode, fetchGuilds, setActiveGuildId, onClose]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Don't advance if inside a textarea or if we're on the confirm step
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'TEXTAREA') return;
                if (state.step === 'confirm') return;
                e.preventDefault();
                handleNext();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose, handleNext, state.step]);

    if (!isOpen) return null;

    const update = <K extends keyof WizardState>(key: K, val: WizardState[K]) =>
        setState(s => ({ ...s, [key]: val, error: '' }));

    return (
        <div
            className="wizard-overlay"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label="Guild Setup Wizard"
            data-testid="guild-setup-wizard"
        >
            <div className="wizard-panel glass-panel">
                {/* Progress dots */}
                <div className="wizard-progress" data-testid="wizard-progress">
                    {steps.map((s, i) => (
                        <div
                            key={s}
                            className={`dot ${i === currentIdx ? 'active' : ''} ${i < currentIdx ? 'completed' : ''}`}
                        />
                    ))}
                </div>

                {/* Step content — keyed on step for animation reset */}
                <div key={state.step} className={`wizard-step ${direction === 'backward' ? 'reverse' : ''}`}>
                    {state.step === 'name' && (
                        <WizardStepName
                            guildName={state.guildName}
                            setGuildName={v => update('guildName', v)}
                            guildIcon={state.guildIcon}
                            setGuildIcon={v => update('guildIcon', v)}
                            guildIconPreview={state.guildIconPreview}
                            setGuildIconPreview={v => update('guildIconPreview', v)}
                            guildDescription={state.guildDescription}
                            setGuildDescription={v => update('guildDescription', v)}
                        />
                    )}
                    {state.step === 'owner' && (
                        <WizardStepOwner
                            ownerMode={state.ownerMode}
                            setOwnerMode={v => update('ownerMode', v)}
                            ownerEmail={state.ownerEmail}
                            setOwnerEmail={v => update('ownerEmail', v)}
                            currentEmail={currentAccount?.email || ''}
                        />
                    )}
                    {state.step === 'channels' && (
                        <WizardStepChannels
                            textChannels={state.textChannels}
                            setTextChannels={v => update('textChannels', v)}
                            voiceChannels={state.voiceChannels}
                            setVoiceChannels={v => update('voiceChannels', v)}
                        />
                    )}
                    {state.step === 'confirm' && (
                        <WizardStepConfirm
                            guildName={state.guildName}
                            guildIconPreview={state.guildIconPreview}
                            guildDescription={state.guildDescription}
                            textChannels={state.textChannels}
                            voiceChannels={state.voiceChannels}
                            ownerEmail={state.ownerEmail}
                            ownerMode={state.ownerMode}
                            currentEmail={currentAccount?.email || ''}
                            targetNodeUrl={nodeUrl}
                            isCreating={state.isCreating}
                            error={state.error}
                        />
                    )}
                </div>

                {/* Error display */}
                {state.error && (
                    <div className="wizard-error" data-testid="wizard-error">{state.error}</div>
                )}

                {/* Navigation buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', gap: '12px' }}>
                    <button
                        className="wizard-btn-nav"
                        onClick={isFirst ? onClose : handleBack}
                        disabled={state.isCreating}
                        data-testid="wizard-back-btn"
                    >
                        {isFirst ? 'Cancel' : '← Back'}
                    </button>

                    {isLast ? (
                        <button
                            className="wizard-btn-create"
                            onClick={handleCreate}
                            disabled={state.isCreating}
                            data-testid="wizard-create-btn"
                            style={{ flex: 1 }}
                        >
                            {state.isCreating ? 'Creating...' : '🚀 Create Guild'}
                        </button>
                    ) : (
                        <button
                            className="btn"
                            onClick={handleNext}
                            data-testid="wizard-next-btn"
                            style={{ padding: '10px 24px' }}
                        >
                            Next →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
