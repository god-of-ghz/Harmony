import React from 'react';
import { useAppStore } from '../../store/appStore';

export const RoleMention: React.FC<{ id: string }> = ({ id }) => {
    const serverRoles = useAppStore(state => state.serverRoles);
    
    const role = serverRoles.find(r => r.id === id);

    if (role) {
        return (
            <span className="mention-tag" style={{ borderLeft: `2px solid ${role.color}` }}>
                @{role.name}
            </span>
        );
    } else {
        return <span className="mention-tag">@Unknown Role</span>;
    }
};
