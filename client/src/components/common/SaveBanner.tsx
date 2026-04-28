import React from 'react';

interface SaveBannerProps {
    show: boolean;
    isSaving: boolean;
    onSave: () => void;
    onReset: () => void;
    errorMessage?: string;
}

export const SaveBanner: React.FC<SaveBannerProps> = ({ show, isSaving, onSave, onReset, errorMessage }) => {
    if (!show && !isSaving && !errorMessage) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 48px)',
            maxWidth: '800px',
            backgroundColor: 'var(--bg-floating)',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 8px 16px rgba(0,0,0,0.24)',
            zIndex: 100000,
            animation: 'slideUp 0.3s ease-out'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text-normal)' }}>
                    Careful — you have unsaved changes!
                </span>
                {errorMessage && (
                    <span style={{ color: '#ed4245', fontSize: '13px' }}>
                        {errorMessage}
                    </span>
                )}
            </div>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button 
                    onClick={onReset}
                    disabled={isSaving}
                    style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: 'var(--text-normal)',
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        padding: '8px 16px',
                        opacity: isSaving ? 0.5 : 1
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                    Reset
                </button>
                <button
                    onClick={onSave}
                    disabled={isSaving}
                    className="btn"
                    style={{
                        backgroundColor: '#23a559',
                        color: 'white',
                        padding: '8px 16px',
                        fontWeight: 'bold',
                        opacity: isSaving ? 0.5 : 1
                    }}
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};
