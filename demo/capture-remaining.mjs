import { chromium } from "playwright";
import { setTimeout } from "timers/promises";

const BASE = "http://localhost:5173";
const OUT = new URL(".", import.meta.url).pathname;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  // Wait for server
  for (let i = 0; i < 30; i++) {
    try { await page.goto(BASE, { timeout: 3000 }); break; }
    catch { console.log(`Waiting... (${i + 1})`); await setTimeout(2000); }
  }
  await setTimeout(2000);

  // Click existing session with rich content (Claude Code 4.6)
  const session46 = page.locator('[class*="cursor-pointer"]').filter({ hasText: "Claude Code 4.6" }).first();
  if (await session46.count() > 0) {
    await session46.click();
    await setTimeout(2000);
    await page.screenshot({ path: `${OUT}07-history-rich.png`, fullPage: true });
    console.log("✓ 07-history-rich.png");

    // Open file explorer
    const filesBtn = page.locator('button').filter({ hasText: /^檔案$|^Files$/ }).first();
    await filesBtn.click();
    await setTimeout(2000);
    await page.screenshot({ path: `${OUT}08-file-explorer.png` });
    console.log("✓ 08-file-explorer.png");
    await filesBtn.click();
    await setTimeout(500);
  }

  // Switch to EN
  await page.click('button:has-text("EN")');
  await setTimeout(1000);

  // New session in EN
  await page.click('button:has-text("New Session")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}09-en-cards.png` });
  console.log("✓ 09-en-cards.png");

  // Switch to JA
  await page.click('button:has-text("JA")');
  await setTimeout(500);
  await page.click('button:has-text("New Session")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}10-ja-cards.png` });
  console.log("✓ 10-ja-cards.png");

  // Back to TW, show settings
  await page.click('button:has-text("TW")');
  await setTimeout(500);
  const settingsBtn = page.locator('button:has-text("Settings")');
  if (await settingsBtn.count() > 0) {
    await settingsBtn.click();
    await setTimeout(1000);
    await page.screenshot({ path: `${OUT}11-settings.png` });
    console.log("✓ 11-settings.png");
  }

  await page.close();
  await context.close();
  await browser.close();
  console.log("\n✅ Remaining screenshots captured");
})();
