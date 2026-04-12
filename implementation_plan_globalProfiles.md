# Account Overhaul & Guild Profiles (Detailed Execution Plan)

This plan outlines the overhaul of the account and profile systems in Harmony to correctly separate and associate Global Discord profiles and Per-Guild profiles. 

## Feedback Addressed
- **Avatar Storage Strategy:** Global avatars will be saved to a global `DATA_DIR/avatars` directory. Per-guild avatars will be saved to `DATA_DIR/servers/[serverId]/avatars`. If an imported member doesn't have a per-guild avatar, the importer will copy their global avatar as the default.
- **"Start Fresh" Override:** If a user clicks "Start Fresh" on the Global Claim prompt, the prompt won't appear again automatically for them (saving a flag to `accounts`). However, Server Owners will be given the ability to manually override/link unassociated Discord Profiles to users from the Server Settings UI.

---

## Execution Phases

### Phase 1: Database Schema Foundations
**Goal:** Prepare the Node DB and Server DBs with the necessary tables and fields to hold global Discord profiles and claim states.

1. **Node Database Updates (`database.ts`)**
   - Create table `imported_discord_users` with fields: `id` (TEXT PK), `global_name` (TEXT), `avatar` (TEXT), `account_id` (TEXT, Nullable, FL to `accounts(id)`).
   - Alter `accounts` table: Add `dismissed_global_claim` (BOOLEAN DEFAULT 0) to track if "Start Fresh" was chosen.
2. **Phase 1 Unit Tests:**
   - Write tests in `database.test.ts` to verify the creation and insertion into `imported_discord_users`.
   - Test that `account_id` properly sets to NULL on account deletion if `ON DELETE SET NULL` is applied.

---

### Phase 2: The Importer & Media Downloader
**Goal:** Modify the V2 exporter pipeline to capture global names, guild nicknames, and download the new array of avatars.

1. **Directory Preparation logic (`importer.ts`)**
   - Add utility functions in `importer.ts` (or `media/downloader.ts`) to download HTTP URLs for avatars (Discord CDN).
   - Ensure paths `DATA_DIR/avatars` and `DATA_DIR/servers/[serverId]/avatars` are created safely.
2. **Metadata Parsing Logic (`importer.ts`)**
   - Read `global_name`, `avatar_url`, `nickname`, and `server_avatar_url` from `guild_metadata.members`.
   - **Node Level Entry:** Insert `id`, `global_name || name`, and local path of parsed `avatar_url` into `imported_discord_users`. Add fallback if `avatar_url` is missing.
   - **Guild Level Entry:** Insert `id`, `nickname || global_name || name`, and local path to `server_avatar_url`.
   - **Copy Avatar Default Rule:** If `server_avatar_url` is absent, copy the downloaded global avatar file to the guild's local avatar directory and set the path in `profiles`.
3. **Phase 2 Unit Tests:**
   - Update `importer.test.ts` to mock a `guild_metadata.json` containing the new avatar/nickname keys.
   - Assert `imported_discord_users` holds the correct count of total unique users across imports.

---

### Phase 3: Backend API Route Expansion
**Goal:** Expose the data for the frontend to build the UI flows, ensuring proper permissions.

1. **Global Claiming Endpoints (`app.ts`)**
   - `GET /api/accounts/unclaimed-imports`: Return `imported_discord_users` where `account_id IS NULL`. Hide this if `req.account.dismissed_global_claim` is true.
   - `POST /api/accounts/dismiss-claim`: Updates the user's `dismissed_global_claim` to true.
   - `POST /api/accounts/link-discord`: 
       - Validates ownership.
       - Sets `account_id` in `imported_discord_users`.
       - Updates the current mapping in `global_profiles`.
       - Scans `getAllLoadedServers()`, querying for `id = discord_id` in `profiles`. Sets `account_id` to current user for each match.
2. **Guild Specific Profile Endpoints (`app.ts`)**
   - `PATCH /api/servers/:serverId/profiles/:profileId`: Apply `nickname` and `avatar` modifications (using Multer for the avatar file).
3. **Server Owner Override Endpoint (`app.ts`)**
   - `POST /api/servers/:serverId/profiles/force-link`: Requires `OWNER` role. Re-links an unassociated profile `id` to a target `account_id` inside that specific guild.
4. **Phase 3 Unit Tests:**
   - API integration tests demonstrating a user fetching unclaimed imports and executing the `link-discord` endpoint successfully across the node and multiple mock server databases.

---

### Phase 4: Client Core Global Claiming Component
**Goal:** Block the main authenticated application state until the claim logic is resolved.

1. **Global Modal Component (`client/src/components/GlobalClaimProfile.tsx`)**
   - Auto-fetches `/api/accounts/unclaimed-imports`.
   - Displays a grid/list of global discord avatars and global user names.
   - Option to "Start Fresh" (Triggers `/api/accounts/dismiss-claim`).
2. **Integration with routing (`App.tsx`)**
   - Query global unclaimed status after the socket connects and valid session is found.
   - Block rendering of `ServerSidebar` and `ChatArea` if unclaimed imports exist for the node AND the user hasn't dismissed them. Show the `GlobalClaimProfile` modal on top.
3. **Login/Signup Flow Cleanup (`LoginSignup.tsx`)**
   - Ensure `isGuestSession` gracefully skips the global claiming process.

---

### Phase 5: Client Guild Profile Enhancements
**Goal:** Present the new data (server-specific avatars and nicknames) everywhere in the standard UI, and build the editor.

1. **Profile Editing UI (`ServerSettings.tsx` & Profile Context menus)**
   - Display a "Server Profile" overlay/view where users can edit their own `nickname` and upload a server-specific `avatar`.
   - Add Server Owner controls to manually link known unassociated users to existing Harmony accounts (Override rule).
2. **Chat Area Visualization (`MessageItem.tsx` & `ChatArea.tsx`)**
   - Switch avatar rendering to prioritize `profile.avatar` (server avatar) before falling back to global state.
   - Remove any legacy CSS/Tailwind placeholder backgrounds, using strict Image elements (`<img src... />`) consistent with Discord aesthetics.

---

### Phase 6: Tagging & Mention Expansion
**Goal:** Make mentions feel intuitive for migrated servers.

1. **Autocomplete Engine (`MentionAutocomplete.tsx` & `MessageInput.tsx`)**
   - Currently, options are filtered by examining names. Update the `.filter()` engine.
   - Logic: `original_username` (godofghz) OR `nickname` (Dungeon Master) must both cause `profile` object to surface upon `@` typing.
   - Prioritize nickname rendering in the dropdown list, but show the global name in a secondary muted font if it differs.
2. **Phase 6 Unit Tests:**
   - Add Vitest test cases to `MessageInput` simulating keyboard inputs searching for varying combinations of global/guild names and confirming the dropdown array filters correctly.
