import { useState, useEffect, useCallback } from 'react';
import { Plus, Link } from 'lucide-react';
import { JoinGuildFlow } from './JoinGuildFlow';
import { CreateGuildFlow } from './CreateGuildFlow';

export interface CreateJoinModalProps {
    isOpen: boolean;
    onClose: () => void;
    fetchGuilds: () => Promise<void>;
    onStartGuildSetup: (provisionCode?: string, targetNodeUrl?: string) => void;
}

type ModalView = 'choice' | 'join' | 'create';

export const CreateJoinModal = ({ isOpen, onClose, fetchGuilds, onStartGuildSetup }: CreateJoinModalProps) => {
    const [view, setView] = useState<ModalView>('choice');

    // Reset to choice view whenever the modal opens
    useEffect(() => {
        if (isOpen) {
            setView('choice');
        }
    }, [isOpen]);

    // Handle Escape key
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="modal-overlay"
            onClick={handleOverlayClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-join-modal-title"
            style={{
                position: 'fixed', inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 2000,
                animation: 'modalFadeIn 0.2s ease-out'
            }}
        >
            <div
                className="glass-panel"
                style={{
                    padding: '32px', borderRadius: '12px',
                    width: view === 'choice' ? '480px' : '440px',
                    maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
                    color: 'var(--text-normal)',
                    animation: 'modalSlideIn 0.25s ease-out',
                    transition: 'width 0.2s ease'
                }}
            >
                {view === 'choice' && (
                    <div className="create-join-choice">
                        <h2
                            id="create-join-modal-title"
                            style={{
                                textAlign: 'center', marginBottom: '8px', fontSize: '22px',
                                fontWeight: 700, color: 'var(--header-primary)'
                            }}
                        >
                            Create or Join a Guild
                        </h2>
                        <p style={{
                            textAlign: 'center', color: 'var(--text-muted)',
                            marginBottom: '28px', fontSize: '14px'
                        }}>
                            Start your own community or join an existing one
                        </p>

                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr',
                            gap: '16px', marginBottom: '24px'
                        }}>
                            {/* Create Card */}
                            <button
                                className="create-join-card"
                                data-testid="create-guild-card"
                                onClick={() => setView('create')}
                                aria-label="Create a Guild"
                                style={{
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    padding: '28px 20px', borderRadius: '12px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    background: 'linear-gradient(135deg, rgba(88, 101, 242, 0.12), rgba(88, 101, 242, 0.03))',
                                    cursor: 'pointer', gap: '14px',
                                    transition: 'all 0.2s ease',
                                    color: 'var(--text-normal)', minHeight: '160px'
                                }}
                            >
                                <div style={{
                                    width: '56px', height: '56px', borderRadius: '16px',
                                    background: 'linear-gradient(135deg, var(--brand-experiment), #4752C4)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 4px 12px rgba(88, 101, 242, 0.3)'
                                }}>
                                    <Plus size={28} color="white" />
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ fontWeight: 600, fontSize: '15px', margin: '0 0 4px 0' }}>
                                        Create
                                    </p>
                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                                        a Guild
                                    </p>
                                </div>
                            </button>

                            {/* Join Card */}
                            <button
                                className="create-join-card"
                                data-testid="join-guild-card"
                                onClick={() => setView('join')}
                                aria-label="Join a Guild"
                                style={{
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    padding: '28px 20px', borderRadius: '12px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    background: 'linear-gradient(135deg, rgba(35, 165, 89, 0.12), rgba(35, 165, 89, 0.03))',
                                    cursor: 'pointer', gap: '14px',
                                    transition: 'all 0.2s ease',
                                    color: 'var(--text-normal)', minHeight: '160px'
                                }}
                            >
                                <div style={{
                                    width: '56px', height: '56px', borderRadius: '16px',
                                    background: 'linear-gradient(135deg, #23a559, #1a8b46)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 4px 12px rgba(35, 165, 89, 0.3)'
                                }}>
                                    <Link size={28} color="white" />
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ fontWeight: 600, fontSize: '15px', margin: '0 0 4px 0' }}>
                                        Join
                                    </p>
                                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                                        a Guild
                                    </p>
                                </div>
                            </button>
                        </div>

                        <button
                            onClick={onClose}
                            data-testid="create-join-cancel"
                            style={{
                                width: '100%', padding: '10px',
                                border: 'none', backgroundColor: 'transparent',
                                color: 'var(--text-muted)', cursor: 'pointer',
                                borderRadius: '4px', fontSize: '14px',
                                transition: 'color 0.15s ease'
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}

                {view === 'join' && (
                    <JoinGuildFlow
                        onClose={onClose}
                        onBack={() => setView('choice')}
                        fetchGuilds={fetchGuilds}
                    />
                )}

                {view === 'create' && (
                    <CreateGuildFlow
                        onClose={onClose}
                        onBack={() => setView('choice')}
                        onStartSetup={(code, nodeUrl) => onStartGuildSetup(code, nodeUrl)}
                    />
                )}
            </div>
        </div>
    );
};
