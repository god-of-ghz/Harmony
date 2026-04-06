import React from 'react';
import type { Profile, RoleData } from '../store/appStore';

interface MentionAutocompleteProps {
    options: (Profile | RoleData)[];
    selectedIndex: number;
    onSelect: (option: Profile | RoleData) => void;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({ options, selectedIndex, onSelect }) => {
    if (options.length === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '16px',
            right: '16px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '8px',
            boxShadow: '0 -2px 10px rgba(0,0,0,0.2)',
            marginBottom: '8px',
            maxHeight: '200px',
            overflowY: 'auto',
            border: '1px solid var(--divider)',
            zIndex: 100
        }}>
            <div style={{ padding: '8px', borderBottom: '1px solid var(--divider)', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                Members & Roles
            </div>
            {options.map((option, index) => {
                const isRole = 'color' in option;
                const name = isRole ? option.name : option.nickname;
                const isSelected = index === selectedIndex;

                return (
                    <div
                        key={option.id}
                        style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            backgroundColor: isSelected ? 'var(--bg-modifier-hover)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: isSelected ? 'var(--interactive-active)' : 'var(--interactive-normal)'
                        }}
                        onMouseDown={(e) => {
                            e.preventDefault(); // Prevent input blur
                            onSelect(option);
                        }}
                        onMouseEnter={() => {
                            // Optionally update selectedIndex on hover
                        }}
                    >
                        {isRole ? (
                            <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: option.color || 'var(--text-muted)' }} />
                        ) : (
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                                {name.substring(0, 2).toUpperCase()}
                            </div>
                        )}
                        <span style={{ fontWeight: isRole ? 'bold' : 'normal' }}>
                            {isRole ? `@${name}` : name}
                        </span>
                        {!isRole && (option as Profile).original_username && (
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                @{(option as Profile).original_username}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
