import { test, expect, SERVER_URL } from './fixtures/harmony';
import { elevateUserToAdmin } from './helpers/mock-server';

test.describe.serial('Server, Channel & Role Lifecycles', () => {

  // TODO: Blocked by a client-side Zustand state bug where \`currentUserPermissions\`
  // remains 0 on newly created servers, preventing the Settings modal from showing the Hierarchy tab.
  test.skip('should create a server and a channel, then rename and delete the channel', async ({ loginPage, profilePage, chatPage, settingsPage, testAccount, page }) => {
    // 1. Initial Setup
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    // 2. Elevate user to admin
    await elevateUserToAdmin(testAccount.email);
    
    // Refresh session to get bits
    await chatPage.logout();
    await page.waitForSelector('#email', { timeout: 10_000 });
    await page.waitForTimeout(2000); // Give backend time
    await page.reload();
    
    // 3. Login as elevated user
    await loginPage.login(testAccount.email, testAccount.password, SERVER_URL);
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 20_000 });

    // 4. Server Creation
    const createServerTitle = 'E2E Test Server';
    await expect(chatPage.createServerButton).toBeVisible({ timeout: 15_000 });
    await chatPage.createServerButton.click();
    await page.locator('input[placeholder="Server Name"]').fill(createServerTitle);
    await page.getByRole('button', { name: 'Create Server' }).click();

    // Verify "E2" icon appears
    const serverIcon = page.getByText('E2').first();
    await expect(serverIcon).toBeVisible({ timeout: 15_000 });
    await serverIcon.click();

    try {
        await profilePage.freshStartButton.waitFor({ state: 'visible', timeout: 5000 });
        await profilePage.freshStartButton.click();
        await page.getByTestId('fresh-nickname').waitFor({ state: 'visible' });
        await page.getByTestId('fresh-nickname').fill('ServerCreator');
        await page.getByRole('button', { name: 'Join Server' }).click();
    } catch (_e) {
        console.log("Fresh Start button did not appear, already joined.");
    }

    await expect(page.getByText('general', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Channel Creation
    await settingsPage.open();
    await settingsPage.createChannel('e2e-random');
    await settingsPage.close();
    await expect(page.getByText('e2e-random', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 6. Rename Channel
    await settingsPage.open();
    await settingsPage.renameChannel('e2e-random', 'e2e-renamed');
    await settingsPage.close();
    await expect(page.getByText('e2e-renamed', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 7. Delete Channel
    await settingsPage.open();
    await settingsPage.deleteChannel('e2e-renamed');
    await settingsPage.close();
    await expect(page.getByText('e2e-renamed', { exact: true })).not.toBeVisible({ timeout: 10_000 });
  });

  // TODO: Blocked by a client-side Zustand state bug where \`currentUserPermissions\`
  // remains 0 on newly created servers, preventing the Settings modal from showing the Roles tab.
  test.skip('should create a Mod role and verify permission to delete others messages', async ({ browser, loginPage, profilePage, chatPage, settingsPage, testAccount, page }) => {
    // 1. Mod Setup
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    await elevateUserToAdmin(testAccount.email);
    await chatPage.logout();
    await page.waitForSelector('#email', { timeout: 10_000 });
    await page.reload();
    await loginPage.login(testAccount.email, testAccount.password, SERVER_URL);
    await expect(page.getByText('general', { exact: true })).toBeVisible({ timeout: 20_000 });

    // 2. Victim Setup
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const victimAccount = { email: `victim_${testAccount.email}`, password: testAccount.password, nickname: 'VictimUser' };
    
    await otherPage.goto('/');
    const otherUrlInput = otherPage.locator('#initialServerUrl');
    await otherUrlInput.waitFor({ state: 'visible' });
    await otherUrlInput.fill(SERVER_URL);
    
    // We can interact directly for the victim instead of injecting full POM
    await otherPage.getByText('Register').click();
    await otherPage.waitForSelector('#confirmPassword', { timeout: 5000 });
    await otherPage.locator('#email').fill(victimAccount.email);
    await otherPage.locator('#password').fill(victimAccount.password);
    await otherPage.locator('#confirmPassword').fill(victimAccount.password);
    await otherPage.getByRole('button', { name: 'Signup' }).click();

    await expect(otherPage.getByRole('heading', { name: 'Join Server' })).toBeVisible({ timeout: 15_000 });
    await otherPage.getByRole('button', { name: 'Fresh Start' }).click();
    await otherPage.waitForTimeout(300);
    await otherPage.locator('form input[type="text"]').fill(victimAccount.nickname);
    await otherPage.locator('form button[type="submit"]').click();
    
    await expect(otherPage.getByText('general', { exact: true })).toBeVisible({ timeout: 15_000 });

    // 3. Mod user creates role and assigns it to member
    await settingsPage.open();
    await settingsPage.createRole('ModRole');
    await settingsPage.enableRolePermission('ModRole', 'perm-manage-messages');
    await settingsPage.assignRoleToMember('ModRole', victimAccount.nickname);
    await settingsPage.close();

    // 4. Mod User sends a message
    const msgText = `Hello from Mod Creator ${testAccount.nickname}`;
    await chatPage.sendMessage(msgText);
    await chatPage.verifyMessageVisible(msgText);

    // 5. Victim (now with ModRole) deletes it
    await expect(otherPage.getByText(msgText)).toBeVisible({ timeout: 10_000 });
    const msgContainer = otherPage.locator('.message-container').filter({ hasText: msgText });
    await msgContainer.hover();
    const deleteBtn = msgContainer.locator('[data-testid="delete-message"]');
    await expect(deleteBtn).toBeVisible();
    
    otherPage.once('dialog', dialog => dialog.accept());
    await deleteBtn.click();

    // 6. Verification
    await expect(otherPage.getByText(msgText)).not.toBeVisible({ timeout: 10_000 });
    await chatPage.verifyMessageNotVisible(msgText);

    await otherContext.close();
  });
});
