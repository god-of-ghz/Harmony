import { expect, type Locator, type Page } from '@playwright/test';

export class ChatPage {
  readonly page: Page;
  readonly messageInput: Locator;
  readonly serverConfigHeader: Locator;
  readonly logoutButton: Locator;
  readonly createServerButton: Locator;
  readonly attachmentButton: Locator;
  readonly imagePreview: Locator;
  readonly chatImage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.messageInput = page.locator('input[placeholder*="Message #"]');
    this.serverConfigHeader = page.getByText('Server Configuration');
    // Using testid for logout btn
    this.logoutButton = page.getByTestId('logout-btn');
    this.createServerButton = page.getByTestId('create-server-btn');
    // Attachment: label containing lucide-image
    this.attachmentButton = page.locator('label').filter({ has: page.locator('.lucide-image') });
    this.imagePreview = page.locator('img[alt="preview"]');
    this.chatImage = page.locator('img[alt="attachment"]');
  }

  async waitForLoad() {
    await expect(this.serverConfigHeader).toBeVisible({ timeout: 15_000 });
  }

  async verifyChannelActive(channelName: string) {
    // Exact match for sidebar
    await expect(this.page.getByText(channelName, { exact: true })).toBeVisible({ timeout: 10_000 });
    // Header for chat area
    await expect(this.page.getByText(`# ${channelName}`)).toBeVisible({ timeout: 10_000 });
  }

  async sendMessage(text: string) {
    await expect(this.messageInput).toBeVisible({ timeout: 10_000 });
    // Wait for WebSocket to be connected before sending
    await this.page.waitForSelector('[data-testid="ws-connected"]', { timeout: 15_000 });
    await this.messageInput.fill(text);
    await this.messageInput.press('Enter');
  }

  async verifyMessageVisible(text: string) {
    await expect(async () => {
      const count = await this.page.getByText(text).count();
      let visible = false;
      for (let i = 0; i < count; i++) {
        if (await this.page.getByText(text).nth(i).isVisible()) {
          visible = true;
          break;
        }
      }
      expect(visible).toBe(true);
    }).toPass({ timeout: 15_000 });
  }

  async verifyMessageNotVisible(text: string) {
    await expect(async () => {
      const count = await this.page.getByText(text).count();
      let visible = false;
      for (let i = 0; i < count; i++) {
        if (await this.page.getByText(text).nth(i).isVisible()) {
          visible = true;
          break;
        }
      }
      expect(visible).toBe(false);
    }).toPass({ timeout: 10_000 });
  }

  async logout() {
    await this.logoutButton.click();
  }

  async uploadAttachment(filePath: string, buffer: Buffer, mimeType: string) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.attachmentButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: filePath.split('/').pop() || 'test-file',
      mimeType,
      buffer,
    });
    await expect(this.imagePreview).toBeVisible({ timeout: 5_000 });
  }

  getMessageContainer(text: string) {
    return this.page.locator('.message-container').filter({ hasText: text });
  }

  async deleteMessage(text: string) {
    const msgContainerAll = this.getMessageContainer(text);
    // Find the first visible container (ignoring hidden virtuoso clones)
    await expect(async () => {
      const count = await msgContainerAll.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
    
    const count = await msgContainerAll.count();
    let visibleIndex = -1;
    for (let i = 0; i < count; i++) {
      if (await msgContainerAll.nth(i).isVisible()) {
        visibleIndex = i;
        break;
      }
    }
    
    if (visibleIndex === -1) throw new Error(`No visible message container found for: ${text}`);

    const msgContainer = msgContainerAll.nth(visibleIndex);
    await msgContainer.hover();
    const deleteBtn = msgContainer.locator('[data-testid="delete-message"]');
    await expect(deleteBtn).toBeVisible();

    this.page.once('dialog', dialog => dialog.accept());
    await deleteBtn.click();
  }
}
