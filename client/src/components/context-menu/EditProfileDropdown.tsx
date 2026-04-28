import React from 'react';
import { openGuildSettings } from './contextActions';
import { useAppStore } from '../../store/appStore';
import { useContextMenuStore } from '../../store/contextMenuStore';

interface EditProfileDropdownProps {
    guildId: string;
    onClose: () => void;
}

export const EditProfileDropdown: React.FC<EditProfileDropdownProps> = ({ guildId, onClose }) => {
    return (
        <div className="edit-profile-dropdown" data-testid="edit-profile-dropdown">
            <button
                className="edit-profile-dropdown-item"
                data-testid="edit-guild-profile"
                onClick={() => {
                    onClose();
                    useContextMenuStore.getState().closeProfilePopup();
                    openGuildSettings(guildId, 'profile');
                }}
            >
                Edit Per-Guild Profile
            </button>
            <button
                className="edit-profile-dropdown-item"
                data-testid="edit-global-profile"
                onClick={() => {
                    onClose();
                    useContextMenuStore.getState().closeProfilePopup();
                    useAppStore.getState().setShowUserSettings(true);
                }}
            >
                Edit Global Profile
            </button>
        </div>
    );
};
