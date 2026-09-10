import { test, expect } from '@playwright/test';

const sample = {
  name: 'sample.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/fcAAAAASUVORK5CYII=', 'base64'),
};

test('production build supports upload, demo results and reset without transmitting images', async ({ page }) => {
  const errors = [];
  const imageRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') imageRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#analyze-button')).toBeDisabled();
  await page.locator('#file-input').setInputFiles(sample);
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('sample.png');
  await page.locator('#analyze-button').click();
  await expect(page.locator('#result-state')).toHaveText('준비 중');
  await expect(page.locator('#result-state')).toHaveText('데모 완료');
  await expect(page.locator('#result-content')).toContainText('실제 판별 아님');
  await expect(page.locator('.decision-tag')).toHaveText('UNKNOWN');
  await expect(page.locator('.completed-result h3')).toHaveText('판별 불확실');
  await page.locator('#remove-file').click();
  await expect(page.locator('#preview')).toBeHidden();
  await expect(page.locator('#analyze-button')).toBeDisabled();
  expect(errors).toEqual([]);
  expect(imageRequests).toEqual([]);
});

test('invalid and oversized uploads are rejected', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.getByRole('alert')).toContainText('JPG, PNG 또는 WEBP');
  await page.locator('#file-input').setInputFiles({ ...sample, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('10MB 이하');
  await page.locator('#file-input').setInputFiles({ ...sample, buffer: Buffer.from('not a valid image') });
  await expect(page.getByRole('alert')).toContainText('이미지를 읽을 수 없습니다');
  await expect(page.locator('#analyze-button')).toBeDisabled();
});

for (const width of [320, 390, 768, 1440]) {
  test(`layout fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
