# Harmony Refactoring Phase 1: Core Infrastructure & Security

## Context
You are tasked with the first phase of a major refactor for the Harmony server codebase. The primary objective is to begin dismantling the monolith `app.ts` file, improve cryptographic baseline security, and fix path traversal vulnerabilities. You must maintain existing functionality and test reliability. 

## Objectives
1. **Cryptographic Baseline Upgrades**:
   - In `client/src/utils/crypto.ts`, find `export const ITERATIONS = 100_000;` and upgrade it to `600_000` to meet OWASP 2023 recommendations for PBKDF2-HMAC-SHA256. 
   - Refactor `getDeterministicSalt(email: string)`. Currently, it deterministically hashes the email with a static suffix (`_harmony_pake_v1`), making it a pseudo-salt. Modify the system to generate a truly random salt locally and persist it to the node database for the user during sign-up alongside the login credentials. Make sure server tests (`tests/system.test.ts`, `tests/security.test.ts`) still pass since login expectations will change slightly based on this. *Do not modify the key separation or WebRTC implementation, just the salt randomness and iterations.*

2. **Backend Security: Path Traversal Fixes**:
   - The `/uploads/:serverId` and `/servers/:serverId/avatars` routes in `server/src/app.ts` currently use naive string matching (`if (serverId.includes('..') || serverId.includes('.'))`) to prevent directory traversal. 
   - Refactor this logic to use Node.js `path.resolve` and `path.normalize`. Calculate the absolute resolved path and verify that `resolvedPath.startsWith(baseDirectory)`. This pattern safely allows normal filesystem usage (like intentional periods in filenames/UUIDs) while strictly boxing navigation.

3. **Infrastructural Modularity**:
   - Create a `server/src/routes` directory.
   - Extract the `/uploads/*`, `/avatars`, and `/api/health` static mapping routes out of `app.ts`. Place them into something like `routes/static.ts` or `routes/health.ts` and ensure they are connected back to the main express instance.

## Execution Requirements
- Do not run blind tests; ensure SQLite database schemas are correctly updated if adding random salt properties requires table expansion.
- After implementing these fixes, run the server tests `npm run test -- tests/security.test.ts tests/system.test.ts` to ensure login and secure routing still behave properly.
- Commit the changes and prepare for Phase 2.

## Quality & Testing Standards
- **Cleanliness & Readability**: Follow established industry standards. Organize controllers cleanly, use type-safety extensively, and keep functions small and single-purpose.
- **Unit Testing**: All code modified or written during this phase must be unit-testable. Update any existing tests that break due to your refactors, and add new unit tests targeting any natively untended features you extract.
- **Regression Prevention**: You must run the test suite (`npm run test`) routinely, and at an absolute minimum when your code changes are complete, to guarantee regressions are blocked before committing.
