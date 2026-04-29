# Harmony

Harmony is a privately hosted, federated chat messaging platform — an open-source, self-hosted alternative to Discord where **you** own your data, your community, and your infrastructure.

**Note: This project is currently in active alpha development. Latest Release: v0.5 Alpha (April 2026)**

> ⚠️ **Internet-facing deployments are intentionally disabled in this release.** The CORS policy and TLS configuration are locked to `localhost` origins only. This is deliberate — we've performed massive architectural overhauls since v0.4 and need to stabilize locally before re-enabling public access. LAN and localhost usage are fully functional. If you would like to try an internet-facing deployment, the older v0.4-alpha release is functional but insecure. Use at your own risk. 

---

## 🚀 What's New in v0.5 Alpha

This is the largest update in Harmony's history, featuring a complete architectural overhaul of almost every subsystem. Here are the key highlights:

- **🔐 Backend Security Overhaul:** Rebuilt from scratch using a zero-trust, guild-scoped permission model. Introduces Ed25519 (PKI) server identity, EdDSA JWT authentication, layered middleware RBAC, and granular permission bitfields.
- **🌐 Server Federation:** Users can now federate identities across independently-hosted Harmony nodes. Supports primary/replica identity models, federated logins with offline caching, cross-node account syncing, and seamless promotion of replica nodes.
- **🏛️ Guild System:** The core architecture now supports hosting multiple independent "guilds" (servers) per node, each with its own SQLite DB. Includes full CLI and UI lifecycles for creating, exporting, migrating, and managing guilds.
- **👤 Profiles & Identity:** Introduces dual-layer global and per-guild profiles, upload-based avatars with magic-byte validation, and tools to claim legacy Discord profiles after imports.
- **📋 Context Menus & UI Polish:** A polymorphic, permission-aware engine powers dynamic right-click menus across users, messages, and channels. Features a new Member Sidebar, viewport-aware dropdowns, a unified Emoji Picker, and a modern Profile Popup.
- **💬 Core Messaging:** Enhanced with a custom Markdown engine (supporting blockquotes and mention highlighting), multiline input (Shift+Enter), inline message editing, real-time emoji reactions with updated styling, and guild-scoped typing indicators.
- **🛠️ CLI & Node Administration:** A comprehensive headless CLI and a new in-app Node Admin Panel for operators to manage guilds, generate invite codes, and monitor instance health.
- **🧪 Testing Infrastructure:** Completely rebuilt with over 140+ unit tests across client and server, Playwright E2E suites, and system-level integration tests.
- **🏗️ Architecture Refactor:** The backend monolith has been split into modular, testable routes with dedicated cryptographic and CLI subsystems to improve maintainability.

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
| **v0.6 Alpha** | 🔜 Next | Interactive CLI mode, real-time log streaming, account management CLI |
| **v0.7 Alpha** | 📋 Planned | Automated backup scheduling, Audit Log Viewer, real-time admin notifications |
| **v0.8 Alpha** | 📋 Planned | Federation management UI, scaling optimizations, pre-beta hardening |
| **Beta** | 📋 Planned | Internet-facing deployment, Let's Encrypt, setup wizard, mDNS discovery (Fully functional, ironing out corner cases) |
| **V1** | 📋 Planned | TOFU fingerprint pinning, SPAKE2+ pairing, full polish |
| **Future** | 🔮 Exploring | Mobile client |

---

## License

This project is open source. See the repository for license details.
