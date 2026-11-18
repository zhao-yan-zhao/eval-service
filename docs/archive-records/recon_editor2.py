# -*- coding: utf-8 -*-
"""侦察2：进入模块后 dump 编辑器内按钮"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8086/?v=wo158#/main"
OUT = r"D:\soft\F1-AI\验收截图\WO-158~161"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(6000)
    btn = page.locator("text=进入模块").first
    btn.click()
    page.wait_for_timeout(10000)
    page.screenshot(path=OUT + r"\01-editor-after-enter.png")
    items = page.evaluate(
        """() => {
        const els = [...document.querySelectorAll('body *')];
        const seen = new Set(); const out = [];
        for (const el of els) {
            const t = (el.innerText || '').trim();
            if (!t || t.length > 16 || el.children.length > 3) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.top < 0 || r.left < 0 || r.top > innerHeight || r.left > innerWidth) continue;
            const key = t + '|' + Math.round(r.left) + '|' + Math.round(r.top);
            if (seen.has(key)) continue; seen.add(key);
            out.push({t, x: Math.round(r.left), y: Math.round(r.top), cls: (el.className||'').toString().slice(0,70)});
        }
        return out.slice(0, 300);
    }"""
    )
    for it in items:
        print(f"[{it['x']},{it['y']}] {it['t']}  <{it['cls']}>")
    print("URL:", page.url)
    browser.close()
print("DONE")
