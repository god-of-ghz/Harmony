# Harmony Social — Agent Prompts: Phase 2 (DM Channel Infrastructure)

Each prompt below is a **self-contained task** for an independent agent. The agent will NOT have access to any prior conversation.

**Prerequisites:** Phase 0 (all), Phase 1A (relationship sync), Phase 1C (block check) must be completed before these tasks.

---

## Phase 2A: DM Database Schema

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite via sqlite3 + TypeScript)

BACKGROUND:
Harmony is adding a distributed Direct Messaging (DM) system called "Harmony Social." DMs
operate outside of guilds/servers. Each DM conversation has a "host server" — the Harmony server
that stores the actual message content. The host server is always the oldest trusted server of
the user who initiated the DM.

Non-host servers store only DM metadata (channel ID, participants, host URL) so that users'
clients can discover their DMs and connect to the correct host server.

CURRENT STATE:
The database (c:\Harmony\server\src\database.ts) has a DatabaseManager class. The initDmsDb()
method creates the DM database with three tables:
  - dm_channels (id, is_group, name, owner_id)
  - dm_participants (channel_id, account_id)
  - dm_messages (id, channel_id, author_id, content, timestamp, is_pinned, edited_at, attachments)

The existing schema lacks several fields needed for distributed operation and E2EE.

YOUR TASK:
Update the DM database schema to support distributed DMs with host server tracking, E2EE,
read states, and channel lifecycle management.

MODIFY c:\Harmony\server\src\database.ts

In the initDmsDb() method, AFTER the existing CREATE TABLE statements, add ALTER TABLE
statements to add new columns. Use the same error-handling pattern already used elsewhere in
this file for ALTER TABLE (wrap in a callback that ignores "duplicate column name" errors):

  this.dmsDb.run("ALTER TABLE ... ADD COLUMN ...", (err) => {
    if (err && !err.message.includes('duplicate column name')) {}
  });

Add these columns:

1. dm_channels:
   - host_server_url TEXT — the URL of the server that stores the actual messages
   - created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
   - max_participants INTEGER DEFAULT 10

2. dm_messages:
   - signature TEXT DEFAULT '' — for E2EE message signing
   - is_encrypted BOOLEAN DEFAULT 0 — whether the message content is encrypted
   - reply_to TEXT DEFAULT NULL — for reply threading

3. Add a NEW table dm_read_states:
   CREATE TABLE IF NOT EXISTS dm_read_states (
     account_id TEXT NOT NULL,
     channel_id TEXT NOT NULL,
     last_message_id TEXT,
     last_read_timestamp INTEGER,
     is_closed BOOLEAN DEFAULT 0,
     PRIMARY KEY (account_id, channel_id)
   );

   is_closed indicates the user has "closed" (hidden) the DM from their sidebar without
   actually leaving the channel. Receiving a new message in a closed DM should re-open it
   (set is_closed back to 0). This is handled by the message endpoints (Phase 3), not here.

4. Add a NEW table dm_channel_keys (for E2EE):
   CREATE TABLE IF NOT EXISTS dm_channel_keys (
     channel_id TEXT NOT NULL,
     account_id TEXT NOT NULL,
     encrypted_channel_key TEXT NOT NULL,
     key_version INTEGER DEFAULT 1,
     updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
     PRIMARY KEY (channel_id, account_id),
     FOREIGN KEY (channel_id) REFERENCES dm_channels(id) ON DELETE CASCADE
   );

   This stores the per-channel AES-256 symmetric key, encrypted with each participant's
   RSA public key. Each participant gets their own encrypted copy. key_version tracks
   key rotations (when participants are added/removed).

Also add helper methods to the DatabaseManager class for DM operations:

  public runDmsQuery(sql: string, params: any[] = []): Promise<void>
    → This already exists, good.

  public getDmsQuery<T>(sql: string, params: any[] = []): Promise<T | undefined>
    → This already exists, good.

  public allDmsQuery<T>(sql: string, params: any[] = []): Promise<T[]>
    → This already exists, good.

Verify these three methods exist. If they do, no action needed. If any are missing, add them
following the same pattern as runNodeQuery/getNodeQuery/allNodeQuery.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_schema.test.ts:
  - Use a temporary in-memory SQLite database for testing.
  - Test that all tables are created successfully.
  - Test that all new columns exist by inserting and selecting data.
  - Test dm_read_states can store and retrieve read states.
  - Test dm_channel_keys can store and retrieve encrypted keys.
  - Test foreign key constraints work (deleting a dm_channel cascades to dm_participants,
    dm_messages, dm_channel_keys, dm_read_states).

Use vitest. Create a test-only DatabaseManager instance with an in-memory database, or
use the sqlite3 ':memory:' path.

CODE QUALITY:
- Follow the exact patterns already used in database.ts for ALTER TABLE error handling.
- Add clear comments above each new table explaining its purpose.
- Do NOT modify any existing table CREATE statements — only ADD new ALTER TABLE statements
  and new CREATE TABLE statements.
- Preserve all existing code exactly as-is.
```

---

## Phase 2B: DM REST API (Full CRUD)

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
Harmony is adding distributed Direct Messaging. The client currently calls GET /api/dms
(see c:\Harmony\client\src\components\DMSidebar.tsx, line 17), but this endpoint does NOT
exist in the server. The entire DM REST API must be built from scratch.

DMs in Harmony work as follows:
- Each DM has a "host server" (the server that stores actual messages). The host_server_url
  is stored in the dm_channels table.
- 1-on-1 DMs and Group DMs (up to 10 participants) are both supported.
- Group DMs have an owner_id. Only the owner can invite new participants.
- Users can "close" a DM (hide from their list without leaving). The is_closed flag is in
  the dm_read_states table.

CURRENT STATE:
- Database: c:\Harmony\server\src\database.ts has dmsDb with tables:
  dm_channels (id, is_group, name, owner_id, host_server_url, created_at, max_participants)
  dm_participants (channel_id, account_id)
  dm_messages (id, channel_id, author_id, content, timestamp, is_pinned, edited_at,
               attachments, signature, is_encrypted, reply_to)
  dm_read_states (account_id, channel_id, last_message_id, last_read_timestamp, is_closed)
- Auth middleware: requireAuth (c:\Harmony\server\src\middleware\rbac.ts) verifies JWT and
  sets req.accountId.
- Block check: c:\Harmony\server\src\helpers\block_check.ts exports isBlocked(accountA, accountB).
- app.ts exports createApp(db, broadcastMessage) — or createApp(db, clientManager) if
  Phase 0B changed the signature. Check the current function signature and adapt.

YOUR TASK:
Create a complete DM REST API. Given the size of app.ts (already 1000+ lines), create a
separate router file.

FILES TO CREATE:

1. c:\Harmony\server\src\middleware\dm_auth.ts
   Two middleware functions:

   requireDmParticipant:
     - Extracts channelId from req.params.channelId.
     - Queries dm_participants for (channel_id = channelId, account_id = req.accountId).
     - If found, calls next(). If not, returns 403 { error: "Not a participant of this DM" }.
     - Depends on requireAuth having already set req.accountId (use AFTER requireAuth).

   requireDmOwner:
     - Same as above but also checks that dm_channels.owner_id === req.accountId.
     - If the user is a participant but not the owner, return 403 { error: "Only the DM owner can do this" }.

   Both should import dbManager from '../database'.

2. c:\Harmony\server\src\routes\social.ts
   Create an Express Router with the following endpoints. Export it as default.

   The router needs access to the database manager and the broadcastMessage/sendToAccounts
   functions. Accept them via a factory function:
     export const createSocialRouter = (db: any, sendToAccounts: Function, broadcastMessage: Function) => { ... }

   ENDPOINTS:

   GET /api/dms (requireAuth)
   - Lists all DM channels the authenticated user participates in.
   - Query: SELECT dc.*, drs.is_closed, drs.last_read_timestamp
            FROM dm_channels dc
            JOIN dm_participants dp ON dc.id = dp.channel_id
            LEFT JOIN dm_read_states drs ON dc.id = drs.channel_id AND drs.account_id = ?
            WHERE dp.account_id = ?
            ORDER BY dc.created_at DESC
   - For each channel, also fetch the participant list:
     SELECT account_id FROM dm_participants WHERE channel_id = ?
   - By default, EXCLUDE channels where is_closed = 1. Accept ?include_closed=true to include them.
   - Return array of: { id, is_group, name, owner_id, host_server_url, created_at, participants: string[], is_closed }

   POST /api/dms (requireAuth)
   - Creates a new DM channel.
   - Body: { participant_ids: string[], name?: string }
   - Validation:
     - participant_ids must include at least 1 other user (not the creator).
     - Total participants (including creator) must be <= 10.
     - Check isBlocked for each participant pair — reject if any blocks exist.
     - For 1-on-1 DMs (1 participant), check if a DM already exists between these two users.
       If yes, return the existing channel (don't create a duplicate). Re-open it if closed.
   - Create the channel:
     - id: crypto.randomUUID()
     - is_group: participant_ids.length > 1 ? 1 : 0
     - name: provided name, or null for 1-on-1 DMs
     - owner_id: req.accountId (the creator)
     - host_server_url: This server's URL (use getServerUrl() from server_identity).
       The host server is always the oldest trusted server of the initiating user.
       For now, since this endpoint is hit on the user's server, just use getServerUrl().
     - created_at: Date.now()
   - Insert into dm_participants for the creator and all participant_ids.
   - Return the created channel with 201 status.
   - NOTE: The announcement to other participants' trusted servers (Phase 2C) is handled
     separately. For now, just create the local records.

   GET /api/dms/:channelId (requireAuth, requireDmParticipant)
   - Returns the DM channel metadata with participant list.

   PUT /api/dms/:channelId (requireAuth, requireDmOwner)
   - Rename a Group DM. Body: { name: string }
   - Only works on group DMs (is_group = 1).
   - Return the updated channel.

   GET /api/dms/:channelId/participants (requireAuth, requireDmParticipant)
   - Returns the list of participant account IDs.

   PUT /api/dms/:channelId/participants (requireAuth, requireDmOwner)
   - Add a participant to a Group DM.
   - Body: { account_id: string }
   - Validate: channel must be a group DM, not exceed max_participants (10), account must not
     be blocked by any existing participant, account must not already be a participant.
   - INSERT into dm_participants.
   - Return { success: true, participants: [...updated list] }.

   DELETE /api/dms/:channelId/participants/:accountId (requireAuth, requireDmParticipant)
   - Remove a participant or leave the DM.
   - If req.accountId === :accountId, user is leaving.
   - If req.accountId !== :accountId, only the owner can remove others.
   - If the leaving user is the owner:
     - Transfer ownership to the participant who joined earliest (lowest rowid in dm_participants,
       excluding the leaving user). Update dm_channels.owner_id.
   - DELETE from dm_participants.
   - If no participants remain, DELETE the DM channel entirely (cascade will clean up messages).
   - Return { success: true }.

   PUT /api/dms/:channelId/close (requireAuth, requireDmParticipant)
   - Marks the DM as closed (hidden) for this user.
   - INSERT OR REPLACE into dm_read_states (account_id, channel_id, is_closed) VALUES (?, ?, 1)
   - Return { success: true }.

   PUT /api/dms/:channelId/open (requireAuth, requireDmParticipant)
   - Re-opens a closed DM.
   - UPDATE dm_read_states SET is_closed = 0 WHERE account_id = ? AND channel_id = ?
   - Return { success: true }.

3. MODIFY c:\Harmony\server\src\app.ts
   - Import the createSocialRouter.
   - Call it with (db, sendToAccounts, broadcastMessage) — adapt to whatever the current
     createApp signature provides.
   - Mount it: app.use(socialRouter) or app.use('/api', socialRouter) depending on whether
     the routes in social.ts include the /api prefix.
   - Ensure requireAuth middleware is already imported.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_api.test.ts:
  - Test GET /api/dms returns empty array for user with no DMs.
  - Test POST /api/dms creates a 1-on-1 DM.
  - Test POST /api/dms de-duplicates 1-on-1 DMs (returns existing).
  - Test POST /api/dms creates a Group DM with multiple participants.
  - Test POST /api/dms rejects more than 10 participants.
  - Test POST /api/dms rejects if any participant is blocked.
  - Test GET /api/dms/:channelId returns channel metadata.
  - Test PUT /api/dms/:channelId renames a Group DM.
  - Test PUT /api/dms/:channelId rejects rename for 1-on-1 DMs (only groups can be renamed).
  - Test PUT /api/dms/:channelId/participants adds a participant.
  - Test DELETE /api/dms/:channelId/participants/:accountId removes user.
  - Test ownership transfer when owner leaves.
  - Test channel deletion when last participant leaves.
  - Test PUT /api/dms/:channelId/close and PUT /api/dms/:channelId/open.
  - Test GET /api/dms excludes closed DMs by default, includes when ?include_closed=true.
  - Test requireDmParticipant rejects non-participants.
  - Test requireDmOwner rejects non-owners.

Use vitest. Use supertest for HTTP-level testing, or mock the req/res/next objects.
Mock the database layer.

CODE QUALITY:
- TypeScript strict mode. Create types/interfaces for DmChannel, DmParticipant, etc.
- JSDoc on every endpoint.
- Validate ALL input fields. Return 400 for malformed input.
- Use proper HTTP status codes: 200, 201, 400, 403, 404, 409.
- Keep the router file focused on DM logic only. No guild-related code.
- Use meaningful error messages in all error responses.
- Import crypto from 'crypto' for UUID generation (already available in the project).
```

---

## Phase 2C: DM Channel Announcements (Server-to-Server)

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
When a DM is created on one Harmony server (the "host"), the other participants may have their
trusted servers on different Harmony instances. Those servers need to know about the DM so that:
1. The participants' clients can discover the DM when they fetch GET /api/dms.
2. The clients know the host_server_url to connect to for actual messages.

The announcement is a server-to-server operation: the host server tells each participant's
trusted servers "hey, your user has been added to this DM channel."

CURRENT STATE:
- DM REST API exists at c:\Harmony\server\src\routes\social.ts (or in app.ts) from Phase 2B.
  POST /api/dms creates a DM locally.
- Server-to-server auth: requireServerAuth middleware, signServerJWT(), getServerUrl().
- The trusted_servers table: (account_id, server_url, position).
- The dm_channels table has host_server_url.
- The dm_participants table has (channel_id, account_id).

YOUR TASK:
1. Create a server-to-server endpoint for receiving DM announcements.
2. Modify the DM creation endpoint to broadcast announcements to participants' trusted servers.
3. Create a server-to-server endpoint for participant list updates.

MODIFY the DM routes file (c:\Harmony\server\src\routes\social.ts or wherever the DM routes
are defined):

1. POST /api/social/dms/announce (protected by requireServerAuth)
   Body: {
     channel_id: string,
     host_server_url: string,
     is_group: boolean,
     name: string | null,
     owner_id: string,
     participants: string[],
     created_at: number
   }
   Logic:
     - This is called by a host server to tell this server about a DM that involves a local user.
     - INSERT OR IGNORE into dm_channels (metadata only — this server won't store messages).
     - INSERT OR IGNORE into dm_participants for all participants.
     - For any participants who are connected via WebSocket on this server, send a
       DM_CHANNEL_CREATE event via sendToAccounts:
       { type: 'DM_CHANNEL_CREATE', data: { ...channel metadata, participants } }
     - Return { success: true }.

2. POST /api/social/dms/update-participants (protected by requireServerAuth)
   Body: {
     channel_id: string,
     action: 'add' | 'remove',
     account_id: string,
     new_owner_id?: string  (included when the owner changed due to a leave)
   }
   Logic:
     - If action is 'add': INSERT OR IGNORE into dm_participants.
     - If action is 'remove': DELETE from dm_participants where channel_id and account_id match.
     - If new_owner_id is provided, UPDATE dm_channels SET owner_id = new_owner_id.
     - Notify locally-connected participants via sendToAccounts with DM_CHANNEL_UPDATE event.
     - Return { success: true }.

3. MODIFY the existing POST /api/dms endpoint (the one that creates DMs):
   After creating the DM locally, add logic to announce it:
   - For each participant (EXCLUDING the creator):
     - Look up the participant's trusted servers from the trusted_servers table.
     - For each trusted server URL (EXCLUDING this server's own URL):
       - Sign a server JWT targeting that server.
       - POST to <serverUrl>/api/social/dms/announce with the channel metadata.
   - Use a helper function for this:
     async function announceDmToParticipantServers(channel, participants)
   - Use Promise.allSettled for concurrent fan-out.
   - Log errors but don't fail the response — the DM was created successfully locally.

4. MODIFY the participant add/remove endpoints (PUT /api/dms/:channelId/participants and
   DELETE /api/dms/:channelId/participants/:accountId):
   After modifying participants locally, announce the change:
   - For each EXISTING participant:
     - Look up their trusted servers.
     - POST to <serverUrl>/api/social/dms/update-participants with the change info.
   - Log errors but don't fail the operation.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_announcements.test.ts:
  - Test POST /api/social/dms/announce stores metadata (channel + participants) locally.
  - Test POST /api/social/dms/announce does not store if it already exists (INSERT OR IGNORE).
  - Test POST /api/social/dms/update-participants adds a participant.
  - Test POST /api/social/dms/update-participants removes a participant.
  - Test POST /api/social/dms/update-participants updates owner.
  - Test that POST /api/dms triggers announcements to participants' trusted servers (mock fetch).
  - Test that the announcement fan-out excludes the current server URL.
  - Test that individual announcement failures don't fail the overall DM creation.

Use vitest. Mock fetch for server-to-server calls. Mock the database.

CODE QUALITY:
- TypeScript strict mode. JSDoc on endpoints and helper functions.
- Extract the announcement fan-out logic into a well-named helper function.
- All network calls wrapped in try/catch with informative logging.
- Use Promise.allSettled (NOT Promise.all) for concurrent operations.
- Keep endpoint handlers lean — delegate complex logic to helper functions.
```

---

## Phase 2D: Group DM Lifecycle Rules

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
Harmony supports Group DMs with up to 10 participants. These are informal group conversations
without guild structure. The lifecycle rules are:
  - Max 10 participants per Group DM.
  - Only the owner (creator) can invite new participants.
  - When the owner leaves, ownership transfers to the NEXT OLDEST participant (by join order).
  - If the last participant leaves, the Group DM and all its messages are deleted.
  - Users can "close" (hide) a DM without leaving. Receiving a new message re-opens it.

CURRENT STATE:
- DM endpoints exist in c:\Harmony\server\src\routes\social.ts (Phase 2B).
- The participant add/remove endpoints were created in Phase 2B but may have basic
  implementations. This task ensures the lifecycle rules are fully enforced.
- The dm_channels table has: owner_id, max_participants, is_group.
- The dm_participants table tracks who is in each channel.
- DM announcements (Phase 2C) sync participant changes to other servers.

YOUR TASK:
Audit and enhance the DM participant management to fully enforce lifecycle rules. This is a
review-and-fix task rather than a build-from-scratch task.

MODIFY c:\Harmony\server\src\routes\social.ts (or wherever DM routes are defined):

1. Review POST /api/dms (create DM):
   Ensure:
   - Total participants (including creator) cannot exceed 10.
   - is_group is set to 1 when participant count (including creator) > 2, and 0 for exactly 2.
     (A DM with just 2 people is a 1-on-1, not a group.)
   - For 1-on-1 DMs, check for an existing DM between the same two users. If one exists,
     return it instead of creating a duplicate. If it was closed, re-open it.

2. Review PUT /api/dms/:channelId/participants (add participant):
   Ensure:
   - Only works on Group DMs (is_group = 1). Reject for 1-on-1 DMs.
   - Only the owner can add participants.
   - Adding a participant does not exceed max_participants (10).
   - The new participant is not blocked by or blocking any existing participant.
   - If a 1-on-1 DM is being "upgraded" to a group (adding a 3rd person), update is_group to 1.
     Actually, reconsider: 1-on-1 DMs should not be upgradeable to groups. The user should
     create a new Group DM instead. Return 400 { error: "Cannot add participants to a 1-on-1 DM. Create a new Group DM." }

3. Review DELETE /api/dms/:channelId/participants/:accountId (remove/leave):
   Ensure:
   - If the leaving user is the owner:
     a) Find the participant who was added earliest (the one with the smallest rowid in
        dm_participants, excluding the leaving user).
     b) Transfer ownership: UPDATE dm_channels SET owner_id = <new_owner> WHERE id = <channelId>.
     c) Announce the ownership transfer to all participants' trusted servers.
   - If the leaving user is NOT the owner:
     a) Only the user themselves or the owner can remove them.
        req.accountId must be :accountId (self-leave) OR req.accountId must be the owner.
     b) If neither, return 403.
   - After removal, count remaining participants:
     - If 0: DELETE the dm_channel (cascades to dm_messages, dm_participants, dm_channel_keys, dm_read_states).
     - If 1: The last person can still see the history but cannot send new messages (optional,
       or just delete the channel — user's choice. For simplicity, keep the channel alive so
       the last person can read the history. They can close it when they want.).
   - Announce the participant change to other servers (Phase 2C logic).

4. Review PUT /api/dms/:channelId/close and PUT /api/dms/:channelId/open:
   Ensure:
   - Close sets is_closed = 1 in dm_read_states (INSERT OR REPLACE).
   - Open sets is_closed = 0.
   - Closing a DM does NOT remove the user from dm_participants (they're still in the channel).

5. Add a mechanism for "re-open on new message":
   Create and export a helper function (for Phase 3A to call):
     async function reopenClosedDm(accountId: string, channelId: string): Promise<void>
   - UPDATE dm_read_states SET is_closed = 0 WHERE account_id = ? AND channel_id = ? AND is_closed = 1
   - This will be called by the message send endpoint (Phase 3A) after storing a new DM message.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_lifecycle.test.ts:
  - Test creating a Group DM with 3+ participants sets is_group = 1.
  - Test creating a 1-on-1 DM with 2 participants sets is_group = 0.
  - Test duplicate 1-on-1 DM returns existing channel.
  - Test cannot exceed 10 participants.
  - Test only owner can add participants to a Group DM.
  - Test cannot add participants to a 1-on-1 DM (returns 400).
  - Test owner leave transfers ownership to the oldest remaining participant.
  - Test non-owner can only remove themselves.
  - Test channel is deleted when last participant leaves.
  - Test close/open updates dm_read_states correctly.
  - Test close does not remove from dm_participants.
  - Test reopenClosedDm sets is_closed = 0.

Use vitest. Mock database or use in-memory SQLite.

CODE QUALITY:
- Explicit TypeScript types. JSDoc on all modified endpoints and helper functions.
- Use clear, readable SQL queries. Parameterize all user input.
- Keep lifecycle logic well-commented — each rule should have a code comment explaining it.
- Use descriptive error messages so the client can display them to the user.
- Return appropriate HTTP status codes.
```

