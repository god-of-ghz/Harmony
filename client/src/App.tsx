import { useAppStore } from './store/appStore';
import { ServerSidebar } from './components/ServerSidebar';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { ClaimProfile } from './components/ClaimProfile';
import { LoginSignup } from './components/LoginSignup';

function App() {
  const { currentAccount, activeServerId, claimedProfiles } = useAppStore();

  if (!currentAccount) {
    return <LoginSignup />;
  }

  const activeProfile = activeServerId
    ? claimedProfiles.find(p => p.server_id === activeServerId)
    : null;

  return (
    <div className="app-container">
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
      ) : (
        <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Select a Server
        </div>
      )}
    </div>
  );
}

export default App;
