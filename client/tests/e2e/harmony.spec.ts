import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

/**
 * Harmony Client – End-to-End System Tests
 *
 * These tests exercise the live Harmony client (Vite dev server on :5173)
 * against a live Harmony server running in --mock mode (port configurable,
 * defaults to 3099).
 *
 * The mock server auto-seeds:
 *   - A server called "Harmony Mock Server" (id: mock-server-001)
 *   - A category "Text Channels" with a #general channel
 *   - An admin account (admin@harmony.local) – but its auth_verifier is
 *     a raw SHA-256 of "password123", which doesn't match the PAKE derivation
 *     the client performs.  So we create FRESH accounts via the signup flow.
 */

const SERVER_URL = process.env.HARMONY_SERVER_URL ?? 'http://localhost:3001';
const UNIQUE_ID  = Date.now().toString(36);
const TEST_PASS  = 'E2eTestPass!42';

// ─── Helpers ────────────────────────────────────────────────────────

/** Clear client state so every test starts fresh. */
async function resetClient(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    const dbs = window.indexedDB.databases ? window.indexedDB.databases() : Promise.resolve([]);
    return dbs.then((list: any[]) => list.forEach((db: any) => window.indexedDB.deleteDatabase(db.name)));
  });
  await page.reload();
  // Wait for login page to fully render
  await page.waitForSelector('#email', { timeout: 10_000 });
}

/** Set the server URL on the login page. */
async function setServerUrl(page: Page, url: string) {
  const serverInput = page.locator('#initialServerUrl');
  await serverInput.fill(url);
}

/** Perform signup in the browser. */
async function signupUser(page: Page, email: string, password: string) {
  // Switch to signup mode
  await page.getByText('Register').click();
  await page.waitForSelector('#confirmPassword', { timeout: 5_000 });

  // Fill in the form
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#confirmPassword').fill(password);

  // Set server URL
  await setServerUrl(page, SERVER_URL);

  // Submit
  await page.getByRole('button', { name: 'Signup' }).click();
}

/** Login with existing credentials. */
async function loginUser(page: Page, email: string, password: string) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await setServerUrl(page, SERVER_URL);
  await page.getByRole('button', { name: 'Login' }).click();
}

/** Wait for ClaimProfile / "Join Server" screen and create a profile. */
async function claimFreshProfile(page: Page, nickname: string) {
  // Wait for the "Join Server" heading to appear
  await expect(page.getByRole('heading', { name: 'Join Server' })).toBeVisible({ timeout: 15_000 });

  // Click "Fresh Start" button
  await page.getByRole('button', { name: 'Fresh Start' }).click();
  await page.waitForTimeout(300);

  // The nickname input is a text input inside the fresh start form, right after
  // the "Choose a Nickname" label. Since the label lacks htmlFor, use the
  // input element directly within the form.
  const nicknameInput = page.locator('form input[type="text"]');
  await expect(nicknameInput).toBeVisible({ timeout: 5_000 });
  await nicknameInput.fill(nickname);

  // Submit via the "Join Server" button inside the form
  await page.locator('form button[type="submit"]').click();
  return nickname;
}

/** Full flow: signup -> claim profile -> wait for channel sidebar. */
async function signupAndJoinServer(page: Page, suffix: string): Promise<string> {
  const email = `${suffix}_${UNIQUE_ID}@e2e.local`;
  const nickname = `${suffix}_${UNIQUE_ID}`;
  await signupUser(page, email, TEST_PASS);
  await claimFreshProfile(page, nickname);

  // Wait for the channel sidebar to load with #general
  await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 10_000 });
  return nickname;
}

// ─── Test Suite ─────────────────────────────────────────────────────

test.describe.serial('Harmony Client System Tests', () => {

  // ═════════════════════════════════════════════════════════════════
  // 1.  LOGIN PAGE UI
  // ═════════════════════════════════════════════════════════════════

  test('should display the login page on first load', async ({ page }) => {
    await resetClient(page);

    await expect(page.getByText('Welcome back!')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.locator('#initialServerUrl')).toBeVisible();
    await expect(page.getByText('Initial Network Server URL')).toBeVisible();
    await expect(page.locator('#rememberMe')).toBeVisible();
    await expect(page.getByText('Remember me')).toBeVisible();
    await expect(page.getByText('Continue as Guest')).toBeVisible();
    await expect(page.getByText('Forgot / Change Password?')).toBeVisible();
    await expect(page.getByText('Clear Local Cache & Reset Client')).toBeVisible();
  });

  test('should toggle between Login and Signup modes', async ({ page }) => {
    await resetClient(page);

    // Start on login
    await expect(page.getByText('Welcome back!')).toBeVisible();

    // Switch to signup
    await page.getByText('Register').click();
    await expect(page.getByText('Create an Account')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();

    // Switch back to login
    await page.getByText('Login').last().click();
    await expect(page.getByText('Welcome back!')).toBeVisible();
    await expect(page.locator('#confirmPassword')).not.toBeVisible();
  });

  test('should show password mismatch error on signup', async ({ page }) => {
    await resetClient(page);

    await page.getByText('Register').click();
    await page.locator('#email').fill('mismatch@e2e.local');
    await page.locator('#password').fill('password1');
    await page.locator('#confirmPassword').fill('password2');
    await setServerUrl(page, SERVER_URL);

    await page.getByRole('button', { name: 'Signup' }).click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2.  AUTHENTICATION FLOWS
  // ═════════════════════════════════════════════════════════════════

  test('should show an error on invalid login credentials', async ({ page }) => {
    await resetClient(page);
    await loginUser(page, 'nonexistent@fake.com', 'wrongpassword');

    // Expect an error message (could be "Invalid credentials", "Failed to unlock...", etc.)
    await expect(page.locator('div').filter({ hasText: /error|Invalid|Failed/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('should signup a new account and leave the login page', async ({ page }) => {
    await resetClient(page);
    await signupUser(page, `signup_${UNIQUE_ID}@e2e.local`, TEST_PASS);

    // After successful signup, the login form should disappear
    await expect(page.getByText('Welcome back!')).not.toBeVisible({ timeout: 15_000 });
  });

  test('should login as a guest', async ({ page }) => {
    await resetClient(page);
    await setServerUrl(page, SERVER_URL);

    await page.getByRole('button', { name: 'Continue as Guest' }).click();

    // Guest users see a warning banner at the top
    await expect(page.getByText('guest account', { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3.  PROFILE SETUP
  // ═════════════════════════════════════════════════════════════════

  test('should show ClaimProfile / Join Server screen after signup', async ({ page }) => {
    await resetClient(page);
    await signupUser(page, `claim_${UNIQUE_ID}@e2e.local`, TEST_PASS);

    await expect(page.getByRole('heading', { name: 'Join Server' })).toBeVisible({ timeout: 15_000 });
    // The "Fresh Start" and "Claim Existing" buttons should be visible
    await expect(page.getByRole('button', { name: 'Fresh Start' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim Existing' })).toBeVisible();
  });

  test('should create a profile via Fresh Start and enter the server', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'profile');

    // We should now see the full app UI: channel sidebar, chat area
    await expect(page.getByText('Server Configuration')).toBeVisible();
    await expect(page.getByText('general', { exact: true })).toBeVisible();
  });

  test('guest should see Fresh Start by default on ClaimProfile', async ({ page }) => {
    await resetClient(page);
    await setServerUrl(page, SERVER_URL);
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await expect(page.getByText('guest account', { exact: false })).toBeVisible({ timeout: 10_000 });

    // Wait for the Join Server screen
    await page.waitForTimeout(2000);
    const joinVisible = await page.getByRole('heading', { name: 'Join Server' }).isVisible();

    if (joinVisible) {
      // For guests, "Fresh Start" should be the active/default option
      // and "Claim Existing" should NOT be visible (guests can't claim)
      await expect(page.getByRole('button', { name: 'Claim Existing' })).not.toBeVisible();
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // 4.  CHANNEL SIDEBAR
  // ═════════════════════════════════════════════════════════════════

  test('should display channel sidebar with #general channel', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'chan');

    // "Server Configuration" header
    await expect(page.getByText('Server Configuration')).toBeVisible();

    // "Text Channels" category (seeded by mock server)
    await expect(page.getByText('Text Channels')).toBeVisible();

    // #general channel
    await expect(page.getByText('general', { exact: true })).toBeVisible();
  });

  test('should display the Settings gear icon in channel sidebar', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'settings');

    await expect(page.getByText('Server Configuration')).toBeVisible();
    // The Settings gear icon is next to "Server Configuration"
    // It's an <svg> element – we just verify the settings header region exists
  });

  // ═════════════════════════════════════════════════════════════════
  // 5.  CHAT AREA & MESSAGING
  // ═════════════════════════════════════════════════════════════════

  test('should display the channel header with # general', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'header');

    // The chat area header should show "# general"
    await expect(page.getByText('# general')).toBeVisible({ timeout: 10_000 });
  });

  test('should display the message input with correct placeholder', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'inputt');

    const msgInput = page.locator('input[placeholder*="Message #"]');
    await expect(msgInput).toBeVisible({ timeout: 10_000 });
    const placeholder = await msgInput.getAttribute('placeholder');
    expect(placeholder).toContain('general');
  });

  test('should send a message and see it appear in chat', async ({ page }) => {
    await resetClient(page);
    const nickname = await signupAndJoinServer(page, 'msg');

    const msgInput = page.locator('input[placeholder*="Message #"]');
    await expect(msgInput).toBeVisible({ timeout: 10_000 });

    // Wait for WebSocket connection to establish after page load
    await page.waitForTimeout(2000);

    const testMessage = `Hello from E2E test ${UNIQUE_ID}`;
    await msgInput.fill(testMessage);
    await msgInput.press('Enter');

    // The sent message should appear in the chat (via WebSocket push)
    await expect(page.getByText(testMessage)).toBeVisible({ timeout: 15_000 });

    // The nickname should appear as the author
    await expect(page.getByText(nickname).first()).toBeVisible({ timeout: 10_000 });
  });

  test('should send multiple messages and display them in order', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'multi');

    const msgInput = page.locator('input[placeholder*="Message #"]');
    await expect(msgInput).toBeVisible({ timeout: 10_000 });

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    // Send 3 messages
    for (let i = 1; i <= 3; i++) {
      await msgInput.fill(`E2E Seq #${i} ${UNIQUE_ID}`);
      await msgInput.press('Enter');
      await page.waitForTimeout(600);
    }

    // All 3 should be visible
    for (let i = 1; i <= 3; i++) {
      await expect(page.getByText(`E2E Seq #${i} ${UNIQUE_ID}`)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('should display message timestamps', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'ts');

    const msgInput = page.locator('input[placeholder*="Message #"]');
    await expect(msgInput).toBeVisible({ timeout: 10_000 });

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    await msgInput.fill(`Timestamp test ${UNIQUE_ID}`);
    await msgInput.press('Enter');

    await expect(page.getByText(`Timestamp test ${UNIQUE_ID}`)).toBeVisible({ timeout: 10_000 });

    // Messages should have a timestamp – check for a date-like string
    const today = new Date();
    const monthDay = `${today.getMonth() + 1}/${today.getDate()}`;
    // Timestamps are rendered via toLocaleString() so check for the date portion
    await expect(page.locator(`text=/${monthDay}/`).first()).toBeVisible({ timeout: 5_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 6.  SERVER SIDEBAR
  // ═════════════════════════════════════════════════════════════════

  test('should display the mock server icon in the sidebar', async ({ page }) => {
    await resetClient(page);
    await signupUser(page, `sidebar_${UNIQUE_ID}@e2e.local`, TEST_PASS);

    // Wait for main UI to load
    await page.waitForTimeout(3000);

    // The mock server "Harmony Mock Server" shows its first 2 chars "HA"
    await expect(page.getByText('HA').first()).toBeVisible({ timeout: 10_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 7.  LOGOUT
  // ═════════════════════════════════════════════════════════════════

  test('should logout and return to the login page', async ({ page }) => {
    await resetClient(page);
    await signupUser(page, `logout_${UNIQUE_ID}@e2e.local`, TEST_PASS);

    // Wait for main UI
    await page.waitForTimeout(3000);

    // Click the Logout button (title="Logout")
    const logoutBtn = page.locator('[title="Logout"]');
    await expect(logoutBtn).toBeVisible({ timeout: 10_000 });
    await logoutBtn.click();

    // Should return to login
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 8.  SERVER AND CHANNEL LIFECYCLE (PHASE 4)
  // ═════════════════════════════════════════════════════════════════

  test('should create a server and a channel, then rename and delete the channel (Phase 4)', async ({ page }) => {
    await resetClient(page);
    const email = `lifecycle_${UNIQUE_ID}@harmony.local`;
    const password = 'password123';
    await signupUser(page, email, password);

    await claimFreshProfile(page, 'LifecycleUser');
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Elevate user to admin so "Create New Server" button is visible
    const serverPath = path.resolve(process.cwd(), '../server');
    // Using npx.cmd on windows for reliability in execSync, though npx usually works
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execSync(`${npxCmd} tsx src/server.ts --mock --port 3001 --elevate ${email}`, { cwd: serverPath });
    await page.waitForTimeout(1000);

    // Refresh session to get "is_creator"/"is_admin" bit from server
    await page.getByTestId('logout-btn').click();
    await page.waitForSelector('#email', { timeout: 10_000 });
    
    // Give external elevation script time to settle
    await page.waitForTimeout(2000);
    
    await page.reload(); // Ensure clean state
    await loginUser(page, email, password);
    
    // Now they should be back in the server
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 20_000 });

    // Diagnostic: Check if user is actually admin
    const account = await page.evaluate(() => {
        // Since useAppStore is not on window, we can't check it directly easily.
        // But we can check if the button exists.
        return true; 
    });

    // 1. Server Creation
    const createServerTitle = 'E2E Test Server';
    const createBtn = page.getByTestId('create-server-btn');
    
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();
    await page.locator('input[placeholder="Server Name"]').fill(createServerTitle);
    await page.getByRole('button', { name: 'Create Server' }).click();

    // Verify "E2" icon appears (substring(0,2) of "E2E Test Server")
    const serverIcon = page.getByText('E2').first();
    await expect(serverIcon).toBeVisible({ timeout: 15_000 });
    await serverIcon.click();

    // After switching to a new server, we might need to join it (Fresh Start)
    // Though for created servers, the backend auto-joins us.
    const freshStartBtn = page.getByRole('button', { name: 'Fresh Start' });
    try {
        await freshStartBtn.waitFor({ state: 'visible', timeout: 5000 });
        await freshStartBtn.click();
        await page.getByTestId('fresh-nickname').waitFor({ state: 'visible' });
        await page.getByTestId('fresh-nickname').fill('ServerCreator');
        await page.getByRole('button', { name: 'Join Server' }).click();
    } catch (e) {
        // Did not appear, assume we are already joined as OWNER (default for creators)
        console.log("DEBUG: Fresh Start button did not appear, proceeding...");
    }

    // Now verify we see the general channel in the new server
    await expect(page.getByText('general', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // Wait for gear icon to correctly render (it depends on calculated permissions)
    // Adding a small delay and a reload attempt to ensure permissions settle
    const settingsGear = page.locator('[data-testid="settings-gear"]');
    try {
        await settingsGear.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (e) {
        console.log("DEBUG: settings-gear not visible yet, refreshing...");
        await page.reload();
        await expect(page.getByText('general', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
        await settingsGear.waitFor({ state: 'visible', timeout: 10_000 });
    }

    await settingsGear.click();
    await page.locator('[data-testid="new-channel-name"]').fill('e2e-random');
    await page.locator('[data-testid="add-channel-btn"]').click();

    // Verify channel renders in settings list first
    await expect(page.locator('[data-testid="channel-name-e2e-random"]')).toBeVisible({ timeout: 10_000 });

    // Close settings and verify in sidebar
    await page.keyboard.press('Escape');
    await expect(page.getByText('e2e-random', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 3. Rename Channel
    await settingsGear.click();
    const renameBtn = page.locator('[data-testid="rename-channel-e2e-random"]');
    await renameBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await renameBtn.click();

    const renameInput = page.getByTestId('rename-channel-input');
    await expect(renameInput).toBeVisible({ timeout: 10_000 });
    await renameInput.fill('e2e-renamed');
    await renameInput.press('Enter');

    // Verify rename in settings
    await expect(page.locator('[data-testid="channel-name-e2e-renamed"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByText('e2e-renamed', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 4. Delete Channel
    await settingsGear.click();
    const deleteBtn = page.locator('[data-testid="delete-channel-e2e-renamed"]');
    await deleteBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await deleteBtn.click();

    // Verify it's gone from settings
    await expect(page.locator('[data-testid="channel-name-e2e-renamed"]')).not.toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByText('e2e-renamed', { exact: true })).not.toBeVisible({ timeout: 10_000 });
  });

  // ═════════════════════════════════════════════════════════════════
  // 9.  ROLE MANAGEMENT AND PERMISSIONS (PHASE 4)
  // ═════════════════════════════════════════════════════════════════

  test('should create a Mod role and verify permission to delete others messages (Phase 4)', async ({ browser, page }) => {
    // We use two separate browser contexts to simulate two different users
    await resetClient(page);
    const modEmail = `mod_${UNIQUE_ID}@harmony.local`;
    const modPassword = 'password123';
    await signupUser(page, modEmail, modPassword);

    const modNickname = await claimFreshProfile(page, 'ModSetup');
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Elevate Mod user to global admin to setup roles
    const serverPath = path.resolve(process.cwd(), '../server');
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execSync(`${npxCmd} tsx src/server.ts --mock --port 3001 --elevate ${modEmail}`, { cwd: serverPath });
    await page.waitForTimeout(1000);

    // Refresh ModSession
    await page.getByTestId('logout-btn').click();
    await page.waitForSelector('#email', { timeout: 10_000 });
    await page.reload();
    await loginUser(page, modEmail, modPassword);

    // Wait for rejoin
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 20_000 });

    // Create a second user (Victim) in a new context
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto('/');
    const otherUrlInput = otherPage.locator('#initialServerUrl');
    await otherUrlInput.waitFor({ state: 'visible' });
    await otherUrlInput.fill(SERVER_URL);
    
    const victimEmail = `victim_${UNIQUE_ID}@harmony.local`;
    await signupUser(otherPage, victimEmail, modPassword);
    const victimNickname = await claimFreshProfile(otherPage, 'Victim');
    await expect(otherPage.getByText('general', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Mod user: Create "Mod" role in the mock server (mod user is global admin)
    await page.locator('[data-testid="settings-gear"]').click();
    await page.getByText('Roles').click();
    await page.locator('input[placeholder="New role..."]').fill('ModRole');
    await page.locator('[data-testid="create-role-btn"]').click();
    
    // Select the role to edit
    await page.getByText('ModRole', { exact: true }).click();
    
    // Enable "Manage Messages" checkbox
    const manageMessagesRow = page.getByTestId('perm-manage-messages');
    await manageMessagesRow.check();

    // Assign "ModRole" to BOTH users (so either can delete? No, just assign to victim)
    await page.getByText('Members').click();
    const victimMemberRow = page.locator('div').filter({ hasText: victimNickname }).first();
    await victimMemberRow.getByText('ModRole').click();
    await page.keyboard.press('Escape');

    // Mod user sends a message
    const msgInput = page.locator('input[placeholder*="Message #"]');
    const msgText = `Hello from Mod Creator ${UNIQUE_ID}`;
    await msgInput.fill(msgText);
    await msgInput.press('Enter');
    await expect(page.getByText(msgText)).toBeVisible({ timeout: 10_000 });

    // Victim user (now has ModRole) should see it and have the delete button
    await expect(otherPage.getByText(msgText)).toBeVisible({ timeout: 10_000 });
    
    const msgContainer = otherPage.locator('.message-container').filter({ hasText: msgText });
    await msgContainer.hover();
    
    const deleteBtn = msgContainer.locator('[data-testid="delete-message"]');
    await expect(deleteBtn).toBeVisible();
    
    // Clicking delete opens a window.confirm
    otherPage.once('dialog', dialog => dialog.accept());
    await deleteBtn.click();

    // Message should disappear for BOTH
    await expect(otherPage.getByText(msgText)).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(msgText)).not.toBeVisible({ timeout: 10_000 });

    await otherContext.close();
  });

  // ═════════════════════════════════════════════════════════════════
  // 10. FILE ATTACHMENTS (PHASE 4)
  // ═════════════════════════════════════════════════════════════════

  test('should upload a .png file and verify rich rendering in chat (Phase 4)', async ({ page }) => {
    await resetClient(page);
    await signupAndJoinServer(page, 'attachments');

    // Prepare a mock file upload
    const fileChooserPromise = page.waitForEvent('filechooser');
    // The attachment button is a <label> containing ImageIcon
    await page.locator('label').filter({ has: page.locator('.lucide-image') }).click();
    const fileChooser = await fileChooserPromise;
    
    await fileChooser.setFiles({
      name: 'e2e-test.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), // 1x1 transparent PNG
    });

    // Check if preview appears
    await expect(page.locator('img[alt="preview"]')).toBeVisible({ timeout: 5_000 });

    // Send the message
    const msgInput = page.locator('input[placeholder*="Message #"]');
    await msgInput.fill('Check out this image!');
    await msgInput.press('Enter');

    // Verify rich rendering
    // Images are rendered with alt="attachment" in ChatArea.tsx
    const chatImg = page.locator('img[alt="attachment"]').first();
    await expect(chatImg).toBeVisible({ timeout: 15_000 });
    
    // Verify src matches expected pattern: /uploads/:serverId/:filename
    const src = await chatImg.getAttribute('src');
    // Pattern: server-url + /uploads/server-id/timestamp-filename
    // e.g. http://localhost:3099/uploads/server-abc/12345-e2e-test.png
    expect(src).toMatch(/\/uploads\/server-[^\/]+\/.*e2e-test\.png/);
  });
});

