import { useState, useEffect, useRef } from 'react';

interface FloatingInputProps {
    /** Title shown at the top of the modal */
    title: string;
    /** Description/subtitle text below the title */
    description?: string;
    /** Label above the input field */
    label: string;
    /** HTML input type (text, password, email, etc.) */
    type?: string;
    /** Placeholder text for the input */
    placeholder?: string;
    /** Text for the confirm/submit button */
    confirmText?: string;
    /** Text for the cancel button */
    cancelText?: string;
    /** Called with the input value on confirm */
    onConfirm: (value: string) => void | Promise<void>;
    /** Called on cancel/dismiss */
    onCancel: () => void;
    /** External error message to display */
    error?: string;
    /** Whether the confirm action is in progress */
    loading?: boolean;
}

/**
 * A reusable floating modal with a single text input field.
 * Designed for inline prompts: password re-entry, rename fields, URL entry, etc.
 * Renders as a fixed overlay with a centered card.
 */
export const FloatingInput = ({
    title,
    description,
    label,
    type = 'text',
    placeholder = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    error,
    loading = false,
}: FloatingInputProps) => {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Auto-focus the input when the modal mounts
        inputRef.current?.focus();
    }, []);

    // Close on Escape key
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onCancel]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value.trim() && !loading) {
            onConfirm(value);
        }
    };

    return (
        <div
            data-testid="floating-input-overlay"
            style={{
                position: 'fixed', inset: 0,
                backgroundColor: 'rgba(0,0,0,0.85)',
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 10001,
                animation: 'fadeIn 0.15s ease-out',
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div
                className="glass-panel"
                style={{
                    padding: '28px 32px', borderRadius: '8px', width: '400px',
                    color: 'var(--text-normal)',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
                }}
            >
                <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: 'var(--text-focus)' }}>{title}</h3>
                {description && (
                    <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                        {description}
                    </p>
                )}

                {error && (
                    <div style={{
                        color: '#ed4245', marginBottom: '12px', fontSize: '13px',
                        padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)',
                        border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px',
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{
                            fontSize: '12px', fontWeight: 'bold',
                            textTransform: 'uppercase', color: 'var(--text-muted)',
                        }}>
                            {label}
                        </label>
                        <input
                            ref={inputRef}
                            data-testid="floating-input-field"
                            type={type}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={placeholder}
                            required
                            disabled={loading}
                            style={{
                                padding: '10px 12px', borderRadius: '4px', border: 'none',
                                backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                                fontSize: '15px', outline: 'none',
                                opacity: loading ? 0.6 : 1,
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            style={{
                                flex: 1, padding: '10px',
                                border: '1px solid var(--background-modifier-accent)',
                                backgroundColor: 'transparent', color: 'var(--text-normal)',
                                cursor: 'pointer', borderRadius: '4px', fontWeight: '500',
                            }}
                        >
                            {cancelText}
                        </button>
                        <button
                            type="submit"
                            className="btn"
                            disabled={loading || !value.trim()}
                            style={{
                                flex: 1, padding: '10px', fontWeight: 'bold',
                                opacity: (loading || !value.trim()) ? 0.6 : 1,
                            }}
                        >
                            {loading ? 'Working...' : confirmText}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
