import React, { useState, useRef, useCallback } from 'react';
import type { MenuItem } from '../../store/contextMenuStore';
import { useViewportAwarePosition } from '../../hooks/useViewportAwarePosition';

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

    // Viewport-aware positioning for submenu (uses shared reusable hook)
    useViewportAwarePosition({
        active: showSubmenu && (!!item.children || !!item.customSubmenuComponent),
        floatingRef: submenuRef,
        anchorRef: itemRef,
        defaultLeft: '100%',
        defaultTop: '-6px',
    });

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
        
        // If it has children or a custom submenu, don't close the menu
        if (item.children || item.customSubmenuComponent) {
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
            {(item.children || item.customSubmenuComponent) && (
                <span className="context-menu-submenu-arrow">▸</span>
            )}
            {item.rightIcon && (
                <span className="context-menu-right-icon">{item.rightIcon}</span>
            )}

            {item.children && showSubmenu && !item.customSubmenuComponent && (
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

            {item.customSubmenuComponent && showSubmenu && (
                <div 
                    ref={submenuRef}
                    style={{ position: 'absolute', top: '-6px', left: '100%' }}
                    onMouseEnter={cancelHide}
                    onMouseLeave={scheduleHide}
                    onClick={(e) => e.stopPropagation()}
                >
                    {item.customSubmenuComponent}
                </div>
            )}
        </div>
    );
};
