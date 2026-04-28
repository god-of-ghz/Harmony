import React, { useEffect, useRef, useState } from 'react';
import { useContextMenuStore } from '../../store/contextMenuStore';
import { useAppStore } from '../../store/appStore';
import { EditProfileDropdown } from './EditProfileDropdown';

export const UserProfilePopup: React.FC = () => {
    const profilePopup = useContextMenuStore((s) => s.profilePopup);
    const closeProfilePopup = useContextMenuStore((s) => s.closeProfilePopup);
    const popupRef = useRef<HTMLDivElement>(null);
    const [showEditDropdown, setShowEditDropdown] = useState(false);

    // Close on Escape
    useEffect(() => {
        if (!profilePopup) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeProfilePopup();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [profilePopup, closeProfilePopup]);

    // Viewport-aware positioning with ResizeObserver
    useEffect(() => {
        if (!profilePopup || !popupRef.current) return;
        
        const adjustPosition = () => {
            const popup = popupRef.current;
            if (!popup) return;
            
            // Reset position temporarily
            popup.style.left = 'auto';
            popup.style.top = 'auto';
            
            const rect = popup.getBoundingClientRect();
            const { anchorRect } = profilePopup;

            // Position to the right of the anchor
            let left = anchorRect.left + anchorRect.width + 12;
            let top = anchorRect.top;

            // Flip left if near right edge
            if (left + rect.width > window.innerWidth) {
                left = anchorRect.left - rect.width - 12;
            }
            // Clamp to bottom
            if (top + rect.height > window.innerHeight) {
                top = window.innerHeight - rect.height - 16;
            }
            // Clamp to top
            if (top < 16) top = 16;
            if (left < 16) left = 16;

            popup.style.left = `${left}px`;
            popup.style.top = `${top}px`;
        };

        adjustPosition();

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => {
                adjustPosition();
            });
            observer.observe(popupRef.current);
            return () => observer.disconnect();
        }
    }, [profilePopup]);

    // Reset dropdown when popup closes
    useEffect(() => {
        if (!profilePopup) setShowEditDropdown(false);
    }, [profilePopup]);

    if (!profilePopup) return null;

    return (
        <ProfilePopupContent
            popup={profilePopup}
            popupRef={popupRef}
            closeProfilePopup={closeProfilePopup}
            showEditDropdown={showEditDropdown}
            setShowEditDropdown={setShowEditDropdown}
        />
    );
};

// Separated so we can read store state only when popup is visible
const ProfilePopupContent: React.FC<{
    popup: NonNullable<ReturnType<typeof useContextMenuStore.getState>['profilePopup']>;
    popupRef: React.RefObject<HTMLDivElement | null>;
    closeProfilePopup: () => void;
    showEditDropdown: boolean;
    setShowEditDropdown: (show: boolean) => void;
}> = ({ popup, popupRef, closeProfilePopup, showEditDropdown, setShowEditDropdown }) => {
    const { target, anchorRect } = popup;

    // Read store data
    const guildProfiles = useAppStore((s) => s.guildProfiles);
    const globalProfiles = useAppStore((s) => s.globalProfiles);
    const presenceMap = useAppStore((s) => s.presenceMap);
    const guildRoles = useAppStore((s) => s.guildRoles);
    const currentAccount = useAppStore((s) => s.currentAccount);
    const claimedProfiles = useAppStore((s) => s.claimedProfiles);
    const guildMap = useAppStore((s) => s.guildMap);

    // Resolve target profile
    const targetProfile = guildProfiles.find((p) => p.id === target.profileId) || null;
    const targetAccountId = target.accountId || targetProfile?.account_id || '';
    const globalProfile = targetAccountId ? globalProfiles[targetAccountId] : null;

    const nickname = targetProfile?.nickname || 'Unknown';
    const globalDisplayName = globalProfile?.display_name || '';
    const bio = globalProfile?.bio || '';
    const bannerColor = targetProfile?.primary_role_color || '#5865F2';

    // Resolve avatar URL
    let avatarBase = targetProfile?.avatar || globalProfile?.avatar_url;
    if (avatarBase) {
        if (avatarBase.includes('\\data\\servers\\') || avatarBase.includes('/data/servers/')) {
            const separator = avatarBase.includes('\\data\\servers\\') ? '\\data\\servers\\' : '/data/servers/';
            const parts = avatarBase.split(separator)[1].split(/[\\/]/);
            avatarBase = `/servers/${parts[0]}/avatars/${parts[2]}`;
        } else if (avatarBase.includes('\\data\\avatars\\') || avatarBase.includes('/data/avatars/')) {
            const separator = avatarBase.includes('\\data\\avatars\\') ? '\\data\\avatars\\' : '/data/avatars/';
            const parts = avatarBase.split(separator)[1].split(/[\\/]/);
            avatarBase = `/avatars/${parts[0]}`;
        }
    }
    const serverUrl = target.guildId ? (guildMap[target.guildId] || '') : '';
    const avatarUrl = avatarBase ? (avatarBase.startsWith('http') || avatarBase.startsWith('data:') ? avatarBase : `${serverUrl}${avatarBase}`) : null;

    // Presence
    const presence = targetAccountId ? presenceMap[targetAccountId] : null;
    const presenceStatus = presence?.status || 'offline';
    const presenceColor =
        presenceStatus === 'online' ? '#23a559' :
        presenceStatus === 'idle' ? '#faa61a' :
        presenceStatus === 'dnd' ? '#ed4245' : '#72767d';

    // Self detection
    const currentProfile = target.guildId
        ? claimedProfiles.find((p) => p.server_id === target.guildId)
        : null;
    const isSelf = currentProfile?.id === target.profileId;

    // Role pills — get profile roles from guild role data
    const profileRolePills = guildRoles
        .filter((r) => r.name !== '@everyone')
        .slice(0, 5); // Show first 5 roles

    return (
        <div
            className="profile-popup-overlay"
            data-testid="profile-popup-overlay"
            onClick={closeProfilePopup}
        >
            <div
                ref={popupRef}
                className="profile-popup"
                data-testid="profile-popup"
                style={{ left: anchorRect.left + anchorRect.width + 12, top: anchorRect.top }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Banner */}
                <div
                    className="profile-popup-banner"
                    style={{ background: `linear-gradient(135deg, ${bannerColor}, ${bannerColor}88)` }}
                />

                {/* Avatar */}
                <div className="profile-popup-avatar-wrapper">
                    <div className="profile-popup-avatar" data-testid="profile-popup-avatar">
                        {avatarUrl ? (
                            <img
                                src={avatarUrl}
                                alt={nickname}
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.parentElement!.innerHTML = `<div class="profile-popup-avatar-fallback">${nickname.substring(0, 2).toUpperCase()}</div>`;
                                }}
                                style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                            />
                        ) : (
                            <div className="profile-popup-avatar-fallback">
                                {nickname.substring(0, 2).toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div
                        className="profile-popup-presence"
                        style={{ backgroundColor: presenceColor }}
                        data-testid="profile-popup-presence"
                    />
                </div>

                {/* Body */}
                <div className="profile-popup-body">
                    {/* Name */}
                    <div className="profile-popup-name">
                        <span className="profile-popup-nickname" data-testid="profile-popup-nickname">{nickname}</span>
                        {globalDisplayName && globalDisplayName !== nickname && (
                            <span className="profile-popup-global-name" data-testid="profile-popup-global-name">{globalDisplayName}</span>
                        )}
                    </div>

                    {/* Separator */}
                    <div className="profile-popup-divider" />

                    {/* Role pills */}
                    {profileRolePills.length > 0 && (
                        <div className="profile-popup-roles" data-testid="profile-popup-roles">
                            <div className="profile-popup-section-label">ROLES</div>
                            <div className="profile-popup-role-list">
                                {profileRolePills.map((role) => (
                                    <span
                                        key={role.id}
                                        className="profile-popup-role-pill"
                                        data-testid={`role-pill-${role.id}`}
                                        style={{ '--role-color': role.color || '#FFFFFF' } as React.CSSProperties}
                                    >
                                        <span className="role-dot" style={{ backgroundColor: role.color || '#FFFFFF' }} />
                                        {role.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Bio */}
                    {bio && (
                        <div className="profile-popup-bio" data-testid="profile-popup-bio">
                            <div className="profile-popup-section-label">ABOUT ME</div>
                            <p>{bio}</p>
                        </div>
                    )}

                    {/* Separator */}
                    <div className="profile-popup-divider" />

                    {/* Action buttons */}
                    <div className="profile-popup-actions">
                        {isSelf ? (
                            <div style={{ position: 'relative' }}>
                                <button
                                    className="profile-popup-btn primary"
                                    data-testid="profile-popup-edit-btn"
                                    onClick={() => setShowEditDropdown(!showEditDropdown)}
                                >
                                    Edit Profile
                                </button>
                                {showEditDropdown && (
                                    <EditProfileDropdown
                                        guildId={target.guildId || ''}
                                        onClose={() => setShowEditDropdown(false)}
                                    />
                                )}
                            </div>
                        ) : (
                            <>
                                <button
                                    className="profile-popup-btn primary"
                                    data-testid="profile-popup-message-btn"
                                    onClick={() => {
                                        useContextMenuStore.getState().showToast('Direct messages coming soon');
                                    }}
                                >
                                    Message
                                </button>
                                <button
                                    className="profile-popup-btn secondary"
                                    data-testid="profile-popup-friend-btn"
                                    onClick={() => {
                                        useContextMenuStore.getState().showToast('Friend action coming soon');
                                    }}
                                >
                                    Add Friend
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
