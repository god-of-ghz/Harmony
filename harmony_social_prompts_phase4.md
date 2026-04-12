# Harmony Social — Agent Prompts: Phase 4 (Client UI/UX)

Each prompt below is a **self-contained task** for an independent agent. The agent will NOT have access to any prior conversation.

**Prerequisites:** All of Phases 0-3 must be completed for these to be fully functional, but Phase 4A and 4B can begin once Phase 0D and Phase 2B are done.

---

## Phase 4A: Multi-Server Store Refactor

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
Harmony is a distributed system where users connect to multiple independent servers. Each user
has "trusted servers" (1-3 servers managing their identity) plus various guild servers they've
joined. The client recently got a ConnectionManager service
(c:\Harmony\client\src\services\ConnectionManager.ts) that can maintain simultaneous WebSocket
connections to multiple servers. However, the Zustand store (c:\Harmony\client\src\store\appStore.ts)
still assumes single-server interaction.

CURRENT STORE STATE (the problems):
- activeServerId: only one active server at a time
- serverProfiles: Profile[] — flat array, mixed servers
- serverRoles: RoleData[] — flat array for one server
- No DM-specific state (dmChannels, dmMessages, etc.)
- knownServers/trustedServers exist but aren't used for multi-connection management
- The WebSocket is initialized somewhere in the main App (a single connection)

This refactor ADDS new DM/social state and connection tracking WITHOUT breaking the existing
guild UI. The existing guild workflow (select server → view channels → chat) must continue
to work exactly as before.

YOUR TASK:
Extend the Zustand store with DM-specific state and multi-server connection tracking.

MODIFY c:\Harmony\client\src\store\appStore.ts

1. Add new TYPES (add to the existing type definitions at the top of the file):

   export interface DmChannel {
     id: string;
     is_group: boolean;
     name: string | null;
     owner_id: string;
     host_server_url: string;
     created_at: number;
     participants: string[];
     is_closed?: boolean;
     last_read_timestamp?: number;
   }

   export interface ConnectionState {
     url: string;
     status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
   }

2. Add new STATE FIELDS to the AppState interface:

   // DM State
   dmChannels: DmChannel[];
   setDmChannels: (channels: DmChannel[]) => void;
   addDmChannel: (channel: DmChannel) => void;
   updateDmChannel: (channel: Partial<DmChannel> & { id: string }) => void;
   removeDmChannel: (channelId: string) => void;

   activeDmChannelId: string | null;
   setActiveDmChannelId: (id: string | null, hostServerUrl?: string | null) => void;
   activeDmHostUrl: string | null;

   // Connection tracking
   serverConnections: ConnectionState[];
   setServerConnections: (connections: ConnectionState[]) => void;
   updateServerConnection: (url: string, status: ConnectionState['status']) => void;

   // DM typing state
   dmTypingUsers: Record<string, string[]>;  // channelId -> accountIds currently typing
   addDmTypingUser: (channelId: string, accountId: string) => void;
   removeDmTypingUser: (channelId: string, accountId: string) => void;
   clearDmTypingUsers: (channelId: string) => void;

3. Add IMPLEMENTATIONS for all new state fields:

   dmChannels: [],
   setDmChannels: (channels) => set({ dmChannels: channels }),
   addDmChannel: (channel) => set((state) => ({
     dmChannels: state.dmChannels.some(c => c.id === channel.id)
       ? state.dmChannels.map(c => c.id === channel.id ? { ...c, ...channel } : c)
       : [...state.dmChannels, channel]
   })),
   updateDmChannel: (channel) => set((state) => ({
     dmChannels: state.dmChannels.map(c => c.id === channel.id ? { ...c, ...channel } : c)
   })),
   removeDmChannel: (channelId) => set((state) => ({
     dmChannels: state.dmChannels.filter(c => c.id !== channelId)
   })),

   activeDmChannelId: null,
   activeDmHostUrl: null,
   setActiveDmChannelId: (id, hostServerUrl = null) => set({
     activeDmChannelId: id,
     activeDmHostUrl: hostServerUrl,
     // When entering a DM, deselect any guild channel:
     activeChannelId: id ? null : undefined as any,
     activeServerId: id ? null : undefined as any,
   }),

   serverConnections: [],
   setServerConnections: (connections) => set({ serverConnections: connections }),
   updateServerConnection: (url, status) => set((state) => {
     const exists = state.serverConnections.some(c => c.url === url);
     if (exists) {
       return { serverConnections: state.serverConnections.map(c => c.url === url ? { ...c, status } : c) };
     }
     return { serverConnections: [...state.serverConnections, { url, status }] };
   }),

   dmTypingUsers: {},
   addDmTypingUser: (channelId, accountId) => set((state) => ({
     dmTypingUsers: {
       ...state.dmTypingUsers,
       [channelId]: [...(state.dmTypingUsers[channelId] || []).filter(id => id !== accountId), accountId]
     }
   })),
   removeDmTypingUser: (channelId, accountId) => set((state) => ({
     dmTypingUsers: {
       ...state.dmTypingUsers,
       [channelId]: (state.dmTypingUsers[channelId] || []).filter(id => id !== accountId)
     }
   })),
   clearDmTypingUsers: (channelId) => set((state) => ({
     dmTypingUsers: { ...state.dmTypingUsers, [channelId]: [] }
   })),

4. Modify setActiveServerId to deselect any active DM:
   Change the existing implementation to also set activeDmChannelId: null, activeDmHostUrl: null.

IMPORTANT: Do NOT remove, rename, or change the behavior of ANY existing state fields. This
is purely additive. All existing guild functionality must continue to work.

TESTING:
Create c:\Harmony\client\src\store\__tests__\appStore.test.ts:
  - Test setDmChannels sets the list.
  - Test addDmChannel adds a new channel.
  - Test addDmChannel updates an existing channel (by id match).
  - Test updateDmChannel partially updates a channel.
  - Test removeDmChannel removes by id.
  - Test setActiveDmChannelId sets the DM and clears guild selection.
  - Test setActiveServerId clears the DM selection.
  - Test addDmTypingUser/removeDmTypingUser/clearDmTypingUsers work correctly.
  - Test existing state (activeServerId, relationships, etc.) still works unchanged.

Use vitest. Import { useAppStore } and test state mutations directly.

CODE QUALITY:
- TypeScript strict mode. All new types must be exported.
- Follow the exact patterns used by existing state fields (setRelationships, updateRelationship, etc.).
- Keep the file organized: types at the top, interface in the middle, store at the bottom.
- Add brief comments above each new section (// === DM State ===, etc.).
```

---

## Phase 4B: DM Sidebar Overhaul

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
The DM sidebar (c:\Harmony\client\src\components\DMSidebar.tsx) currently has a stub
implementation — it calls a non-existent GET /api/dms endpoint and shows a basic list. Now that
the DM API exists on the server, the sidebar needs to be fully rebuilt.

The DM sidebar should look similar to Discord's DM list (see inspiration):
- At the top: "Friends" button and "Direct Messages" header with a + button.
- Below: scrollable list of DM channels, sorted by most recent activity.
- 1-on-1 DMs show: the other user's avatar (or initials), display name, presence dot.
- Group DMs show: stacked participant initials, group name or participant list, member count.
- Unread DMs are visually distinguished (bold text, badge).
- Right-click context menu: Close DM, Block (1-on-1), Report, Leave Group DM.

CURRENT STATE:
- DMSidebar.tsx exists at c:\Harmony\client\src\components\DMSidebar.tsx (141 lines).
- The store has: dmChannels, activeDmChannelId, setActiveDmChannelId, presenceMap, unreadChannels.
- The store has: currentAccount, knownServers, trustedServers.
- The server responds to GET /api/dms with Authorization: Bearer token header.
- The DM REST API returns channels with participants arrays and host_server_url.

YOUR TASK:
Rewrite DMSidebar.tsx from scratch.

REWRITE c:\Harmony\client\src\components\DMSidebar.tsx

1. On mount (useEffect), fetch DM channels from the user's primary trusted server:
   const server = trustedServers[0] || knownServers[0];
   GET <server>/api/dms
   Headers: { Authorization: `Bearer ${currentAccount.token}` }
   Store the result in the Zustand store: setDmChannels(data).
   Start an interval (every 15 seconds) to refresh the list. Clean up interval on unmount.

2. Render a "Friends" button at the top that navigates to the Friends view:
   onClick: set activeDmChannelId to null, activeServerId to null (showing FriendsList).
   Style it with an icon (Users from lucide-react) and highlight when no DM is selected.

3. Render the DM channel list:
   Sort by most recent activity (you can use created_at for now; ideally by last message
   timestamp, but that requires additional data. Use created_at as a reasonable default).

   For 1-on-1 DMs (is_group === false):
     - Find the OTHER participant: channel.participants.filter(id => id !== currentAccount.id)[0]
     - Display their account ID (or display name if global profiles are available).
     - Show a presence indicator dot (green/yellow/red) from presenceMap.
     - Show the generic avatar (first 2 chars of account ID in a colored circle).

   For Group DMs (is_group === true):
     - If channel.name exists, show it. Otherwise, show "participant1, participant2, ..." (first 3).
     - Show participant count badge: "N Members".
     - Show a group icon or stacked initials.

   Selected state: highlight with var(--bg-modifier-selected).
   Hover state: highlight with var(--bg-modifier-hover).
   onClick: setActiveDmChannelId(channel.id, channel.host_server_url).
   Unread indicator: if unreadChannels.has(channel.id), show bold text and/or a red badge.

4. The "+" button opens a modal for creating a new DM:
   - Text input for Account ID (or comma-separated IDs for group DMs).
   - "Start Chat" button that POSTs to /api/dms on the primary trusted server with:
     Body: { participant_ids: [inputId] }
     Headers: { Authorization: Bearer token, Content-Type: application/json }
   - On success, add the new DM to the store and select it.
   - Handle errors: show error message (e.g., "User not found", "User has blocked you").

5. Right-click context menu (optional but encouraged):
   Use a simple custom context menu (absolute positioned div on right-click).
   Options:
     - "Close Conversation" → PUT /api/dms/:channelId/close
     - "Leave Group" (Group DMs only) → DELETE /api/dms/:channelId/participants/<accountId>
     - "Block User" (1-on-1 only) → triggers block flow
     - "Report User" → triggers report flow (can be a placeholder for Phase 4D)

STYLING:
- Use CSS variables already defined in the app (var(--bg-secondary), var(--text-normal), etc.).
- Match the existing sidebar width: var(--channel-sidebar-width).
- Match the style of ChannelSidebar.tsx for consistency.
- Use Lucide icons: MessageSquare, Users, Plus, X from 'lucide-react'.

TESTING:
Create c:\Harmony\client\src\components\__tests__\DMSidebar.test.tsx:
  - Test that the component renders "Direct Messages" header.
  - Test that it fetches DMs on mount.
  - Test that DM channels are rendered.
  - Test that clicking a DM calls setActiveDmChannelId.
  - Test the "Friends" button is present and clickable.
  - Test the "+" button opens the new DM modal.

Use vitest with @testing-library/react. Mock fetch and the Zustand store.

CODE QUALITY:
- TypeScript strict mode. Explicit types on all props and state.
- No inline styles exceeding 3 properties — extract to const style objects or CSS.
- Clean up intervals and event listeners in useEffect cleanup.
- Use meaningful component and variable names.
- Accessible: buttons should have aria-labels, list items should be keyboard-navigable.
```

---

## Phase 4C: ChatArea DM Mode

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
The ChatArea component (c:\Harmony\client\src\components\ChatArea.tsx) currently renders guild
channel messages. It needs to also handle DM channels — when the user selects a DM from the
sidebar, the ChatArea should switch to "DM mode" and show the DM conversation.

The key difference: DM messages are fetched from the DM's HOST SERVER (stored in the DM
channel's host_server_url field), not necessarily the server the user is primarily connected to.
The API endpoints for DMs are different from guild endpoints:
  - Guild: GET /api/channels/:channelId/messages
  - DM:    GET /api/dms/:channelId/messages

CURRENT STATE:
- ChatArea.tsx is ~450 lines. It fetches messages, renders a MessageList, and includes a
  MessageInput at the bottom.
- The store has: activeDmChannelId, activeDmHostUrl, activeChannelId, dmChannels.
- The DM message API returns messages with the same basic shape as guild messages:
  { id, channel_id, author_id, content, timestamp, edited_at, attachments, reply_to, is_encrypted }
  But author info comes from account email (not server profile).

YOUR TASK:
Modify ChatArea.tsx to detect DM mode and route message fetching/sending to the correct API.

MODIFY c:\Harmony\client\src\components\ChatArea.tsx

1. Add DM mode detection:
   Read activeDmChannelId and activeDmHostUrl from the store.
   const isDmMode = !!activeDmChannelId;
   const channelId = isDmMode ? activeDmChannelId : activeChannelId;
   const apiBaseUrl = isDmMode ? activeDmHostUrl : knownServers[0]; // or primary server

   If isDmMode is true, skip all guild-specific logic (server profiles, guild header, etc.).

2. Modify the message fetch:
   Currently fetches from: `${server}/api/channels/${channelId}/messages`
   In DM mode, fetch from: `${apiBaseUrl}/api/dms/${channelId}/messages`
   Same query params (limit, cursor). Same pagination logic.

   The auth header is the same: Authorization: Bearer ${currentAccount.token}.
   BUT: if the DM's host server is a DIFFERENT server than the one the user logged into,
   the user's token might not be valid there. This is a known limitation that will be
   addressed later (server-to-server proxy). For now, assume the token works or the user
   is also registered on the host server (common case for small communities).

3. Modify the message send:
   Currently sends to: `${server}/api/channels/${channelId}/messages`
   In DM mode, send to: `${apiBaseUrl}/api/dms/${channelId}/messages`
   Body: { content, signature (optional), is_encrypted (optional), attachments, reply_to }
   Note: DM messages don't have an authorId field in the body (the server uses req.accountId).

4. Modify the chat header:
   In guild mode: shows "#channel-name" with the guild context.
   In DM mode: show either:
     - 1-on-1: "@OtherUserName" (or their account ID) with a presence indicator.
     - Group DM: "GroupName" or participant list, with a member count.
   Get the DM channel metadata from dmChannels in the store.

5. Handle DM-specific features:
   - Message deletion in DM mode should DELETE to /api/dms/:channelId/messages/:messageId.
   - Message editing should PUT to /api/dms/:channelId/messages/:messageId.
   - E2EE: if the message has is_encrypted=true, decrypt it client-side using the DM channel
     key (from DmEncryption service). If decryption fails, show "[Encrypted message - unable to decrypt]".
     This integration can be a best-effort — if DmEncryption.ts is available, use it.
     If not (because Phase 3C isn't done yet), skip decryption gracefully.

IMPORTANT:
- Do NOT rewrite ChatArea from scratch. Make targeted modifications.
- All guild functionality MUST continue to work unchanged.
- Use early return or conditional rendering to keep the DM-specific code paths clean.
- Minimize the diff — add helper functions at the top, add conditionals where needed.

TESTING:
This is primarily a UI integration task. Testing approach:
  - Verify TypeScript compilation: npx tsc --noEmit in c:\Harmony\client\.
  - Verify the build: npm run build in c:\Harmony\client\.
  - Manual test: with the server running, create a DM via the API, select it in the sidebar,
    and verify messages load and send correctly.

Create c:\Harmony\client\src\components\__tests__\ChatArea.dm.test.tsx (optional):
  - Test that when activeDmChannelId is set, the component fetches from the DM API.
  - Test that the DM header renders participant info instead of channel name.
  - Mock fetch and store.

CODE QUALITY:
- Minimize changes to the existing ChatArea component. Add, don't rewrite.
- Extract DM-specific logic into clearly named helper functions.
- Add comments marking DM-specific sections: // === DM MODE ===
- TypeScript strict mode. Handle null/undefined states gracefully.
```

---

## Phase 4D: Block & Report UI

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
The server has blocking and reporting APIs:
  - POST /api/accounts/relationships/block — block a user
  - POST /api/accounts/relationships/unblock — unblock a user
  - POST /api/reports — submit a report
  - GET /api/reports — list reports (admin only)
  - PUT /api/reports/:reportId — update report status (admin only)

The client needs UI components for users to block/unblock others and submit reports, plus an
admin panel for reviewing reports.

CURRENT STATE:
- FriendsList.tsx has block/unblock handling stubbed out.
- No ReportModal or ReportsPanel components exist.
- The store has: currentAccount (with is_creator, is_admin).
- The app uses CSS variables for theming (var(--bg-primary), var(--text-normal), etc.).
- The app uses Lucide icons.

YOUR TASK:
Create the Block/Unblock UI and the Report system UI.

FILES TO CREATE:

1. c:\Harmony\client\src\components\ReportModal.tsx
   A modal dialog for submitting a user report.
   Props: { targetAccountId: string; onClose: () => void; contextInfo?: { serverId?: string; channelId?: string; messageId?: string } }

   Contents:
     - Title: "Report User"
     - Show who is being reported (targetAccountId).
     - Reason dropdown/select:
       Options: "Harassment", "Spam", "Inappropriate Content", "Impersonation", "Other"
     - Details textarea: free-text for additional context.
     - "Submit Report" button:
       POST /api/reports to the primary trusted server.
       Body: { reported_account_id: targetAccountId, reason, details, context_server_id, context_channel_id, context_message_id }
       Headers: { Authorization: Bearer token, Content-Type: application/json }
     - On success: show a brief success message, then close after 2 seconds.
     - On error: show the error message.
     - "Cancel" button to close without submitting.

   Styling:
     - Fixed overlay with centered modal (same pattern as other modals in the app).
     - Use glass-panel class if available, or dark card with rounded corners.
     - Match existing form styling.

2. c:\Harmony\client\src\components\ReportsPanel.tsx
   An admin-only panel for reviewing submitted reports.

   Contents:
     - Header: "User Reports"
     - Fetch reports on mount: GET /api/reports from primary trusted server (admin auth).
     - Display as a list/table with columns:
       Reporter, Reported User, Reason, Status, Timestamp.
     - Each report is expandable to see details, context links, and review notes.
     - Status filter: tabs or dropdown for "Pending", "Reviewed", "Dismissed", "Actioned", "All".
     - Action buttons per report:
       "Mark Reviewed" → PUT /api/reports/:id { status: 'reviewed' }
       "Dismiss" → PUT /api/reports/:id { status: 'dismissed' }
       "Take Action" → PUT /api/reports/:id { status: 'actioned' }
       Each with an optional review_notes text input.
     - Show empty state when no reports.

   This component should be accessible from the server settings or an admin dashboard.
   For now, just create the component — integration into navigation will depend on existing
   UI structure.

FILES TO MODIFY:

3. c:\Harmony\client\src\components\FriendsList.tsx
   - Add a "Blocked" tab (alongside Online, All, Pending, Add Friend).
   - The Blocked tab shows all relationships with status 'blocked':
     const blocked = relationships.filter(r => r.status === 'blocked' && r.account_id === currentAccount?.id);
   - Each blocked user entry has an "Unblock" button:
     POST /api/accounts/relationships/unblock, body: { targetId }
     Headers: { Authorization: Bearer token, Content-Type: application/json }
   - Add a "Block" action button to each friend entry (alongside Message and Remove Friend).
     POST /api/accounts/relationships/block, body: { targetId }
   - After blocking/unblocking, refresh the relationships list.

4. Add "Report" and "Block" actions to user interactions across the app:
   This is context-dependent — add to wherever user names/avatars appear:
   - In the MessageItem context menu (if one exists): "Report User", "Block User"
   - In the DM sidebar context menu: "Report User", "Block User"
   - In the FriendsList: "Report" button alongside existing buttons

   For each, open the ReportModal with the appropriate targetAccountId and context.
   For block, call the block API directly (no modal needed — just a confirmation dialog).

TESTING:
Create c:\Harmony\client\src\components\__tests__\ReportModal.test.tsx:
  - Test the modal renders with the target user ID.
  - Test the reason dropdown has all options.
  - Test submitting calls the API with correct body.
  - Test cancel closes the modal.
  - Test error display on API failure.

Create c:\Harmony\client\src\components\__tests__\ReportsPanel.test.tsx:
  - Test fetches and displays reports.
  - Test status filter works.
  - Test action buttons call the correct API.

Use vitest with @testing-library/react. Mock fetch.

CODE QUALITY:
- TypeScript strict mode. Props interfaces on all components.
- Consistent styling with the rest of the app (CSS variables, not hardcoded colors).
- Accessible: proper labels, keyboard navigation, focus management in modals.
- Confirmation dialogs for destructive actions (block, take action on report).
- Clean separation: ReportModal is reusable from anywhere.
```

---

## Phase 4E: Friends List Improvements

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
The Friends List (c:\Harmony\client\src\components\FriendsList.tsx) has a functional but basic
implementation. It needs improvements to integrate with the new Harmony Social features.

CURRENT STATE:
- FriendsList.tsx has tabs: Online, All, Pending, Add Friend. Phase 4D added "Blocked".
- The "Message" button (MessageSquare icon) on each friend entry doesn't do anything.
- The "Add Friend" tab only accepts Account IDs, with no way to specify a remote server.
- The "Online" tab shows all friends regardless of presence status.
- Global profiles (avatar, status message, bio) are fetched but minimally displayed.

YOUR TASK:
Enhance the Friends List with DM integration, remote friend discovery, and better UX.

MODIFY c:\Harmony\client\src\components\FriendsList.tsx

1. Wire up the "Message" button on each friend entry:
   onClick should:
   a) Check if a 1-on-1 DM already exists with this friend (search dmChannels in the store).
   b) If YES: setActiveDmChannelId(existingDm.id, existingDm.host_server_url).
   c) If NO: Create a new DM:
      POST /api/dms to the primary trusted server.
      Body: { participant_ids: [friendAccountId] }
      Headers: { Authorization: Bearer token, Content-Type: application/json }
      On success: add the DM to the store and select it.

2. Fix the "Online" tab to actually filter by presence:
   const onlineFriends = friends.filter(r => {
     const targetId = getTargetId(r);
     const presence = presenceMap[targetId];
     return presence && presence.status !== 'offline';
   });
   Display onlineFriends in the "Online" tab, not all friends.

3. Enhance the "Add Friend" tab:
   - Keep the existing Account ID input.
   - Add a collapsible "Advanced" section with a second input: "Server URL (optional)".
   - If Server URL is provided, use the new endpoint:
     POST /api/accounts/relationships/request-via-server
     Body: { targetId: accountIdInput, targetServerUrl: serverUrlInput }
   - If Server URL is NOT provided, use the existing endpoint:
     POST /api/accounts/relationships/request
     Body: { targetId: accountIdInput }
   - Show a help text: "If your friend is on a different Harmony server, enter their server URL."

4. Improve friend entries with global profile data:
   For each friend, if globalProfiles[targetId] exists:
   - Show their avatar (if avatar_url is set, render an <img>. Otherwise, show initials).
   - Show their status_message below their name (already partially implemented).
   - Show their bio on hover (tooltip) or in an expanded view.

5. Add presence indicator to each friend entry:
   Show a colored dot next to the avatar:
   - Green (#23a559) for 'online'
   - Yellow (#faa61a) for 'idle'
   - Red (#ed4245) for 'dnd'
   - Gray or no dot for 'offline'
   Use the presenceMap from the store.

TESTING:
Create c:\Harmony\client\src\components\__tests__\FriendsList.test.tsx:
  - Test "Online" tab filters by presence status.
  - Test "Message" button creates a DM if none exists.
  - Test "Message" button navigates to existing DM if one exists.
  - Test "Add Friend" with server URL calls the via-server endpoint.
  - Test "Add Friend" without server URL calls the standard endpoint.
  - Test friend entries show avatars and status messages from global profiles.
  - Test presence indicators show correct colors.

Use vitest with @testing-library/react. Mock fetch and store.

CODE QUALITY:
- TypeScript strict mode.
- Refactor repeated avatar rendering into a small UserAvatar subcomponent within the file
  (or next to it) to avoid duplication.
- Use CSS variables for presence indicator colors (or define them as constants).
- Keep the fetch-on-click pattern simple — show a loading spinner or disable the button
  while the DM is being created.
- Handle API errors with user-visible error messages (toast or inline).
- Preserve all existing functionality. All tabs must continue to work.
```

