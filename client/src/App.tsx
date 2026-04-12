import { useState, useEffect } from 'react';
import { useAppStore } from './store/appStore';
import { ServerSidebar } from './components/ServerSidebar';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { ClaimProfile } from './components/ClaimProfile';
import { LoginSignup } from './components/LoginSignup';
import { GlobalClaimProfile } from './components/GlobalClaimProfile';
import { DMSidebar } from './components/DMSidebar';
import { FriendsList } from './components/FriendsList';
import { ImageModal } from './components/ImageModal';

function App() {
  const { currentAccount, activeServerId, activeChannelId, claimedProfiles, isGuestSession, knownServers, trustedServers, dismissedGlobalClaim, setCurrentAccount, setIsGuestSession } = useAppStore();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeError, setUpgradeError] = useState('');

  useEffect(() => {
    if (currentAccount) {
      if (currentAccount.trusted_servers) {
        useAppStore.getState().setTrustedServers(currentAccount.trusted_servers);
      }

      const safeKnown = Array.isArray(knownServers) ? knownServers : [];
      const safeTrusted = Array.isArray(trustedServers) ? trustedServers : [];
      const homeServer = safeKnown[0] || safeTrusted[0];
      
      if (homeServer) {
        fetch(`${homeServer}/api/read_states`, {
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
      }
    }
  }, [currentAccount, knownServers, trustedServers]);

  if (!currentAccount) {
    return <LoginSignup />;
  }

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${knownServers[0]}/api/guest/merge`, {
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
      {!isGuestSession && !dismissedGlobalClaim && <GlobalClaimProfile />}
      {isGuestSession && (
        <div style={{ backgroundColor: 'var(--brand-experiment)', padding: '8px', textAlign: 'center', color: 'white', fontSize: '14px', fontWeight: 'bold' }}>
          You are currently using a guest account. Your data may be lost if you clear your browser data.
          <span onClick={() => setShowUpgradeModal(true)} style={{ marginLeft: '8px', textDecoration: 'underline', cursor: 'pointer' }}>Register to save your profile.</span>
        </div>
      )}

      <div className="app-container" style={{ flex: 1 }}>
        <ServerSidebar />
        {activeServerId ? (
          !activeProfile ? (
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
      <ImageModal />
    </div>
  );
}

export default App;
