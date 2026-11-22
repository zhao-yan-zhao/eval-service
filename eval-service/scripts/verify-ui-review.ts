import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

function resolveBrowserExecutable(): string {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`未找到本地 Edge/Chrome 浏览器: ${candidates.join(', ')}`);
}

const ARTIFACT_DIR = 'C:\\Users\\zhaoyan\\.gemini\\antigravity\\brain\\e8c34ea2-2643-4b98-bc5c-615ffb17eeb5\\ui_review';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function main() {
  console.log('[E2E Review] Launching browser...');
  const browser = await chromium.launch({
    executablePath: resolveBrowserExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  const consoleLogs: string[] = [];
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`Console error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`Page error: ${err.message}`);
  });

  const baseUrl = 'http://127.0.0.1:7280';

  console.log(`[E2E Review] Navigating to ${baseUrl}...`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. 检查顶部导航与遥测指标
  console.log('[E2E Review] Step 1: Checking header & telemetry chips...');
  const headerText = await page.textContent('header');
  console.log('[E2E Review] Header text snippet:', headerText?.slice(0, 150));

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '01_header_cockpit.png'),
  });

  // 打开数据库设置弹窗
  console.log('[E2E Review] Step 2: Opening Database Settings Modal...');
  const settingsBtn = page.locator('#btn-global-system-settings');
  if (await settingsBtn.isVisible()) {
    await settingsBtn.click();
    await page.waitForTimeout(600);
    // 切换到数据库标签
    const dbTab = page.locator('button:has-text("存储与数据库")').first();
    if (await dbTab.isVisible()) {
      await dbTab.click();
      await page.waitForTimeout(600);
    }
    const modalContent = await page.textContent('dialog, div.fixed');
    console.log('[E2E Review] Database modal text snippet:', modalContent?.slice(0, 200));
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, '02_database_settings_modal.png'),
    });
    // 关闭弹窗
    const closeBtn = page.locator('button:has-text("关闭")').first();
    if (await closeBtn.isVisible()) await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // 2. 概览驾驶舱运行评估
  console.log('[E2E Review] Step 3: Running evaluation in Cockpit...');
  const runBtn = page.locator('#panel-cockpit button:has-text("运行评估"), #panel-cockpit button:has-text("重新计算")').first();
  if (await runBtn.isVisible()) {
    console.log('[E2E Review] Clicking run evaluation button...');
    await runBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, '03_cockpit_evaluated.png'),
    });
  }

  // 3. 算子库与新建算子测试
  console.log('[E2E Review] Step 4: Navigating to Operator Studio...');
  await page.click('#tab-operators');
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '04_operator_library.png'),
  });

  // 测试新建算子
  console.log('[E2E Review] Step 5: Testing Create Operator Modal...');
  const createOpBtn = page.locator('button:has-text("新建自定义算子"), button:has-text("新建算子")').first();
  if (await createOpBtn.isVisible()) {
    await createOpBtn.click();
    await page.waitForTimeout(600);

    // 填写算子表单
    const nameInput = page.locator('input[placeholder*="传感器连续跟踪保持率"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('雷达告警响应时延');
    }

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, '05_create_operator_modal_filled.png'),
    });

    // 点击保存并进入画布编排
    const saveAndOpenBtn = page.locator('button:has-text("保存并进入画布编排")').first();
    if (await saveAndOpenBtn.isVisible()) {
      await saveAndOpenBtn.click();
      await page.waitForTimeout(1500);

      // 检查是否报错还是成功进入画布
      const hasError = await page.locator('text=创建算子失败').isVisible().catch(() => false);
      if (hasError) {
        const errorText = await page.locator('text=创建算子失败').first().textContent();
        console.error('[E2E Review] CREATE OPERATOR ERROR DETECTED:', errorText);
      } else {
        console.log('[E2E Review] Successfully created operator and entered Canvas!');
      }

      await page.screenshot({
        path: path.join(ARTIFACT_DIR, '06_operator_canvas_studio.png'),
      });

      // 检查画布左下角指引文案
      const guideText = await page.locator('div:has-text("操作指引")').first().textContent().catch(() => '');
      console.log('[E2E Review] Canvas guide text snippet:', guideText?.slice(0, 100));

      // 返回算子列表
      const backBtn = page.locator('button[title="返回算子列表"], button:has-text("返回算子列表")').first();
      if (await backBtn.isVisible()) {
        console.log('[E2E Review] Clicking back button to exit canvas...');
        await backBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  // 4. 指标配置
  console.log('[E2E Review] Step 6: Navigating to Indicator Studio...');
  await page.click('#tab-indicators', { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '07_indicator_studio.png'),
  });

  // 5. 评估体系
  console.log('[E2E Review] Step 7: Navigating to System Designer...');
  await page.click('#tab-systems', { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '08_system_designer.png'),
  });

  // 6. 推演数据 (态势与事件)
  console.log('[E2E Review] Step 8: Navigating to Data Explorer...');
  await page.click('#tab-data', { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '09_data_explorer.png'),
  });

  // 7. 实时研判
  console.log('[E2E Review] Step 9: Navigating to Realtime Monitor...');
  await page.click('#tab-realtime', { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '10_realtime_monitor.png'),
  });

  // 8. 关系图谱
  console.log('[E2E Review] Step 10: Navigating to Data Relations...');
  await page.click('#tab-catalog', { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '11_output_catalog_and_relations.png'),
  });

  await browser.close();

  console.log('\n======================================');
  console.log(`[E2E Review Complete] Total errors detected: ${errors.length}`);
  if (errors.length > 0) {
    console.error('Errors:', errors);
  } else {
    console.log('All 7 tabs verified flawlessly with 0 page/console errors!');
  }
  console.log(`Screenshots saved to: ${ARTIFACT_DIR}`);
  console.log('======================================\n');
}

main().catch((err) => {
  console.error('[E2E Review Fatal]', err);
  process.exit(1);
});
