import { useMemo, useCallback } from 'react';
import type { UserTarget } from '../types/UserTarget';
import { resolveUserContext } from '../types/UserTarget';
import { useContextMenuStore } from '../store/contextMenuStore';
import { buildUserMenu } from '../components/context-menu/menuBuilders';

/**
 * Hook that provides unified onContextMenu and onClick handlers for any user surface.
 *
 * Usage:
 *   const { onContextMenu, onClick } = useUserInteraction({ profileId, guildId });
 *   <div onContextMenu={onContextMenu} onClick={onClick}>...</div>
 */
export function useUserInteraction(target: UserTarget) {
    const memoKey = `${target.profileId}:${target.guildId}`;

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            useContextMenuStore.getState().openContextMenu(
                { x: e.clientX, y: e.clientY },
                items
            );
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [memoKey]
    );

    const onClick = useCallback(
        (e: React.MouseEvent) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            useContextMenuStore.getState().openProfilePopup(
                {
                    accountId: target.accountId || '',
                    profileId: target.profileId,
                    guildId: target.guildId,
                },
                {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                }
            );
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [memoKey]
    );

    return useMemo(() => ({ onContextMenu, onClick }), [onContextMenu, onClick]);
}
