# Harmony

Harmony is a privately hosted, federated chat messaging platform — an open-source, self-hosted alternative to Discord where **you** own your data, your community, and your infrastructure.

**Note: This project is currently in active alpha development. Latest Release: v0.5 Alpha (April 2026)**

> ⚠️ **Internet-facing deployments are intentionally disabled in this release.** The CORS policy and TLS configuration are locked to `localhost` origins only. This is deliberate — we've performed massive architectural overhauls since v0.4 and need to stabilize locally before re-enabling public access. LAN and localhost usage works fully.

---

## 🚀 What's New in v0.5 Alpha

This is the largest update in Harmony's history. Nearly every subsystem has been rewritten or significantly overhauled. Here's what changed:

### 🔐 Backend Security Overhaul

The entire backend security model has been rebuilt from scratch around a **zero-trust, guild-scoped permission system**.

- **Ed25519 Server Identity (PKI):** Every Harmony server now generates a persistent Ed25519 keypair on first boot, serving as its cryptographic identity for federation. Keys are stored locally and never leave the server. A one-time revocation code is generated and displayed on first run for emergency key rotation.
- **EdDSA JWT Authentication:** All tokens are now signed with Ed25519 (EdDSA algorithm) instead of HMAC. Cross-server token verification works by fetching the issuer's public key from `/api/federation/key`, with a stale-while-revalidate cache to avoid redundant fetches.
- **Guild-Scoped RBAC (Role-Based Access Control):** The old flat `isCreator`/`isAdmin` permission model is gone. A new layered middleware stack enforces access at every API endpoint:
  - `requireAuth` — JWT signature verification (local or cross-server)
  - `requireGuildAccess` — active guild membership required (no admin bypass)
  - `requireGuildPermission(perm)` — bitfield permission check against assigned roles
  - `requireGuildRole(roles)` — guild-level role gating
  - `requireGuildOwner` — owner-only operations
  - `requireNodeOperator` — infrastructure-level access (server CLI, node admin)
- **12-Bit Permission Bitfield:** Granular permissions including `ADMINISTRATOR`, `MANAGE_SERVER`, `MANAGE_ROLES`, `MANAGE_CHANNELS`, `KICK_MEMBERS`, `BAN_MEMBERS`, `MANAGE_MESSAGES`, `SEND_MESSAGES`, `ATTACH_FILES`, `MENTION_EVERYONE`, `VIEW_CHANNEL`, and `READ_MESSAGE_HISTORY`.
- **Message Guardrails:** Server-side content sanitization (null-byte stripping, script tag neutralization), blocked dangerous file extensions (.exe, .bat, .dll, .jar, etc.), magic-byte MIME validation on all uploads, and per-user rate limiting with role-based tiers.
- **Delegation Certificates:** Cryptographically signed certificates that allow a primary server to vouch for a user's identity when they join a replica. Certificates are time-limited and verified using Ed25519 signatures.
- **Security Webhook Alerts:** Suspicious activity (brute-force login attempts, IP suspensions) can be dispatched to external webhook endpoints for monitoring.

### 🌐 Server Federation

Harmony servers can now federate with each other, allowing a single user identity to span multiple independently-hosted nodes.

- **Primary / Replica Identity Model:** Each user account has a single "primary" server (where they signed up) and zero or more "replica" servers. The primary holds the authoritative credential record; replicas cache it with delegation certificates.
- **Federated Login:** When a user logs into a replica server, the replica first attempts to authenticate against the primary. If the primary is unreachable, it falls back to its local cached credentials — ensuring the user isn't locked out by a temporary outage.
- **Cross-Node Account Sync:** Account data (credentials, profile info, trusted servers) is synchronized across federated nodes. The sync respects `updated_at` timestamps to avoid overwriting newer data with stale records.
- **Federation Promotion:** If a user's primary server goes permanently offline, any replica can be promoted to primary status via the Promotion Wizard — re-authenticating the user and re-issuing tokens signed by the new primary's identity key. Profile data is synced from the old primary during promotion when reachable.
- **Trust Levels:** Each server in a user's network has an explicit trust level (`trusted` / `untrusted`), controlling whether identity data is synchronized to that node.
- **Account Deactivation:** Removing a server from your trusted list sends a signed deactivation notice, preventing the removed server from accepting requests on your behalf.
- **SSRF-Safe Federation Fetch:** All server-to-server HTTP requests go through `federationFetch`, which uses a scoped TLS agent (no global `NODE_TLS_REJECT_UNAUTHORIZED` override) for proper certificate handling in development.

### 🏛️ Guild System (In Progress)

The old "server" concept has been renamed to "guilds" across the entire codebase — database schema, API routes, client state, and UI. This is a foundational change that enables multi-guild architecture on a single Harmony node.

- **Multi-Guild Node Architecture:** A single Harmony server can now host multiple independent guilds, each with its own SQLite database, file storage, roles, channels, and membership. The `node.db` acts as the central registry; each guild has its own `guild.db`.
- **Guild Lifecycle CLI:** Full command-line management for guild operations:
  - `--create-guild`, `--list-guilds`, `--stop-guild`, `--start-guild`, `--delete-guild`
  - `--export-guild` (portable ZIP bundles) and `--import-guild`
  - `--guild-status` (node dashboard)
- **Provision Codes:** Node operators can generate time-limited, member-capped invitation codes for guild creation, or toggle open guild creation for all users.
- **Guild Setup Wizard:** Multi-step UI for creating guilds (name, icon, channels, owner assignment) with real-time validation.
- **Guild Export / Import:** Portable ZIP bundles containing the full guild database, file attachments, and metadata. Supports cross-node migration.
- **Ownership & Orphan Recovery:** Guilds track their owner via `owner_account_id`. Imported guilds owned by `system_import` are auto-transferred to the node operator on first privileged access.
- **Role Management:** Full CRUD for custom roles with color, position ordering, and bitfield permissions. Includes `@everyone` default role handling and Discord permission integer sanitization for imported data.
- **Guild-Scoped WebSocket Routing:** Real-time messages are now routed only to WebSocket connections subscribed to the relevant guild, preventing cross-guild data leakage. Subscription is verified against active membership.

### 👤 Profiles & Identity

- **Global + Guild Profiles:** Dual-layer identity system — users have a global profile (display name, avatar, about me) and can override it per-guild. The UI always resolves the most specific profile available.
- **Guild Profile Claiming:** When a guild is imported from Discord, users can claim their old Discord identity through a guided profile-matching flow.
- **Profile Avatars:** Upload-based avatar system with magic-byte validation (PNG, JPEG, GIF, WebP only), stored server-side with unique filenames.
- **User Panel & Settings:** Comprehensive user settings UI including profile editing, password changes, server management, and account security.

### 📋 Context Menus & UI Polish

The entire context menu system has been rebuilt from scratch as a polymorphic, permission-aware engine.

- **Unified Context Menu Engine:** A centralized `menuBuilders` system that generates context-appropriate menus for users, messages, channels, and categories. Menus are built dynamically based on the viewer's permissions, roles, and relationship to the target.
- **User Context Menu:** Copy ID, view profile, assign/remove roles (interactive checklist with role colors), kick, ban — all permission-gated.
- **Message Context Menu:** Reply, edit (own messages only), delete (permission-gated), copy text, copy ID, pin — with a Quick React Bar for fast emoji reactions.
- **Channel/Category Context Menu:** Edit, delete, create channel — with permission checks.
- **User Profile Popup:** Click any username to see their profile card with avatar, display name, roles, and about section. Viewport-aware positioning that never clips off-screen.
- **Member Sidebar:** Grouped, collapsible member list organized by role with online/offline status and role-colored names. Right-click for the full user context menu.
- **Viewport-Aware Positioning:** All context menus and submenus dynamically adjust their position to stay fully visible within the window bounds.

### 💬 Core Messaging

Significant improvements to day-to-day chat functionality:

- **Markdown Rendering Pipeline:** Full custom Markdown engine supporting bold, italic, strikethrough, code blocks, inline code, blockquotes, spoilers, and links. Custom components for user mentions, role mentions, custom emoji, and internal navigation links.
- **Shift+Enter Newlines:** Multiline message input with Shift+Enter for line breaks and Enter to send, matching Discord's behavior.
- **Message Editing:** Inline edit mode triggered from context menu or hover actions, with full API round-trip and real-time broadcast.
- **Message Reactions:** Add/remove emoji reactions with real-time sync across all connected clients.
- **Typing Indicators:** Guild-scoped typing notifications that only appear to members of the same guild.
- **Invite Links:** `harmony://invite` protocol links with scoped invite codes, expiration, and max-use limits.

### 🧪 Testing Infrastructure

The test suite has been completely rebuilt alongside the architecture:

- **100+ Server Unit Tests** covering federation, RBAC, guild lifecycle, profiles, messages, categories, channels, invites, DMs, PKI, signatures, webhooks, rate limiting, and more.
- **40+ Client Unit Tests** covering the context menu engine, identity resolution, role management, guild sidebar, member sidebar, profile popups, federation promotion, and store logic.
- **E2E Test Framework** with Playwright for auth flows, messaging, and server management.
- **System-Level Integration Tests** for federation lifecycle, membership transitions, and cross-node sync.

### 🏗️ Architecture & Infrastructure

- **Route Decomposition:** The monolithic `app.ts` has been split into dedicated route modules: `guilds.ts`, `messages.ts`, `channels.ts`, `categories.ts`, `profiles.ts`, `invites.ts`, `dms.ts`, `provision.ts`, `servers.ts`, and `health.ts`.
- **Cryptographic Module:** Dedicated `crypto/` directory housing `pki.ts` (server identity), `jwt.ts` (EdDSA token management), `signatures.ts` (message signing), `revocation.ts` (identity revocation), and `guild_identity.ts` (guild-level crypto).
- **CLI Module:** Server management commands extracted into `cli/guild.ts`, `cli/provision.ts`, and `cli/revoke-identity.ts`.
- **Audit Job:** Daily integrity audit snapshots via `auditJob.ts`, tracking database consistency and configuration state.
- **SLA Tracker:** Client-side service level monitoring for connection quality and server responsiveness.
- **Dual-Mount Routing:** API routes accept both legacy `/api/servers/:serverId/...` and new `/api/guilds/:guildId/...` paths for backward compatibility during migration.

---

## Architecture

Harmony operates on a **decentralized, federated, self-hosted** model. Instead of relying on a central company's servers, anyone can host their own Harmony node to control their community completely.

```
┌─────────────────────────────────────────────────────────────┐
│                     Harmony Node                            │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Guild A   │  │ Guild B   │  │ Guild C   │  ← Independent │
│  │ (SQLite)  │  │ (SQLite)  │  │ (SQLite)  │    databases   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                             │
│  ┌──────────────────────────────────────────┐               │
│  │            node.db (Central)             │               │
│  │  Accounts, Federation, Guild Registry    │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
│  ┌──────┐  ┌───────────┐  ┌──────┐  ┌─────┐               │
│  │ REST │  │ WebSocket │  │ PKI  │  │ SFU │               │
│  │ API  │  │ (Scoped)  │  │Ed25519│  │Voice│               │
│  └──────┘  └───────────┘  └──────┘  └─────┘               │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │  HTTPS / WSS                 │  Federation (HTTPS)
         ▼                              ▼
    ┌──────────┐                  ┌──────────┐
    │  Client  │                  │  Other   │
    │(Electron)│                  │  Nodes   │
    └──────────┘                  └──────────┘
```

* **Harmony Server (Node):** The backend. Handles authentication, message routing, guild management, file storage (local SQLite databases), federation, and voice routing via mediasoup. Exposes a REST API and scoped WebSocket server.
* **Harmony Client:** The frontend application (Electron + React + TypeScript). Connects to any reachable Harmony node. Supports multiple server connections with per-server token management.

---

## How to Use Harmony

### 1. Hosting a Server

The server is distributed as a standalone executable (e.g., `harmony-server.exe`).

```bash
# Start the server (defaults to http://localhost:3001)
./harmony-server.exe

# Start with mock data for development
./harmony-server.exe --mock

# Start on a custom port
./harmony-server.exe --port 4000

# Create a guild from the CLI
./harmony-server.exe --create-guild "My Community" --owner admin@harmony.local

# View all guilds and node status
./harmony-server.exe --guild-status

# See all available commands
./harmony-server.exe --help
```

### 2. Connecting with a Client

The client is a standalone desktop application (Windows, macOS, Linux via Electron).

1. Download and run the latest client release.
2. On the login/signup screen, enter the server address.
   - *Local testing:* `http://localhost:3001`
3. Create an account and you're in!

### 3. Federation (Multi-Server)

To federate your identity across multiple Harmony nodes:

1. Sign up on your **primary** server (this is your identity home).
2. In **User Settings → Servers**, add additional server URLs to your trusted server list.
3. Your credentials are securely synced to each trusted server via delegation certificates.
4. You can now log in to any of your federated servers — if your primary goes down, replicas serve cached credentials until it recovers.

---

## Security Model

Harmony's security is built on the principle of **trust no one by default**:

- **Ed25519 identity keypairs** for every server — cryptographic proof of identity, not just DNS
- **EdDSA-signed JWTs** for all authentication — no shared secrets
- **Guild-scoped RBAC** on every API endpoint — no implicit admin bypass
- **Magic-byte file validation** — MIME types verified by content, not extension
- **Rate limiting** with role-based tiers and IP suspension
- **Content sanitization** — null-byte stripping, script tag neutralization
- **Scoped TLS** — no global certificate override; each federation connection uses its own TLS agent

> 📖 For the complete security architecture, threat model, and development roadmap, see [HARMONY_VISION.md](HARMONY_VISION.md).

---

## Development

```bash
# Server
cd server
npm install
npm run dev          # Start dev server on :3001

# Client
cd client
npm install
npm run dev          # Start Vite dev server on :5173

# Tests
cd server && npx vitest run    # Server unit tests
cd client && npx vitest run    # Client unit tests
```

---

## Roadmap

| Phase | Status | Focus |
|-------|--------|-------|
| **v0.4 Alpha** | ✅ Complete | ServerSaver integration, E2EE, Discord imports, profile system |
| **v0.5 Alpha** | 🔄 Current | Federation, guild architecture, security overhaul, context menus |
| **Beta** | 🔜 Next | Internet-facing deployment, Let's Encrypt, setup wizard, mDNS discovery |
| **V1** | 📋 Planned | TOFU fingerprint pinning, SPAKE2+ pairing, mobile client, full polish |

---

## License

This project is open source. See the repository for license details.
