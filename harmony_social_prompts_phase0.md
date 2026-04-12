# Harmony Social — Agent Prompts: Phase 0 (Infrastructure Prerequisites)

Each prompt below is a **self-contained task** for an independent agent. The agent will NOT have access to any prior conversation. Each prompt contains all context needed.

---

## Phase 0A: Server-to-Server JWT Authentication

```
You are working on "Harmony," an open-source distributed chat platform similar to Discord. The
codebase is a TypeScript monorepo at c:\Harmony with:
  - Server: c:\Harmony\server\src\ (Node.js + Express + SQLite via sqlite3)
  - Client: c:\Harmony\client\src\ (React + TypeScript + Zustand)

BACKGROUND:
Harmony is a distributed system where multiple independent Harmony servers cooperate to provide
social features (friends, DMs, blocking) for users. Each user has a list of "trusted servers"
(1-3 servers run by people they know). These trusted servers need to communicate with each other
to synchronize user data (friend lists, DM metadata, block lists, etc.).

Currently, the server has NO authentication mechanism for server-to-server API calls. Existing
inter-server endpoints like POST /api/accounts/sync and POST /api/accounts/federate in
c:\Harmony\server\src\app.ts accept requests from anyone with no verification. This is a critical
security gap — any machine on the internet could inject fake data.

YOUR TASK:
Implement a server-to-server JWT authentication system so that Harmony servers can mutually
authenticate when making API calls to each other.

MECHANISM:
1. Each Harmony server generates a persistent Ed25519 keypair on first boot and stores it.
2. When servers "meet" (via a user adding a new trusted server), they exchange public keys via a
   handshake process.
3. All subsequent server-to-server requests include a short-lived JWT in an X-Server-JWT header,
   signed by the sending server's private key.
4. The receiving server verifies the JWT against the stored public key of the sender.

FILES TO CREATE:

1. c:\Harmony\server\src\server_identity.ts
   - On first boot, generate an Ed25519 keypair using Node.js crypto module.
   - Persist the keypair to DATA_DIR/server_identity.json (import DATA_DIR from ./database).
   - On subsequent boots, load the existing keypair from disk.
   - Exports:
     - getServerPublicKey(): string — returns the base64-encoded public key
     - getServerUrl(): string — returns this server's own URL (from env or config)
     - signServerJWT(targetServerUrl: string): string — creates a short-lived JWT (60s expiry)
       signed with this server's private key, with claims: { iss: thisServerUrl, aud: targetServerUrl, iat, exp }
     - verifyServerJWT(token: string, senderPublicKey: string): { iss: string, aud: string } — verifies
       and decodes a JWT against the given public key. Throws on invalid/expired tokens.
   - Use the 'jsonwebtoken' package (already installed) with algorithm 'EdDSA' for Ed25519.
     If EdDSA is not supported by the installed jsonwebtoken version, fall back to using
     Node.js crypto.sign/crypto.verify directly with a custom JWT implementation (header.payload.signature).

2. c:\Harmony\server\src\middleware\server_auth.ts
   - Export a requireServerAuth Express middleware function.
   - It extracts the X-Server-JWT header from the request.
   - It extracts the issuer (iss) claim from the JWT (decode without verifying first to get iss).
   - It looks up the issuer's public key from the known_servers table in nodeDb
     (use dbManager imported from ../database).
   - It verifies the full JWT using verifyServerJWT from ../server_identity.
   - It also checks that the aud claim matches THIS server's URL.
   - On success: sets req.senderServerUrl = iss and calls next().
   - On failure: returns 401 with { error: "Unauthorized: Invalid server identity" }.
   - Extend the Express Request type to include senderServerUrl?: string.

FILES TO MODIFY:

3. c:\Harmony\server\src\database.ts
   - In the initNodeDb() method (inside the serialize block), add a new table:
     CREATE TABLE IF NOT EXISTS known_servers (
       server_url TEXT PRIMARY KEY,
       public_key TEXT NOT NULL,
       label TEXT DEFAULT '',
       first_seen INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
     );
   - Do NOT modify any existing tables or code. Only ADD the new CREATE TABLE statement.

4. c:\Harmony\server\src\app.ts
   - Add these NEW endpoints (do not modify existing endpoints):

   GET /api/server/identity (unauthenticated — this is public info)
     - Returns { server_url: string, public_key: string } for this server.

   POST /api/server/handshake (unauthenticated — bootstrapping trust)
     - Body: { server_url: string, public_key: string }
     - Stores the sender's URL and public key in the known_servers table (INSERT OR REPLACE).
     - Returns this server's { server_url, public_key } so both sides learn each other's identity.

   - Modify the existing POST /api/accounts/:accountId/trusted_servers endpoint:
     After the existing logic that stores the trusted server URL and pushes an identity sync,
     ADD a try/catch block that:
       1. Fetches GET <serverUrl>/api/server/identity to get the remote server's public key.
       2. Stores it in known_servers (INSERT OR IGNORE).
       3. Calls POST <serverUrl>/api/server/handshake with THIS server's identity.
     This ensures that whenever a user adds a new trusted server, the two servers automatically
     exchange keys.

   - Import getServerPublicKey, getServerUrl from './server_identity' at the top of the file.

5. c:\Harmony\server\src\server.ts
   - At the very beginning of the startServer() function (after startMediasoup), add a call to
     initialize the server identity: import and call an init function from server_identity
     (e.g., ensureIdentityExists() or similar) to ensure the keypair is generated/loaded before
     the server starts accepting requests.

TESTING:
Create c:\Harmony\server\src\__tests__\server_identity.test.ts with unit tests:
  - Test keypair generation produces valid Ed25519 keys.
  - Test signServerJWT creates a valid JWT that verifyServerJWT can decode.
  - Test verifyServerJWT rejects expired tokens.
  - Test verifyServerJWT rejects tokens signed by a different key.
  - Test the requireServerAuth middleware rejects requests without X-Server-JWT header.
  - Test the requireServerAuth middleware rejects requests with invalid JWTs.
  - Test the requireServerAuth middleware accepts requests with valid JWTs.

Use vitest (already configured in the project). Mock the database calls in middleware tests.

CODE QUALITY:
- Use TypeScript strict mode conventions. All functions must have explicit return types.
- Add JSDoc comments to all exported functions explaining purpose, parameters, and return values.
- Use meaningful variable names. No single-letter variables except loop counters.
- Handle all error cases explicitly (file I/O errors, crypto errors, missing fields).
- Keep functions small and focused (< 30 lines each).
- No console.log in library code — use console.error only for actual errors.
```

---

## Phase 0B: WebSocket Targeted Delivery

```
You are working on "Harmony," an open-source distributed chat platform similar to Discord. The
codebase is at c:\Harmony with:
  - Server: c:\Harmony\server\src\ (Node.js + Express + WebSocket via 'ws' package)

BACKGROUND:
Harmony is adding a "Harmony Social" feature for direct messaging (DMs) between users. Currently,
the WebSocket implementation in server.ts uses a BROADCAST model — every message sent via
broadcastMessage() goes to ALL connected WebSocket clients:

  // In server.ts (current code):
  const clients = new Set<WebSocket>();
  const broadcastMessage = (data: any) => {
      const payload = JSON.stringify(data);
      clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
              client.send(payload);
          }
      });
  };

This is fine for guild/server channels where all connected users see the same messages, but it's
a CATASTROPHIC PRIVACY VIOLATION for DMs — User C would receive User A's private DM to User B
if they're all connected to the same server.

The websocket.ts file already maintains a socketAccountMap (Map<WebSocket, string>) that maps
each WebSocket to its authenticated accountId. We need to leverage this to enable targeted delivery.

YOUR TASK:
Create a ClientManager class that replaces the raw Set<WebSocket> and broadcastMessage function,
providing both broadcast (for guilds) and targeted delivery (for DMs).

FILES TO CREATE:

1. c:\Harmony\server\src\client_manager.ts
   - Export a ClientManager class with:

     Private state:
       - allClients: Set<WebSocket>
       - accountSockets: Map<string, Set<WebSocket>> — maps accountId to their open sockets

     Public methods:
       - addClient(ws: WebSocket): void
         Adds the WebSocket to allClients.

       - removeClient(ws: WebSocket): void
         Removes from allClients and from any accountSockets entry.

       - registerAccount(ws: WebSocket, accountId: string): void
         Associates a WebSocket with an accountId in the accountSockets map.
         A single accountId may have multiple sockets (multiple browser tabs).

       - unregisterAccount(ws: WebSocket): void
         Removes the WebSocket from its accountId's socket set.
         If the set becomes empty, delete the accountId entry entirely.

       - broadcastMessage(data: any): void
         Sends to ALL clients in allClients (existing behavior, unchanged).
         Serializes data to JSON once, then iterates.

       - sendToAccounts(accountIds: string[], data: any): void
         Sends to ONLY the WebSocket connections belonging to the listed accountIds.
         Serializes data to JSON once, then iterates over each accountId's socket set.
         Silently skips accountIds that have no active connections.

       - sendToAccount(accountId: string, data: any): void
         Convenience wrapper: sendToAccounts([accountId], data).

       - getConnectedAccountIds(): string[]
         Returns all accountIds that have at least one active socket.

       - isAccountConnected(accountId: string): boolean
         Returns true if the accountId has at least one open socket.

       - getClientCount(): number
         Returns allClients.size.

FILES TO MODIFY:

2. c:\Harmony\server\src\server.ts
   - Import ClientManager from './client_manager'.
   - Replace `const clients = new Set<WebSocket>();` with `const clientManager = new ClientManager();`.
   - Replace the broadcastMessage function with a reference to clientManager.broadcastMessage.
     Create a const: `const broadcastMessage = (data: any) => clientManager.broadcastMessage(data);`
     This preserves the existing API so all current code continues to work.
   - In the wss.on('connection') handler:
     - Replace clients.add(ws) with clientManager.addClient(ws).
     - Replace clients.delete(ws) with clientManager.removeClient(ws).
   - Pass the clientManager instance to setupConnectionTracking (in addition to or instead of
     broadcastMessage). See websocket.ts changes below.
   - Pass clientManager (or broadcastMessage + sendToAccounts) to createApp so the app layer
     can use targeted delivery for future DM endpoints.

3. c:\Harmony\server\src\websocket.ts
   - Modify setupConnectionTracking to accept a ClientManager instance (or at minimum, two
     callbacks: broadcastMessage and a registerAccount function).
   - On PRESENCE_IDENTIFY (after JWT verification succeeds and accountId is extracted):
     - Call clientManager.registerAccount(ws, accountId) instead of just socketAccountMap.set().
     - You may keep socketAccountMap for backwards compat, or remove it and use clientManager instead.
   - On ws 'close' event:
     - Call clientManager.unregisterAccount(ws).
   - The existing broadcastMessage calls for PRESENCE_UPDATE, TYPING_START, TYPING_STOP should
     continue to use broadcastMessage (they are guild-scoped events that all clients should see).

4. c:\Harmony\server\src\app.ts
   - Update the createApp function signature to accept the clientManager or sendToAccounts function
     in addition to broadcastMessage. For now, you can pass both:
       createApp(db, broadcastMessage, sendToAccounts)
     or pass the whole clientManager:
       createApp(db, clientManager)
     Choose whichever is cleaner. Update the function parameter types accordingly.
   - Do NOT change any existing endpoint behavior. All existing broadcastMessage calls stay as-is.
     The sendToAccounts capability will be used by future DM endpoints (not in this task).

TESTING:
Create c:\Harmony\server\src\__tests__\client_manager.test.ts with unit tests:
  - Create mock WebSocket objects (just need readyState and send method).
  - Test addClient/removeClient updates the client count correctly.
  - Test registerAccount/unregisterAccount associates and disassociates correctly.
  - Test broadcastMessage sends to all added clients.
  - Test broadcastMessage skips clients with readyState !== WebSocket.OPEN.
  - Test sendToAccounts sends only to the specified accounts' sockets.
  - Test sendToAccounts with multiple sockets per account sends to all of them.
  - Test sendToAccounts silently skips unknown accountIds (no error).
  - Test removeClient also unregisters the account association.
  - Test isAccountConnected returns correct values.

Use vitest (already configured). Create mock WebSocket objects for testing:
  const createMockWs = (open = true) => ({
    readyState: open ? 1 : 3, // WebSocket.OPEN = 1, WebSocket.CLOSED = 3
    send: vi.fn(),
  });

CODE QUALITY:
- Use TypeScript strict mode. All methods must have explicit return types.
- Add JSDoc comments to all public methods.
- The class should be stateless aside from its internal maps/sets — no side effects in constructor.
- Use meaningful variable names. Keep methods small and focused.
- Ensure thread safety isn't an issue (Node.js is single-threaded, but be careful with async).
- The broadcastMessage and sendToAccounts methods must serialize the payload ONCE, not per-client.
```

---

## Phase 0C: Client Auth Header Migration

```
You are working on "Harmony," an open-source distributed chat platform. The client is a React +
TypeScript app at c:\Harmony\client\src\.

BACKGROUND:
Harmony recently implemented JWT-based authentication on the server. The server middleware
(requireAuth in server/src/middleware/rbac.ts) expects an Authorization: Bearer <token> header
on all authenticated API calls. The JWT token is stored in the client's Zustand store as
currentAccount.token (see c:\Harmony\client\src\store\appStore.ts, the Account interface has
a token?: string field).

PROBLEM:
Several client components still use the OLD, insecure authentication pattern of sending the raw
account ID in an X-Account-Id header:
  headers: { 'X-Account-Id': currentAccount.id }

This bypasses JWT verification and allows trivial impersonation. All such usages must be migrated
to use the JWT Bearer token instead.

YOUR TASK:
Find and replace ALL instances of the X-Account-Id header pattern in the client codebase with
the proper JWT Authorization header.

SEARCH SCOPE:
Search the entire c:\Harmony\client\src\ directory for any occurrence of 'X-Account-Id'.

REPLACEMENT PATTERN:
  BEFORE: headers: { 'X-Account-Id': currentAccount.id }
  AFTER:  headers: { 'Authorization': `Bearer ${currentAccount.token}` }

  BEFORE: headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id }
  AFTER:  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount.token}` }

Some files may use variations — adapt accordingly, but the pattern is always the same: replace
the X-Account-Id header with an Authorization Bearer header using the token from the account.

KNOWN FILES THAT NEED CHANGES (search for more):
  - c:\Harmony\client\src\components\FriendsList.tsx — lines ~16-18, ~50-52, ~67-69, ~81-83
  - c:\Harmony\client\src\components\DMSidebar.tsx — line ~18

IMPORTANT NOTES:
  - The currentAccount object is always accessed from the Zustand store via useAppStore().
  - The token field may theoretically be undefined. Where fetch calls are already guarded by
    if (!currentAccount) return; that's sufficient. If no such guard exists, add one.
  - Do NOT change any server-side code. This task is client-only.
  - Do NOT change the API endpoints or request bodies. Only change the headers.
  - After making changes, verify there are ZERO remaining occurrences of 'X-Account-Id' in the
    entire c:\Harmony\client\src\ directory by running a grep/search.

TESTING:
This is a straightforward find-and-replace task. Verification is:
1. Run: grep -r "X-Account-Id" c:\Harmony\client\src\ — should return zero results.
2. Run: npx tsc --noEmit in c:\Harmony\client\ to verify TypeScript compilation succeeds.
3. Ensure the client builds without errors: npm run build in c:\Harmony\client\.

CODE QUALITY:
- Maintain consistent formatting with the surrounding code.
- Do not introduce any new dependencies or abstractions — this is a mechanical replacement.
- Preserve all existing comments and code structure.
```

---

## Phase 0D: Multi-Server Connection Manager (Client)

```
You are working on "Harmony," an open-source distributed chat platform. The client is a React +
TypeScript app at c:\Harmony\client\src\ using Zustand for state management.

BACKGROUND:
Harmony is a distributed platform where users connect to multiple independent servers. Each user
has a list of "trusted servers" (typically 1-3) that manage their identity, plus they join various
guild servers for chat. Currently, the Harmony client maintains only ONE WebSocket connection at
a time, established in the main App component. This is fundamentally insufficient because:

1. Users need real-time events from ALL guilds they're members of (across multiple servers).
2. The new "Harmony Social" feature requires DM messages to flow from a DM's "host server,"
   which may be different from the user's primary server.
3. Friend requests, relationship updates, and presence data come from trusted servers.

The client needs a ConnectionManager service that maintains simultaneous WebSocket connections
to multiple Harmony servers.

CURRENT STATE:
- The WebSocket connection is currently established inline in the main App component (likely in
  c:\Harmony\client\src\App.tsx). Look for `new WebSocket(...)` or `ws://` or `wss://` usage.
- The Zustand store at c:\Harmony\client\src\store\appStore.ts has:
  - knownServers: string[] — server URLs the client knows about
  - trustedServers: string[] — the user's trusted server URLs
  - currentAccount: Account | null — includes a token?: string for JWT auth
  - presenceMap, relationships, unreadChannels, etc. — state that receives WS updates

YOUR TASK:
Create a ConnectionManager service class and integrate it with the existing app.

FILES TO CREATE:

1. c:\Harmony\client\src\services\ConnectionManager.ts

   Export a ConnectionManager class (singleton pattern) with:

   Types:
     interface ServerConnection {
       url: string;
       ws: WebSocket | null;
       state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
       reconnectAttempts: number;
       reconnectTimer: ReturnType<typeof setTimeout> | null;
       token: string;
     }

   Private state:
     - connections: Map<string, ServerConnection>
     - messageHandler: ((serverUrl: string, data: any) => void) | null
     - maxReconnectAttempts: number = 10
     - baseReconnectDelay: number = 1000 (ms)

   Public methods:
     - setMessageHandler(handler: (serverUrl: string, data: any) => void): void
       Sets the callback that will be invoked for ALL incoming WebSocket messages from
       any server. The handler receives the server URL and the parsed JSON data.

     - connect(serverUrl: string, token: string): void
       Creates a new WebSocket connection to serverUrl. The WebSocket URL is derived from
       the HTTP URL by replacing http:// with ws:// and https:// with wss://.
       On open:
         - Update state to 'connected', reset reconnectAttempts to 0.
         - Send a PRESENCE_IDENTIFY message: { type: 'PRESENCE_IDENTIFY', data: { token } }.
       On message:
         - Parse JSON, call messageHandler(serverUrl, parsed).
       On close:
         - Update state to 'disconnected'.
         - If reconnectAttempts < maxReconnectAttempts, schedule reconnect with exponential
           backoff: delay = baseReconnectDelay * 2^reconnectAttempts (capped at 30 seconds).
       On error:
         - Log to console.error with the server URL for debugging.
       If a connection to this URL already exists and is connected/connecting, do nothing.

     - disconnect(serverUrl: string): void
       Close the WebSocket for this URL. Clear any reconnect timer. Remove from the map.

     - disconnectAll(): void
       Disconnect all connections. Clear the map.

     - getConnectionState(serverUrl: string): 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
       Returns the state, or 'disconnected' if not in the map.

     - isConnected(serverUrl: string): boolean

     - getConnectedServers(): string[]
       Returns URLs of all connected servers.

     - send(serverUrl: string, data: any): void
       Sends a JSON message to a specific server's WebSocket.
       Throws or silently fails if not connected (your choice — document it).

   Export a singleton instance:
     export const connectionManager = new ConnectionManager();

2. c:\Harmony\client\src\services\__tests__\ConnectionManager.test.ts
   - Unit tests using vitest.
   - Mock the global WebSocket class.
   - Test connect creates a WebSocket with the correct URL (http->ws, https->wss conversion).
   - Test PRESENCE_IDENTIFY is sent on open.
   - Test incoming messages are routed to the messageHandler with the correct serverUrl.
   - Test disconnect closes the WebSocket and removes from map.
   - Test disconnectAll clears everything.
   - Test reconnect logic: on close, a reconnect is scheduled with backoff.
   - Test duplicate connect calls are idempotent.
   - Test getConnectionState returns correct states.

FILES TO MODIFY:

3. c:\Harmony\client\src\store\appStore.ts
   - Add new state fields to the AppState interface and the store:
     connectedServerUrls: string[];
     setConnectedServerUrls: (urls: string[]) => void;
   - This is a MINIMAL change. The full store refactor for multi-server state tracking will
     happen in Phase 4A. For now, just add the field so the ConnectionManager integration
     has somewhere to report connection status.

4. DO NOT modify App.tsx in this task. The integration of ConnectionManager into the App
   component's lifecycle (connecting on login, disconnecting on logout, routing messages to
   store actions) will be done in Phase 4A when the store is refactored. This task creates
   the ConnectionManager as a standalone, tested utility.

DESIGN NOTES:
- The ConnectionManager should NOT import from appStore or any React code. It is a plain
  TypeScript class with no React dependencies. Communication with the store happens via the
  messageHandler callback, which the App component will wire up later.
- The class must be safe to instantiate and test without a browser environment (mock WebSocket).
- Use the URL API to convert http://... to ws://... reliably.

CODE QUALITY:
- Full TypeScript strict mode. Explicit types on all methods and properties.
- JSDoc on all public methods.
- Clean separation of concerns: the class manages connections, nothing else.
- Exponential backoff formula must be clear and well-commented.
- No magic numbers — use named constants.
- All timers must be properly cleaned up in disconnect/disconnectAll to prevent memory leaks.
- The class must not hold references to closed WebSockets.
```

