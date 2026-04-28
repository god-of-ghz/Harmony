import React from 'react';

interface ProfileGridProps {
    children: React.ReactNode;
}

export const ProfileGrid: React.FC<ProfileGridProps> = ({ children }) => {
    return (
        <>
            <div 
                id="unclaimed-grid"
                style={{ 
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
                gap: '16px', maxHeight: '400px', overflowY: 'auto', padding: '4px'
            }}>
                {children}
            </div>

            <style>{`
                .claim-card:hover {
                    background-color: var(--bg-modifier-hover) !important;
                    border-color: var(--brand-experiment) !important;
                    transform: translateY(-4px);
                    box-shadow: 0 10px 20px rgba(0,0,0,0.4);
                }
                .claim-card:active {
                    transform: translateY(-1px);
                }
                #unclaimed-grid::-webkit-scrollbar { width: 6px; }
                #unclaimed-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            `}</style>
        </>
    );
};
