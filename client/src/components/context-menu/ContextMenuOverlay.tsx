import React, { useEffect, useRef } from 'react';
import { useContextMenuStore } from '../../store/contextMenuStore';
import { ContextMenuItem } from './ContextMenuItem';

export const ContextMenuOverlay: React.FC = () => {
    const { isOpen, position, items, closeContextMenu } = useContextMenuStore();
    const menuRef = useRef<HTMLDivElement>(null);

    // Keyboard: Escape to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeContextMenu();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeContextMenu]);

    // Viewport-aware edge detection (with ResizeObserver for dynamic content)
    useEffect(() => {
        if (!isOpen || !menuRef.current) return;
        
        const adjustPosition = () => {
            const menu = menuRef.current;
            if (!menu) return;
            
            // Reset position temporarily to get natural bounds
            menu.style.left = 'auto';
            menu.style.top = 'auto';
            
            const rect = menu.getBoundingClientRect();
            let { x, y } = position;
            const margin = 8;

            // X Axis: Flip left of the cursor if near right edge
            if (x + rect.width > window.innerWidth) {
                x = position.x - rect.width;
            }

            // Y Axis: Flip up if near bottom edge
            if (y + rect.height > window.innerHeight) {
                // Does it fit above the cursor?
                if (position.y - rect.height >= margin) {
                    y = position.y - rect.height;
                } else {
                    // Doesn't fit above or below, clamp to window bottom
                    y = window.innerHeight - rect.height - margin;
                }
            }

            // Clamp to viewport edges
            if (x < margin) x = margin;
            if (y < margin) y = margin;

            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        };

        // Run once initially
        adjustPosition();

        // Observe for size changes
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => {
                adjustPosition();
            });
            observer.observe(menuRef.current);
            return () => observer.disconnect();
        }
    }, [isOpen, position, items]);

    if (!isOpen || items.length === 0) return null;

    return (
        <div
            className="context-menu-overlay"
            data-testid="context-menu-overlay"
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
        >
            <div
                ref={menuRef}
                className="context-menu"
                role="menu"
                data-testid="context-menu"
                style={{ left: position.x, top: position.y }}
                onClick={(e) => e.stopPropagation()}
            >
                {items.map((item) =>
                    item.customComponent ? (
                        <div key={item.id} data-testid={`context-menu-item-${item.id}`}>
                            {item.customComponent}
                        </div>
                    ) : (
                        <ContextMenuItem
                            key={item.id}
                            item={item}
                            onClose={closeContextMenu}
                        />
                    )
                )}
            </div>
        </div>
    );
};
