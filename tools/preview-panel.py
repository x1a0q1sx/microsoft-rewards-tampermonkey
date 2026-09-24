# -*- coding: utf-8 -*-
"""在真实浏览器里渲染悬浮面板，用于排查"面板不显示/按钮丢失"一类问题。

    python tools/preview-panel.py [脚本路径] [--headed]

用法：脚本会被注入到一个 mock 的 https://rewards.bing.com/earn 页面上
（只拦截网络，URL 与真实站点一致），因此无需登录即可验证面板 DOM/CSS
和脚本顶层是否抛异常。输出的 PNG 就是面板截图。
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(os.path.dirname(HERE), "Get_Microsoft_Rewards_fixed.user.js")
target = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT
headed = "--headed" in sys.argv
out_png = os.path.join(os.environ.get("TEMP", HERE), "mr_panel_preview.png")

STUBS = r"""
window.__store = {};
window.GM_getValue = (k, d) => (k in window.__store ? window.__store[k] : d);
window.GM_setValue = (k, v) => { window.__store[k] = v; };
window.GM_deleteValue = (k) => { delete window.__store[k]; };
window.GM_listValues = () => Object.keys(window.__store);
window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s; };
window.GM_registerMenuCommand = () => {};
window.GM_openInTab = (url) => ({ closed: false, close() {}, focus() {}, url: String(url) });
window.GM_xmlhttpRequest = (d) => { if (d && d.onerror) setTimeout(() => d.onerror({ status: 0, statusText: 'preview-blocked' }), 0); return { abort() {} }; };
window.GM_notification = () => {};
window.GM_log = () => {};
window.GM_cookie = (o, cb) => { if (cb) cb([]); };
window.GM_setClipboard = () => {};
window.unsafeWindow = window;
window.GM_info = { script: { name: 'preview', uuid: 'preview' }, version: 'preview' };
"""

MOCK_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Microsoft Rewards</title></head>
<body style="margin:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
<div style="padding:40px;color:#555">Microsoft Rewards（本地预览，不联网）</div>
</body></html>"""

errors, logs = [], []
with open(target, "r", encoding="utf-8") as f:
    code = f.read()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=not headed)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    page.route("**/*", lambda r: r.fulfill(body=MOCK_PAGE, content_type="text/html; charset=utf-8")
               if r.request.resource_type == "document" else r.abort())
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: (errors if m.type == "error" else logs).append(m.text))
    page.goto("https://rewards.bing.com/earn", wait_until="domcontentloaded")
    page.add_init_script(STUBS)
    page.evaluate(STUBS)
    page.add_script_tag(content=code)
    page.wait_for_timeout(2500)

    info = page.evaluate("""() => {
      const el = document.getElementById('mr-panel');
      const out = { version: window.__MR_VERSION__ || '(未设置)', found: !!el };
      if (!el) return out;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      out.visible = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 0;
      out.buttons = [...el.querySelectorAll('button, [id^="btn-"]')].map(b => ({
        id: b.id, text: (b.textContent || '').trim().slice(0, 12),
        shown: b.offsetParent !== null,
      }));
      out.ids = [...el.querySelectorAll('[id]')].map(n => n.id);
      return out;
    }""")
    page.screenshot(path=out_png)

    # 再点开折叠气泡，验证展开后的完整面板
    expanded = None
    try:
        page.evaluate("() => { const el = document.getElementById('mr-panel'); if (el) el.click(); }")
        page.wait_for_timeout(500)
        expanded = page.evaluate("""() => {
          const el = document.getElementById('mr-panel');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const shown = [...el.querySelectorAll('button')].filter(b => b.offsetParent !== null)
              .map(b => b.id + ':' + (b.textContent || '').trim());
          return { w: Math.round(r.width), h: Math.round(r.height),
                   collapsed: el.classList.contains('collapsed'), shownButtons: shown };
        }""")
        out_exp = out_png.replace(".png", "_expanded.png")
        page.screenshot(path=out_exp)
        expanded["screenshot"] = out_exp
    except Exception as e:
        expanded = {"error": str(e)}
    browser.close()

print(json.dumps(info, ensure_ascii=False, indent=2))
print("expanded:", json.dumps(expanded, ensure_ascii=False))
if errors:
    print("PAGE_ERRORS / console.error:")
    for e in errors[:15]:
        print("  ! " + str(e)[:300])
else:
    print("PAGE_ERRORS: none")
print("screenshot -> " + out_png)
