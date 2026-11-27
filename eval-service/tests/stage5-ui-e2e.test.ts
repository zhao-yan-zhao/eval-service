import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createEvalApp } from '../src/server.ts';

function resolveEdgeExecutable(): string {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`未找到本地 Edge/Chrome 浏览器可执行文件，已检查: ${candidates.join(', ')}`);
}

test('Stage 5 & 6：全栈 UI 构建产物与六大工作台无头浏览器端到端交互验证', { timeout: 240_000 }, async () => {
  const distUiIndex = path.resolve(import.meta.dirname, '..', 'dist-ui', 'index.html');
  assert.equal(fs.existsSync(distUiIndex), true, 'dist-ui/index.html 必须先由 npm run build:ui 生成');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-e2e-'));
  const screenshotDir = process.env.E2E_SCREENSHOT_DIR
    ? path.resolve(process.env.E2E_SCREENSHOT_DIR)
    : '';
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    autoSeed: true,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const executablePath = resolveEdgeExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith(baseUrl)) {
        httpFailures.push(`${res.status()} ${res.url()}`);
      }
    });

    const snap = async (filename: string) => {
      if (!screenshotDir) return;
      await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
    };

    const assertNoHorizontalOverflow = async (label: string) => {
      const dims = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      assert.ok(
        dims.scrollWidth <= dims.innerWidth + 2,
        `[${label}] 检测到页面水平溢出: scrollWidth=${dims.scrollWidth} > innerWidth=${dims.innerWidth}`,
      );
    };

    const assertVisibleCanvasDrawn = async (panelSelector: string, label: string) => {
      const box = await page.locator(`${panelSelector} canvas`).first().boundingBox();
      assert.ok(box && box.width > 120 && box.height > 100, `[${label}] ECharts canvas 尺寸异常: ${JSON.stringify(box)}`);
    };

    // 1. 首屏加载新版 V4 Cockpit 评估总控台
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const cockpitSampleSelect = page.locator('#panel-cockpit').getByLabel('选择推演样本');
    await cockpitSampleSelect.waitFor({ state: 'visible', timeout: 15_000 });
    await cockpitSampleSelect.selectOption('gj11_pl15_bvr_real');
    await page.waitForSelector('#panel-cockpit canvas', { timeout: 30_000 });
    await page.locator('#panel-cockpit').getByText('已存评估：').waitFor({ state: 'visible', timeout: 30_000 });
    await assertNoHorizontalOverflow('1440-cockpit');
    await assertVisibleCanvasDrawn('#panel-cockpit', 'cockpit');

    // 验证「层次得分明细」展示客观指标徽标，并点击「明细表」一键联动跳转「体系指标明细」页签
    await page.locator('#panel-cockpit').getByText('客观指标').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#panel-cockpit').getByRole('button', { name: '明细表' }).first().click();
    await page.locator('#panel-cockpit').getByRole('button', { name: '导出 CSV' }).waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#panel-cockpit').getByRole('tab', { name: /层次得分明细/ }).click();

    // 验证右栏三视角切换（指标热力矩阵 / 短板四象限）
    await page.locator('#panel-cockpit').getByRole('button', { name: '指标热力矩阵' }).click();
    await page.waitForTimeout(150);
    await page.locator('#panel-cockpit').getByRole('button', { name: '短板四象限' }).click();
    await page.waitForTimeout(150);
    await page.locator('#panel-cockpit').getByRole('button', { name: '分维度对比' }).click();

    // 点击「多方案优选」并执行 TOPSIS + VIKOR 排序
    await page.locator('#panel-cockpit').getByRole('button', { name: '多方案优选' }).click();
    await page.locator('#panel-cockpit').getByRole('button', { name: /执行 TOPSIS \+ VIKOR 对比/ }).click();
    await page.locator('#panel-cockpit').getByText('Rank #1').first().waitFor({ state: 'visible', timeout: 60_000 });
    await snap('01-cockpit-desktop.png');

    // 切换物理证据溯源页签并测试原生 <dialog> 详情弹窗（若有证据项）
    await page.locator('#panel-cockpit').getByRole('tab', { name: /物理证据溯源/ }).click();
    const firstEvidenceBtn = page.locator('#panel-cockpit').getByRole('button', { name: '溯源详情' }).first();
    if (await firstEvidenceBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await firstEvidenceBtn.click();
      await page.waitForSelector('dialog[open]', { timeout: 5_000 });
      await page.locator('dialog[open]').getByRole('button', { name: '关闭弹窗' }).click();
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5_000 });
    }

    // 2. 算子工作台 (#tab-operators)：单一算子资产列表、4 大核心算法规范底座、列表操作一键跳转画布工坊
    await page.locator('#tab-operators').click();
    await page.waitForSelector('#panel-operators:not([hidden])', { timeout: 5_000 });
    await page.waitForSelector('#op-panel-catalog:not([hidden])', { timeout: 5_000 });
    await page.locator('#panel-operators').getByText('全部算子 · 42').first().waitFor({ state: 'visible', timeout: 5_000 });
    await assertNoHorizontalOverflow('1440-operators-catalog');
    await page.locator('#panel-operators th button', { hasText: '就绪门控' }).click();

    // 验证列表行按钮触发「详情弹窗」查看底层数据来源与字段映射
    await page.locator('#op-panel-catalog tbody tr').first().getByRole('button', { name: '详情' }).click();
    await page.waitForSelector('#op-panel-catalog dialog[open]', { timeout: 5_000 });
    await page.locator('#op-panel-catalog dialog[open]').getByText('底层数据来源与字段映射').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#op-panel-catalog dialog[open]').getByRole('button', { name: '关闭算子详情弹窗' }).click();
    await page.waitForSelector('#op-panel-catalog dialog[open]', { state: 'detached', timeout: 5_000 });

    // 验证从算子列表的「操作」列一键跳转进入画布工坊 (Canvas Studio)
    await page.locator('#op-panel-catalog tbody tr').first().getByRole('button', { name: '画布编排' }).click();
    await page.getByRole('button', { name: '返回算子列表' }).waitFor({ state: 'visible', timeout: 5_000 });
    await page.getByRole('button', { name: /全链路试运行/ }).click();
    await page.getByText('节点输出切片预览').waitFor({ state: 'visible', timeout: 10_000 });
    
    // 验证画布工坊顶部一键平滑「返回算子列表」
    await page.getByRole('button', { name: '返回算子列表' }).click();
    await page.waitForSelector('#op-panel-catalog:not([hidden])', { timeout: 5_000 });
    await snap('02-operators-desktop.png');

    // 3. 指标库 (#tab-indicators · V4 指标清单与聚焦画布)
    await page.locator('#tab-indicators').click();
    await page.waitForSelector('#panel-indicators:not([hidden])', { timeout: 5_000 });
    const firstMetricCanvasBtn = page.locator('#panel-indicators tbody tr').getByRole('button', { name: '画布编排' }).first();
    await firstMetricCanvasBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await assertNoHorizontalOverflow('1440-indicators');

    await firstMetricCanvasBtn.click();
    await page.locator('#panel-indicators').getByRole('button', { name: '返回指标列表' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#panel-indicators').getByRole('button', { name: '全貌' }).waitFor({ state: 'visible', timeout: 10_000 });
    await snap('03-indicators-desktop.png');
    await page.locator('#panel-indicators').getByRole('button', { name: '返回指标列表' }).click();
    await firstMetricCanvasBtn.waitFor({ state: 'visible', timeout: 5_000 });

    // 4. 评估体系 (#tab-systems · V4 体系列表、总览与画布)
    await page.locator('#tab-systems').click();
    await page.waitForSelector('#panel-systems:not([hidden])', { timeout: 5_000 });
    const firstSystemDetailBtn = page.locator('#panel-systems tbody tr').getByRole('button', { name: '查看详情' }).first();
    await firstSystemDetailBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await assertNoHorizontalOverflow('1440-systems');

    await firstSystemDetailBtn.click();
    await page.locator('#panel-systems table').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#panel-systems').getByRole('button', { name: '画布编排' }).click();
    await page.locator('#panel-systems').getByRole('button', { name: '全貌' }).waitFor({ state: 'visible', timeout: 10_000 });
    await snap('04-systems-desktop.png');

    // 5a-spec. 全局「仿真输出规范」独立一级入口 (#tab-catalog · 共 7 个一级 Tab)
    const topTabCount = await page.locator('nav[aria-label="评估中台主导航"] [role="tab"]').count();
    assert.equal(topTabCount, 7, '顶部主导航应包含 7 个独立一级入口');

    await page.locator('#tab-catalog').click();
    await page.waitForSelector('#panel-catalog:not([hidden])', { timeout: 5_000 });
    assert.equal(
      await page.locator('#tab-catalog').getAttribute('aria-selected'),
      'true',
      '应选中「仿真输出规范」独立一级入口',
    );
    assert.equal(
      await page.locator('#panel-catalog').getByLabel('选择要剖析的推演 Run').count(),
      0,
      '独立「仿真输出规范」入口不得绑定或显示具体 Run 下拉框',
    );

    // 验证全局 KPI（44 标准事件 / 333 业务字段 / 7 族 · 74 路径）及 3 张 ECharts 全局分布图渲染
    await page.locator('#panel-catalog').getByText('7 族 · 74 路径').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow('1440-catalog');
    const catalogCanvasCount = await page.locator('#panel-catalog canvas').count();
    assert.ok(catalogCanvasCount >= 3, `全局规范目录应渲染 3 张 ECharts 图表，实际=${catalogCanvasCount}`);
    await assertVisibleCanvasDrawn('#panel-catalog', 'catalog-charts');

    // 测试跨表/跨通道全局字段检索 ("WeaponID") 与算子反查 (weapon.platform_launch_status)，随后清除筛选
    const globalSearchInput = page.locator('#panel-catalog').getByLabel('全局检索仿真输出字段与路径');
    await globalSearchInput.fill('WeaponID');
    await page.locator('#panel-catalog').getByText('字段反查命中：').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#panel-catalog').getByText('weapon.platform_launch_status').first().waitFor({ state: 'visible', timeout: 5_000 });
    await snap('05c-catalog-desktop.png');
    await page.locator('#panel-catalog').getByRole('button', { name: /清除筛选/ }).click();

    // 5b-data. 单局数据与 eval.db (#tab-data)：默认进入「单局源文件剖析」，支持切换到「航迹、事件与 eval.db」
    await page.locator('#tab-data').click();
    await page.waitForSelector('#panel-data:not([hidden])', { timeout: 5_000 });
    await page.waitForSelector('#data-panel-sources:not([hidden])', { timeout: 5_000 });
    assert.equal(
      await page.locator('#data-subtab-sources').getAttribute('aria-selected'),
      'true',
      '单局数据入口默认应选中「单局源文件剖析」子标签',
    );
    const runSelect = page.locator('#panel-data').getByLabel('选择要剖析的推演 Run');

    await runSelect.selectOption('gj11_pl15_bvr_real');
    await page.locator('#data-panel-sources').getByText('11 / 44 有数据').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow('1440-data-sources-csv');
    await assertVisibleCanvasDrawn('#data-panel-sources', 'data-sources-csv');
    const csvCatalogRows = await page.locator('#data-panel-sources tbody tr').count();
    assert.equal(csvCatalogRows, 44, 'CSV 来源对照表默认应展示 44 类标准导出事件');

    // 点击 WeaponFired 行的「预览」触发原始 CSV 前 50 行读取
    await page
      .locator('#data-panel-sources tbody tr', { hasText: 'WeaponFired' })
      .getByRole('button', { name: '预览' })
      .click();
    await page
      .locator('[aria-label="WeaponFired 原始数据预览"]')
      .getByText(/PL-15/)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    await snap('05a-data-sources-csv-desktop.png');

    // 5b) 切换 Run 到 BS JSONL 样本验证 7 族路径命中率与 Batch B 空缺
    await runSelect.selectOption('bs_sample_swarm_demo');
    await page.locator('#data-panel-sources').getByText('解析 6 帧 · 错误 0').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow('1440-data-sources-bs');
    await assertVisibleCanvasDrawn('#data-panel-sources', 'data-sources-bs');
    await page.locator('#data-panel-sources').getByText('0/6 (0%)').first().waitFor({ state: 'visible', timeout: 10_000 });
    await snap('05b-data-sources-bs-desktop.png');

    // 切回 GJ11 样本并测试键盘切换 / 点击 Sub-tab B 验证航迹与 eval.db 原有资产
    await runSelect.selectOption('gj11_pl15_bvr_real');
    await page.locator('#data-subtab-sqlite').click();
    assert.equal(await page.locator('#data-subtab-sqlite').getAttribute('aria-selected'), 'true');
    await page.waitForSelector('#data-panel-sqlite:not([hidden])', { timeout: 5_000 });
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow('1440-data-sqlite');
    await assertVisibleCanvasDrawn('#data-panel-sqlite', 'data-track');
    await page.locator('#data-panel-sqlite').getByText('D1:').first().waitFor({ state: 'visible', timeout: 10_000 });
    const eventRows = await page.locator('#data-panel-sqlite tbody tr').count();
    assert.ok(eventRows > 0, 'DataExplorer simulation_events 表格行数应 > 0');
    await snap('05-data-desktop.png');

    // 6. 实时伴随监视 Q-109 (#tab-realtime)
    await page.locator('#tab-realtime').click();
    await page.waitForSelector('#panel-realtime:not([hidden])', { timeout: 5_000 });
    await assertNoHorizontalOverflow('1440-realtime');

    await page.locator('#panel-realtime').getByRole('button', { name: '创建/重置实时流' }).click();
    await page.locator('#panel-realtime').getByText('实时单元健康态').first().waitFor({ state: 'visible', timeout: 10_000 });

    // 注入两次战损异常帧 -> 触发 Q-109 告警卡片 + 第 2 次进入 5 分钟防骚扰冷却抑制计数增长
    const injectBtn = page.locator('#panel-realtime').getByRole('button', { name: /注入战损异常帧/ });
    await injectBtn.click();
    await page.locator('#panel-realtime').getByRole('button', { name: /继续观察/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
    const suppressedEl = page.locator('[data-testid="rt-suppressed-count"]');
    const beforeSuppressed = Number.parseInt((await suppressedEl.innerText()).replace(/\D+/g, '') || '0', 10);

    await injectBtn.click();
    await page.waitForFunction(
      (prevCount: number) => {
        const txt = document.querySelector('[data-testid="rt-suppressed-count"]')?.textContent ?? '';
        const n = Number.parseInt(txt.replace(/\D+/g, '') || '0', 10);
        return n > prevCount;
      },
      beforeSuppressed,
      { timeout: 10_000 },
    );

    // HITL 点击 继续观察 (observe)
    await page.locator('#panel-realtime').getByRole('button', { name: /继续观察/ }).first().click();
    await page.locator('#panel-realtime').getByText('已人工处置：observe').first().waitFor({ state: 'visible', timeout: 10_000 });
    await snap('06-realtime-desktop.png');

    // 7. 窄屏移动端响应式检测 (430x900)
    await page.setViewportSize({ width: 430, height: 900 });
    await page.locator('#tab-cockpit').click();
    await page.waitForSelector('#panel-cockpit:not([hidden])', { timeout: 15_000 });
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow('430-cockpit-mobile');
    await snap('07-cockpit-mobile.png');

    await page.locator('#tab-catalog').click();
    await page.waitForSelector('#panel-catalog:not([hidden])', { timeout: 15_000 });
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow('430-catalog-mobile');
    await snap('08c-catalog-mobile.png');

    await page.locator('#tab-data').click();
    await page.waitForSelector('#panel-data:not([hidden])', { timeout: 15_000 });
    await page.locator('#data-subtab-sources').click();
    await page.waitForSelector('#data-panel-sources:not([hidden])', { timeout: 15_000 });
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow('430-data-sources-mobile');
    await snap('08-data-sources-mobile.png');

    assert.equal(pageErrors.length, 0, `捕获未处理的 pageerror: ${pageErrors.join(' | ')}`);
    assert.equal(consoleErrors.length, 0, `捕获 console.error: ${consoleErrors.join(' | ')}`);
    assert.equal(httpFailures.length, 0, `存在失败的 HTTP 请求: ${httpFailures.join(' | ')}`);

    if (consoleWarnings.length > 0) {
      console.log('[E2E] console warnings observed:', consoleWarnings);
    }

    await context.close();
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
