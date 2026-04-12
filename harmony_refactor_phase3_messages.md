# Harmony Refactoring Phase 3: Messages, Profiles & Resiliency

## Context
This is the final phase of the monolithic teardown for Harmony. You are tasked with migrating the most complicated portion of the codebase out of `app.ts`: the messaging array, profile bindings, and internal reaction mappings. Following the architectural migrations, you will be eliminating a heavy string-parsing workload in the database endpoints and repairing test-bed reliability.

## Objectives
1. **Extract Profiles and Messages Logic**:
   - Create `server/src/routes/messages.ts` and `server/src/routes/profiles.ts`.
   - Remove endpoints like `GET /api/channels/:channelId/messages`, `POST /.../messages`, `POST /.../reactions`, and `GET /api/servers/:serverId/search` out of `app.ts`.
   - Migrate `POST /api/servers/:serverId/profiles`, `PATCH /.../profiles/:profileId`, and related logic.
   - Ensure the Express routers are correctly hooked into `app.ts`. *At this point, `app.ts` should be little more than middleware, websockets dispatch, and route mounting arrays.*

2. **Eliminate Malicious In-Memory Attachment Swapping**:
   - Within the existing `GET /api/channels/:channelId/messages` and `GET /search` routes, there is code that manually loops over the attachments string: `JSON.parse(attachments)`, loops over arrays checking `url.startsWith('/uploads/channels/')`, performs manual `.replace()` statements locally to inject dynamic `serverId` strings, and then `JSON.stringify`s it back. 
   - This prevents clean database streaming and scales linearly with query load. Refactor the backend/frontend synchronization so that attachments are saved into the database with universally valid reference paths (e.g., dynamically computed cleanly by the client or stored fully resolved) rather than swapping URLs dynamically via JSON parsers during a database query loop.

3. **Frontend Test Resiliency**:
   - The test bed for the `client` throws mass warnings from Vitest/React regarding state mutations that are uncaught within `act(...)` blocks (`tests/Permissions.test.tsx`, `tests/LoginSignup.test.tsx`, etc.).
   - Edit the respective test files and wrap the state-inducing renders, DOM click simulations, and promises inside `act(async () => { ... })` closures. The goal is to perfectly silence those terminal warnings, establishing an immaculate and readable UX output for automated test logs.

## Execution Requirements
- The message extraction includes WebSocket dispatch hooks. You must ensure the `broadcastMessage` function instances mapped in `app.ts` successfully flow into the decoupled routers. 
- Validate the new architecture by executing a complete test run across the server and client codebase. Resolve any breakages or hanging tests from dangling connections.

## Quality & Testing Standards
- **Cleanliness & Readability**: Follow established industry standards. Organize controllers cleanly, use type-safety extensively, and keep functions small and single-purpose.
- **Unit Testing**: All code modified or written during this phase must be unit-testable. Update any existing tests that break due to your refactors, and add new unit tests targeting any natively untended features you extract.
- **Regression Prevention**: You must run the test suite (`npm run test`) routinely, and at an absolute minimum when your code changes are complete, to guarantee regressions are blocked before committing.
