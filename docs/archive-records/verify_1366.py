# -*- coding: utf-8 -*-
"""WO-161 复核：1366x768 下弹窗不溢出"""
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8086/?v=wo158#/main"
OUT = r"D:\soft\F1-AI\验收截图\WO-158~161"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1366, "height": 768})
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(6000)
    page.locator("text=进入模块").first.click()
    page.wait_for_timeout(6000)
    page.locator(".hud-action-btn:has-text('加载想定')").first.click()
    page.wait_for_timeout(12000)

    def dlg_width():
        return page.evaluate("""() => {
            const ds = [...document.querySelectorAll('.el-dialog, [class*="custom-dialog"], [class*="hud-dialog"], [class*="dialog_wrap"], [class*="dialog-wrap"]')]
                .filter(e=>e.offsetParent).map(e=>Math.round(e.getBoundingClientRect().width));
            return {widths: ds, vw: innerWidth, overflow: ds.some(w=>w>innerWidth)};
        }""")

    # 任务列表
    page.locator(".hud-btn:has-text('任务编辑')").first.click()
    page.wait_for_timeout(2500)
    page.screenshot(path=OUT + r"\20-WO161-任务列表-1366.png")
    print("[tasklist@1366]", json.dumps(dlg_width(), ensure_ascii=False))
    page.evaluate("""() => { const b=[...document.querySelectorAll('.el-dialog__close, [class*="closeBtn"], [class*="close-btn"]')].find(e=>e.offsetParent); if(b) b.click(); }""")
    page.wait_for_timeout(600)

    # 显示控制
    page.locator(".el-dropdown:has-text('设置')").first.click()
    page.wait_for_timeout(1000)
    page.locator(".dropdown-item-mock:has-text('显示设置')").first.click()
    page.wait_for_timeout(2500)
    page.screenshot(path=OUT + r"\21-WO161-显示控制-1366.png")
    print("[display@1366]", json.dumps(dlg_width(), ensure_ascii=False))
    page.evaluate("""() => { const b=[...document.querySelectorAll('.el-dialog__close, [class*="closeBtn"], [class*="close-btn"]')].find(e=>e.offsetParent); if(b) b.click(); }""")
    page.wait_for_timeout(600)

    # 参考点管理
    page.locator(".hud-btn:has-text('参考点管理')").first.click()
    page.wait_for_timeout(2500)
    page.screenshot(path=OUT + r"\22-WO161-参考点管理-1366.png")
    print("[refpoint@1366]", json.dumps(dlg_width(), ensure_ascii=False))

    browser.close()
print("DONE")
