# Harmony Refactoring Phase 2: Servers, Channels & Scalability

## Context
You are working on Phase 2 of the Harmony monolith teardown. The `server/src/app.ts` file acts as thousands of lines of intertwined routing, database queries, and business logic. Your objective is to extract the structural communication layer (Servers, Categories, Channels) into modular, independent route controllers while fixing an unscalable database scanning implementation.

## Objectives
1. **Extract Server and Category Routing**:
   - Create `server/src/routes/servers.ts` and `server/src/routes/categories.ts`.
   - Migrate endpoints like `GET /api/servers`, `POST /api/servers`, `DELETE /api/servers/:serverId`, `PUT /api/servers/:serverId/rename`, and all `categories` logic out of `app.ts`. 
   - Integrate them cleanly back into `app.ts` using `app.use('/api/servers', serverRoutes)` or similar express mounting patterns. Ensure you adequately inject the database handle or import the DB singleton.

2. **Extract Channel Routing**:
   - Create `server/src/routes/channels.ts`. 
   - Migrate all generic channel administration (creating channels, updating category assignments, deleting channels) into this file and mount it. *Skip the `/messages` endpoints for now, they belong to Phase 3.*

3. **Fix Scalability: Rewrite `findServerId`**:
   - In `app.ts`, observe the `findServerId` method. It iteratively loops over *every loaded server database instance*, performing `SELECT * FROM channels WHERE id = ?`. This is an egregious $O(m \times n)$ nested search that will freeze large deployments.
   - Refactor the architecture so that the main `Node DB` (or an in-memory mapping cached at server start/channel creation) maintains a lightweight `{ channel_id: server_id }` indexing system. `findServerId` should become an $O(1)$ look-up map request, completely bypassing the heavy SQLite iterations.

## Execution Requirements
- Types and Imports will likely break as you extract this code. Be meticulous with your TS configurations and ensure the `requireAuth`, `requireRole`, and `requirePermission` middleware from `rbac.ts` are successfully carried over.
- Run `npm run test` targeting system and server flow tests (`tests/system.test.ts`) to ensure channels and server creation commands execute identically as they did in the monolith.

## Quality & Testing Standards
- **Cleanliness & Readability**: Follow established industry standards. Organize controllers cleanly, use type-safety extensively, and keep functions small and single-purpose.
- **Unit Testing**: All code modified or written during this phase must be unit-testable. Update any existing tests that break due to your refactors, and add new unit tests targeting any natively untended features you extract.
- **Regression Prevention**: You must run the test suite (`npm run test`) routinely, and at an absolute minimum when your code changes are complete, to guarantee regressions are blocked before committing.
