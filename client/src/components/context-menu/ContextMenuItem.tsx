import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { MenuItem } from '../../store/contextMenuStore';

interface ContextMenuItemProps {
    item: MenuItem;
    onClose: () => void;
}

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ item, onClose }) => {
    const [showSubmenu, setShowSubmenu] = useState(false);
    const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const itemRef = useRef<HTMLDivElement>(null);
    const submenuRef = useRef<HTMLDivElement>(null);

    // Use a small delay before hiding the submenu so the user can cross the gap
    const scheduleHide = useCallback(() => {
        hideTimeout.current = setTimeout(() => setShowSubmenu(false), 100);
    }, []);

    const cancelHide = useCallback(() => {
        if (hideTimeout.current) {
            clearTimeout(hideTimeout.current);
            hideTimeout.current = null;
        }
    }, []);

    const handleMouseEnter = useCallback(() => {
        cancelHide();
        setShowSubmenu(true);
    }, [cancelHide]);

    const handleMouseLeave = useCallback(() => {
        scheduleHide();
    }, [scheduleHide]);

    // Viewport-aware positioning for submenu
    useEffect(() => {
        if (!showSubmenu || !submenuRef.current || !itemRef.current) return;
        
        const submenu = submenuRef.current;
        const itemRect = itemRef.current.getBoundingClientRect();
        
        // Reset to default first so we get an accurate natural rect
        submenu.style.top = '-6px';
        submenu.style.bottom = 'auto';
        submenu.style.left = '100%';
        submenu.style.right = 'auto';
        
        // Force layout
        void submenu.offsetWidth;
        
        const rect = submenu.getBoundingClientRect();
        const margin = 8;
        
        // Flip left if near right edge
        if (rect.right > window.innerWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
        }
        
        // Adjust vertical position if it goes off the bottom
        if (rect.bottom > window.innerHeight) {
            // Calculate how far we need to shift up to fit within the window
            const targetGlobalBottom = window.innerHeight - margin;
            const targetGlobalTop = targetGlobalBottom - rect.height;
            // Don't shift higher than the top margin
            const finalGlobalTop = Math.max(margin, targetGlobalTop);
            
            // Convert to relative position
            const relativeTop = finalGlobalTop - itemRect.top;
            submenu.style.top = `${relativeTop}px`;
        }
    }, [showSubmenu, item.children]);

    // Separator rendering
    if (item.separator) {
        return <div className="context-menu-separator" role="separator" />;
    }

    const classNames = [
        'context-menu-item',
        item.danger ? 'danger' : '',
        item.disabled ? 'disabled' : '',
    ].filter(Boolean).join(' ');

    const handleClick = (e: React.MouseEvent) => {
        if (item.disabled) return;
        
        // If it has children, don't close the menu
        if (item.children) {
            e.stopPropagation();
            return;
        }

        if (item.onClick) {
            item.onClick();
        }
        onClose();
    };

    return (
        <div
            ref={itemRef}
            className={classNames}
            role="menuitem"
            data-testid={`context-menu-item-${item.id}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            aria-disabled={item.disabled}
        >
            {item.icon && (
                <span className="context-menu-icon">{item.icon}</span>
            )}
            <div className="context-menu-label">
                <span>{item.label}</span>
                {item.description && (
                    <div className="context-menu-description">{item.description}</div>
                )}
            </div>
            {item.children && (
                <span className="context-menu-submenu-arrow">▸</span>
            )}
            {item.rightIcon && (
                <span className="context-menu-right-icon">{item.rightIcon}</span>
            )}

            {item.children && showSubmenu && (
                <div 
                    ref={submenuRef}
                    className="context-menu submenu" 
                    style={{ position: 'absolute', top: '-6px', left: '100%' }}
                    onMouseEnter={cancelHide}
                    onMouseLeave={scheduleHide}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="submenu-inner">
                        {item.children.map(child => child.customComponent ? (
                            <div key={child.id} data-testid={`context-menu-item-${child.id}`}>
                                {child.customComponent}
                            </div>
                        ) : (
                            <ContextMenuItem key={child.id} item={child} onClose={onClose} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
