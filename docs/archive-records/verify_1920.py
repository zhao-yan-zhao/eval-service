# -*- coding: utf-8 -*-
"""WO-158~161 运行时验收主脚本：1920x1080"""
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8086/?v=wo158#/main"
OUT = r"D:\soft\F1-AI\验收截图\WO-158~161"
R = {}

def shot(page, name):
    page.screenshot(path=f"{OUT}\\{name}.png")
    print(f"[shot] {name}.png")

def vis(page, sel):
    return page.locator(sel).first.is_visible()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(6000)
    page.locator("text=进入模块").first.click()
    page.wait_for_timeout(6000)
    page.locator(".hud-action-btn:has-text('加载想定')").first.click()
    page.wait_for_timeout(12000)

    # ---------- 1. 消息日志 (WO-158) ----------
    try:
        page.locator(".hud-btn:has-text('消息日志')").first.click()
        page.wait_for_timeout(3000)
        shot(page, "10-WO158-消息日志")
        info = page.evaluate("""() => {
            const dlg = [...document.querySelectorAll('*')].find(e => (e.className||'').toString().includes('custom-dialog') && e.offsetParent);
            if (!dlg) return {found:false};
            const cs = getComputedStyle(dlg);
            const item = dlg.querySelector('.tab_menu_item');
            const ics = item ? getComputedStyle(item) : null;
            return {found:true, fontSize: cs.fontSize,
                    itemFont: ics && ics.fontSize, itemHeight: ics && ics.height,
                    w: Math.round(dlg.getBoundingClientRect().width)};
        }""")
        R['msglog'] = info
        print("[msglog]", json.dumps(info, ensure_ascii=False))
        page.keyboard.press("Escape")
        # 用关闭按钮
        page.evaluate("""() => { const b=[...document.querySelectorAll('*')].find(e=>(e.className||'').toString().includes('custom-dialog')&&e.offsetParent); if(b){const c=b.querySelector('[class*="close"]'); if(c) c.click();} }""")
        page.wait_for_timeout(800)
    except Exception as e:
        print("[msglog][ERR]", e)

    # ---------- 2. 任务列表 (WO-158 tab选中态 / WO-161 宽度) ----------
    try:
        page.locator(".hud-btn:has-text('任务编辑')").first.click()
        page.wait_for_timeout(3000)
        shot(page, "11-WO158+161-任务列表")
        info = page.evaluate("""() => {
            const tabs = [...document.querySelectorAll('.el-tabs__item')].filter(e=>e.offsetParent);
            const act = tabs.find(e=>e.className.includes('is-active'));
            const dlg = act ? act.closest('[class*="dialog"], [class*="Dialog"]') : null;
            const dw = dlg ? Math.round(dlg.getBoundingClientRect().width) : null;
            if (!act) return {found:false, tabCount: tabs.length};
            const cs = getComputedStyle(act);
            return {found:true, tabCount: tabs.length, activeText: act.innerText.trim(),
                    bg: cs.backgroundColor, boxShadow: cs.boxShadow, textShadow: cs.textShadow,
                    color: cs.color, dialogWidth: dw, vw: innerWidth};
        }""")
        R['tasklist'] = info
        print("[tasklist]", json.dumps(info, ensure_ascii=False))
        page.evaluate("""() => { const b=[...document.querySelectorAll('.el-dialog__close, [class*="closeBtn"], [class*="close-btn"]')].find(e=>e.offsetParent); if(b) b.click(); }""")
        page.wait_for_timeout(800)
    except Exception as e:
        print("[tasklist][ERR]", e)

    # ---------- 3. 显示控制 (WO-160) ----------
    try:
        page.locator(".el-dropdown:has-text('设置')").first.click()
        page.wait_for_timeout(1200)
        page.locator(".dropdown-item-mock:has-text('显示设置')").first.click()
        page.wait_for_timeout(3000)
        shot(page, "12-WO160-显示控制-默认页")
        info = page.evaluate("""() => {
            const switches = [...document.querySelectorAll('.el-switch')].filter(e=>e.offsetParent).length;
            const checkboxes = [...document.querySelectorAll('.el-checkbox')].filter(e=>e.offsetParent).length;
            const tabs = [...document.querySelectorAll('.el-tabs__item')].filter(e=>e.offsetParent);
            const wrap = tabs.length ? tabs[0].closest('.el-tabs__nav') : null;
            const widths = tabs.map(t=>Math.round(t.getBoundingClientRect().width));
            const navW = wrap ? Math.round(wrap.getBoundingClientRect().width) : null;
            const act = tabs.find(e=>e.className.includes('is-active'));
            const cs = act ? getComputedStyle(act) : null;
            return {switches, checkboxes, tabCount: tabs.length, tabWidths: widths, navWidth: navW,
                    tabTexts: tabs.map(t=>t.innerText.trim()),
                    activeBg: cs && cs.backgroundColor, activeShadow: cs && cs.boxShadow};
        }""")
        R['displaycontrol'] = info
        print("[displaycontrol]", json.dumps(info, ensure_ascii=False))
        # 逐页签点击并找「自定义采集」截图
        for t in info.get('tabTexts', []):
            if '采集' in t or '自定义' in t:
                page.locator(f".el-tabs__item:has-text('{t}')").first.click()
                page.wait_for_timeout(1200)
                shot(page, "13-WO160-显示控制-自定义采集")
        page.evaluate("""() => { const b=[...document.querySelectorAll('.el-dialog__close, [class*="closeBtn"], [class*="close-btn"]')].find(e=>e.offsetParent); if(b) b.click(); }""")
        page.wait_for_timeout(800)
    except Exception as e:
        print("[displaycontrol][ERR]", e)

    # ---------- 4. 添加兵力 (WO-159)：右键菜单 ----------
    try:
        page.mouse.click(960, 540, button="right")
        page.wait_for_timeout(1500)
        menu = page.locator("li:has-text('添加兵力'), .menu-item:has-text('添加兵力')").first
        if menu.is_visible():
            menu.click()
        else:
            page.locator("text=添加兵力").first.click()
        page.wait_for_timeout(4000)
        shot(page, "14-WO159-添加兵力-默认右栏隐藏")
        info = page.evaluate("""() => {
            const dp = document.querySelector('.detail-panel');
            const lp = document.querySelector('.library-panel');
            if (!dp || !lp) return {found:false};
            const dr = dp.getBoundingClientRect(), lr = lp.getBoundingClientRect();
            return {found:true, detailWidth: Math.round(dr.width), detailHidden: dp.className.includes('is-hidden'),
                    libraryWidth: Math.round(lr.width), libraryFull: lp.className.includes('full-width'),
                    detailVisible: !!dp.querySelector('.detail-header')};
        }""")
        R['addunit_default'] = info
        print("[addunit-default]", json.dumps(info, ensure_ascii=False))
        # 点第一行「查看」
        view_btn = page.locator(".cus_table button:has-text('查看'), .library-panel button:has-text('查看')").first
        if view_btn.is_visible():
            view_btn.click()
            page.wait_for_timeout(2000)
            shot(page, "15-WO159-添加兵力-右栏展开")
            info2 = page.evaluate("""() => {
                const dp = document.querySelector('.detail-panel');
                const lp = document.querySelector('.library-panel');
                const dr = dp.getBoundingClientRect(), lr = lp.getBoundingClientRect();
                return {detailWidth: Math.round(dr.width), libraryWidth: Math.round(lr.width),
                        bottomAlign: Math.abs(dr.bottom - lr.bottom) < 24,
                        detailBottom: Math.round(dr.bottom), libraryBottom: Math.round(lr.bottom)};
            }""")
            R['addunit_open'] = info2
            print("[addunit-open]", json.dumps(info2, ensure_ascii=False))
            # 关闭详情
            close_d = page.locator("button:has-text('关闭详情'), .detail-header *:has-text('关闭')").first
            if close_d.is_visible():
                close_d.click()
                page.wait_for_timeout(1500)
                shot(page, "16-WO159-添加兵力-右栏再收起")
                info3 = page.evaluate("""() => {
                    const dp = document.querySelector('.detail-panel');
                    return {detailWidth: Math.round(dp.getBoundingClientRect().width),
                            detailHidden: dp.className.includes('is-hidden')};
                }""")
                R['addunit_close'] = info3
                print("[addunit-close]", json.dumps(info3, ensure_ascii=False))
        page.evaluate("""() => { const b=[...document.querySelectorAll('.el-dialog__close, [class*="closeBtn"], [class*="close-btn"]')].find(e=>e.offsetParent); if(b) b.click(); }""")
        page.wait_for_timeout(800)
    except Exception as e:
        print("[addunit][ERR]", e)

    # ---------- 5. 参考点管理 (WO-161) ----------
    try:
        page.locator(".hud-btn:has-text('参考点管理')").first.click()
        page.wait_for_timeout(3500)
        shot(page, "17-WO161-参考点管理")
        info = page.evaluate("""() => {
            const label = [...document.querySelectorAll('.toolbar-label')].find(e=>e.offsetParent);
            const rightPanel = [...document.querySelectorAll('.panel-title')].find(e=>e.innerText.includes('编辑参考点'));
            const leftPanel = document.querySelector('.left-panel');
            const dlg = [...document.querySelectorAll('*')].find(e=>{const t=e.querySelector&&e.querySelector('.panel-title'); return (e.className||'').toString().includes('main-split')===false && false;});
            return {labelText: label && label.innerText.trim(),
                    labelColor: label && getComputedStyle(label).color,
                    rightPanelExists: !!rightPanel,
                    leftWidth: leftPanel && Math.round(leftPanel.getBoundingClientRect().width)};
        }""")
        R['refpoint'] = info
        print("[refpoint]", json.dumps(info, ensure_ascii=False))
        # 重命名功能回归测试：点第一行「重命名」，看是否弹出重命名弹窗
        rn = page.locator(".el-table button:has-text('重命名')").first
        if rn.is_visible():
            rn.click()
            page.wait_for_timeout(1500)
            shot(page, "18-WO161-参考点管理-点重命名后")
            chk = page.evaluate("""() => {
                const vis = [...document.querySelectorAll('.el-dialog, [class*="custom-dialog"], [class*="hud-dialog"]')].filter(e=>e.offsetParent);
                return {visibleDialogs: vis.map(e=>{const t=e.querySelector('[class*="title"], .el-dialog__title'); return t?t.innerText.trim():e.className.toString().slice(0,40);}),
                        hasRenameInput: !![...document.querySelectorAll('input')].find(i=>i.offsetParent && i.closest('[class*="rename"], [class*="Rename"]'))};
            }""")
            R['refpoint_rename'] = chk
            print("[refpoint-rename]", json.dumps(chk, ensure_ascii=False))
    except Exception as e:
        print("[refpoint][ERR]", e)

    with open(r"D:\soft\F1-AI\验收截图\WO-158~161\verify-1920.json", "w", encoding="utf-8") as f:
        json.dump(R, f, ensure_ascii=False, indent=2)
    browser.close()
print("DONE")
