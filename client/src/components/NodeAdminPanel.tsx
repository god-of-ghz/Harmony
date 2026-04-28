import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { NodeOverview } from './admin/NodeOverview';
import { GuildManagement } from './admin/GuildManagement';
import { ProvisionCodes } from './admin/ProvisionCodes';
import { NodeSettings } from './admin/NodeSettings';

type AdminSection = 'overview' | 'guilds' | 'provisions' | 'settings';

interface Props {
    onClose: () => void;
}

const sections: { key: AdminSection; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'guilds', label: 'Guild Management' },
    { key: 'provisions', label: 'Provision Codes' },
    { key: 'settings', label: 'Node Settings' },
];

export const NodeAdminPanel = ({ onClose }: Props) => {
    const [activeSection, setActiveSection] = useState<AdminSection>('overview');

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const renderContent = () => {
        switch (activeSection) {
            case 'overview':
                return <NodeOverview onNavigate={setActiveSection} />;
            case 'guilds':
                return <GuildManagement />;
            case 'provisions':
                return <ProvisionCodes />;
            case 'settings':
                return <NodeSettings />;
            default:
                return null;
        }
    };

    return (
        <div className="admin-panel-overlay" data-testid="admin-panel">
            {/* Sidebar */}
            <div className="admin-sidebar">
                <div className="admin-sidebar-nav">
                    <div className="admin-sidebar-header">Node Admin</div>
                    {sections.map((section) => (
                        <button
                            key={section.key}
                            className={`admin-sidebar-item ${activeSection === section.key ? 'active' : ''}`}
                            onClick={() => setActiveSection(section.key)}
                            data-testid={`admin-nav-${section.key}`}
                        >
                            {section.label}
                        </button>
                    ))}
                </div>
                <button
                    className="admin-sidebar-close"
                    onClick={onClose}
                    data-testid="admin-close-btn"
                    aria-label="Close admin panel"
                >
                    <X size={16} />
                    Close
                </button>
            </div>

            {/* Content Area */}
            <div className="admin-content" key={activeSection}>
                <div className="admin-content-inner">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};
