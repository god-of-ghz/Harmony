import { create } from 'zustand';

// ── MenuItem Interface ──

export interface MenuItem {
    id: string;
    label?: string;
    icon?: React.ReactNode;
    description?: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    children?: MenuItem[];
    rightIcon?: React.ReactNode;
    /** When set, renders this React node instead of the default menu item UI. */
    customComponent?: React.ReactNode;
    /** When set, renders this React node as a flyout submenu instead of mapping children. */
    customSubmenuComponent?: React.ReactNode;
}

// ── Toast Interface ──

export interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
}

// ── Profile Popup Interface (Phase 3 placeholder) ──

export interface ProfilePopup {
    target: { accountId: string; profileId?: string; guildId?: string };
    anchorRect: { top: number; left: number; width: number; height: number };
}

// ── Store State ──

interface ContextMenuState {
    // Context menu
    isOpen: boolean;
    position: { x: number; y: number };
    items: MenuItem[];
    openContextMenu: (pos: { x: number; y: number }, items: MenuItem[]) => void;
    closeContextMenu: () => void;

    // Profile popup (Phase 3)
    profilePopup: ProfilePopup | null;
    openProfilePopup: (target: ProfilePopup['target'], anchorRect: ProfilePopup['anchorRect']) => void;
    closeProfilePopup: () => void;

    // Toasts
    toasts: Toast[];
    showToast: (message: string, type?: Toast['type']) => void;
    removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useContextMenuStore = create<ContextMenuState>((set, get) => ({
    // ── Context Menu ──
    isOpen: false,
    position: { x: 0, y: 0 },
    items: [],

    openContextMenu: (pos, items) => set({
        isOpen: true,
        position: pos,
        items,
    }),

    closeContextMenu: () => set({
        isOpen: false,
        items: [],
    }),

    // ── Profile Popup ──
    profilePopup: null,

    openProfilePopup: (target, anchorRect) => set({
        profilePopup: { target, anchorRect },
    }),

    closeProfilePopup: () => set({
        profilePopup: null,
    }),

    // ── Toasts ──
    toasts: [],

    showToast: (message, type = 'info') => {
        const id = `toast-${++toastCounter}`;
        set((state) => ({
            toasts: [...state.toasts, { id, message, type }],
        }));
        // Auto-remove after 2 seconds
        setTimeout(() => {
            get().removeToast(id);
        }, 2000);
    },

    removeToast: (id) => set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
