import { expect, type Locator, type Page } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly settingsGear: Locator;
  readonly newChannelNameInput: Locator;
  readonly addChannelButton: Locator;
  readonly renameChannelInput: Locator;
  readonly rolesTab: Locator;
  readonly membersTab: Locator;
  readonly newRoleInput: Locator;
  readonly createRoleButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.settingsGear = page.locator('[data-testid="settings-gear"]');
    this.newChannelNameInput = page.locator('[data-testid="new-channel-name"]');
    this.addChannelButton = page.locator('[data-testid="add-channel-btn"]');
    this.renameChannelInput = page.getByTestId('rename-channel-input');
    this.rolesTab = page.getByText('Roles');
    this.membersTab = page.getByText('Members', { exact: true });
    this.newRoleInput = page.locator('input[placeholder="New role..."]');
    this.createRoleButton = page.locator('[data-testid="create-role-btn"]');
  }

  async open() {
    await this.settingsGear.waitFor({ state: 'visible', timeout: 10_000 });
    
    // Poll the Zustand store until permissions are populated to avoid modal race condition
    await this.page.waitForFunction(() => {
      const store = (window as any).useAppStore;
      if (!store) return true; // Fallback if store isn't exposed
      return store.getState().currentUserPermissions !== 0;
    }, { timeout: 5_000 }).catch(() => console.log('Store permission check timed out, proceeding anyway.'));

    await this.settingsGear.click();
    // Wait for Hierarchy tab — permissions may take a render cycle to propagate.
    // If the modal opened before permissions were set, close and retry once.
    const hierarchyTab = this.page.getByText('Hierarchy');
    try {
      await hierarchyTab.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      // Permissions weren't ready — close modal and retry
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1000);
      await this.settingsGear.click();
      await hierarchyTab.waitFor({ state: 'visible', timeout: 10_000 });
    }
    await hierarchyTab.click();
  }

  async close() {
    await this.page.keyboard.press('Escape');
  }

  async createChannel(name: string) {
    await this.newChannelNameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await this.newChannelNameInput.fill(name);
    await this.addChannelButton.click();
    await expect(this.page.locator(`[data-testid="channel-name-${name}"]`)).toBeVisible({ timeout: 10_000 });
  }

  async renameChannel(oldName: string, newName: string) {
    const renameBtn = this.page.locator(`[data-testid="rename-channel-${oldName}"]`);
    await renameBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await renameBtn.click();
    await expect(this.renameChannelInput).toBeVisible({ timeout: 10_000 });
    await this.renameChannelInput.fill(newName);
    await this.renameChannelInput.press('Enter');
    await expect(this.page.locator(`[data-testid="channel-name-${newName}"]`)).toBeVisible({ timeout: 10_000 });
  }

  async deleteChannel(name: string) {
    const deleteBtn = this.page.locator(`[data-testid="delete-channel-${name}"]`);
    await deleteBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await deleteBtn.click();
    await expect(this.page.locator(`[data-testid="channel-name-${name}"]`)).not.toBeVisible({ timeout: 10_000 });
  }

  async createRole(roleName: string) {
    await this.rolesTab.click();
    await this.newRoleInput.fill(roleName);
    await this.createRoleButton.click();
  }

  async enableRolePermission(roleName: string, permissionTestId: string) {
    await this.page.getByText(roleName, { exact: true }).click();
    const checkbox = this.page.getByTestId(permissionTestId);
    await checkbox.check();
  }

  async assignRoleToMember(roleName: string, memberName: string) {
    await this.membersTab.click();
    const memberRow = this.page.locator('div').filter({ hasText: memberName }).first();
    await memberRow.getByText(roleName).click();
  }
}
