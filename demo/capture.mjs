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

  // Wait for Vite to be ready (retry)
  for (let i = 0; i < 20; i++) {
    try {
      await page.goto(BASE, { timeout: 5000 });
      break;
    } catch {
      console.log(`Waiting for server... (${i + 1})`);
      await setTimeout(2000);
    }
  }
  // 1. Welcome screen
  await setTimeout(2000);
  await page.screenshot({ path: `${OUT}01-welcome.png` });
  console.log("✓ 01-welcome.png");

  // 2. Create new session → Empty chat with pipeline cards
  await page.click('button:has-text("開始新 Session")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}02-pipeline-cards.png` });
  console.log("✓ 02-pipeline-cards.png");

  // 3. Click 指定主題 → input fill + hint
  await page.click('button:has-text("指定主題發文")');
  await setTimeout(1000);
  await page.screenshot({ path: `${OUT}03-custom-topic-fill.png` });
  console.log("✓ 03-custom-topic-fill.png");

  // 4. Type topic and send
  const textarea = page.locator("textarea");
  await textarea.fill("AI Agent 自動化工作流 2026 最新趨勢");
  await setTimeout(500);
  await page.screenshot({ path: `${OUT}04-topic-typed.png` });
  console.log("✓ 04-topic-typed.png");

  await textarea.press("Enter");
  await setTimeout(3000);
  await page.screenshot({ path: `${OUT}05-loading-state.png` });
  console.log("✓ 05-loading-state.png");

  // 5. Wait for response with tool calls
  await setTimeout(15000);
  await page.screenshot({ path: `${OUT}06-tool-calls.png` });
  console.log("✓ 06-tool-calls.png");

  // 6. Wait more for full response
  await setTimeout(30000);
  await page.screenshot({ path: `${OUT}07-response.png`, fullPage: true });
  console.log("✓ 07-response.png");

  // 7. Open file explorer
  const filesBtn = page.locator('button:has-text("Files"), button:has-text("檔案")').first();
  await filesBtn.click();
  await setTimeout(2000);
  await page.screenshot({ path: `${OUT}08-file-explorer.png` });
  console.log("✓ 08-file-explorer.png");
  await filesBtn.click(); // close

  // 8. Switch language to EN
  await page.click('button:has-text("EN")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}09-english-mode.png` });
  console.log("✓ 09-english-mode.png");

  // 9. Create new session in EN to show EN cards
  await page.click('button:has-text("New Session")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}10-en-pipeline-cards.png` });
  console.log("✓ 10-en-pipeline-cards.png");

  // 10. Switch to JA
  await page.click('button:has-text("JA")');
  await setTimeout(500);
  await page.click('button:has-text("New Session")');
  await setTimeout(1500);
  await page.screenshot({ path: `${OUT}11-ja-pipeline-cards.png` });
  console.log("✓ 11-ja-pipeline-cards.png");

  // Switch back to TW
  await page.click('button:has-text("TW")');
  await setTimeout(500);

  // 12. Click existing session with history to show rich content
  const sessionItem = page.locator('[class*="cursor-pointer"]').filter({ hasText: "Claude Code 4.6" }).first();
  if (await sessionItem.count() > 0) {
    await sessionItem.click();
    await setTimeout(2000);
    await page.screenshot({ path: `${OUT}12-history-rich-content.png`, fullPage: true });
    console.log("✓ 12-history-rich-content.png");
  }

  // Done
  await page.close();
  await context.close();
  await browser.close();
  console.log("\n✅ All screenshots captured in demo/");
})();
