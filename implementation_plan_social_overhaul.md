# Harmony Social — Implementation Plan (Final)

This document is the comprehensive, user-approved implementation plan for "Harmony Social," a distributed social networking layer for the Harmony platform. It has been revised to incorporate all user feedback and architectural decisions.

---

## Core Design Principles (Confirmed)

1. **Trusted Server Transparency:** Server operators can see the full social graph of users on their node. This is the intentional Harmony compromise — users trust 1-3 servers run by people they know IRL, rather than a faceless corporation.
2. **Message Residency:** DM messages live on the **initiator's** trusted servers (specifically the oldest trusted server). Other participants connect to that server directly or via proxy. No full replication unless servers are shared.
3. **Caching Hybrid:** Non-host trusted servers may cache recent DM messages for performance, but the host is the source of truth.
4. **Block Enforcement:** Enforced only on the **blocker's** trusted servers (messages from blockee are dropped on arrival). The blockee's servers inform the blockee they are blocked. Blocking does NOT hide presence and does NOT affect shared guild visibility.
5. **Multi-Server Client:** The Harmony client must be fundamentally refactored to maintain simultaneous connections to multiple Harmony servers — for guilds, DMs, and social features.

---

## Phase 0: Infrastructure Prerequisites

Everything else depends on these foundational changes. Each sub-phase is an independent, self-contained task.

---

### Phase 0A: Server-to-Server JWT Authentication

**Objective:** Establish mutual authentication between Harmony servers so that inter-server API calls (sync, relay, announce) cannot be spoofed.

**Mechanism:** Each server generates a persistent Ed25519 keypair on first boot. When servers "meet" (via a user adding a new trusted server), they exchange public keys. All subsequent server-to-server requests include a short-lived JWT signed by the sending server's private key. The receiving server verifies the JWT against the stored public key.

#### [NEW] [server_identity.ts](file:///c:/Harmony/server/src/server_identity.ts)
- On first boot, generate an Ed25519 keypair and persist it to `DATA_DIR/server_identity.json`.
- On subsequent boots, load the existing keypair.
- Export `getServerPublicKey()`, `signServerJWT(targetServerUrl)`, `verifyServerJWT(token, senderPublicKey)`.

#### [MODIFY] [database.ts](file:///c:/Harmony/server/src/database.ts)
- Add `known_servers` table to `nodeDb`:
  ```sql
  CREATE TABLE IF NOT EXISTS known_servers (
    server_url TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    label TEXT DEFAULT '',
    first_seen INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  );
  ```

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts)
- `GET /api/server/identity` — Returns this server's public key (unauthenticated, public info).
- `POST /api/server/handshake` — Accepts another server's public key and URL, stores it in `known_servers`, returns own public key. Called during "trust establishment."
- Enhance `POST /api/accounts/:accountId/trusted_servers` to automatically trigger a handshake with the new server if not already known.

#### [NEW] [middleware/server_auth.ts](file:///c:/Harmony/server/src/middleware/server_auth.ts)
- `requireServerAuth` middleware: Extracts the `X-Server-JWT` header, looks up the sender's public key from `known_servers`, verifies the JWT. Rejects if invalid.

**Deliverable:** Any server-to-server endpoint can be protected with `requireServerAuth`. Untrusted/unknown servers are rejected.

---

### Phase 0B: WebSocket Targeted Delivery

**Objective:** Refactor the WebSocket layer from "broadcast to all" to "send to specific accounts," so DM events only reach participants.

#### [MODIFY] [server.ts](file:///c:/Harmony/server/src/server.ts)
- Replace the `clients: Set<WebSocket>` with a `ClientManager` class that maintains:
  - `allClients: Set<WebSocket>` (for guild broadcasts, backwards compat)
  - `accountSockets: Map<string, Set<WebSocket>>` (accountId → their open sockets)
- Export two functions from ClientManager:
  - `broadcastMessage(data)` — sends to ALL clients (existing guild behavior, unchanged)
  - `sendToAccounts(accountIds: string[], data)` — sends only to WebSocket connections belonging to the listed accounts
- Wire up `setupConnectionTracking` to register sockets in the `accountSockets` map on `PRESENCE_IDENTIFY` and remove on `close`.

#### [MODIFY] [websocket.ts](file:///c:/Harmony/server/src/websocket.ts)
- Accept the `ClientManager` instance instead of a bare `broadcastMessage` function.
- On `PRESENCE_IDENTIFY`, register the socket in `accountSockets`.
- On `close`, remove from `accountSockets`.

**Deliverable:** `sendToAccounts(['user-a-id', 'user-b-id'], { type: 'DM_MESSAGE', ... })` sends only to those users' open WebSocket connections.

---

### Phase 0C: Client Auth Header Migration

**Objective:** Replace all remaining `X-Account-Id` header usage in the client with `Authorization: Bearer <token>` headers to work with the `requireAuth` middleware.

#### [MODIFY] [FriendsList.tsx](file:///c:/Harmony/client/src/components/FriendsList.tsx)
- Replace all `headers: { 'X-Account-Id': currentAccount.id }` with `headers: { 'Authorization': 'Bearer ' + currentAccount.token }`.
- Affects: `fetch` calls on lines 16-18, 50-52, 67-69, 81-83.

#### [MODIFY] [DMSidebar.tsx](file:///c:/Harmony/client/src/components/DMSidebar.tsx)
- Replace `headers: { 'X-Account-Id': currentAccount.id }` with JWT auth header (line 18).

#### [MODIFY] Any other components still using `X-Account-Id`
- Grep the entire `client/src` for `X-Account-Id` and migrate all instances.

**Deliverable:** Zero uses of `X-Account-Id` in client code. All API calls use JWT Bearer tokens.

---

### Phase 0D: Multi-Server Connection Manager (Client)

**Objective:** Refactor the client to maintain simultaneous WebSocket connections and API sessions to multiple Harmony servers, instead of one at a time.

> [!IMPORTANT]
> This is the single largest refactor in the entire plan. It changes the fundamental assumption of how the client operates. It should be done carefully and tested thoroughly before proceeding to later phases.

#### [NEW] [client/src/services/ConnectionManager.ts](file:///c:/Harmony/client/src/services/ConnectionManager.ts)
- Manages a `Map<serverUrl, ServerConnection>` where each `ServerConnection` holds:
  - The WebSocket instance
  - Connection state (connecting, connected, disconnected, reconnecting)
  - Auto-reconnect logic with exponential backoff
  - A message handler that routes incoming WS events to the appropriate store handlers
- API methods:
  - `connect(serverUrl, token)` — establish a new WS connection
  - `disconnect(serverUrl)` — tear down a connection
  - `disconnectAll()` — cleanup on logout
  - `getConnection(serverUrl)` — retrieve a specific connection
  - `isConnected(serverUrl)` — check status

#### [MODIFY] [appStore.ts](file:///c:/Harmony/client/src/store/appStore.ts)
- Add `connectedServers: Map<string, ConnectionState>` to track which servers the client is connected to.
- Replace the single monolithic WS setup (currently in the main App component) with calls to `ConnectionManager`.
- On login: connect to ALL trusted servers + any known guild servers.
- On server add: connect to the new server.
- On logout: `disconnectAll()`.

#### [MODIFY] Main App component (wherever the current WS connection is established)
- Replace single WS connection setup with `ConnectionManager.connect()` for each server.
- Route incoming WS messages based on their source server URL.

**Deliverable:** Client maintains N simultaneous WebSocket connections. Guild events from Server A and DM events from Server B are both received in real-time.

---

## Phase 1: Distributed Social Graph & Relationships

Builds on Phase 0's server-to-server auth and targeted WebSocket delivery.

---

### Phase 1A: Relationship Sync Across Trusted Servers

**Objective:** When a user modifies their friend/block list on one trusted server, the change propagates to all their other trusted servers.

#### [MODIFY] [database.ts](file:///c:/Harmony/server/src/database.ts)
- Add `updated_at INTEGER` column to the `relationships` table for last-write-wins conflict resolution.

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts)
- `POST /api/social/sync/relationships` (protected by `requireServerAuth`):
  - Accepts an array of relationship records with `updated_at` timestamps.
  - For each: if local record is older (or missing), upsert. If local is newer, skip. (Merge with last-write-wins.)
  - Returns the set of records where the local copy was newer (so the sender can update itself).
- Modify existing `POST /api/accounts/relationships/request`, `PUT .../accept`, `DELETE .../:targetId`:
  - After local DB write, fan out the change to all of the user's OTHER trusted servers via `POST /api/social/sync/relationships`.

**Conflict resolution:** `updated_at` timestamp comparison. Latest timestamp wins. Clock skew is accepted as a known limitation (servers are expected to have roughly synchronized clocks via OS-level time sync).

---

### Phase 1B: Friend Request Discovery & Relay

**Objective:** Allow User A to send a friend request to User B, even if they share no common server. Leverage the trusted server network for discovery and relay.

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts)
- `POST /api/social/relay/friend-request` (protected by `requireServerAuth`):
  - Receives: `{ from_account_id, from_server_url, target_account_id }`.
  - Checks if `target_account_id` exists locally. If yes, creates a pending relationship and notifies the target via WebSocket (`sendToAccounts`).
  - If target is NOT on this server, check `trusted_servers` table for the target. If found, relay the request to one of the target's known trusted servers.
- Modify `POST /api/accounts/relationships/request`:
  - First, check if target exists locally. If yes, create relationship directly.
  - If not, look up target's trusted servers from the `trusted_servers` table (synced account data should contain this). Relay the request to the target's trusted servers.
  - If target is completely unknown, return an error suggesting the user provide a server URL.
- `POST /api/accounts/relationships/request-via-server`:
  - New endpoint: accepts `{ targetId, targetServerUrl }`. 
  - Performs a handshake with the target server (if not already known), then relays the friend request.
  - This is the "manual specification" path for connecting with users not in the current network.

---

### Phase 1C: Block Enforcement

**Objective:** When User A blocks User B, User A's trusted servers drop all incoming DM messages from User B. User B's servers inform User B they are blocked.

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts)
- `POST /api/accounts/relationships/block`:
  - Sets relationship status to `'blocked'` with current timestamp.
  - Syncs to all of User A's trusted servers (same sync mechanism as 1A).
  - Notifies User B's trusted servers via `POST /api/social/relay/block-notification` so User B's client can display a "you have been blocked" indicator.
- Block enforcement in DM message endpoints (Phase 3):
  - Before delivering a DM message, check if the recipient has blocked the sender.
  - If blocked, silently drop the message (do not store, do not deliver).
  - Return an appropriate error to the sender's client.

**Behavioral rules (confirmed by user):**
- ✅ Block prevents initiating new DMs
- ✅ Block prevents existing DM messages from being delivered
- ❌ Block does NOT hide presence
- ❌ Block does NOT affect shared guild visibility
- Enforcement is on blocker's trusted servers only
- Blockee's servers inform the blockee

---

### Phase 1D: User Reporting System

**Objective:** Allow users to report other users to the operators of Harmony servers.

#### [MODIFY] [database.ts](file:///c:/Harmony/server/src/database.ts)
- Add `reports` table to `nodeDb`:
  ```sql
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_account_id TEXT NOT NULL,
    reported_account_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT DEFAULT '',
    context_server_id TEXT,
    context_channel_id TEXT,
    context_message_id TEXT,
    status TEXT DEFAULT 'pending',
    timestamp INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    reviewed_by TEXT,
    reviewed_at INTEGER
  );
  ```

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts)
- `POST /api/reports` (requireAuth): Submit a report. Include optional context (server, channel, message IDs for evidence).
- `GET /api/reports` (isCreator/isAdmin): List all reports for server admin review.
- `PUT /api/reports/:reportId` (isCreator/isAdmin): Update report status (reviewed, dismissed, actioned).
- When a report is submitted, broadcast a `REPORT_SUBMITTED` WebSocket event to admin accounts on this server.

---

## Phase 2: DM Channel Infrastructure

---

### Phase 2A: DM Database Schema

**Objective:** Extend the DM database to support distributed DM channels with host server tracking.

#### [MODIFY] [database.ts](file:///c:/Harmony/server/src/database.ts)
- Add columns to `dm_channels`:
  ```sql
  ALTER TABLE dm_channels ADD COLUMN host_server_url TEXT;
  ALTER TABLE dm_channels ADD COLUMN created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER));
  ALTER TABLE dm_channels ADD COLUMN is_closed BOOLEAN DEFAULT 0;
  ALTER TABLE dm_channels ADD COLUMN max_participants INTEGER DEFAULT 10;
  ```
- Add columns to `dm_messages` for E2EE:
  ```sql
  ALTER TABLE dm_messages ADD COLUMN signature TEXT DEFAULT '';
  ALTER TABLE dm_messages ADD COLUMN is_encrypted BOOLEAN DEFAULT 0;
  ALTER TABLE dm_messages ADD COLUMN reply_to TEXT DEFAULT NULL;
  ```
- Add `dm_read_states` table:
  ```sql
  CREATE TABLE IF NOT EXISTS dm_read_states (
    account_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    last_message_id TEXT,
    last_read_timestamp INTEGER,
    is_closed BOOLEAN DEFAULT 0,
    PRIMARY KEY (account_id, channel_id)
  );
  ```

**Host server selection rule:** When creating a DM, the host server is the initiating user's **oldest** trusted server (lowest `position` value in `trusted_servers` table, or earliest `first_seen` if positions are equal).

---

### Phase 2B: DM REST API (Full CRUD)

**Objective:** Build the complete DM REST API from scratch (none exists currently).

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts) or [NEW] [routes/dms.ts](file:///c:/Harmony/server/src/routes/dms.ts)

Consider extracting DM routes into a separate file to keep `app.ts` manageable.

**Client-facing endpoints (all require `requireAuth`):**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dms` | List all DM channels the user participates in (including closed ones marked `is_closed`) |
| `POST` | `/api/dms` | Create a new 1-on-1 or Group DM. Body: `{ participant_ids: string[], name?: string }`. This server becomes the host. Announces to participants' trusted servers. |
| `GET` | `/api/dms/:channelId` | Get DM channel metadata (participants, name, host) |
| `GET` | `/api/dms/:channelId/messages` | Fetch messages with cursor-based pagination |
| `POST` | `/api/dms/:channelId/messages` | Send a message (with E2EE fields) |
| `DELETE` | `/api/dms/:channelId/messages/:messageId` | Delete a message (author or admin only) |
| `PUT` | `/api/dms/:channelId/messages/:messageId` | Edit a message |
| `PUT` | `/api/dms/:channelId/participants` | Add participants (owner only, max 10) |
| `DELETE` | `/api/dms/:channelId/participants/:accountId` | Remove a participant or leave |
| `PUT` | `/api/dms/:channelId` | Rename a Group DM (owner only) |
| `PUT` | `/api/dms/:channelId/close` | Close/hide a DM from your list (sets `is_closed` in `dm_read_states`) |
| `PUT` | `/api/dms/:channelId/open` | Re-open a closed DM |

#### [NEW] [middleware/dm_auth.ts](file:///c:/Harmony/server/src/middleware/dm_auth.ts)
- `requireDmParticipant` middleware: Verifies the authenticated user is in `dm_participants` for the requested channel. Replaces guild-based RBAC for DM routes.
- `requireDmOwner` middleware: Verifies the user is the `owner_id` of the DM channel.

---

### Phase 2C: DM Channel Announcements (Server-to-Server)

**Objective:** When a DM is created on the host server, announce it to all participants' trusted servers so their clients can discover it.

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts) or [routes/dms.ts](file:///c:/Harmony/server/src/routes/dms.ts)
- `POST /api/social/dms/announce` (protected by `requireServerAuth`):
  - Receives DM metadata: `{ channel_id, host_server_url, participants, name, is_group, owner_id }`.
  - The receiving server stores this in its local `dm_channels` table (metadata only, no messages).
  - Notifies any locally-connected participants via `sendToAccounts` with a `DM_CHANNEL_CREATE` event.
- When `POST /api/dms` creates a DM:
  - For each participant, look up their trusted servers.
  - Call `POST /api/social/dms/announce` on each participant's trusted servers.
- `POST /api/social/dms/update-participants` (protected by `requireServerAuth`):
  - Syncs participant list changes (adds/removes) to non-host servers.

---

### Phase 2D: Group DM Lifecycle Rules

**Objective:** Implement group DM management rules.

**Rules (confirmed by user):**
- Maximum 10 participants per Group DM.
- Only the owner/creator can invite new participants.
- When the owner leaves, ownership transfers to the **next oldest participant** (by join order).
- If the last participant leaves, the Group DM is deleted.
- Users can "close" a DM (hide from list) without leaving. Closing does not remove them from participants; it sets `is_closed = 1` in `dm_read_states`. Receiving a new message in a closed DM should re-open it.

#### [MODIFY] DM endpoints from Phase 2B
- `DELETE /api/dms/:channelId/participants/:accountId`:
  - If the leaving user is the owner, transfer ownership to the participant with the earliest join timestamp.
  - If no participants remain, delete the DM channel and all its messages.
  - Announce the participant change to all participants' trusted servers.

---

## Phase 3: DM Messaging & Real-Time

---

### Phase 3A: DM Message CRUD

**Objective:** Wire up the message send/receive/delete/edit logic for DM channels, using `dmsDb` instead of server DBs.

#### [MODIFY] [app.ts](file:///c:/Harmony/server/src/app.ts) or [routes/dms.ts](file:///c:/Harmony/server/src/routes/dms.ts)
- `POST /api/dms/:channelId/messages`:
  - Verify sender is a participant (`requireDmParticipant`).
  - **Block check:** Before storing, check if ANY participant has blocked the sender. If so, return 403 with a clear error.
  - Write to `dmsDb` (`dm_messages` table).
  - Notify all participants via `sendToAccounts` with a `DM_MESSAGE` event.
  - If sender is on a non-host server (proxying), the sender's server forwards the message to the host server for storage, and the host broadcasts to other participants.
- `GET /api/dms/:channelId/messages`:
  - Verify requester is a participant.
  - Read from `dmsDb` with cursor-based pagination (same pattern as guild messages).
  - Include author profile info (global profile lookup).
- `DELETE /api/dms/:channelId/messages/:messageId`:
  - Author can delete their own messages. DM owner can delete any message.
  - Broadcast `DM_MESSAGE_DELETE` to participants.
- `PUT /api/dms/:channelId/messages/:messageId`:
  - Author-only edit. Sets `edited_at` timestamp.
  - Broadcast `DM_MESSAGE_EDIT` to participants.

---

### Phase 3B: DM WebSocket Events

**Objective:** Define and implement the WebSocket event types for DM real-time communication.

**New WebSocket event types:**
| Event | Direction | Description |
|-------|-----------|-------------|
| `DM_CHANNEL_CREATE` | Server → Client | A new DM was created or announced |
| `DM_CHANNEL_UPDATE` | Server → Client | DM renamed, participant added/removed |
| `DM_CHANNEL_DELETE` | Server → Client | DM was deleted |
| `DM_MESSAGE` | Server → Client | New DM message received |
| `DM_MESSAGE_EDIT` | Server → Client | A DM message was edited |
| `DM_MESSAGE_DELETE` | Server → Client | A DM message was deleted |
| `DM_TYPING_START` | Client → Server → Client | User started typing in a DM |
| `DM_TYPING_STOP` | Client → Server → Client | User stopped typing in a DM |

#### [MODIFY] [websocket.ts](file:///c:/Harmony/server/src/websocket.ts)
- Handle `DM_TYPING_START` and `DM_TYPING_STOP` messages:
  - Look up the DM channel's participant list.
  - Forward the typing event only to other participants via `sendToAccounts`.

All DM events use `sendToAccounts` (from Phase 0B), never `broadcastMessage`.

---

### Phase 3C: DM End-to-End Encryption

**Objective:** Encrypt DM message content so that even the host server operator cannot read messages at rest.

**Recommended approach: Per-channel symmetric key, distributed via public keys.**

1. **1-on-1 DMs:**
   - When creating a DM, the initiator generates a random AES-256-GCM symmetric key.
   - The initiator encrypts this symmetric key with each participant's public key (already stored in `accounts` table) and sends the encrypted key blobs alongside the DM announcement.
   - Each participant decrypts the channel key with their private key and stores it locally on the client.
   - All messages are encrypted with the channel's symmetric key before sending.
   
2. **Group DMs:**
   - Same mechanism, but the channel key is encrypted for all participants.
   - **Key rotation on participant removal:** When a participant is removed, the owner generates a new symmetric key, encrypts it for all remaining participants, and distributes it. The removed participant can no longer decrypt new messages.
   - **Key rotation on participant addition:** The owner encrypts the existing channel key for the new participant. (New participant cannot decrypt messages sent before they joined, which is acceptable.)
   - Rotation responsibility follows seniority: if the owner leaves, the new owner (next senior) handles key rotation.

#### [MODIFY] DM schema (`dm_channels`)
- Add `encrypted_channel_keys TEXT` — JSON blob: `{ [account_id]: "base64-encrypted-symmetric-key" }`.

#### Client-side
- Store decrypted channel keys in memory (never persisted to disk unencrypted).
- Encrypt message content before `POST /api/dms/:channelId/messages`.
- Decrypt message content after receiving from `GET` or WebSocket.

---

### Phase 3D: DM Typing Indicators

**Objective:** Show typing indicators in DM conversations, scoped to participants only.

#### [MODIFY] [websocket.ts](file:///c:/Harmony/server/src/websocket.ts)
- On `DM_TYPING_START` / `DM_TYPING_STOP`:
  - Validate the sender is a participant of the DM channel.
  - Look up participant list from `dmsDb`.
  - Forward to other participants via `sendToAccounts`.

#### Client-side
- Reuse the existing `TypingIndicator` component, but route DM typing events through the correct WebSocket connection (the one connected to the host server).

---

## Phase 4: Client UI/UX

---

### Phase 4A: Multi-Server Store Refactor

**Objective:** Refactor `appStore.ts` to support multi-server state.

#### [MODIFY] [appStore.ts](file:///c:/Harmony/client/src/store/appStore.ts)
- Add per-server state tracking:
  ```typescript
  serverStates: Map<string, {
    connected: boolean;
    guilds: ServerData[];
    profiles: Profile[];
    roles: RoleData[];
  }>;
  ```
- Add DM-specific state:
  ```typescript
  dmChannels: DMChannel[];
  activeDmChannelId: string | null;
  dmMessages: Map<string, MessageData[]>;
  ```
- Modify `setActiveChannelId` to accept an optional `serverUrl` parameter so the UI knows which connection to use for fetching messages.

---

### Phase 4B: DM Sidebar Overhaul

**Objective:** Rebuild `DMSidebar.tsx` to render a Discord-like list of 1-on-1 and Group DMs.

#### [MODIFY] [DMSidebar.tsx](file:///c:/Harmony/client/src/components/DMSidebar.tsx)
- Fetch DM list from the user's primary trusted server (`GET /api/dms`).
- Sort by most recent message timestamp.
- Render:
  - 1-on-1 DMs: Show the other user's avatar, name, and presence indicator.
  - Group DMs: Show stacked avatars (up to 3) and group name or participant list.
  - Unread indicators (badge count or bold text).
  - Closed DMs are hidden by default, with an option to show them.
- Right-click context menu:
  - Close DM (hide from list)
  - Block user (1-on-1 only)
  - Report user
  - Leave Group DM
- "New DM" button that opens a user search/selection modal.

---

### Phase 4C: ChatArea DM Mode

**Objective:** Adapt `ChatArea.tsx` to render DM conversations.

#### [MODIFY] [ChatArea.tsx](file:///c:/Harmony/client/src/components/ChatArea.tsx)
- Detect when the active channel is a DM (check `activeDmChannelId` or a `type` field).
- DM header shows:
  - Participant avatars and names (1-on-1: single user; Group: list of participants).
  - "Add People" button (owner only, Group DMs, if < 10 participants).
  - "Leave" button (Group DMs).
- Fetch messages from the DM's **host server** URL (not necessarily the server the sidebar connected to).
- Decrypt messages client-side if `is_encrypted` is set.
- Send messages to the host server, encrypting before send.
- All existing message features (replies, reactions, attachments, editing) should work identically in DMs, using the DM message endpoints.

---

### Phase 4D: Block & Report UI

**Objective:** Add UI surfaces for blocking and reporting users.

#### [MODIFY] [FriendsList.tsx](file:///c:/Harmony/client/src/components/FriendsList.tsx)
- Add a "Block" button to each friend entry.
- Add a "Blocked" tab showing all blocked users with an "Unblock" button.

#### [NEW] [client/src/components/ReportModal.tsx](file:///c:/Harmony/client/src/components/ReportModal.tsx)
- Modal for submitting a report: reason dropdown, free-text description, optional message context.
- Submit to `POST /api/reports`.

#### [NEW] [client/src/components/ReportsPanel.tsx](file:///c:/Harmony/client/src/components/ReportsPanel.tsx) (Admin only)
- Panel in server settings for admins to review reports.
- List reports with status, view evidence, mark as reviewed/dismissed/actioned.

#### Context menus (right-click on user avatars/names)
- "Report User" option available everywhere a user is displayed (DMs, guilds, friends list).
- "Block User" option in DM headers and user popups.

---

### Phase 4E: Friends List Improvements

**Objective:** Enhance the existing friends list with better UX and integration with Harmony Social features.

#### [MODIFY] [FriendsList.tsx](file:///c:/Harmony/client/src/components/FriendsList.tsx)
- "Message" button on each friend entry should create or open a 1-on-1 DM.
- "Add Friend" should support both Account ID and the "specify a server URL" flow (for users not in the current network).
- "Online" tab should actually filter by presence status (currently shows all friends regardless).
- Show global profile info (avatar, status message, bio) in friend entries.

---

## Phase 5: Scalability & Optimization (DEFERRED)

> [!NOTE]
> Per user decision, this phase is deferred indefinitely. Harmony is expected to serve small communities of technically-minded users, not mass-scale deployments. The architecture from Phases 0-4 is sufficient for this use case. Revisit if performance testing reveals bottlenecks.

Potential future work:
- WebSocket relay fan-out (host server → shared trusted server → N clients)
- Connection multiplexing
- Message caching tiers
- DM history pagination optimization

---

## Summary of All Architectural Decisions

| Decision | Resolution |
|----------|-----------|
| Social graph privacy | Visible to trusted server operators (intentional) |
| Message storage | On initiator's oldest trusted server; hybrid caching on others |
| Block enforcement | Blocker's trusted servers only; blockee is notified |
| Block hides presence? | No |
| Block affects shared guilds? | No |
| Server-to-server auth | JWT tokens with Ed25519 keypairs exchanged during handshake |
| Group DM max participants | 10 |
| Group DM invites | Creator/owner only |
| Owner leaves Group DM | Ownership transfers to next oldest participant |
| Close vs. leave DM | Close hides from list; leave removes from participants |
| Conflict resolution | Merge with last-write-wins (latest `updated_at` wins) |
| E2EE for DMs | Per-channel AES-256-GCM symmetric key, distributed via RSA public keys |
| Group DM key rotation | By seniority (new owner rotates key) |
| Offline message buffering | Deferred to future work |
| Multi-server client | Full refactor: simultaneous connections to all relevant servers |

---

## Verification Plan

### Automated Tests (per phase)
- **Phase 0A:** Reject unsigned server-to-server requests. Accept valid JWTs.
- **Phase 0B:** DM events only reach listed account IDs; guild broadcasts still reach all.
- **Phase 0C:** All API calls use Bearer token; `X-Account-Id` calls return 401.
- **Phase 1A:** Relationship created on S1 appears on S2 within sync cycle.
- **Phase 1C:** Blocked user's message to `POST /api/dms/:id/messages` returns 403.
- **Phase 2B:** Full CRUD lifecycle for DM channels and messages.
- **Phase 3A:** Message stored in `dmsDb` on host server; not present on non-host servers.

### Manual Verification
- Run 3 local nodes (`--port=3001`, `3002`, `3003`).
- User A (trusts 3001, 3002) friends User B (trusts 3003).
- User A sends a DM. Verify messages are in `dms.db` on 3001 (oldest trusted server), not on 3003.
- User B reads the DM by connecting to 3001 (or via proxy through 3003).
- Block User B. Verify messages from B are dropped. Verify B is notified.
- Submit a report. Verify admin on the server can see and review it.
