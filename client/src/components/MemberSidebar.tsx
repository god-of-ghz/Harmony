import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import type { Profile, RoleData, PresenceData } from '../store/appStore';
import { useUserInteraction } from '../hooks/useUserInteraction';
import { ChevronDown } from 'lucide-react';

// ── Individual member entry (needs its own hook call) ──

interface MemberEntryProps {
    profile: Profile;
    guildId: string;
    presence: PresenceData | null;
    serverUrl: string;
    roleColor: string | null;
}

const MemberEntry: React.FC<MemberEntryProps> = React.memo(({ profile, guildId, presence, serverUrl, roleColor }) => {
    const { onContextMenu, onClick } = useUserInteraction({
        profileId: profile.id,
        accountId: profile.account_id || undefined,
        guildId,
    });

    const [avatarError, setAvatarError] = useState(false);
    const displayName = profile.nickname || profile.original_username || 'Unknown';
    const initials = displayName.substring(0, 2).toUpperCase();

    // Resolve avatar URL
    let avatarUrl: string | null = null;
    if (profile.avatar && !avatarError) {
        const av = profile.avatar;
        if (av.startsWith('http') || av.startsWith('data:')) {
            avatarUrl = av;
        } else {
            avatarUrl = `${serverUrl}${av}`;
        }
    }

    const presenceStatus = presence?.status || 'offline';

    return (
        <div
            className="member-sidebar-entry"
            data-testid={`member-entry-${profile.id}`}
            onContextMenu={onContextMenu}
            onClick={onClick}
        >
            <div className="member-sidebar-avatar">
                {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} onError={() => setAvatarError(true)} />
                ) : (
                    <div className="avatar-fallback">{initials}</div>
                )}
                <div
                    className={`member-sidebar-presence ${presenceStatus}`}
                    data-testid={`presence-${profile.id}`}
                />
            </div>
            <span
                className="member-sidebar-name"
                style={roleColor ? { color: roleColor } : undefined}
            >
                {displayName}
            </span>
        </div>
    );
});
MemberEntry.displayName = 'MemberEntry';

// ── Role section with collapsible group ──

interface RoleSectionProps {
    title: string;
    count: number;
    members: Profile[];
    guildId: string;
    presenceMap: Record<string, PresenceData>;
    serverUrl: string;
    roleColor: string | null;
    defaultCollapsed?: boolean;
}

const RoleSection: React.FC<RoleSectionProps> = React.memo(({
    title,
    count,
    members,
    guildId,
    presenceMap,
    serverUrl,
    roleColor,
    defaultCollapsed = false,
}) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    if (members.length === 0) return null;

    return (
        <div className="member-sidebar-section" data-testid={`member-section-${title}`}>
            <div
                className="member-sidebar-section-header"
                onClick={() => setCollapsed(prev => !prev)}
            >
                <span className={`chevron ${collapsed ? 'collapsed' : ''}`}>
                    <ChevronDown size={10} />
                </span>
                <span>{title} — {count}</span>
            </div>
            {!collapsed && members.map(profile => (
                <MemberEntry
                    key={profile.id}
                    profile={profile}
                    guildId={guildId}
                    presence={profile.account_id ? presenceMap[profile.account_id] ?? null : null}
                    serverUrl={serverUrl}
                    roleColor={roleColor}
                />
            ))}
        </div>
    );
});
RoleSection.displayName = 'RoleSection';

// ── Main MemberSidebar ──

export const MemberSidebar: React.FC = () => {
    const activeServerId = useAppStore(state => state.activeServerId);
    const serverMap = useAppStore(state => state.serverMap);
    const guildProfiles = useAppStore(state => state.guildProfiles);
    const guildRoles = useAppStore(state => state.guildRoles);
    const presenceMap = useAppStore(state => state.presenceMap);

    const serverUrl = activeServerId ? serverMap[activeServerId] || '' : '';

    // Build role lookup: roleId → RoleData
    const roleLookup = useMemo(() => {
        const map: Record<string, RoleData> = {};
        guildRoles.forEach(r => { map[r.id] = r; });
        return map;
    }, [guildRoles]);

    // Determine each profile's highest role for grouping
    const getProfilePrimaryRole = useCallback((profile: Profile): RoleData | null => {
        // Profile.role is the string role ("OWNER", "ADMIN", "USER")
        // profile.primary_role_color is set if they have an assigned role
        // We look for the highest-position role in guildRoles matching the profile
        // For simplicity, we group by profile.role field
        const roleName = profile.role || 'USER';
        // Try to find a matching role definition
        const matchingRole = guildRoles.find(r =>
            r.name.toUpperCase() === roleName.toUpperCase()
        );
        return matchingRole ?? null;
    }, [guildRoles]);

    // Split members into online and offline, then group by role
    const { onlineSections, offlineMembers } = useMemo(() => {
        // Partition into online/offline
        const onlineProfiles: Profile[] = [];
        const offlineProfiles: Profile[] = [];

        guildProfiles.forEach(profile => {
            const accountId = profile.account_id;
            const presence = accountId ? presenceMap[accountId] : null;
            const isOnline = presence && presence.status !== 'offline';
            if (isOnline) {
                onlineProfiles.push(profile);
            } else {
                offlineProfiles.push(profile);
            }
        });

        // Group online profiles by role
        // Sort roles by position descending (highest position = most important)
        const sortedRoles = [...guildRoles]
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position);

        // Build role → members map
        const roleGroups: { role: RoleData; members: Profile[] }[] = [];
        const assignedProfileIds = new Set<string>();

        // Match profiles to roles by their .role field
        const ROLE_PRIORITY: Record<string, number> = { OWNER: 3, ADMIN: 2, USER: 1 };

        sortedRoles.forEach(role => {
            const members = onlineProfiles.filter(p => {
                if (assignedProfileIds.has(p.id)) return false;
                // Match by role name (case-insensitive)
                return p.role?.toUpperCase() === role.name.toUpperCase();
            });
            members.forEach(m => assignedProfileIds.add(m.id));
            if (members.length > 0) {
                roleGroups.push({ role, members });
            }
        });

        // Remaining online members not matched to any role → "Online" group
        const unmatched = onlineProfiles.filter(p => !assignedProfileIds.has(p.id));

        return {
            onlineSections: [
                ...roleGroups,
                ...(unmatched.length > 0 ? [{ role: null as RoleData | null, members: unmatched }] : []),
            ],
            offlineMembers: offlineProfiles,
        };
    }, [guildProfiles, guildRoles, presenceMap]);

    if (!activeServerId) return null;

    if (guildProfiles.length === 0) {
        return (
            <div className="member-sidebar" data-testid="member-sidebar">
                <div className="member-sidebar-empty">No members</div>
            </div>
        );
    }

    return (
        <div className="member-sidebar" data-testid="member-sidebar">
            {/* Online role sections */}
            {onlineSections.map(({ role, members }) => (
                <RoleSection
                    key={role?.id ?? 'online'}
                    title={role?.name ?? 'Online'}
                    count={members.length}
                    members={members}
                    guildId={activeServerId}
                    presenceMap={presenceMap}
                    serverUrl={serverUrl}
                    roleColor={role?.color ?? null}
                />
            ))}

            {/* Offline section — collapsed by default */}
            {offlineMembers.length > 0 && (
                <RoleSection
                    title="Offline"
                    count={offlineMembers.length}
                    members={offlineMembers}
                    guildId={activeServerId}
                    presenceMap={presenceMap}
                    serverUrl={serverUrl}
                    roleColor={null}
                    defaultCollapsed={true}
                />
            )}
        </div>
    );
};
