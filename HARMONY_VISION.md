# Harmony — Platform Vision & Architecture

_Last updated: April 2026_

---

## Core Philosophy

> The network and the code are free and maintainable, forever.

Harmony is a communication platform built on one foundational constraint: **Harmony
the organization never becomes a dependency for Harmony the network to function.**
No central server. No hosted authentication. No update service you must phone home
to. No infrastructure bill that, if unpaid, takes everyone's guilds offline.

This is not a technical limitation. It is a deliberate design principle that
informs every architectural decision.

The model is the old internet: **Teamspeak, Mumble, IRC, email.** Power users and
communities spin up their own nodes. Big public nodes coexist with private home
nodes. The software is the platform. Hosting is the user's responsibility —
and Harmony's job is to make that as easy as possible for non-technical people.

**Security is a first-class design constraint, not an afterthought.** Harmony's
security model is built on one principle: **trust no one by default.** Not clients.
Not nodes. Not the local network. Not the federation partner. Every party in the
system is assumed to be a potential adversary until cryptographically proven otherwise.
Security through obscurity is explicitly rejected — the entire codebase is open
source, so every attacker has full knowledge of the protocol. Security must come
entirely from the strength of the math, not the secrecy of the implementation.

---

## Who Runs a Harmony Node?

There is no single user profile. The platform must serve all of these:

| Operator Type | Setup | Scale | Example |
|---|---|---|---|
| Home power user | Self-hosted on home PC/NAS | Family, friend group | LAN node, maybe exposed externally |
| Community host | VPS or dedicated server | Dozens to hundreds | Gaming clan, hobbyist community |
| Public node | Properly hosted, real domain | Thousands | Like a public Mumble or TeamSpeak server |
| Organization | Internal deployment | Corporate/institutional | Private, air-gapped if needed |

A single node can host **multiple guilds** — independent communities, each with its
own database, channels, roles, and membership. The operator manages the node;
guild owners manage their communities.

Harmony's tooling must make all four operator types viable. The setup wizard, the
cert management, the discovery system, and the network stack all have to work
across this entire range.

---

## Platform Architecture

### No Central Infrastructure — Ever

| Concern | Centralized (what we won't do) | Harmony approach |
|---|---|---|
| Node discovery | Registry Harmony hosts | mDNS on LAN, stored public URL for internet |
| User identity | Accounts on harmony.com | Ed25519 keypair on user's own node |
| Federation | Relay Harmony operates | Direct node-to-node over HTTPS |
| Cert management | Harmony manages it | ACME direct to Let's Encrypt, or user-provided |
| Software updates | Harmony update server | GitHub releases / self-hosted update feed |
| Voice routing | Harmony TURN relay | mediasoup on the user's own node |
| Guild hosting | Harmony hosts guilds | Each node operator hosts their own guilds |
| Guild data | Harmony stores your data | Portable ZIP exports, operator-controlled storage |

Every feature that could create a central dependency must be designed around that
dependency not existing.

### Client Platforms

**Current: Electron + React (Desktop)**  
The desktop client is an Electron app using React + TypeScript. Electron was chosen
deliberately: it gives the client native OS access (file system, mDNS via Node.js,
system tray, notifications) while keeping the UI in React — a language that ports
well to mobile.

The client is the interface through which users interact with guilds — browsing
channels, sending messages, managing roles — and occasionally with the node itself
for administrative tasks (guild management, provision codes, federation settings).

**Future: React Native (Mobile — Android & iOS)**  
The mobile client will be React Native. This is the natural extension of the Electron
choice. The business logic, state management, API layer, and most UI components will
be shared between the Electron and React Native clients via a common `core` package.

Platform-specific code will be limited to:
- Network discovery (Node.js mDNS → Android NSD API / iOS Bonjour)
- File system operations
- Push notifications
- OS-level audio/video device access

**There will be no web browser client.** A browser app requires Harmony to host a
domain and serve the application — a permanent central infrastructure dependency
that violates the core philosophy. The Electron and React Native apps are the
distribution mechanism.

### The Node

A Harmony **node** is a single Node.js process (`harmony-server.exe` / `harmony-server`).
Operators download it, run it, and it manages everything: the guild registry, account
database, file storage, TLS, WebSocket routing, voice (mediasoup), and federation.

The node has no "call home" behavior. It does not contact Harmony's infrastructure
for any operational purpose. Let's Encrypt (ACME) is an exception for cert issuance
— it is an independent non-profit infrastructure, not a Harmony dependency.

A node maintains two layers of data:
- **`node.db`** — Central database for accounts, federation state, guild registry,
  provision codes, and node-level settings. Shared across all guilds.
- **Per-guild databases** — Each guild has its own `guild.db` with channels, messages,
  roles, profiles, and attachments. Fully isolated from other guilds on the same node.

### Guilds — The Multi-Guild Architecture

A **guild** is a self-contained community hosted on a node. It has its own database,
file storage, channels, categories, roles, membership, and WebSocket subscription
scope. Multiple guilds coexist independently on a single node.

This is a deliberate architectural decision:
- **Reduced operational burden:** A community host running multiple game clans or
  topic communities doesn't need a separate node for each one.
- **Isolation guarantees:** Guilds cannot see each other's data. WebSocket messages
  are routed only to connections subscribed to the relevant guild. A compromised
  guild database does not expose data from other guilds on the same node.
- **Independent lifecycle:** Guilds can be created, stopped, started, exported,
  imported, and deleted independently without affecting other guilds.

The guild registry in `node.db` tracks:
- Guild ID, name, description, icon
- Owner account ID
- Ed25519 guild identity keypair (encrypted with owner's public key)
- Status: `active`, `stopped`, `suspended`
- Fingerprint for identity verification

**The relationship between nodes, guilds, and federation:**
A user federates their **identity** to a node. Once authenticated on a node, they
can join individual guilds hosted on that node. A user's guild memberships are
scoped to guilds, but their authentication is scoped to the node.

### Guild Portability & Data Sovereignty

**Your guild data is yours. You can take it anywhere.**

This is not just a feature — it is a design constraint derived from the core
philosophy. If a guild's data is trapped on a single node with no export path,
the node operator becomes a dependency. Harmony explicitly rejects this.

Guild portability is implemented via:
- **`--export-guild <id>`** — Produces a portable ZIP bundle containing the complete
  guild database, all file attachments, and a manifest with SHA-256 integrity
  checksums. The export is a point-in-time snapshot of the entire guild.
- **`--import-guild <path>`** — Imports a guild bundle onto a new node. The guild
  receives a new identity keypair, and members can reclaim their profiles through a
  guided matching flow.
- **Cross-node migration:** An operator can export a guild from one node, transfer
  the ZIP, and import it on a different node. The guild's messages, files, roles,
  and structure are fully preserved.

### Provision Codes & Guild Creation Access

Not everyone on a node should be able to create guilds. Provision codes are the
mechanism for node operators to authorize guild creation:

- Operators generate time-limited, member-capped provision codes via CLI or the
  Node Admin Panel.
- Users present a valid code when creating a guild. The code is consumed atomically.
- Alternatively, operators can toggle **open guild creation** to allow any
  authenticated user to create guilds freely.
- Codes can be listed, revoked, and audited. Each code tracks who used it and
  which guild it produced.

### Federation Promotion & Resilience

The Primary/Replica federation model (see Networking Model below) creates a
single point of failure: if the primary node goes permanently offline, the user's
authoritative identity is lost.

**Promotion** solves this:
- Any replica node can be promoted to primary status via the **Promotion Wizard**.
- The wizard re-authenticates the user, re-issues tokens signed by the new
  primary's Ed25519 identity key, and updates the trust chain.
- During promotion, the system attempts a best-effort sync of the user's global
  profile data from the old primary (when reachable).
- **Account deactivation propagation:** When a user removes a node from their
  trusted list, a signed deactivation notice is sent to that node, preventing it
  from accepting requests on the user's behalf.

This ensures that no single node failure can permanently lock a user out of their
identity across the federation.

### Operator Tooling

Harmony provides two operator interfaces:

**Server CLI** — A comprehensive command-line interface built into the node binary:
- Guild lifecycle: `--create-guild`, `--list-guilds`, `--stop-guild`, `--start-guild`,
  `--delete-guild` (with confirmation prompt and `--preserve-data` option)
- Guild portability: `--export-guild` and `--import-guild` (with optional
  `--provision-code` authorization)
- Node dashboard: `--guild-status` displays a formatted table with guild names,
  member counts, storage usage, and status indicators
- Provision codes: `--generate-provision-code`, `--list-provision-codes`,
  `--revoke-provision-code`, `--toggle-open-creation`
- Security: `--revoke-identity` for emergency Ed25519 key revocation

**Node Admin Panel** — A multi-section admin interface accessible to node operators
from within the client application:
- **Overview:** Node status dashboard with guild counts and provision code stats
- **Guild Management:** Create, stop, start, and delete guilds visually
- **Provision Codes:** Generate, list, and revoke codes with expiration controls
- **Node Settings:** Configure node-level policies

---

## Networking Model

### The Identity/Transport Separation

A node does not have one address. It has an **identity** (who it is, stable forever)
and one or more **transports** (how to reach it right now). These must be decoupled.

**Identity:** The node's Ed25519 public key fingerprint. Generated once at setup,
stored in `data/server_identity.key`. Never changes. Cryptographically verifiable.

**Transports:**
- Local: `http://192.168.1.100:3001` — fast, no cert needed, LAN only
- Public: `https://harmony.example.com` — CA-verified, works from anywhere

The client identifies nodes by fingerprint and tries transports in order of
preference.

### Local Network Discovery — mDNS

On boot, the node broadcasts a Multicast DNS (mDNS) service record:

```
Service: _harmony._tcp.local
TXT records:
    node_id     = <uuid>
    fingerprint = <ed25519 fingerprint, first 16 hex chars>
    public_url  = https://harmony.example.com  (if configured)
    name        = "My Harmony Node"
    version     = 0.5
```

Clients listen for `_harmony._tcp.local` on startup and populate a
"Discovered on your network" list automatically. No IP address entry required.

mDNS support by platform:
- **Electron** — Node.js `mdns-js` package, full UDP multicast access
- **Android** — NSD (Network Service Discovery) API, built into the Android SDK
- **iOS** — Bonjour, built into the OS at the system level

### Adaptive Transport — Seamless LAN/Internet Switching

The client maintains a transport registry per known node:

```ts
interface NodeTransport {
    fingerprint: string;    // stable identity — never changes
    localUrl:   string | null;  // 192.168.x.x — null if never seen locally
    publicUrl:  string | null;  // harmony.example.com — null if local-only
    preferLocal: boolean;   // true if last successful connection was local
    lastSeenLocal: number;  // unix timestamp
}
```

Connection logic:
```
At home:
    → ping localUrl (timeout 500ms) → success → connect, preferLocal = true

At work / on mobile:
    → ping localUrl → timeout
    → connect via publicUrl, preferLocal = false

Next time at home:
    → local ping succeeds → preferLocal flips back to true
```

The user never manually switches. The client detects context and routes accordingly.

### Zero Trust — The Adversarial Security Model

Harmony assumes every participant in the network is a potential adversary until
cryptographic proof says otherwise. This applies without exception to:

**Clients**
A Harmony client is open-source software. Any attacker can read the exact request
format, replicate it, modify it, or automate it. The node must never trust
client-reported data. Every claim a client makes — its identity, its permissions,
its account state — must be independently verified server-side on every request.
A client that reports being an admin, a guild owner, or a trusted federation
partner is making an unverified assertion. The node verifies via JWT signature,
database state, and cryptographic identity — never by taking the client's word.

**Nodes**
A federated Harmony node is operated by an unknown third party. The node software
is open-source, so a malicious actor can run a modified node that behaves however
they choose. A federation partner that claims to represent a user's account, or claims
to be relaying a sync from a trusted primary, must prove this cryptographically via
delegation certificates and Ed25519 signatures. An unverified node is an adversary.

**The Network**
Neither the local network nor the internet routing layer is trusted. Any network path
between client and node — LAN, ISP, CDN, DNS — is treated as potentially compromised.
This is why TLS is mandatory on every connection and why the Ed25519 fingerprint layer
exists independently of the TLS certificate: even a compromised CA or a hijacked DNS
record cannot impersonate a node to a client that has pinned its fingerprint.

**Kerckhoffs's Principle**
The security of Harmony must not depend on the secrecy of its implementation.
Because Harmony is fully open-source, every attacker knows the exact protocol,
the exact data formats, the exact endpoint names, and the exact validation logic.
Security must survive complete knowledge of the system. The only secrets in Harmony
are cryptographic keys held by users and nodes. Everything else is public. Any
security property that would break if an attacker read the source code is not a
security property — it is a bug.

### Application-Level Security Principles

Beyond transport and identity, every API endpoint and inter-process boundary must
be designed with the following non-negotiable rules:

**All inputs are untrusted until validated server-side.**
No client-reported value is used directly for any authorization or routing decision.
This includes: usernames, email addresses, file names, content lengths, MIME types,
account IDs, permission flags, and node claims. Every value is validated and
sanitized independently on the node against the database and the JWT. A client
that lies about any of these must produce an error, never a privilege escalation.

**Content size limits are enforced before any processing.**
Files, messages, usernames, channel names, and request bodies all have hard upper
bounds enforced at the API layer — before the data touches a database, a media
library, or a WebSocket broadcast. This prevents storage bombs, memory exhaustion
from malformed media parsing, and bandwidth amplification attacks.

**Authentication is verified on every request — never cached across requests.**
JWT tokens are verified cryptographically on every API call. The node never trusts
a session state that was validated in a previous request. Tokens must specify an
exact issuing node (audience claim) and must use the expected algorithm (EdDSA).
Tokens claiming any other algorithm are rejected before verification, preventing
JWT algorithm confusion attacks.

**File operations are path-safe.**
All file upload names are sanitized with `path.basename()` before use, and all
resulting paths are verified to remain within the designated upload directory. No
client-provided path component is ever used to construct a filesystem path directly.

**The node never makes outbound requests to client-provided URLs**
without first validating the target against a strict allowlist. Embed URL fetching,
webhook delivery, and any other feature that involves the node fetching a
URL must maintain an explicit blocklist of private IP ranges, loopback addresses,
and link-local addresses to prevent Server-Side Request Forgery (SSRF).

**Constant-time responses on authentication endpoints.**
Endpoints that look up accounts (`/salt`, `/login`, `/federate`) must return
identical responses in identical time whether or not the account exists. Timing
differences between a found and not-found account reveal account existence to
an attacker performing enumeration.

**Connection-level resource limits are enforced independently of HTTP rate limiting.**
HTTP rate limiting counts complete requests. It does not protect against:
- Slow HTTP (Slowloris) attacks that hold connections open indefinitely
- WebSocket connection flooding that exhausts the node's connection pool
- mediasoup voice session exhaustion via incomplete WebRTC handshakes
Each of these requires its own dedicated limit, separate from request-rate limiting.

### Security Model — Threat Posture

**Harmony treats the local network as an adversarial environment.**

The assumption that a LAN is a "safe" or "trusted" network is wrong and dangerous.
A home network at any given time may contain:
- Guest devices with unknown security posture
- IoT devices (smart TVs, cameras, thermostats) with compromised or unpatched firmware
- Any device infected with malware that can run a passive packet capture
- Neighbours if Wi-Fi credentials are weak or shared

Any device on the same network segment can run Wireshark and passively read all
plaintext HTTP traffic with zero skill required. This is not a theoretical threat.

**Therefore: plain HTTP is never used in Harmony, under any circumstances.**
This applies to LAN connections, to localhost in production mode, and to every
deployment tier. The only exception is the development mode flag (`--dev`) which
explicitly disables this for local testing workflows and must never be used with
real user data.

### The Confidentiality / Identity Separation

Harmony cleanly separates two distinct security concerns into two distinct systems:

| Concern | Mechanism | Scope |
|---|---|---|
| **Confidentiality** (nobody reads the wire) | TLS (self-signed or CA-signed) | Every connection, always |
| **Identity** (this is the node I trust) | Ed25519 fingerprint (TOFU) | Every connection, always |

These two systems are independent. The TLS certificate is never used to verify node
identity in Harmony's trust model. This is deliberate: the CA system was designed
for web-scale commercial services, not for individual homelab nodes. A CA cert
provides a useful first-contact identity hint for internet-facing nodes, but it
is not the authoritative identity mechanism. The Ed25519 fingerprint is.

Consequences of this separation:
- **TLS cert rotation** (e.g. Let's Encrypt renewing every 90 days) has zero impact
  on pinned fingerprints. The two systems are fully decoupled.
- **CA compromise** (e.g. a rogue cert issued for a Harmony node's domain) cannot
  impersonate a node to an existing client, because the fingerprint won't match.
- **Self-signed TLS on LAN** provides full wire confidentiality. An attacker can
  present their own self-signed cert — but they cannot forge the Ed25519 identity
  verification that follows, because they don't hold the node's private key.

### Trust Bootstrap — How Identity is Established

**Internet connections (CA-signed TLS):**
The CA certificate provides a first-contact identity signal for brand-new clients
that have no pinned fingerprint. After the first successful connection, the Ed25519
fingerprint is pinned. The CA cert becomes irrelevant to identity from that point
onward — it continues to provide wire encryption only.

**LAN connections (self-signed TLS):**
For Mode C nodes with no CA cert, the TLS layer provides wire encryption but no
CA-based identity signal. First-time connections on the LAN are bootstrapped via
SPAKE2+ PIN pairing. PAKE cryptography is specifically designed to be secure against
MITM attackers on an unauthenticated channel — meaning the SPAKE2+ handshake is
secure even over an unverified TLS connection. Once the handshake completes, the
real Ed25519 fingerprint is transmitted and pinned. Subsequent connections verify
silently against that fingerprint.

**All subsequent connections (any network):**
After the fingerprint is pinned, every connection — LAN or internet — performs Ed25519
identity verification immediately after the TLS handshake. If the fingerprint does
not match the pinned value, the connection is aborted and the user is alerted.
No silent reconnection. No override button. A fingerprint mismatch is always treated
as a potential attack.

**Combined security posture:**

| Scenario | Wire Encrypted | Identity Verified | How |
|---|---|---|---|
| First internet connection (new device) | ✅ CA TLS | ✅ CA hint + fingerprint pinned | Standard TLS |
| First LAN connection (new device) | ✅ Self-signed TLS | ✅ SPAKE2+ PIN pairing | PAKE handshake |
| All subsequent connections | ✅ TLS | ✅ Fingerprint match | Silent background check |
| DNS hijack / CA compromise (existing client) | ✅ TLS | ✅ Fingerprint mismatch → blocked | Fingerprint pinning |
| Passive LAN eavesdrop | ✅ TLS blocks this | N/A | Wire encryption |

**Four-tier connection model — TLS and identity requirements by context:**

| Context | TLS | Certificate | Identity | Notes |
|---|---|---|---|---|
| **localhost (dev mode only)** | ❌ HTTP | N/A | N/A | `--dev` flag only. Never with real user data. |
| **localhost (production)** | ✅ | Self-signed | Ed25519 TOFU | No CA needed. No PIN needed (physical access implied). |
| **Local network (LAN)** | ✅ | Self-signed | Ed25519 TOFU + SPAKE2+ PIN | PIN required on first connection from each new device. |
| **Internet** | ✅ | CA-signed (Let's Encrypt) | Ed25519 TOFU | CA provides first-contact hint; fingerprint is the real anchor. |

### mDNS Security and Spoofing Mitigation

mDNS (Multicast DNS) has no built-in authentication. Any device on a local network
can broadcast a fake `_harmony._tcp.local` record. A malicious device (e.g., a
Raspberry Pi on the same Wi-Fi) could advertise itself as a legitimate Harmony
node, appearing in the client's "Discovered on your network" list.

**Mitigation 1 — Fingerprint in mDNS TXT Record**

The mDNS advertisement includes the node's Ed25519 fingerprint (first 16 hex chars).
When the client receives a discovery advertisement, it checks the advertised fingerprint
against its pinned database:
- If the fingerprint matches a known node: the client can connect seamlessly.
- If the fingerprint is unknown (new node): the client initiates the PIN pairing flow.
- If a node the client knows broadcasts a *changed* fingerprint: the client raises
  a security alert, never silently reconnects.

A spoofed mDNS record will have a different fingerprint. The client will treat it
as an unknown node and require PIN pairing. Without the real node's private key,
an attacker cannot complete the SPAKE2+ handshake.

**Mitigation 2 — Discovery is Never Auto-Trust**

mDNS is strictly a *discovery hint*, never a grant of trust. Clients display discovered
nodes to the user, but always require explicit user action (and PIN pairing for new
nodes) before establishing any authenticated connection. Auto-connecting to an
mDNS-discovered node is explicitly prohibited in the client implementation.

### Key Rotation Protocol

The Ed25519 node identity key (`data/server_identity.key`) is designed to be
long-lived and stable. It is explicitly NOT the same as the TLS certificate. TLS
certs (Let's Encrypt) rotate automatically every 90 days with no impact on pinned
fingerprints — the two systems are completely decoupled.

The Ed25519 key should only ever be rotated in response to a genuine compromise
(e.g., hardware theft, node breach). When rotation is necessary:

- The old private key signs a **Key Rotation Announcement**: a structured payload
  containing the new public key and an effective timestamp, signed by the old key.
- Clients that have the old fingerprint pinned can verify this announcement is
  legitimate (only the real node could have signed it with the old private key)
  and update their pinned fingerprint to the new one.
- The announcement is served at a well-known endpoint: `GET /api/federation/key-rotation`
  and persisted in the node's data directory until manually cleared by the operator.
- Clients that connect after the rotation window and do not have the announcement
  cached will see a fingerprint mismatch warning and must re-verify out-of-band.
- **A legitimate node will never silently replace a pinned fingerprint.** Any
  automatic silent fingerprint replacement is a security bug, not a feature.

---

## Certificate Strategy

Three first-class deployment modes. All are supported. All have clear UX.

### Mode A — Automated (Let's Encrypt / ACME)

For users with a domain name who want zero ongoing cert management.

- User provides their domain during setup
- Harmony performs the ACME challenge directly — no third-party tool required
- Cert issued and written to disk automatically
- `auditJob.ts` checks expiry daily, renews automatically when < 30 days remain
- User never thinks about certs again

Prerequisites: a domain name, port 80 reachable from the internet.

### Mode B — User-Provided Certificate

For users with Cloudflare, a hosting provider, a corporate CA, or their own PKI.

- User provides `cert.pem` and `key.pem` via file upload or file path
- Node validates: not expired, cert and key match, shows cert details
- Node logs expiry date at every boot as a reminder
- No auto-renewal — operator is responsible

### Mode C — Local Network / Self-Signed Certificate

For home LAN nodes with no internet exposure and no domain name.

- No domain required
- Node generates a self-signed TLS certificate on first boot
- **TLS is still used** — plain HTTP is never permitted, even on LAN
- Clients bypass CA chain validation for this node but verify identity via
  Ed25519 fingerprint pinning instead (see Security Model above)
- First-time connections require SPAKE2+ PIN pairing to establish the fingerprint
- mDNS discovery only — not reachable from outside the LAN by default
- Clearly labelled in the client UI: **"Local Node"**
- Full functionality within the LAN: voice, file sharing, federation with other
  local nodes

This is a legitimate, first-class deployment mode — not a degraded fallback.
The absence of a CA cert does not mean the absence of security.

---

## First-Run Setup Wizard

On first boot (no database detected), the node serves a browser-based setup
wizard at `http://localhost:3001/setup`. All other routes return 503 until setup
is complete. The wizard is never accessible again after setup.

### Step 1 — Welcome
Brief explanation of what setup involves. Estimated time: ~5 minutes.

### Step 2 — Reachability Check

The server attempts to verify that its port is reachable from the internet, using
a one-time echo token and an external probe.

| Result | Action |
|---|---|
| ✅ Port reachable | Proceed |
| ❌ Port blocked | Plain-language explanation + router guide |
| ⚠️ Inconclusive | Warning persists, user can continue |

**Blocked port explanation (no jargon):**
> Your server isn't reachable from the internet yet. This usually means your
> home router is blocking incoming connections. Here's how to fix it:
> 1. Log into your router admin page (usually http://192.168.1.1)
> 2. Find "Port Forwarding" (sometimes "Virtual Servers" or "NAT")
> 3. Forward port 443 to this computer's local IP: 192.168.x.x
> 4. Save and hit "Check Again"
>
> On a VPS? Check your firewall or security group rules.

DNS propagation delay is explicitly called out: if the user just updated their
DNS A record, the wizard explains propagation and provides a "Check Again in 1 min"
flow.

### Step 3 — Certificate

Three cards, equal prominence. Default: **Mode A**.

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  ⚡ Automatic         │  │  📄 I have a cert     │  │  🏠 Local only        │
│  (recommended)       │  │                       │  │                      │
│                      │  │  Upload or enter the  │  │  No domain needed.   │
│  Enter your domain.  │  │  path to your cert    │  │  Discoverable on     │
│  We handle the rest. │  │  and key files.       │  │  your network only.  │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

Each path has inline validation and plain-language error messages.
No documentation links required for the happy path.

### Step 4 — Create Owner Account

First account on the server. Automatically granted Creator + Admin.  
Standard fields: display name, email, password with strength indicator.

### Step 5 — Launch

Summary of all configured items with status indicators.  
On click: writes config, initializes database, restarts server in production mode.

---

## Development Roadmap

### Current — Alpha (v0.5)

**Status: Core architecture stabilized. Guild system, federation, and RBAC operational.**

The alpha has expanded well beyond its original scope. In addition to the federated
login → profile claim → chat workflow, v0.5 now includes the multi-guild architecture,
guild-scoped RBAC, operator CLI tooling, and a comprehensive context menu engine.

#### Completed

- ✅ Core messaging, voice, file sharing
- ✅ Node federation (Ed25519 PKI, delegation certificates)
- ✅ Adaptive token verification (local + cross-node)
- ✅ Scoped TLS agent for dev (no global NODE_TLS_REJECT_UNAUTHORIZED)
- ✅ Self-signed cert generation (local dev only)
- ✅ Primary/Replica identity model with delegation certificates
- ✅ Federated login with cached credential fallback to replica
- ✅ Join vs. Trust node separation in client UI (communication vs. identity sync)
- ✅ Rate-limited login with IP suspension (screaming webhooks)
- ✅ Atomic federation invite consumption (`harmony://invite` protocol links)
- ✅ Profile deduplication with composite key (`id:node_id`)
- ✅ Client-side message signing (Ed25519) and server-side verification
- ✅ E2EE for direct messages
- ✅ Daily integrity audit snapshots (`auditJob.ts`)
- ✅ Multi-guild node architecture (`node.db` registry + per-guild `guild.db`)
- ✅ Guild lifecycle CLI (`--create-guild`, `--list-guilds`, `--stop-guild`, `--start-guild`, `--delete-guild`)
- ✅ Guild export/import as portable ZIP bundles with SHA-256 integrity checksums
- ✅ Guild-scoped RBAC with 12-bit permission bitfield and layered middleware
- ✅ Provision code system for guild creation authorization
- ✅ Node Admin Panel UI (overview, guild management, provision codes, node settings)
- ✅ Federation promotion (replica → primary) with Promotion Wizard UI
- ✅ Profile sync during promotion (best-effort fetch from old primary)
- ✅ Account deactivation propagation across federation
- ✅ Polymorphic context menu engine (user, message, channel, category)
- ✅ User Profile Popups with viewport-aware positioning
- ✅ Member Sidebar with role-grouped, collapsible sections
- ✅ Custom Markdown rendering pipeline (bold, italic, code, blockquotes, spoilers, mentions)
- ✅ Message editing with inline edit mode and real-time broadcast
- ✅ Message reactions with real-time sync across all clients
- ✅ Typing indicators (guild-scoped)
- ✅ Shift+Enter multiline message input
- ✅ Message guardrails (content sanitization, blocked extensions, magic-byte MIME validation)
- ✅ Per-user rate limiting with role-based tiers
- ✅ Route decomposition (`app.ts` → 10+ dedicated route modules)
- ✅ Guild-scoped WebSocket routing (prevents cross-guild data leakage)
- ✅ Global + guild-scoped dual-layer profile system
- ✅ 140+ unit tests across client and server (vitest)

#### Known Alpha Workarounds (to be removed before Beta)

- ~~⚠️  All accounts elevated to `is_admin = 1` on DB init~~ → ✅ **Resolved.** `is_admin` column removed; replaced by guild-scoped RBAC.
- ~~⚠️  All profiles elevated to `ADMIN` role on server DB init~~ → ✅ **Resolved.** RBAC now uses 12-bit permission bitfield with proper role assignment.
- ⚠️  `/api/accounts/sync` accepts unauthenticated requests (no node-to-node auth)
- ⚠️  `account_servers` stores URLs only — no fingerprint pinning column
- ⚠️  `authority_role` defaults to `'primary'` — multi-primary state is possible but
     undefined. See note below.
- ⚠️  Node runs plain HTTP in dev mode; localhost production connections also currently
     use HTTP — self-signed TLS must be enforced for production localhost before Beta

#### Not Yet Started (by design — stabilizing basics first)

- ⚠️  Setup is CLI-only; cert handling is manual
- ⚠️  No mDNS discovery
- ⚠️  No adaptive transport (LAN vs internet switching)
- ⚠️  No node fingerprint verification in client login or join flows

> **Note on multi-primary:** If a user signs up independently on two nodes without
> federating between them, both accounts will be `authority_role = 'primary'`. This is
> a known ambiguous state. The intended model is that a user has exactly one primary
> and explicitly syncs replicas via delegation. The alpha does not enforce this
> constraint. Beta should either enforce single-primary or formally adopt multi-primary
> with conflict resolution.

### Near Term — Alpha v0.6

**Focus: Operator CLI and tooling polish.**

- [ ] Interactive CLI mode (`--interactive` / `--shell`): persistent REPL for bulk
      guild operations without re-parsing args each time
- [ ] Real-time log streaming (`--logs [--guild <id>]`): structured server log
      output filtered by guild or severity
- [ ] Account management CLI: `--list-accounts`, `--deactivate-account <email>`,
      `--reset-password <email>`
- [ ] Multi-use provision codes (`--max-uses <n>`)
- [ ] Provision code usage analytics (full audit trail of code → guild mapping)

### Near Term — Alpha v0.7

**Focus: Admin visibility and monitoring.**

- [ ] Audit Log Viewer in Node Admin Panel (daily integrity snapshots, login
      attempts, federation events, permission changes)
- [ ] Real-time admin notifications via dedicated WebSocket channel (registrations,
      failed login spikes, guild capacity warnings)
- [ ] Automated backup scheduling (`--backup-schedule`) with retention policies

### Near Term — Alpha v0.8

**Focus: Federation management and pre-Beta hardening.**

- [ ] Federation Management section in Node Admin Panel (view federated nodes,
      trust levels, last-seen timestamps, manual trust revocation)
- [ ] Scaling optimizations for large guild databases
- [ ] Pre-Beta security audit pass

### Near Term — Beta

#### Federation Hardening

- [ ] Node-to-node authentication on `/api/accounts/sync` (require delegation
      cert or node-signed JWT — match the pattern already used by `/replica-sync`)
- [ ] `FEDERATION_REJECT_UNAUTHORIZED=true` enforced in production mode
- ~~[ ] Remove universal admin elevation workaround from `database.ts`~~ → ✅ **Done in v0.5** (RBAC replaced `is_admin`)
- [ ] Enforce single-primary constraint OR formally design multi-primary resolution
- [ ] **JWT audience enforcement**: JWTs must encode the intended node fingerprint
      as the `aud` claim. Nodes must reject any token whose `aud` does not match
      their own fingerprint, preventing JWT replay across federation partners.
- [ ] **JWT algorithm pinning**: Node JWT verification must explicitly reject any
      token that does not use EdDSA, regardless of the algorithm field in the token
      header. Accept-all-algorithms behavior enables algorithm confusion attacks.

#### Application & Input Security

The following items close specific attack surfaces identified via adversarial review.
All are pre-conditions for exposing Harmony to real users on a real network.

- ✅ ~~**Message and content size limits**~~ — **Done in v0.5.** `MAX_MESSAGE_LENGTH`
      enforced in `messageGuardrails.ts`.
- [ ] **File upload path traversal fix**: Strip all path components from
      `file.originalname` using `path.basename()` before constructing the upload
      filename. Verify the final resolved path is within the configured upload
      directory using `path.resolve()` comparison.
- ✅ ~~**File upload size and count limits**~~ — **Done in v0.5.** `MAX_UPLOAD_SIZE_BYTES`
      enforced in `messageGuardrails.ts`.
- [ ] **Constant-time auth responses**: Auth endpoints (`/salt`, `/login`,
      `/federate`) must respond in constant time regardless of whether the account
      exists. Use a dummy scrypt computation for unknown accounts to prevent
      timing-based email enumeration.
- [ ] **Slow HTTP (Slowloris) protection**: Set a connection-level request timeout
      on the Node.js HTTP server (`server.requestTimeout`, `server.headersTimeout`)
      to drop connections that do not complete a request within a fixed window.
- [ ] **WebSocket connection limits**: Enforce a per-IP maximum concurrent WebSocket
      connection count, independent of HTTP rate limiting. Track open connections
      in a Map and reject new connections from IPs that exceed the threshold.
- [ ] **mediasoup voice session timeouts**: Voice transport and producer objects that
      are not fully established within a configurable window (default: 30s) must be
      automatically closed and their resources reclaimed. Enforce a per-user
      concurrent voice session limit to prevent resource exhaustion.
- ✅ ~~**Authenticated user send rate limiting**~~ — **Done in v0.5.** `MessageRateLimiter`
      with role-based tiers in `messageGuardrails.ts`.

#### Rate Limiting

- [ ] **Global connection rate limiting**: Apply `express-rate-limit` middleware to
      all public-facing endpoints. Prevents resource exhaustion from floods of
      requests (even non-malicious ones from misconfigured clients).
- [ ] **Per-endpoint tighter limits**: Authentication endpoints (`/login`, `/signup`,
      `/federate`) and federation endpoints (`/sync`, `/replica-sync`) must have
      stricter per-IP limits than general API routes.
- [ ] **PIN brute-force lockout**: The SPAKE2+ PIN pairing endpoint must enforce
      a lockout after a configurable number of failed attempts (default: 5). After
      lockout, the node must require the owner to generate a new PIN. Per-IP
      lockout alone is insufficient on a LAN — also apply a global attempt counter
      per active PIN to handle distributed multi-device attacks.
- [ ] **Rate limiting response headers**: Include `Retry-After` headers on 429
      responses so well-behaved clients back off gracefully.

#### Discovery & Transport

- [ ] mDNS advertisement in `server.ts` (Node.js, `mdns-js`) — **must include
      fingerprint and node_id in TXT record**
- [ ] Client: mDNS listener + "Discovered on your network" UI
      — discovered nodes must never auto-connect; always require user action
      — fingerprint from TXT record checked against pinned database on display
- [ ] Client: `NodeTransport` registry with adaptive LAN/internet switching

#### Certificate Management

- [ ] `--dev` flag: forces HTTP, disables TLS warnings, enables verbose logging.
      **This is the only context where plain HTTP is permitted.**
- [ ] Enforce self-signed TLS for localhost in production mode — currently localhost
      runs HTTP regardless of `NODE_ENV`. Production mode must generate and use a
      self-signed cert for localhost connections, identical to LAN Mode C behavior.
- [ ] `mkcert` detection in `certs.ts`: log clearly whether cert is self-signed,
      mkcert-generated, or CA-issued
- [ ] ACME integration in `certs.ts` (`acme-client` npm package)
- [ ] Cert renewal in `auditJob.ts`

#### Setup Experience

- [ ] First-run setup wizard (browser-based, `src/routes/setup.ts`)
- [ ] Port reachability check in setup wizard

### V1 — Production Ready

- [ ] Full setup wizard: all three cert paths, reachability check, owner account creation
- [ ] TOFU fingerprint pinning stored in `account_servers` table
      (add `fingerprint TEXT` column, pin on first contact, verify on reconnect)
- [ ] `federationFetch` verifies peer fingerprint on every request
- [ ] Client: node fingerprint shown during join flow, SSH-style TOFU prompt
- [ ] **SPAKE2+ PIN pairing system** for first-time LAN connections:
      — Node-side: PIN generation endpoint (owner-only, authenticated), PAKE
        handshake endpoint, configurable expiry (max 24h), brute-force lockout
      — Client-side: detect local connection with no pinned fingerprint, prompt
        for PIN, execute SPAKE2+ handshake, pin resulting fingerprint on success
      — Node Admin Panel: "Generate Local Pairing PIN" button with expiry selector
- [ ] **Key rotation protocol**: `GET /api/federation/key-rotation` endpoint,
      signed rotation announcement generation CLI (`--rotate-identity-key`),
      client-side rotation announcement verification and fingerprint update flow
- [ ] **Node-specific credential isolation**: The `nodeAuthKey` sent by the client
      during login must be derived from both the user's password AND the target
      node's fingerprint, so a credential captured by one node cannot be replayed
      against a different node. This requires a coordinated change to the client
      key derivation function and all node auth verification logic.
- [ ] **SSRF protection for embed/preview URL fetching**: Before the node fetches
      any client-provided URL (for link previews, webhooks, or any future feature),
      resolve the URL's IP and reject requests targeting RFC-1918 private ranges
      (`10.x`, `172.16-31.x`, `192.168.x`), loopback (`127.x`), and link-local
      (`169.254.x`) addresses.
- [ ] **Electron client security hardening**: Audit all Electron BrowserWindow
      configurations to ensure `nodeIntegration: false` and `contextIsolation: true`
      in all renderer processes. Remote content must never have access to Node.js
      APIs. Validate against the official Electron security checklist.
- [ ] **Federation metadata acknowledgment**: Document explicitly in the Node Admin
      Panel that joining a federation node exposes user metadata (presence,
      timing, communication partners) to that node's operator. Users must be
      informed before trusting a new node.
- [ ] Cert expiry warnings in Node Admin Panel (visible to operators only)
- [ ] `--reconfigure-cert` CLI flag to re-run cert setup without full reset
- ✅ ~~Audit log UI for node operators~~ — Partially done (Node Admin Panel exists; audit log viewer planned for v0.7)
- ✅ ~~Role and permission UI polished for non-technical admins~~ — **Done in v0.5.** Full role CRUD, color, position ordering, interactive context menu checklist.
- [ ] GitHub Releases-based update notification (no Harmony update node)

### Mobile Era — Post V1

- [ ] Extract shared `core` package from Electron client (store, API layer, hooks)
- [ ] React Native client targeting Android and iOS
- [ ] Platform bridges: Android NSD, iOS Bonjour (maps to same mDNS interface)
- [ ] Mobile-specific UI patterns (navigation, touch targets, notifications)
- [ ] Push notification support (local node push, no Harmony relay)
- [ ] Sync mDNS discovery state between Electron and React Native via shared core
- [ ] **OS keychain integration for private key storage**: Replace IndexedDB private
      key storage with iOS Keychain, Android Keystore, and Windows DPAPI on
      respective platforms. IndexedDB is accessible to any process running as the
      same OS user; OS keychains are not.

---

## What Harmony Will Never Do

These are explicit non-goals, not future work:

- **Host a web browser client** — requires Harmony to own a domain and run a server
  permanently. Violates the zero-infrastructure-cost principle.
- **Run a central user registry** — user identity lives on the user's node.
- **Operate a TURN/media relay** — voice routes through the operator's node, not ours.
- **Require internet connectivity to function** — LAN-only deployments must work fully
  offline, forever, with no dependency on any external service.
- **Become the gatekeeper for node discovery** — there is no "official" Harmony
  node list. Communities find each other the way they always have: word of mouth,
  links, community boards.

---

## The Long View

The model this is building toward is the email model: a protocol, not a platform.
Anyone can run a node. Nodes federate with each other. No company controls the
network. The software is open, forkable, and runs without the original authors
being alive or solvent.

Teamspeak and Mumble proved this works for voice.
Email proved it works at internet scale.
Matrix is proving it works for modern chat.

Harmony's contribution is making it work for people who aren't power users —
with a setup experience good enough that your non-technical friend can actually
run it, and a client polished enough that they'd choose it over Discord even if
they didn't care about the philosophy.
