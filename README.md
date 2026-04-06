# Harmony

Harmony is a privately hosted chat messaging service, intended as a competitor for Discord. 

**Note: This project is currently in early alpha development. Latest Release: v0.3 Alpha (April 2026)**

## 🚀 Recent Changes (v0.3 Alpha)

This release brings massive performance improvements, UI polishing, and expanded functionality!

### ⚡ Performance & Scalability
- **Zero-Lag Chat History**: Implemented full virtualization using `react-virtuoso`. The chat now handles 10,000+ messages with zero performance impact.
- **Optimized State Management**: Decoupled message list rendering from high-frequency typing updates, ensuring the app stays responsive even in the busiest channels.
- **Database Scaling**: Optimized the Discord server importer for massive JSON files with intelligent transaction batching.

### ✨ Premium UI Experience
- **Discord-like Replies**: Added a beautiful reply system with avatars, message previews, and smooth curved connector lines.
- **Inline Emoji Autocomplete**: Type `:EMOJI_NAME:` to see suggestions and press Tab to autocomplete instantly!
- **Smooth Animations**: Refined typing indicators and scroll-snapping for a more fluid feel.

### 🎥 Media & Communication
- **Restored Screen Sharing**: Fixed WGC permission issues in Electron and WebRTC signaling race conditions for a much more stable streaming experience.
- **Improved Video UI**: Re-engineered the video overlay and control bar to prevent layout shifts.

### 🛠️ Functionality & Admin
- **Smart Server Ownership**: The first user to register on any new Harmony server is automatically elevated to "Creator" and "Admin" status.
- **Developer Workflow**: Added `dev_login.bat` to launch two isolated Harmony clients for instant multi-user testing.
- **Reliable User Profiles**: Fixed synchronization bugs where users would sometimes appear as "Unknown" to others.

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

