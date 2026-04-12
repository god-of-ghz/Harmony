# Harmony ServerSaver V2 Upgrade Prompts

Each section below is a **self-contained prompt** designed for an independent, smaller agent to execute a subphase of the ServerSaver V2 Upgrade. 

---

## Phase 1A: Core Schema Updates

```text
You are working on "Harmony," an open-source distributed chat platform similar to Discord.
The codebase is located at `c:\Harmony\server\src\` and uses Node.js + Express with an SQLite database (sqlite3).

BACKGROUND:
Harmony is upgrading its systems to support an official, richer data export format produced by "ServerSaver", a Discord archival tool. This standard is documented centrally in the `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md` document.

This phase of the overall migration project handles the core database schema. According to the specification doc, the new exporter outputs hierarchical metadata (channel topics, NSFW flags) and custom server emojis. Harmony currently lacks these fields. 

YOUR TASK:
Modify the backend database schemas in `database.ts` to support the new metadata fields and the new `server_emojis` table required by the `SERVERSAVER_EXPORT_SPEC.md`, ensuring all changes are backward-compatible.

CONCRETE STEPS:
1. Open `c:\Harmony\server\src\database.ts`.
2. In the `initServerDb` method, locate the existing table creation statements and modify them implicitly by adding ALTER TABLE fallbacks to handle existing nodes:
   - For `servers` table: Add `owner_id TEXT` and `description TEXT`.
   - For `channels` table: Add `topic TEXT` and `nsfw BOOLEAN DEFAULT 0`.
   - For `messages` table: Add `embeds TEXT DEFAULT '[]'`.
3. In `initServerDb`, create a new table block:

   CREATE TABLE IF NOT EXISTS server_emojis (
     id TEXT PRIMARY KEY,
     server_id TEXT NOT NULL,
     name TEXT NOT NULL,
     url TEXT NOT NULL,
     animated BOOLEAN DEFAULT 0,
     FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
   )

4. Add the necessary `dbObj.run("ALTER TABLE ...")` fallbacks under the table creations to ensure backward compatibility for instances that already have the older schema.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards.
- Write code to be as unit-testable as possible.
- Update or add new unit tests (e.g., in `c:\Harmony\server\src\__tests__\database.test.ts`) to verify that the `server_emojis` table is created correctly and fields can be successfully written and retrieved.
- Use TypeScript strict mode and handle errors explicitly.
```

---

## Phase 1B: Custom Emojis API Endpoint

```text
You are working on "Harmony," an open-source distributed chat platform. 
The backend is a Node.js Express server using SQLite (sqlite3) at `c:\Harmony\server\src\`.

BACKGROUND:
Harmony is upgrading its systems to support an official, richer data export format produced by "ServerSaver", a Discord archival tool. This standard is documented in `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md`.

This phase tackles backend API expansion for Phase 1. As noted by the spec doc, the export now catalogs custom server emojis. Our SQLite database was recently updated to contain a `server_emojis` table. Clients need a dedicated API endpoint to fetch these custom emojis to render them inline in chat securely.

YOUR TASK:
Create a new API endpoint that securely exposes the server's custom emojis to authenticated clients.

CONCRETE STEPS:
1. Open `c:\Harmony\server\src\app.ts`.
2. Add a new `GET` route: `/api/servers/:serverId/emojis`.
3. Apply existing middlewares: `requireAuth` (to ensure the user is logged in) and `requireServerAccess` (to ensure the user has permission to view this server's data).
4. Implement the endpoint logic: use `dbManager.allServerQuery` to select all rows from the `server_emojis` table where the `server_id` matches the URL parameter.
5. Return the rows as a JSON array `[{id, name, url, animated}, ...]`. If no emojis exist, return an empty array.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards. Provide JSDoc annotations for functions.
- Write code to be as unit-testable as possible.
- Add new unit tests (e.g., in `c:\Harmony\server\src\__tests__\api.test.ts`) to mock the DB, simulate requests to the new endpoint, verify that the middlewares behave correctly, and verify the correct JSON response is sent.
- Use TypeScript strict mode.
```

---

## Phase 2A: Global State for Emojis

```text
You are working on "Harmony", an open-source chat platform. The client is a React + TypeScript application located at `c:\Harmony\client\src\`, utilizing Zustand for state management.

BACKGROUND:
Harmony is undergoing a massive upgrade to ingest Discord structural exports defined by `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md`. 

This stage covers the initial client-side groundwork of Phase 2. As per the overarching specification, custom emojis are now supported platform-wide. The backend exposes an endpoint `GET /api/servers/:serverId/emojis`. The React client needs to fetch and intelligently cache these emojis dynamically into the global state when navigating to different servers.

YOUR TASK:
Extend the Zustand application store to cache server-specific emojis, and fetch them gracefully from the backend.

CONCRETE STEPS:
1. Open `c:\Harmony\client\src\store\appStore.ts`.
2. Update the `AppState` interface to include an `emojis: Record<string, EmojiData[]>` mapping.
3. Add a new state method `fetchServerEmojis(serverId: string): Promise<void>`.
4. In `fetchServerEmojis`, check if the emojis for `serverId` are already cached in `emojis[serverId]`. If they are, return early.
5. If not cached, execute a `fetch()` using the `Authorization: Bearer <token>` header to `GET /api/servers/:serverId/emojis`.
6. Parse the response and update the `emojis` record in the Zustand store.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards.
- Write code to be as unit-testable as possible.
- Add unit tests for the AppStore logic (e.g., mock the global `fetch`, trigger `fetchServerEmojis`, and ensure the Zustand state is properly updated and caches subsequent calls).
- Use TypeScript strict mode.
```

---

## Phase 2B: Discord-Style Embed Component

```text
You are working on "Harmony," an open-source chat platform. The React Client is based in `c:\Harmony\client\src\`.

BACKGROUND:
Harmony is standardizing around an external import specification detailed in `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md` via the ServerSaver tool. 

This phase focuses on UI component fidelity (Phase 2). The specification dictates that Discord messages often contain rich "Embeds" (coloured code blocks with images, titles, and descriptions). Our system now ingests and surfaces these as a stringified JSON array in the `message.embeds` database column. We must visualize them natively.

YOUR TASK:
Implement a React component to visualize a Discord-style embed, and integrate it into the standard message-item view framework.

CONCRETE STEPS:
1. Create `c:\Harmony\client\src\components\MessageEmbed.tsx`.
   - The component should accept an `embed` object prop.
   - Design the structure to match Discord embeds: a colored left border matching `embed.color`, a bold `embed.title`, `embed.description` mapped cleanly, and conditionally render an `embed.image.url` if present.
   - Ensure the CSS is clean and isolated.
2. Open `c:\Harmony\client\src\components\MessageItem.tsx`.
   - Parse `message.embeds`. If it is a non-empty array (or stringified array), map over it.
   - Render the mapped `<MessageEmbed>` components directly under the main text content block.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards (modular CSS/Tailwind, React best practices).
- Write code to be as unit-testable as possible.
- Add unit tests for `MessageEmbed.tsx` (using React Testing Library) to ensure it handles missing properties gracefully and renders the correct color/layout out of a mock Discord JSON embed payload.
```

---

## Phase 2C: Inline Custom Emoji Rendering

```text
You are working on "Harmony", an open-source chat platform. The React Client is located in `c:\Harmony\client\src\`.

BACKGROUND:
Harmony is aligning with the Discord export format cataloged in `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md`. 

This subphase concludes our client-side React UI updates. The spec highlights custom emojis being a core part of native message parsing. Historically, Harmony only supported native unicode. We recently added caching of custom emojis into `appStore.ts`. We now need to update our text rendering algorithm to visualize these graphical assets inside chat boxes. 

YOUR TASK:
Update the message text rendering logic to search for Discord's custom emoji syntax shortcodes and replace them dynamically with formatted `<img>` tags pointing to the remote fallback URLs.

CONCRETE STEPS:
1. Open `c:\Harmony\client\src\components\MessageItem.tsx`.
2. Locate the function/logic that maps raw markdown `message.content` into display text.
3. Fetch the `server_id` scope and pull the custom emojis array from the Zustand store.
4. Implement Regex text replacement: Identify text matching `<:name:id>` or `<a:name:id>`. Cross-reference `name` or `id` against the `emojis` array to resolve its `url`.
5. Return the text with the standard shortcode replaced with an `<img src={url} alt={name} className="inline-emoji" />`. Handle missing fallbacks cleanly.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards.
- Write code to be as unit-testable as possible.
- Extract the regex and replacement logic into a pure function `parseCustomEmojis(content: string, emojis: EmojiData[]): ReactNode[] | string` in a `utils/` helper.
- Write unit tests against this pure function to test varied content containing multiple custom emojis, regular text, and edge-cases.
```

---

## Phase 3A: Guild Metadata Ingestion

```text
You are working on "Harmony," an open-source Node.js distributed chat platform (`c:\Harmony\server\src\`).

BACKGROUND:
Harmony is revamping its internal database importer tools to process a new hierarchical Discord export structure. This export flow is formally laid out inside `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md`.

This phase represents the kickoff to the Phase 3 backend importer rewrite. The `importer.ts` previously processed a flat list of JSON dumps. The spec now defines a rigid, multi-directory nested structure featuring a root domain `guild_metadata.json` dictating roles, emoji assets, and profile trees.

YOUR TASK:
Rewrite the initial ingestion stage of the `importer.ts` pipeline to process the newly structured `guild_metadata.json` data into the local SQLite database.

CONCRETE STEPS:
1. Open `c:\Harmony\server\src\importer.ts`.
2. Modify or rewrite `importDirectory(dirPath, serverName)` to look for `guild_metadata.json` in the root folder according to the specification. Read this metadata file synchronously.
3. Use `dbManager.runBatch` or standard `runServerQuery` to safely insert the newly imported data:
   - Insert into the `servers` table linking the added `owner_id` and `description` traits.
   - Iterate and insert all custom roles into the `roles` table.
   - Iterate the `members` array. For each member, create a dummy profile linking `name` or `global_name` to their profile `nickname`. Resolve their `roles` array and populate `profile_roles`.
   - Iterate `emojis` and populate the new `server_emojis` table.
   - Iterate `categories` and insert them into the `channel_categories` table.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards. Use `async/await` and SQLite transactions cleanly.
- Write code to be as unit-testable as possible. Limit side-effects by extracting parsing logic from database inserts.
- Add unit tests validating that the parsing logic yields proper DB params and doesn't crash on slightly malformed inputs.
- Use TypeScript strict mode.
```

---

## Phase 3B: Channel & Message Traversal

```text
You are working on "Harmony", an open-source Node.js distributed chat platform (`c:\Harmony\server\src\`).

BACKGROUND:
Harmony's internal import pipeline is being upgraded to cleanly parse the export syntax declared in `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md`.

In this middle subset of the importer expansion phase, we must deal with local directories. The specification lays out channel metadata and messages as nested subdirectories labeled `[Sanitized Channel Name]-[Channel ID]`. Our core import algorithm needs to traverse these directories and stream parsing the channel states sequentially.

YOUR TASK:
Update `importer.ts` to iterate through the nested subdirectories, instantiate the channels matching the specification schema, and pipeline the raw `messages.json` logs into the SQL database.

CONCRETE STEPS:
1. Open `c:\Harmony\server\src\importer.ts`.
2. Inside the master `importDirectory` function, after parsing `guild_metadata.json`, iterate all folders inside the directory.
3. For each folder matching a channel: Read `channel_metadata.json`. Insert the row into the `channels` table linking `category_id`, `topic`, `nsfw`, and `position`. 
4. Call into the streaming JSON pipeline logic (like `importDiscordJson` but modernized) pointing to `messages.json` within that folder.
5. In the message JSON stream:
   - Map standard properties.
   - Serialize `embeds` directly into a JSON string since SQLite handles it as TEXT.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and to industry standards. Node streams and SQLite batch commits must be used efficiently to handle millions of rows without OOM errors.
- Write code to be as unit-testable as possible.
- Update tests to prove directories can be walked recursively and stream correctly pushes batches into mock databases without memory leaks.
```

---

## Phase 3C: Local File & Reaction Migrations

```text
You are working on "Harmony", an open-source Node.js chat platform (`c:\Harmony\server\src\`).

BACKGROUND:
Harmony is concluding the integration of a new Discord export mechanism, heavily documented in the `c:\Harmony\SERVERSAVER_EXPORT_SPEC.md` specification. 

This is the final hurdle of the Phase 3 importer overhaul. The specification indicates that media attachment binaries are now stored locally in nested `media/` directories, and reactions contain localized `users` arrays. These entities must be correctly pipelined off the data streams and migrated into the primary Harmony server structure.

YOUR TASK:
Hook into the message stream loop in `importer.ts` to copy local file binaries and map detailed user-attribution message reactions according to the schema specification.

CONCRETE STEPS:
1. Open `c:\Harmony\server\src\importer.ts`.
2. Locate the data transformation block in the `messages.json` streaming pipeline.
3. Handle Attachments: 
   - The JSON strings specify formats like `media/123_image.png`. 
   - Translate DB strings to `/uploads/channels/:channelId/123_image.png`.
   - Use `fs.copyFileSync` (wrapped safely) to physically move the files from `[Export Dir]/[Channel Name-Id]/media/` into `DATA_DIR/servers/[Server ID]/uploads/channels/[Channel ID]/.` Ensure destination folders exist via `fs.mkdirSync`.
4. Handle Reactions:
   - For each reaction node in the JSON, check for a `users` array (as outlined in the spec).
   - Unpack this array to perform row inserts into the `message_reactions` table natively mapping each `reaction.emoji` with the explicit `user.id`.
   - If `users` is missing, assign the reaction count to a predefined "System" account.

CODE QUALITY & TESTING:
- Keep the code clean, readable, and compliant with industry standards.
- Write code to be as unit-testable as possible. Abstract `fs.copyFileSync` behind a wrapper so it can be mocked in tests.
- Add unit tests proving attachments are resolved to correct relative paths and dummy reaction counts are distributed evenly.
- Use TypeScript strict mode and gracefully catch disk I/O errors so importing millions of rows doesn't break due to a single missing file.
```
