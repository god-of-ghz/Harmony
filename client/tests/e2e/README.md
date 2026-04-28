# Harmony E2E Testing Infrastructure

> **Notice to AI Agents**: This README is the source of truth for handling and verifying browser interactions and UI tests for the Harmony project.

## Overview

Harmony relies on Playwright to ensure the application UI functions flawlessly. Testing is strictly enforced via End-to-End browser validation.
We have isolated critical pathways into Domain-driven Page Object Models (POM) to ensure tests don't break when simple CSS or DOM layouts change. 

DO NOT blindly "fix" things using terminal scripts to curl UI endpoints. We have built two distinct commands specifically for you.

## 1. Local Testing Environments

There are two primary ways to test this application:

### `npm run test:e2e:auto` 
**When to use:** Use this for verifying regressions locally or in an automated context. This will use Playwright's `webServer` lifecycle hooks to spin up both the Vite client server and the Mock backend server simultaneously and headless across Chromium, WebKit, and Firefox.
**Note:** It takes a moment for the servers to boot. Do not override this command lightly.

### `npm run test:env`
**When to use:** Use this when you are writing/debugging code and need a persistent environment to visually interact with. This starts the testing backend `--mock` server on port 3001 and the vite client on 5173. **Once running, you can use your browser tools to manually view `http://localhost:5173`**.

## 2. Page Object Models (POM)

We use Page Objects located in `models/` to encapsulate UI interactions.

- `LoginPage.ts`: Use for Authentication (`login()`, `signup()`, `switchMode()`)
- `ProfilePage.ts`: Use for the Profile setup screen (`claimFreshProfile()`).
- `ChatPage.ts`: Use for all active chat interactions, messaging, uploading, logging out.
- `SettingsPage.ts`: Use for channel and role manipulation.

## 3. Fixtures 

Our custom Playwright fixture is exported from `fixtures/harmony.ts`.
**IMPORTANT**: All spec files **MUST** import `test` and `expect` from this fixture, NOT `@playwright/test`!

```typescript
import { test, expect, SERVER_URL } from './fixtures/harmony';

test('example', async ({ loginPage, profilePage, testAccount }) => {
    // Note: The fixture AUTOMATICALLY navigates to '/' and clears 
    // localStorage/IndexedDB before extending these page objects to your test.
    
    // testAccount ensures a deterministic, random-looking account across runs
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
});
```

## 4. Test State rules

- All tests in `.spec.ts` files should use `test.describe.serial` and run in isolated browser contexts (Playwright handles context clearing by default, but we enforce local DB wipes via the fixture setup).
- Use `testAccount` provided by the fixture rather than generating random emails manually. This ensures determinism when debugging a failing test suite.
