import React from 'react';
import { useContextMenuStore } from '../../store/contextMenuStore';

export const Toast: React.FC = () => {
    const toasts = useContextMenuStore((state) => state.toasts);

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container" data-testid="toast-container">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className="toast-item"
                    data-testid={`toast-${toast.id}`}
                >
                    {toast.message}
                </div>
            ))}
        </div>
    );
};
