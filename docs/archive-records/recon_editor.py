# -*- coding: utf-8 -*-
"""侦察：打开想定编辑器， dump 可见按钮文本，找各弹窗入口"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8086/?v=wo158#/main"
OUT = r"D:\soft\F1-AI\验收截图\WO-158~161"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(8000)
    page.screenshot(path=OUT + r"\00-editor-main.png")
    # dump 可见的可点击元素文本
    items = page.evaluate(
        """() => {
        const els = [...document.querySelectorAll('button, .el-button, [class*="btn"], [class*="menu"] li, [class*="tool"] *')];
        const seen = new Set(); const out = [];
        for (const el of els) {
            const t = (el.innerText || '').trim();
            const r = el.getBoundingClientRect();
            if (!t || t.length > 20 || r.width === 0 || r.height === 0) continue;
            if (r.top < 0 || r.left < 0 || r.top > innerHeight || r.left > innerWidth) continue;
            const key = t + '|' + Math.round(r.left) + '|' + Math.round(r.top);
            if (seen.has(key)) continue; seen.add(key);
            out.push({t, x: Math.round(r.left), y: Math.round(r.top), cls: (el.className||'').toString().slice(0,60)});
        }
        return out.slice(0, 200);
    }"""
    )
    for it in items:
        print(f"[{it['x']},{it['y']}] {it['t']}  <{it['cls']}>")
    browser.close()
print("DONE")
