import { useAppStore, Permission } from '../store/appStore';
import type { Profile } from '../store/appStore';

// ── Identity Tuple ──

export interface UserTarget {
    profileId: string;
    accountId?: string;
    guildId: string;
}

// ── Resolved Context ──

export interface ResolvedUserContext {
    target: UserTarget;
    targetProfile: Profile | null;
    targetNickname: string;
    targetRole: string; // 'OWNER' | 'ADMIN' | 'USER'
    currentProfile: Profile | null;
    currentPermissions: number;
    isSelf: boolean;
    isFriend: boolean;
    isHigherRank: boolean; // true if target outranks current user
    canKick: boolean;
    canBan: boolean;
    canManageRoles: boolean;
}

// ── Role Rank Helper ──

const ROLE_RANK: Record<string, number> = {
    OWNER: 3,
    ADMIN: 2,
    USER: 1,
};

function getRoleRank(role: string): number {
    return ROLE_RANK[role] ?? 0;
}

// ── Resolver ──

/**
 * Resolve full user interaction context from a UserTarget.
 * Reads from appStore snapshot — no subscriptions, no hooks.
 */
export function resolveUserContext(target: UserTarget): ResolvedUserContext {
    const state = useAppStore.getState();

    // Find target profile in guild profiles
    const targetProfile = state.guildProfiles.find(
        (p) => p.id === target.profileId
    ) ?? null;

    const targetNickname = targetProfile?.nickname || 'Unknown';
    const targetRole = targetProfile?.role || 'USER';

    // Resolve the target's accountId (from profile if not provided)
    const targetAccountId = target.accountId || targetProfile?.account_id || null;

    // Find current user's profile for this guild
    const currentProfile = target.guildId
        ? state.claimedProfiles.find((p) => p.server_id === target.guildId) ?? null
        : null;

    const currentRole = currentProfile?.role || 'USER';
    const currentPermissions = state.currentUserPermissions;

    // Self detection
    const isSelf = currentProfile
        ? currentProfile.id === target.profileId
        : false;

    // Friend detection
    const currentAccountId = state.currentAccount?.id || null;
    const isFriend = targetAccountId && currentAccountId
        ? state.relationships.some(
            (r) =>
                r.status === 'friend' &&
                ((r.account_id === currentAccountId && r.target_id === targetAccountId) ||
                 (r.account_id === targetAccountId && r.target_id === currentAccountId))
        )
        : false;

    // Rank comparison
    const isHigherRank = getRoleRank(targetRole) >= getRoleRank(currentRole);

    // Permission checks
    const isAdmin = (currentPermissions & Permission.ADMINISTRATOR) !== 0;
    const canKick = isAdmin || (currentPermissions & Permission.KICK_MEMBERS) !== 0;
    const canBan = isAdmin || (currentPermissions & Permission.BAN_MEMBERS) !== 0;
    const canManageRoles = isAdmin || (currentPermissions & Permission.MANAGE_ROLES) !== 0;

    return {
        target,
        targetProfile,
        targetNickname,
        targetRole,
        currentProfile,
        currentPermissions,
        isSelf,
        isFriend,
        isHigherRank,
        canKick,
        canBan,
        canManageRoles,
    };
}
