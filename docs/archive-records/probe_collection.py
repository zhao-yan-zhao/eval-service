# -*- coding: utf-8 -*-
"""探针：自定义采集页拨片开关的 DOM 类链"""
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8086/?v=wo158#/main"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(6000)
    page.locator("text=进入模块").first.click()
    page.wait_for_timeout(6000)
    page.locator(".hud-action-btn:has-text('加载想定')").first.click()
    page.wait_for_timeout(12000)
    page.locator(".el-dropdown:has-text('设置')").first.click()
    page.wait_for_timeout(1200)
    page.locator(".dropdown-item-mock:has-text('显示设置')").first.click()
    page.wait_for_timeout(2500)
    page.locator(".el-tabs__item:has-text('自定义采集')").first.click()
    page.wait_for_timeout(1500)
    info = page.evaluate("""() => {
        const labels = [...document.querySelectorAll('*')].filter(e=>e.offsetParent && (e.innerText||'').trim()==='事件');
        const out = [];
        for (const el of labels) {
            let chain = [];
            let cur = el;
            for (let i=0; i<7 && cur; i++) { chain.push(cur.tagName + '.' + (cur.className||'').toString().split(' ').slice(0,3).join('.')); cur = cur.parentElement; }
            out.push(chain.join(' < '));
        }
        // 检查页签容器布局
        const nav = document.querySelector('.el-tabs__nav');
        const navStyle = nav ? getComputedStyle(nav) : null;
        const firstTab = document.querySelector('.el-tabs__item');
        const tabStyle = firstTab ? getComputedStyle(firstTab) : null;
        // 检查 switch 全局数量（含不可见）
        return {chains: out.slice(0,3),
                navDisplay: navStyle && navStyle.display, navWidth: navStyle && navStyle.width,
                tabFlex: tabStyle && tabStyle.flex, tabWidth: tabStyle && tabStyle.width, tabTextAlign: tabStyle && tabStyle.textAlign,
                allSwitchCount: document.querySelectorAll('.el-switch').length};
    }""")
    print(json.dumps(info, ensure_ascii=False, indent=2))
    browser.close()
print("DONE")
