# Harmony

Harmony is a privately hosted chat messaging service, intended as a competitor for Discord. 

**Note: This project is currently in early alpha development. Latest Release: v0.4 Alpha (April 2026)**

## 🚀 Recent Changes (v0.4 Alpha)

This massive update revolves around data independence and server migration! Bring your community's history with you into your own private haven safely and smoothly.

### 📦 ServerSaver Integration & Discord Imports
- **Discord Migration:** Fully interoperable with [ServerSaver](https://github.com/god-of-ghz/ServerSaver). You can natively import your entire server content (channels, messages, attachments, embeds, reactions).
- **Import Identity Claiming:** New users joining a Harmony Server with imported Discord data are guided through a sleek Global Profile claiming process. Seamlessly connect your newly created local account to your past Discord history!
- **Server File Storage:** We fully support ServerSaver's local asset caching. Discord profile pictures, chat attachments, and video clips show up natively within Harmony rather than hotlinking.

### ✨ Advanced Identity Systems
- **Global & Guild Profiles:** You're no longer limited to a single name! We implemented a flexible identity model allowing distinct display names and avatars on a per-guild basis, while maintaining a reliable unified global profile fallback.

### 🔒 Security & Privacy (E2EE)
- **End-to-End Encryption:** Your messages stay exclusively yours. Harmony now features full client-side E2EE message payload encryption using ECDH (Elliptic-curve Diffie–Hellman) for key exchange and AES-GCM for secure data wrapping.
- **Auto-Provisioned HTTPS & WSS:** The Harmony backend now securely runs on HTTPS by default using PKIjs! It automatically generates self-signed certificates (`cert.pem` and `key.pem`) on boot, ensuring all API requests and WebSockets are routed securely over TLS without any manual networking setup.

### ⚡ UI/UX Polish & Client Reliability
- **Client State Persistence:** You won't get lost anymore! The Harmony app now saves your active navigation path — automatically dropping you into your last-visited guild and channel upon login or refresh.
- **Smooth Lazy-Loading:** Virtualized list rendering for older messages when scrolling upward is completely fixed. No more jerky movements or sudden snapbacks when catching up on history!
- **Multimedia Improvements:** Vertical smartphone videos are now automatically oriented and scaled appropriately instead of being stretched or rotated sideways.
- **Importer Auto-Select:** Users seamlessly logging into a fresh setup bypass manual discovery for their imported guilds—putting you right into the action instantly.

*(Previous release v0.3 features such as Virtualization handling 10k messages, emoji autocompletes, and integrated screen-sharing are fully present and polished in v0.4!)*

## Architecture

Harmony operates on a decentralized, self-hosted client-server model. This means that instead of relying on a central company's servers, anyone can host their own "Harmony Server" to control their community completely.

* **Harmony Server**: The backend. It handles user authentication, message routing, data storage (using a local SQLite database), and file uploads. It exposes a REST API and a WebSocket server for real-time communication.
* **Harmony Client**: The frontend application (built with Electron and React). Users use the client app to connect to any reachable Harmony Server.

## How to use Harmony

### 1. Hosting a Server
The server is distributed as a standalone executable (e.g., `harmony-server.exe`).

- Download the latest server release.
- Run the executable on a machine you want to act as the host.
- By default, the server runs on `http://localhost:3001`.

**Connecting over the Internet:**
To allow friends to connect to your server over the internet, you have two main options:
1. **Port Forwarding:** Configure your router to forward port `3001` to the internal IP address of the machine running the server. You would then give your friends your public IP address.
2. **Tunnels/Proxies:** Use a service like ngrok, localtunnel, or Cloudflare Tunnels to securely expose your local server to the internet without changing router settings. They will provide a URL (like `https://my-harmony-server.ngrok.io`) that you give to your friends.

### 2. Connecting with a Client
The client is a standalone Windows application.

- Download and install/extract the latest client release.
- Open the application.
- On the login/signup screen, click the **Settings** gear icon (usually top right).
- In the "Server URL" field, enter the address of the server you wish to connect to.
  - *Local testing:* `http://localhost:3001`
  - *Remote server (Port Forwarded):* `http://<your-public-ip>:3001`
  - *Remote server (Tunnel):* `https://<your-tunnel-url>`
- Click Save. You can now create an account on that server and join the chat!
