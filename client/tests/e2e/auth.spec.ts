import { test, expect, SERVER_URL } from './fixtures/harmony';

test.describe.serial('Authentication & Profile Flows', () => {
  test('should display the login page on first load', async ({ loginPage, page }) => {
    // loginPage fixture automatically goes to / and clears state.
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

  test('should toggle between Login and Signup modes', async ({ loginPage, page }) => {
    await expect(page.getByText('Welcome back!')).toBeVisible();

    await loginPage.switchMode('signup');
    await expect(page.getByText('Create an Account')).toBeVisible();
    await expect(loginPage.confirmPasswordInput).toBeVisible();

    await loginPage.switchMode('login');
    await expect(page.getByText('Welcome back!')).toBeVisible();
    await expect(loginPage.confirmPasswordInput).not.toBeVisible();
  });

  test('should show password mismatch error on signup', async ({ loginPage }) => {
    await loginPage.signup('mismatch@e2e.local', 'password123', SERVER_URL, 'password456');
    await loginPage.assertPasswordMismatchVisible();
  });

  test('should show an error on invalid login credentials', async ({ loginPage }) => {
    await loginPage.login('nonexistent@fake.com', 'wrongpassword', SERVER_URL);
    await loginPage.assertErrorMessageVisible();
  });

  test('should login as a guest', async ({ loginPage, page }) => {
    await loginPage.loginAsGuest(SERVER_URL);
    await expect(page.getByText('guest account', { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  test('should signup a new account and leave the login page', async ({ loginPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await expect(page.getByText('Welcome back!')).not.toBeVisible({ timeout: 15_000 });
  });

  test('should show ClaimProfile / Join Server screen after signup', async ({ loginPage, profilePage, testAccount }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    
    await profilePage.waitForJoinScreen();
    await expect(profilePage.freshStartButton).toBeVisible();
    await expect(profilePage.claimExistingButton).toBeVisible();
  });

  test('should create a profile via Fresh Start and enter the server', async ({ loginPage, profilePage, chatPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);

    await chatPage.waitForLoad();
    await chatPage.verifyChannelActive('general');
  });

  test('guest should see Fresh Start by default on ClaimProfile', async ({ loginPage, profilePage, page }) => {
    await loginPage.loginAsGuest(SERVER_URL);
    await expect(page.getByText('guest account', { exact: false })).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(2000);
    const joinVisible = await profilePage.joinServerHeading.isVisible();

    if (joinVisible) {
      await expect(profilePage.claimExistingButton).not.toBeVisible();
      await expect(profilePage.freshStartButton).toBeVisible();
    }
  });

  test('should logout and return to the login page', async ({ loginPage, profilePage, chatPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);

    await chatPage.waitForLoad();
    await chatPage.logout();

    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10_000 });
  });
});
