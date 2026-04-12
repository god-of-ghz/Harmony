# Harmony Social — Agent Prompts: Phase 1 (Social Graph & Relationships)

Each prompt below is a **self-contained task** for an independent agent. The agent will NOT have access to any prior conversation. Each prompt contains all context needed.

**Prerequisites:** Phase 0A (server-to-server JWT auth), Phase 0B (targeted WebSocket delivery), Phase 0C (client auth migration) must be completed before these tasks.

---

## Phase 1A: Relationship Sync Across Trusted Servers

```
You are working on "Harmony," an open-source distributed chat platform similar to Discord.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite via sqlite3 + TypeScript)

BACKGROUND:
Harmony is a distributed system where users have 1-3 "trusted servers" (independent Harmony
server instances). When a user modifies their friend/block list on one server, the change must
propagate to all their other trusted servers so the data stays consistent.

CURRENT STATE OF THE CODEBASE:
- The database (c:\Harmony\server\src\database.ts) has a DatabaseManager class with:
  - nodeDb: SQLite database for accounts, trusted_servers, relationships, etc.
  - Helper methods: runNodeQuery, getNodeQuery, allNodeQuery.
- The relationships table currently has columns:
    account_id TEXT, target_id TEXT, status TEXT, timestamp INTEGER
    PRIMARY KEY (account_id, target_id)

- The app (c:\Harmony\server\src\app.ts) has three existing relationship endpoints:
  - POST /api/accounts/relationships/request — creates a 'pending' relationship
  - PUT /api/accounts/relationships/accept — changes 'pending' to 'friend'
  - DELETE /api/accounts/relationships/:targetId — removes the relationship
  All three are protected by requireAuth middleware (JWT Bearer token).
  All three call broadcastMessage() to notify connected WebSocket clients.

- The server has a server-to-server authentication system (implemented in Phase 0A):
  - Middleware: requireServerAuth (c:\Harmony\server\src\middleware\server_auth.ts)
  - Identity: server_identity.ts exports signServerJWT, getServerUrl
  - Known servers table: known_servers (server_url, public_key) in nodeDb.

- The trusted_servers table in nodeDb:
    account_id TEXT, server_url TEXT, position INTEGER
    UNIQUE(account_id, server_url)

YOUR TASK:
1. Add an updated_at column to the relationships table for conflict resolution.
2. Create a server-to-server sync endpoint for relationships.
3. Modify the three existing relationship endpoints to fan out changes to the user's other
   trusted servers after making local changes.

DETAILED IMPLEMENTATION:

1. MODIFY c:\Harmony\server\src\database.ts
   - In initNodeDb(), after the existing CREATE TABLE IF NOT EXISTS relationships statement,
     add an ALTER TABLE to add updated_at:
       ALTER TABLE relationships ADD COLUMN updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
     Wrap in error handling that ignores "duplicate column name" errors (same pattern used
     elsewhere in this file — look at how ALTER TABLE is handled for accounts.is_admin).

2. MODIFY c:\Harmony\server\src\app.ts

   a) Add a new server-to-server endpoint:
      POST /api/social/sync/relationships (protected by requireServerAuth middleware)
      Body: { relationships: Array<{ account_id, target_id, status, timestamp, updated_at }> }
      Logic:
        - For each relationship in the array:
          - Look up the local record by (account_id, target_id).
          - If no local record exists, INSERT the incoming record.
          - If a local record exists and the incoming updated_at is NEWER, UPDATE the local record.
          - If a local record exists and the incoming updated_at is OLDER or equal, SKIP (local wins).
        - Return { success: true, synced: <count of records actually updated/inserted> }.

   b) Create a helper function (do NOT export, keep it in app.ts scope):
      async function syncRelationshipsToTrustedServers(accountId: string, relationships: any[])
        - Fetches all trusted_servers for the given accountId from the DB.
        - For each trusted server URL (EXCLUDING this server's own URL — use getServerUrl()):
          - Creates a signed server JWT using signServerJWT(targetUrl).
          - POSTs to <serverUrl>/api/social/sync/relationships with the relationships array.
          - Uses the X-Server-JWT header for authentication.
          - Wraps each call in try/catch and logs errors (don't let one failed server block others).
        - Use Promise.allSettled to fan out concurrently.

   c) Modify the existing POST /api/accounts/relationships/request endpoint:
      - After the existing INSERT, set updated_at to Date.now() in the INSERT statement.
      - After the broadcastMessage call, call syncRelationshipsToTrustedServers with the
        new relationship record.

   d) Modify the existing PUT /api/accounts/relationships/accept endpoint:
      - After the UPDATE, fetch the updated record and call syncRelationshipsToTrustedServers.
      - Include updated_at = Date.now() in the UPDATE.

   e) Modify the existing DELETE /api/accounts/relationships/:targetId endpoint:
      - Before deleting, fetch the record so you have the data.
      - After deleting, call syncRelationshipsToTrustedServers with the record, setting
        status to 'none' and updated_at to Date.now(). (Sync endpoints should handle 'none'
        status as a delete signal — if status is 'none', DELETE the local record.)

   Import getServerUrl and signServerJWT from './server_identity'.
   Import requireServerAuth from './middleware/server_auth'.

CONFLICT RESOLUTION:
- Last-write-wins based on the updated_at timestamp.
- Clock skew between servers is accepted as a known limitation.

TESTING:
Create c:\Harmony\server\src\__tests__\relationship_sync.test.ts:
  - Test the sync endpoint accepts and inserts new relationships.
  - Test the sync endpoint updates when incoming updated_at is newer.
  - Test the sync endpoint skips when incoming updated_at is older.
  - Test the sync endpoint handles status='none' by deleting the local record.
  - Test that the helper function calls all trusted servers (mock fetch).
  - Test that the helper function excludes the current server URL.
  - Test that the helper function handles individual server failures gracefully.

Use vitest. Mock the database using a simple in-memory object or by creating a temporary
SQLite database. Mock fetch for the fan-out tests.

CODE QUALITY:
- TypeScript strict mode. Explicit return types on all functions.
- JSDoc on the sync endpoint and helper function.
- Use Promise.allSettled for concurrent fan-out (not sequential awaits).
- All error handling must log context (which server failed, what the error was).
- Do not modify any existing endpoint behavior beyond adding the sync fan-out.
- Preserve all existing comments and code structure.
```

---

## Phase 1B: Friend Request Discovery & Relay

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
Harmony is distributed — users may be registered on different, independent Harmony servers.
When User A wants to send a friend request to User B, User B might not exist on User A's server.
Harmony servers need to discover where User B's account lives and relay the friend request.

HOW ACCOUNT DISCOVERY WORKS:
Each user has trusted servers stored in the trusted_servers table (account_id, server_url).
When users are synced across servers (via /api/accounts/sync), their trusted server list is
included. So Server S1 may know that User B's account is managed by servers S3 and S4, even if
User B has never directly interacted with S1.

If User B is completely unknown to the network (no server has their info), the user should be
able to manually specify a server URL where User B is registered, triggering a discovery process.

CURRENT STATE:
- POST /api/accounts/relationships/request already exists in app.ts (requireAuth protected).
  It currently only creates a local relationship record. After Phase 1A, it also syncs to
  the sender's trusted servers.
- The accounts table has: id, email, auth_verifier, public_key, etc.
- The trusted_servers table has: account_id, server_url, position.
- Server-to-server auth exists: requireServerAuth middleware, signServerJWT(), getServerUrl().
- A sendToAccounts(accountIds, data) function is available (from Phase 0B's ClientManager)
  for targeted WebSocket delivery.

YOUR TASK:
Enable friend requests to be sent to users on remote servers, with both automatic discovery
and manual server specification.

MODIFY c:\Harmony\server\src\app.ts

1. New server-to-server endpoint:
   POST /api/social/relay/friend-request (protected by requireServerAuth)
   Body: { from_account_id: string, from_server_url: string, target_account_id: string }
   Logic:
     - Check if target_account_id exists in the local accounts table.
     - If YES:
       - Create a 'pending' relationship record (INSERT OR IGNORE) with updated_at = Date.now().
       - Notify the target user via sendToAccounts (or broadcastMessage — use sendToAccounts if
         available, fallback to broadcastMessage) with:
         { type: 'RELATIONSHIP_UPDATE', data: { account_id: from_account_id, target_id: target_account_id, status: 'pending' } }
       - Return { success: true, delivered: true }.
     - If target_account_id is NOT in the local accounts table:
       - Look up trusted_servers for the target_account_id. If entries exist, pick the first one
         and relay the request to that server (call POST /api/social/relay/friend-request on it,
         with a signed JWT). This creates a relay chain.
       - If no trusted_servers entries exist for the target, return { success: false, error: 'User not found on this server' }.
     - Add a relay_depth counter (pass it in the body, default 0). Increment on each relay.
       Reject if relay_depth > 3 to prevent infinite loops.

2. Modify the existing POST /api/accounts/relationships/request endpoint:
   Currently it only works if the target user exists locally. Change it:
   - First, check if targetId exists in the local accounts table. If YES, proceed as before
     (create local relationship, sync to trusted servers).
   - If targetId does NOT exist locally:
     - Look up trusted_servers for targetId. If found, pick the first server_url.
     - Call POST /api/social/relay/friend-request on that server, signed with a server JWT.
     - If the relay returns success, create a local record for the sender's side (pending outgoing)
       and return { success: true, relayed: true }.
     - If no trusted_servers entries exist, return 404: { error: 'User not found. Try specifying their server URL.' }

3. New client-facing endpoint:
   POST /api/accounts/relationships/request-via-server (protected by requireAuth)
   Body: { targetId: string, targetServerUrl: string }
   Logic:
     - This is the "manual specification" path for when the network has no info about the target.
     - First, perform a server handshake with targetServerUrl if not already in known_servers:
       - GET <targetServerUrl>/api/server/identity to get its public key.
       - Store in known_servers (INSERT OR IGNORE).
       - POST <targetServerUrl>/api/server/handshake with this server's identity.
     - Then relay the friend request: POST <targetServerUrl>/api/social/relay/friend-request
       with a signed JWT, sending { from_account_id, from_server_url: getServerUrl(), target_account_id: targetId }.
     - If successful, create the local outgoing pending relationship.
     - Return { success: true }.

TESTING:
Create c:\Harmony\server\src\__tests__\friend_request_relay.test.ts:
  - Test direct friend request (target exists locally) still works.
  - Test relay when target is not local but trusted_servers are known — verify fetch is called
    with correct URL and signed JWT.
  - Test relay depth limit — reject at depth > 3.
  - Test request-via-server performs handshake then relays.
  - Test request-via-server handles handshake failure gracefully.
  - Test that local pending relationship is created on the sender's side after successful relay.

Use vitest. Mock fetch for all network calls. Mock database methods.

CODE QUALITY:
- Explicit TypeScript types. JSDoc on all new endpoints and functions.
- Keep relay logic clean — extract into a helper function:
  async function relayFriendRequest(targetServerUrl, fromAccountId, targetAccountId, depth)
- Log relay attempts for debugging: console.log(`Relaying friend request to ${targetServerUrl}`).
- All network calls must be in try/catch blocks.
- Return meaningful HTTP status codes: 200 for success, 404 for not found, 502 for relay failure.
```

---

## Phase 1C: Block Enforcement

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
Harmony is adding user blocking. When User A blocks User B:
  - User A's trusted servers enforce the block: they DROP any incoming DM messages from User B.
  - User B's servers are notified so User B's client can display a "you have been blocked" state.
  - Blocking does NOT hide presence information.
  - Blocking does NOT affect visibility in shared guilds (User B can still see User A in guilds).
  - Blocked users cannot initiate new DMs with the blocker.
  - Messages from blocked users to existing DMs are silently dropped (not stored, not delivered).

CURRENT STATE:
- The relationships table in nodeDb has: account_id, target_id, status, timestamp, updated_at.
  Status can be: 'pending', 'friend', 'blocked', 'none'.
- The relationship sync mechanism from Phase 1A syncs relationship changes to trusted servers.
- Server-to-server auth exists (requireServerAuth, signServerJWT).
- DM endpoints do not exist yet — they'll be built in Phase 2/3. But you need to create the
  blocking infrastructure now so DM endpoints can check block status when they're implemented.

YOUR TASK:
1. Create a block endpoint for client use.
2. Create a server-to-server block notification relay.
3. Create a reusable helper function to check if a user is blocked.
4. Create an unblock endpoint.

MODIFY c:\Harmony\server\src\app.ts

1. POST /api/accounts/relationships/block (protected by requireAuth)
   Body: { targetId: string }
   Logic:
     - Set the relationship status to 'blocked' with updated_at = Date.now().
     - If a relationship already exists between the two users, UPDATE it to 'blocked'.
     - If no relationship exists, INSERT a new one with status='blocked'.
     - Use INSERT OR REPLACE or an UPSERT pattern.
     - Sync to the blocker's trusted servers using the existing syncRelationshipsToTrustedServers
       helper (from Phase 1A).
     - Notify the blockee's servers via a new relay endpoint (see below).
     - Return { success: true }.

2. POST /api/accounts/relationships/unblock (protected by requireAuth)
   Body: { targetId: string }
   Logic:
     - DELETE the relationship record between the two users.
     - Sync the deletion to trusted servers (status='none').
     - Optionally notify the blockee's servers that the block has been lifted.
     - Return { success: true }.

3. POST /api/social/relay/block-notification (protected by requireServerAuth)
   Body: { blocker_account_id: string, blocked_account_id: string, is_blocked: boolean }
   Logic:
     - This is called by the blocker's server to inform the blockee's server.
     - If the blocked_account_id exists locally:
       - Send a targeted WebSocket event to the blocked user:
         { type: 'RELATIONSHIP_UPDATE', data: { account_id: blocker_account_id, target_id: blocked_account_id, status: is_blocked ? 'blocked_by' : 'none' } }
         Note: 'blocked_by' is a client-side display state meaning "this person blocked you."
         It should NOT be stored in the relationships table — it's only a transient notification.
     - Return { success: true }.

4. Create a helper function (exported for use by future DM endpoints):
   NEW FILE: c:\Harmony\server\src\helpers\block_check.ts
   Export: async function isBlocked(accountA: string, accountB: string): Promise<boolean>
     - Queries the relationships table for any record where:
       (account_id = A AND target_id = B AND status = 'blocked')
       OR (account_id = B AND target_id = A AND status = 'blocked')
     - Returns true if either user has blocked the other.
   Export: async function getBlockDirection(accountA: string, accountB: string): Promise<'none' | 'a_blocked_b' | 'b_blocked_a' | 'mutual'>
     - More detailed check returning which direction(s) the block exists.
   Both functions should accept a db parameter (the DatabaseManager) for testability.

MODIFY the block endpoint to also call the blockee's trusted servers:
   - Look up the blockee's trusted servers from the trusted_servers table.
   - For each, POST /api/social/relay/block-notification with a signed server JWT.
   - Use Promise.allSettled for concurrent fan-out.

TESTING:
Create c:\Harmony\server\src\__tests__\block_enforcement.test.ts:
  - Test POST /api/accounts/relationships/block creates a 'blocked' record.
  - Test POST /api/accounts/relationships/block overwrites an existing 'friend' relationship.
  - Test POST /api/accounts/relationships/unblock deletes the record.
  - Test isBlocked returns true when a block exists (either direction).
  - Test isBlocked returns false when no block exists.
  - Test getBlockDirection returns correct direction.
  - Test the block notification relay sends a WebSocket event to the blocked user.
  - Test that block sync fans out to trusted servers.

Create c:\Harmony\server\src\__tests__\block_check.test.ts:
  - Isolated tests for the isBlocked and getBlockDirection helper functions.
  - Use a temporary in-memory SQLite database or mock the DB.

Use vitest. Mock fetch for network calls. Mock sendToAccounts for WebSocket tests.

CODE QUALITY:
- Explicit TypeScript types, JSDoc on all functions and endpoints.
- The isBlocked helper must be highly efficient — it will be called on every DM message send.
  Use a single SQL query, not multiple.
- Keep the block_check.ts module focused — no Express imports, no side effects. Pure logic + DB.
- Return proper HTTP status codes (200, 404, 500).
```

---

## Phase 1D: User Reporting System

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)

BACKGROUND:
Harmony server operators need to be able to receive and review reports from users about other
users' behavior. Unlike centralized platforms, each Harmony server is independently operated,
so reports go to the server operator (admin/creator), not a global moderation team.

This is a LOCAL feature — reports are stored on the server where they're submitted and are
reviewed by that server's admin. Reports do NOT sync across servers.

CURRENT STATE:
- The database (c:\Harmony\server\src\database.ts) has nodeDb with accounts table.
  Accounts have is_creator and is_admin boolean flags.
- The middleware (c:\Harmony\server\src\middleware\rbac.ts) has:
  - requireAuth: verifies JWT Bearer token, sets req.accountId.
  - isCreator: requires the user to be a server creator or admin.
- The app has a broadcastMessage function and a sendToAccounts function (from ClientManager in
  Phase 0B). sendToAccounts sends WebSocket events to specific users.

YOUR TASK:
Build a complete reporting system: database table, submission API, admin review API.

1. MODIFY c:\Harmony\server\src\database.ts
   In initNodeDb(), add a new table inside the serialize block:
   CREATE TABLE IF NOT EXISTS reports (
     id TEXT PRIMARY KEY,
     reporter_account_id TEXT NOT NULL,
     reported_account_id TEXT NOT NULL,
     reason TEXT NOT NULL,
     details TEXT DEFAULT '',
     context_server_id TEXT,
     context_channel_id TEXT,
     context_message_id TEXT,
     status TEXT DEFAULT 'pending',
     timestamp INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
     reviewed_by TEXT,
     reviewed_at INTEGER,
     review_notes TEXT DEFAULT ''
   );

2. MODIFY c:\Harmony\server\src\app.ts
   Add the following endpoints:

   POST /api/reports (protected by requireAuth)
   Body: {
     reported_account_id: string,
     reason: string,
     details?: string,
     context_server_id?: string,
     context_channel_id?: string,
     context_message_id?: string
   }
   Logic:
     - Validate that reason is not empty.
     - Validate that reported_account_id is not the same as the reporter (can't report yourself).
     - Generate a UUID for the report id.
     - Insert into the reports table with reporter_account_id = req.accountId.
     - Try to notify admin/creator accounts: query accounts where is_admin=1 or is_creator=1,
       then use sendToAccounts (if available) or broadcastMessage to send:
       { type: 'REPORT_SUBMITTED', data: { report_id, reported_account_id, reason, timestamp } }
       If sendToAccounts is not directly accessible from app.ts, use broadcastMessage with filter
       logic, or simply skip the real-time notification (admins can poll GET /api/reports).
     - Return the created report object with 201 status.

   GET /api/reports (protected by isCreator — admin only)
   Query params: ?status=pending (optional filter)
   Logic:
     - Fetch all reports from the reports table, ordered by timestamp DESC.
     - If status query param is provided, filter by it.
     - Return the array of reports.

   GET /api/reports/:reportId (protected by isCreator)
   Logic:
     - Fetch a single report by id.
     - Return 404 if not found.

   PUT /api/reports/:reportId (protected by isCreator)
   Body: { status: 'reviewed' | 'dismissed' | 'actioned', review_notes?: string }
   Logic:
     - Update the report: set status, reviewed_by = req.accountId, reviewed_at = Date.now(),
       review_notes if provided.
     - Return the updated report.

   DELETE /api/reports/:reportId (protected by isCreator)
   Logic:
     - Delete the report by id.
     - Return { success: true }.

TESTING:
Create c:\Harmony\server\src\__tests__\reports.test.ts:
  - Test POST /api/reports creates a report with correct fields.
  - Test POST /api/reports rejects empty reason.
  - Test POST /api/reports rejects self-reporting.
  - Test GET /api/reports returns all reports (admin only).
  - Test GET /api/reports?status=pending filters correctly.
  - Test GET /api/reports/:reportId returns a specific report.
  - Test PUT /api/reports/:reportId updates status and review fields.
  - Test DELETE /api/reports/:reportId removes the report.
  - Test that non-admin users cannot access GET/PUT/DELETE endpoints (403).

Use vitest. You can either:
  a) Use supertest to test the Express app directly (install if needed), or
  b) Mock the database and test the handler logic in isolation.

CODE QUALITY:
- TypeScript strict mode. Explicit types for report objects.
- Create a Report interface/type at the top of the file or in a shared types file.
- Validate all input — never trust the request body blindly.
- Use crypto.randomUUID() for report IDs (already imported in app.ts).
- Proper HTTP status codes: 201 for creation, 200 for success, 400 for bad input, 403 for unauthorized, 404 for not found.
- JSDoc on each endpoint.
```

