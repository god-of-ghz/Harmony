import { useState, useEffect } from 'react';
import { useAppStore } from './store/appStore';
import { pingServerHealth } from './utils/slaTracker';
import { apiFetch } from './utils/apiFetch';
import { GuildSidebar } from './components/GuildSidebar';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { ClaimProfile } from './components/ClaimProfile';
import { LoginSignup } from './components/LoginSignup';
import { GlobalClaimProfile } from './components/GlobalClaimProfile';
import { DMSidebar } from './components/DMSidebar';
import { FriendsList } from './components/FriendsList';
import { ImageModal } from './components/ImageModal';
import { PromotionWizard } from './components/PromotionWizard';
import { ContextMenuOverlay } from './components/context-menu/ContextMenuOverlay';
import { UserProfilePopup } from './components/context-menu/UserProfilePopup';
import { Toast } from './components/context-menu/Toast';

function App() {
  const { currentAccount, activeServerId, activeChannelId, claimedProfiles, isGuestSession, connectedServers, dismissedGlobalClaim, setCurrentAccount, setIsGuestSession, primaryOfflineMessage, setServerStatus } = useAppStore();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeError, setUpgradeError] = useState('');
  const profilesLoaded = useAppStore(state => state.profilesLoaded);

  useEffect(() => {
    if (currentAccount) {
      const safe = Array.isArray(connectedServers) ? connectedServers : [];
      const homeServer = currentAccount.primary_server_url || safe[0]?.url;
      
      if (homeServer) {
        apiFetch(`${homeServer}/api/read_states`, {
          headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        })
        .then(res => res.ok ? res.json() : [])
        .then(data => {
            if (Array.isArray(data)) {
                const map: any = {};
                data.forEach(s => map[s.channel_id] = s.last_message_id);
                useAppStore.getState().setReadStates(map);
            }
        })
        .catch(console.error);

        apiFetch(`${homeServer}/api/accounts/settings`, {
          headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        })
        .then(res => res.ok ? res.json() : {})
        .then(data => {
            if (Object.keys(data).length > 0) {
                useAppStore.getState().setAccountSettings(data);
            }
        })
        .catch(console.error);
      }
    }
  }, [currentAccount, connectedServers]);

  useEffect(() => {
      const { clientSettings } = useAppStore.getState();
      if (clientSettings.theme === 'light') {
          document.body.classList.add('theme-light');
      } else {
          document.body.classList.remove('theme-light');
      }
  }, []);

  useEffect(() => {
    if (!currentAccount) return;

    const pollHealth = async () => {
      const safe = Array.isArray(connectedServers) ? connectedServers : [];
      const primaryUrl = currentAccount.primary_server_url;
      const allUrls = new Set(safe.map(s => s.url));
      if (primaryUrl) allUrls.add(primaryUrl);

      const statusMap: Record<string, 'online' | 'offline' | 'unknown'> = {};
      
      await Promise.all(Array.from(allUrls).map(async (url) => {
        const isOnline = await pingServerHealth(url);
        statusMap[url] = isOnline ? 'online' : 'offline';
      }));

      setServerStatus(statusMap);
    };

    pollHealth(); // Initial immediate check
    const interval = setInterval(pollHealth, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [currentAccount, connectedServers, setServerStatus]);

  if (!currentAccount) {
    return <LoginSignup />;
  }

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const safe = Array.isArray(connectedServers) ? connectedServers : [];
      const homeServer = currentAccount.primary_server_url || safe[0]?.url || '';
      const res = await apiFetch(`${homeServer}/api/guest/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestAccountId: currentAccount!.id, email: upgradeEmail, password: upgradePassword })
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentAccount(data);
        setIsGuestSession(false);
        setShowUpgradeModal(false);
      } else {
        setUpgradeError(data.error || 'Failed to upgrade account');
      }
    } catch (err: any) {
      setUpgradeError(err.message);
    }
  };

  const activeProfile = (activeServerId && Array.isArray(claimedProfiles))
    ? claimedProfiles.find(p => p.server_id === activeServerId)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      {primaryOfflineMessage && (
        <div style={{ backgroundColor: '#faa61a', padding: '12px', textAlign: 'center', color: '#000', fontSize: '14px', fontWeight: 'bold' }}>
          {primaryOfflineMessage}
        </div>
      )}
      {!isGuestSession && !dismissedGlobalClaim && <GlobalClaimProfile />}
      {isGuestSession && (
        <div style={{ backgroundColor: 'var(--brand-experiment)', padding: '8px', textAlign: 'center', color: 'white', fontSize: '14px', fontWeight: 'bold' }}>
          You are currently using a guest account. Your data may be lost if you clear your browser data.
          <span onClick={() => setShowUpgradeModal(true)} style={{ marginLeft: '8px', textDecoration: 'underline', cursor: 'pointer' }}>Register to save your profile.</span>
        </div>
      )}

      <div className="app-container" style={{ flex: 1 }}>
        <GuildSidebar />
        {activeServerId ? (
          !profilesLoaded ? (
            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '32px', height: '32px', border: '3px solid var(--text-muted)', borderTopColor: 'var(--brand-experiment)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span>Loading profiles...</span>
              </div>
            </div>
          ) : !activeProfile ? (
            <ClaimProfile serverId={activeServerId} />
          ) : (
            <>
              <ChannelSidebar />
              <ChatArea />
            </>
          )
        ) : activeServerId === '' ? (
          <>
            <DMSidebar />
            {activeChannelId ? <ChatArea /> : <FriendsList />}
          </>
        ) : (
          <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Select a Server
          </div>
        )}
      </div>

      {showUpgradeModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div className="glass-panel" style={{ padding: '32px', borderRadius: '8px', width: '400px', color: 'var(--text-normal)' }}>
            <h2 style={{ marginBottom: '16px' }}>Register Guest Account</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>Secure your guest identity by moving it to an email and password log in.</p>
            {upgradeError && <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', borderRadius: '4px' }}>{upgradeError}</div>}

            <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input
                type="email"
                placeholder="Email Address"
                required
                value={upgradeEmail}
                onChange={e => setUpgradeEmail(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
              />
              <input
                type="password"
                placeholder="Password"
                required
                value={upgradePassword}
                onChange={e => setUpgradePassword(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowUpgradeModal(false)} style={{ flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
                <button type="submit" className="btn" style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}>Register</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <PromotionWizard />
      <ImageModal />
      <UserProfilePopup />
      <ContextMenuOverlay />
      <Toast />
    </div>
  );
}

export default App;
