# Harmony Social — Agent Prompts: Phase 3 (DM Messaging & Real-Time)

Each prompt below is a **self-contained task** for an independent agent. The agent will NOT have access to any prior conversation.

**Prerequisites:** All of Phase 0 and Phase 2 must be completed.

---

## Phase 3A: DM Message CRUD

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite via sqlite3 + TypeScript)

BACKGROUND:
Harmony has a distributed DM system. Each DM channel has a "host server" that stores the actual
message content in a dedicated dmsDb (separate from guild server databases). The DM routes are
in c:\Harmony\server\src\routes\social.ts (or wherever they were placed in Phase 2B).

DM channels already have these endpoints (from Phase 2):
  - GET /api/dms — list channels
  - POST /api/dms — create a channel
  - Channel metadata and participant management endpoints

Now we need the message CRUD endpoints that read/write to the dm_messages table in dmsDb.

CURRENT STATE:
- dmsDb has dm_messages table with: id, channel_id, author_id, content, timestamp, is_pinned,
  edited_at, attachments, signature, is_encrypted, reply_to.
- dm_read_states table: account_id, channel_id, last_message_id, last_read_timestamp, is_closed.
- Middleware: requireAuth (sets req.accountId), requireDmParticipant (verifies user is in channel).
- Block check: isBlocked(accountA, accountB) in c:\Harmony\server\src\helpers\block_check.ts.
- sendToAccounts(accountIds, data) for targeted WebSocket delivery.
- reopenClosedDm(accountId, channelId) helper from Phase 2D.
- The db object has runDmsQuery, getDmsQuery, allDmsQuery for dmsDb operations.

YOUR TASK:
Add message CRUD endpoints for DM channels.

MODIFY the DM routes file (c:\Harmony\server\src\routes\social.ts or equivalent):

1. GET /api/dms/:channelId/messages (requireAuth, requireDmParticipant)
   Query params:
     - limit: number (default 100, max 200)
     - cursor: string (ISO timestamp for pagination — fetch messages BEFORE this timestamp)
   Logic:
     - Query dm_messages WHERE channel_id = :channelId, ordered by timestamp DESC, with LIMIT.
     - If cursor is provided, add WHERE timestamp < cursor.
     - For each message, look up the author's global profile to get display name:
       Query accounts table in nodeDb: SELECT email FROM accounts WHERE id = <author_id>.
       Use the email prefix (before @) as a display name. If no account found, use 'Unknown'.
     - Reverse the results to return in chronological order (ASC).
     - If a reply_to is set, fetch the replied message's content and author (same pattern as
       guild messages in app.ts — look for the existing reply JOIN pattern).
     - Return array of messages with author info stitched in.

2. POST /api/dms/:channelId/messages (requireAuth, requireDmParticipant)
   Body: {
     content: string,
     signature?: string,
     is_encrypted?: boolean,
     attachments?: string,   // JSON array of URLs
     reply_to?: string       // message ID being replied to
   }
   Logic:
     - Validate content is not empty (unless attachments are provided).
     - BLOCK CHECK: Fetch all participants of this DM channel. For each participant OTHER than
       the sender, call isBlocked(sender, participant). If ANY returns true, return 403:
       { error: "Cannot send messages: you are blocked by a participant" }.
       Import isBlocked from '../helpers/block_check'.
     - Generate message ID: Date.now().toString() (same pattern used in guild messages).
     - INSERT into dm_messages with all fields.
     - For each participant (INCLUDING the sender), call reopenClosedDm(accountId, channelId)
       to re-open the DM if any participant had closed it.
     - Update dm_read_states for the SENDER: set last_message_id and last_read_timestamp.
     - Fetch author info (same as GET endpoint above).
     - Send the new message to all participants via sendToAccounts:
       { type: 'DM_MESSAGE', data: { ...message, channel_id } }
     - Return the message object with 201 status.

3. DELETE /api/dms/:channelId/messages/:messageId (requireAuth, requireDmParticipant)
   Logic:
     - Fetch the message to check ownership.
     - The author can delete their own messages. The DM owner can delete any message.
     - If neither, return 403.
     - DELETE from dm_messages WHERE id = :messageId.
     - Notify participants via sendToAccounts:
       { type: 'DM_MESSAGE_DELETE', data: { message_id: messageId, channel_id: channelId } }
     - Return { success: true }.

4. PUT /api/dms/:channelId/messages/:messageId (requireAuth, requireDmParticipant)
   Body: { content: string, is_encrypted?: boolean }
   Logic:
     - Only the message author can edit their own messages.
     - UPDATE dm_messages SET content = ?, edited_at = ? WHERE id = ? AND author_id = ?
     - If no rows updated, return 403 or 404.
     - Notify participants via sendToAccounts:
       { type: 'DM_MESSAGE_EDIT', data: { message_id: messageId, channel_id: channelId, content, edited_at } }
     - Return the updated message.

5. PUT /api/dms/:channelId/read (requireAuth, requireDmParticipant)
   Body: { last_message_id: string }
   Logic:
     - INSERT OR REPLACE into dm_read_states: account_id, channel_id, last_message_id,
       last_read_timestamp = Date.now(), preserve existing is_closed value.
     - Return { success: true }.

PERFORMANCE NOTE:
The block check on message send queries the relationships table for every participant pair.
For Group DMs with 10 participants, that's up to 9 queries. This is acceptable at small scale.
If it becomes a bottleneck, batch the checks into a single SQL query using IN clauses.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_messages.test.ts:
  - Test GET /api/dms/:channelId/messages returns messages in chronological order.
  - Test GET /api/dms/:channelId/messages with cursor paginates correctly.
  - Test POST /api/dms/:channelId/messages creates a message.
  - Test POST /api/dms/:channelId/messages rejects when sender is blocked.
  - Test POST /api/dms/:channelId/messages re-opens closed DMs for all participants.
  - Test DELETE /api/dms/:channelId/messages/:messageId by author succeeds.
  - Test DELETE /api/dms/:channelId/messages/:messageId by non-author/non-owner fails.
  - Test PUT /api/dms/:channelId/messages/:messageId edits a message (author only).
  - Test PUT /api/dms/:channelId/read updates read state.
  - Test that non-participants are rejected by requireDmParticipant.

Use vitest. Mock database and sendToAccounts.

CODE QUALITY:
- TypeScript strict mode. JSDoc on all endpoints.
- Follow the EXACT same patterns used for guild messages in app.ts (look at the existing
  GET /api/channels/:channelId/messages and POST /api/channels/:channelId/messages for
  the SQL query style, pagination approach, and response format).
- Keep the code consistent with the rest of the codebase.
- Proper HTTP status codes. Descriptive error messages.
- Parameterize ALL SQL queries — no string interpolation for user input.
```

---

## Phase 3B: DM WebSocket Events

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + WebSocket via 'ws' + TypeScript)

BACKGROUND:
Harmony's WebSocket layer was refactored in Phase 0B to support targeted delivery via a
ClientManager class (c:\Harmony\server\src\client_manager.ts). The DM message endpoints
(Phase 3A) already call sendToAccounts to push events. Now the WebSocket handler in
websocket.ts needs to be updated to handle DM-specific client messages like typing indicators.

CURRENT STATE:
- c:\Harmony\server\src\websocket.ts handles PRESENCE_IDENTIFY, PRESENCE_UPDATE,
  TYPING_START, TYPING_STOP message types from clients.
- It uses a ClientManager (or broadcastMessage + registerAccount).
- The existing TYPING_START/TYPING_STOP events are for guild channels and use broadcastMessage
  (all clients receive them).
- DM typing events need to use sendToAccounts (targeted delivery to DM participants only).

YOUR TASK:
Add handling for DM-specific WebSocket messages from clients.

MODIFY c:\Harmony\server\src\websocket.ts

1. Add handling for DM_TYPING_START message type:
   Client sends: { type: 'DM_TYPING_START', data: { channelId: string } }
   Server logic:
     - Get the accountId from socketAccountMap (or clientManager).
     - Look up the DM channel's participants from dmsDb:
       SELECT account_id FROM dm_participants WHERE channel_id = ?
     - Verify the sender is a participant (security check — don't relay for non-participants).
     - Get the list of OTHER participant accountIds (exclude the sender).
     - Send to those accounts via sendToAccounts:
       { type: 'DM_TYPING_START', data: { channelId, accountId } }

2. Add handling for DM_TYPING_STOP message type:
   Same as above but with type 'DM_TYPING_STOP'.

IMPORTANT: The websocket.ts module needs access to the database manager to look up DM
participants. Currently it does NOT import the database. You have two options:
  a) Import dbManager from './database' directly in websocket.ts.
  b) Pass the db reference into setupConnectionTracking (modify its signature).
Choose whichever is cleaner. If modifying the signature, update server.ts accordingly.

Also ensure: The existing TYPING_START / TYPING_STOP handlers for guild channels continue to
work unchanged. They use broadcastMessage and are NOT changed. The DM versions are SEPARATE
handlers that check for DM_TYPING_START / DM_TYPING_STOP event types.

DEFINE the complete set of DM WebSocket event types (as a reference for the codebase):
  Server → Client events (sent by endpoints/handlers):
    DM_CHANNEL_CREATE — new DM created/announced
    DM_CHANNEL_UPDATE — DM renamed, participant changed
    DM_CHANNEL_DELETE — DM deleted
    DM_MESSAGE — new message in DM
    DM_MESSAGE_EDIT — message edited in DM
    DM_MESSAGE_DELETE — message deleted in DM
    DM_TYPING_START — user started typing in DM
    DM_TYPING_STOP — user stopped typing in DM

  Client → Server events (handled in websocket.ts):
    DM_TYPING_START — { channelId: string }
    DM_TYPING_STOP — { channelId: string }

No other client → server DM events are needed. All other DM operations use REST API endpoints.

TESTING:
Create c:\Harmony\server\src\__tests__\dm_websocket.test.ts:
  - Test DM_TYPING_START from a valid participant sends to other participants only.
  - Test DM_TYPING_START from a non-participant is silently ignored.
  - Test DM_TYPING_STOP from a valid participant sends to other participants only.
  - Test that existing TYPING_START (guild) still uses broadcastMessage (no regression).
  - Test that unknown message types are silently ignored (no crash).

Use vitest. Mock the database (allDmsQuery) and mock WebSocket send functions.

CODE QUALITY:
- TypeScript strict mode. JSDoc on new handlers.
- Keep the message handler's if/else chain clean — consider a switch statement or handler map.
- The DM participant lookup is an async operation. The WebSocket message handler is currently
  synchronous (try/catch around JSON.parse). You'll need to make parts of it async. Ensure
  errors in the async DM handler don't crash the WebSocket connection.
- Log errors with context (channelId, accountId) for debugging.
```

---

## Phase 3C: DM End-to-End Encryption

```
You are working on "Harmony," an open-source distributed chat platform.
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite + TypeScript)
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
Harmony already has E2EE for guild messages. Each user has an RSA keypair — the public key is
stored in the accounts table on the server, and the encrypted private key is stored with the
user's account (decrypted client-side using their password).

For DMs, we use per-channel symmetric encryption:
  - Each DM channel gets a random AES-256-GCM symmetric key.
  - This key is encrypted with each participant's RSA public key and stored in the
    dm_channel_keys table: (channel_id, account_id, encrypted_channel_key, key_version).
  - Clients encrypt message content with the channel key before sending.
  - Clients decrypt message content after receiving.

Key rotation:
  - When a participant is REMOVED, the owner generates a new key and re-distributes it to all
    remaining participants. The removed user can no longer decrypt new messages.
  - When a participant is ADDED, the owner encrypts the existing key for the new participant.
    (New participant can't decrypt messages sent before they joined — this is acceptable.)

CURRENT STATE:
- Accounts table has: public_key TEXT (base64-encoded RSA public key).
- Client store has: sessionPrivateKey: CryptoKey | null (the decrypted user's RSA private key).
- dm_channel_keys table exists (Phase 2A): channel_id, account_id, encrypted_channel_key,
  key_version, updated_at.
- dm_messages table has: is_encrypted BOOLEAN, signature TEXT.
- The client already has E2EE logic for guild messages. Look in the client codebase for
  existing encrypt/decrypt functions using WebCrypto API — reuse them where possible.

YOUR TASK:
Implement the server-side key storage endpoints and client-side encryption/decryption for DMs.

SERVER CHANGES:

MODIFY the DM routes (c:\Harmony\server\src\routes\social.ts or equivalent):

1. POST /api/dms/:channelId/keys (requireAuth, requireDmParticipant)
   Body: { keys: { [account_id: string]: string }, key_version: number }
   - keys is a map of account_id → base64-encoded encrypted channel key.
   - Only the DM owner can set keys (verify req.accountId === channel.owner_id).
   - For each entry, INSERT OR REPLACE into dm_channel_keys.
   - Return { success: true }.

2. GET /api/dms/:channelId/keys (requireAuth, requireDmParticipant)
   - Fetch the requesting user's encrypted channel key from dm_channel_keys:
     SELECT encrypted_channel_key, key_version FROM dm_channel_keys
     WHERE channel_id = ? AND account_id = ?
   - Return { encrypted_channel_key, key_version }.
   - If no key exists for this user, return 404.

3. GET /api/dms/:channelId/keys/all (requireAuth, requireDmOwner)
   - Fetch ALL encrypted keys for this channel (only owner can see all).
   - Return array of { account_id, encrypted_channel_key, key_version }.

4. MODIFY POST /api/dms (create DM):
   After creating the channel, if the request body includes a `keys` field:
     { participant_ids: [...], keys: { [account_id]: encrypted_channel_key } }
   Automatically populate dm_channel_keys for each participant.
   The keys field is OPTIONAL — the client may set keys in a separate POST /api/dms/:channelId/keys call.

CLIENT CHANGES:

5. CREATE c:\Harmony\client\src\services\DmEncryption.ts
   Export utility functions:

   - async function generateChannelKey(): Promise<CryptoKey>
     Generates a random AES-256-GCM key using window.crypto.subtle.generateKey().

   - async function exportChannelKey(key: CryptoKey): Promise<ArrayBuffer>
     Exports the AES key as raw bytes.

   - async function importChannelKey(rawKey: ArrayBuffer): Promise<CryptoKey>
     Imports raw bytes back into a CryptoKey.

   - async function encryptChannelKeyForUser(channelKey: CryptoKey, userPublicKeyBase64: string): Promise<string>
     - Import the user's RSA public key from base64.
     - Export the channel key as raw bytes.
     - Encrypt the raw bytes using RSA-OAEP with the user's public key.
     - Return as base64 string.

   - async function decryptChannelKey(encryptedKeyBase64: string, privateKey: CryptoKey): Promise<CryptoKey>
     - Decode from base64 to ArrayBuffer.
     - Decrypt using RSA-OAEP with the user's private key.
     - Import the result as an AES-256-GCM CryptoKey.

   - async function encryptMessage(content: string, channelKey: CryptoKey): Promise<{ ciphertext: string, iv: string }>
     - Generate a random 12-byte IV.
     - Encrypt content using AES-256-GCM with the channel key and IV.
     - Return base64-encoded ciphertext and base64-encoded IV.
     - The message stored on the server will be JSON: { ciphertext, iv }

   - async function decryptMessage(encryptedContent: string, channelKey: CryptoKey): Promise<string>
     - Parse the JSON content { ciphertext, iv }.
     - Decode both from base64 to ArrayBuffer.
     - Decrypt using AES-256-GCM with the channel key and IV.
     - Return the plaintext string.

TESTING:

Server tests (c:\Harmony\server\src\__tests__\dm_encryption_api.test.ts):
  - Test POST /api/dms/:channelId/keys stores keys correctly.
  - Test GET /api/dms/:channelId/keys returns the user's key.
  - Test GET /api/dms/:channelId/keys returns 404 for missing key.
  - Test only owner can POST keys.
  - Test only owner can GET /keys/all.

Client tests (c:\Harmony\client\src\services\__tests__\DmEncryption.test.ts):
  - Test generateChannelKey creates a valid AES-256-GCM key.
  - Test encrypt then decrypt round-trip: message matches original.
  - Test encryptChannelKeyForUser then decryptChannelKey round-trip works.
  - Test decryptMessage with wrong key fails (throws).
  - Test different IVs produce different ciphertexts for the same message.

Use vitest for both. The client tests may need a polyfill for WebCrypto if running in Node
(vitest runs in Node). Use the 'crypto' module's webcrypto: import { webcrypto } from 'crypto';
and assign globalThis.crypto = webcrypto if needed.

CODE QUALITY:
- TypeScript strict mode. JSDoc on all functions.
- Security best practices: never log key material, never store plaintext keys on the server.
- Use standard WebCrypto APIs — no third-party crypto libraries.
- IV must be unique per message (random generation). Document this in comments.
- Handle errors gracefully: decryption failures should be caught and displayed as
  "[Encrypted message — unable to decrypt]" rather than crashing.
- The encryption service must be stateless — no global variables holding keys.
```

---

## Phase 3D: DM Typing Indicators

```
You are working on "Harmony," an open-source distributed chat platform.
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
Harmony has a TypingIndicator component at c:\Harmony\client\src\components\TypingIndicator.tsx
that shows "User is typing..." in guild channels. The WebSocket layer now supports DM typing
events (Phase 3B) with event types DM_TYPING_START and DM_TYPING_STOP.

For DM channels, the client needs to:
1. Send DM_TYPING_START/STOP events through the WebSocket connected to the DM's host server.
2. Display typing indicators in the DM chat view.

CURRENT STATE:
- TypingIndicator.tsx exists and handles guild typing events.
- The client has a ConnectionManager (c:\Harmony\client\src\services\ConnectionManager.ts)
  that manages WebSocket connections to multiple servers.
- The Zustand store (c:\Harmony\client\src\store\appStore.ts) would need DM typing state.
- The MessageInput component (c:\Harmony\client\src\components\MessageInput.tsx) sends
  TYPING_START events for guild channels. Look at how it does this.

YOUR TASK:
Wire up DM typing indicators on the client side.

1. MODIFY c:\Harmony\client\src\store\appStore.ts
   Add DM typing state:
     dmTypingUsers: Map<string, Set<string>>; // channelId -> set of typing accountIds
     setDmTypingUsers: (channelId: string, accountIds: Set<string>) => void;
     addDmTypingUser: (channelId: string, accountId: string) => void;
     removeDmTypingUser: (channelId: string, accountId: string) => void;
     clearDmTypingUsers: (channelId: string) => void;

2. MODIFY the WebSocket message handler (wherever incoming WS messages are routed to store
   actions — likely in the main App component or ConnectionManager setup):
   Handle these incoming events:
     DM_TYPING_START: call addDmTypingUser(data.channelId, data.accountId).
                      Set a timeout (8 seconds) to auto-remove if no TYPING_STOP received.
     DM_TYPING_STOP: call removeDmTypingUser(data.channelId, data.accountId).

3. MODIFY c:\Harmony\client\src\components\MessageInput.tsx
   When the active channel is a DM channel (you'll need a way to detect this — e.g., check
   if the active channel exists in dmChannels state), send DM_TYPING_START / DM_TYPING_STOP
   instead of the guild TYPING_START / TYPING_STOP events.

   The DM typing event format:
     { type: 'DM_TYPING_START', data: { channelId: activeChannelId } }
     { type: 'DM_TYPING_STOP', data: { channelId: activeChannelId } }

   Send these through the WebSocket connection to the DM's host server (not necessarily the
   main server). Use connectionManager.send(hostServerUrl, event).

   If determining the host server is complex at this point, it's acceptable to send through
   the primary WebSocket connection and have the server handle routing (the server already
   does participant lookup in Phase 3B).

4. MODIFY c:\Harmony\client\src\components\TypingIndicator.tsx (or create a DmTypingIndicator)
   When rendered in a DM context, read from dmTypingUsers instead of the guild typing state.
   Display the same "X is typing..." animation but using account IDs or display names from
   the DM participant list.

   If restructuring TypingIndicator to support both contexts is too invasive, create a small
   DmTypingIndicator component that mirrors its behavior.

TESTING:
Create c:\Harmony\client\src\components\__tests__\DmTypingIndicator.test.ts:
  - Test addDmTypingUser adds the user to the correct channel's typing set.
  - Test removeDmTypingUser removes the user.
  - Test clearDmTypingUsers clears all typing users for a channel.
  - Test the auto-timeout removes the user after 8 seconds (use vi.useFakeTimers).
  - Test the DmTypingIndicator component renders "X is typing..." when users are typing.
  - Test it renders nothing when no one is typing.

Use vitest with @testing-library/react for component tests.

CODE QUALITY:
- TypeScript strict mode. Explicit types on all state and props.
- Reuse existing patterns from the guild TypingIndicator as much as possible.
- Clean up timeouts in useEffect cleanup functions to prevent memory leaks.
- Keep the typing detection debounce logic consistent with guild behavior.
```

