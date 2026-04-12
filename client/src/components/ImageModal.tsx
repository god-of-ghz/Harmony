import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export const ImageModal = () => {
    const { zoomedImageUrl, setZoomedImageUrl } = useAppStore();

    const handleClose = useCallback(() => {
        setZoomedImageUrl(null);
    }, [setZoomedImageUrl]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };

        if (zoomedImageUrl) {
            window.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [zoomedImageUrl, handleClose]);

    if (!zoomedImageUrl) return null;

    return (
        <div 
            id="image-zoom-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3000,
                cursor: 'zoom-out',
                animation: 'fadeIn 0.2s ease-out'
            }}
            onClick={handleClose}
        >
            <style>
                {`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes zoomInEffect {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                `}
            </style>
            
            <div 
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    display: 'flex',
                    gap: '12px',
                    zIndex: 3001
                }}
            >
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClose();
                    }}
                    style={{
                        background: 'rgba(0, 0, 0, 0.5)',
                        border: 'none',
                        color: 'white',
                        padding: '8px',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                        backdropFilter: 'blur(4px)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.8)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)')}
                    title="Close"
                >
                    <X size={24} />
                </button>
            </div>

            <div 
                style={{
                    maxWidth: '90vw',
                    maxHeight: '90vh',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'zoomInEffect 0.25s cubic-bezier(0.2, 0, 0.2, 1)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <img 
                    src={zoomedImageUrl} 
                    alt="Zoomed attachment" 
                    style={{
                        maxWidth: '100%',
                        maxHeight: '90vh',
                        borderRadius: '8px',
                        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
                        cursor: 'default',
                        objectFit: 'contain'
                    }}
                />
            </div>
            
            <div style={{
                position: 'absolute',
                bottom: '20px',
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '14px',
                pointerEvents: 'none'
            }}>
                Click outside or press Escape to close
            </div>
        </div>
    );
};
