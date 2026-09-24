/*
 * 可复用的浏览器环境桩：给"在 Node 里真跑油猴脚本"这类检查用。
 * check-script.js 与 test-auth-handoff.js 共用，避免各写一套、各漏一处。
 *
 * 用法：
 *   const { createHarness } = require('./harness');
 *   const h = createHarness({ url, store, onTokenExchange });
 *   h.run(scriptSource);          // 执行脚本顶层，同步异常会抛出
 *   h.sandbox / h.ids / h.store / h.navigations / h.missingSelectors
 */
const vm = require('vm');

function createHarness(options = {}) {
    const url = options.url || 'https://rewards.bing.com/earn';
    const parsed = new URL(url);
    const store = options.store || new Map();
    const navigations = [];
    const tokenExchanges = [];
    const ids = new Map();
    const missingSelectors = [];

    const mkEl = (tag) => {
        let _id = '';
        let _html = '';
        const el = {
            tagName: String(tag || 'div').toUpperCase(), className: '', textContent: '', value: '', checked: false, href: '',
            style: new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => (t[k] === undefined ? '' : t[k]) }),
            dataset: {}, children: [], childNodes: [], _h: {},
            appendChild(c) { this.children.push(c); return c; },
            removeChild(c) { return c; },
            insertAdjacentHTML(_p, html) { registerHtml(String(html)); },
            setAttribute(k, v) { if (k === 'id') el.id = v; },
            getAttribute(k) { return k === 'id' ? _id : null; },
            remove() {}, focus() {}, click() {}, blur() {}, select() {},
            closest() { return null; }, matches() { return false; },
            querySelector: (s) => query(s), querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }),
            scrollTop: 0, scrollHeight: 100, offsetHeight: 100, offsetWidth: 100, clientHeight: 100,
            offsetParent: null, parentNode: null, parentElement: null, nextSibling: null, firstChild: null,
            dispatchEvent: () => true,
        };
        ['change', 'input', 'click', 'keydown', 'mousedown', 'load', 'error', 'scroll'].forEach(ev => {
            Object.defineProperty(el, 'on' + ev, {
                get: () => (Array.isArray(el._h[ev]) ? el._h[ev][0] : el._h[ev]),
                set: (fn) => { el._h[ev] = fn; },
            });
        });
        el.addEventListener = (ev, fn) => { const a = (el._h[ev] = el._h[ev] || []); if (!a.includes(fn)) a.push(fn); };
        el.removeEventListener = () => {};
        Object.defineProperty(el, 'id', { get: () => _id, set: (v) => { _id = String(v); if (_id) ids.set(_id, el); } });
        Object.defineProperty(el, 'innerHTML', { get: () => _html, set: (v) => { _html = String(v); registerHtml(_html); } });
        Object.defineProperty(el, 'outerHTML', { get: () => _html, set: () => {} });
        return el;
    };

    function registerHtml(html) {
        const re = /id\s*=\s*["']([^"']+)["']/g;
        let m;
        while ((m = re.exec(html))) if (!ids.has(m[1])) { const e = mkEl('div'); e.id = m[1]; }
    }

    function query(sel) {
        if (typeof sel !== 'string') return null;
        const s = sel.trim();
        if (s.charAt(0) === '#') {
            const id = s.slice(1).split(/[\s:.[#]/)[0];
            const hit = ids.get(id) || null;
            if (!hit && !missingSelectors.includes(id)) missingSelectors.push(id);
            return hit;
        }
        return mkEl('div');
    }

    const localStorageStub = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };

    const documentStub = {
        readyState: 'complete', title: 'Microsoft Rewards', cookie: '', visibilityState: 'visible', hidden: false,
        documentElement: mkEl('html'), head: mkEl('head'), body: mkEl('body'),
        createElement: mkEl, createTextNode: (t) => ({ nodeValue: t }), createDocumentFragment: () => mkEl('fragment'),
        querySelector: query, querySelectorAll: () => [],
        getElementById: (id) => ids.get(id) || null,
        addEventListener() {}, removeEventListener() {}, execCommand: () => true,
    };

    const locationStub = {
        href: url, protocol: parsed.protocol, host: parsed.host, hostname: parsed.hostname,
        origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash,
        reload() { navigations.push('reload'); },
        assign(u) { navigations.push(String(u)); locationStub.href = String(u); },
        replace(u) { navigations.push(String(u)); locationStub.href = String(u); },
        toString: () => locationStub.href,
    };

    const defaultXhr = (d) => {
        if (d && typeof d.onerror === 'function') { try { d.onerror({ status: 0, statusText: 'harness-blocked' }); } catch (_) {} }
        return { abort() {} };
    };

    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        document: documentStub, location: locationStub, localStorage: localStorageStub, sessionStorage: localStorageStub,
        navigator: {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/151.0.0.0',
            language: 'zh-CN', languages: ['zh-CN'], platform: 'Win32',
            clipboard: { writeText: () => Promise.resolve() }, sendBeacon: () => true,
        },
        history: { pushState() {}, replaceState() {}, back() {}, forward() {}, go() {}, state: null, length: 1 },
        crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i % 251; return a; }, randomUUID: () => 'uuid-harness' },
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
        XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; this.addEventListener = () => {}; },
        setTimeout: (fn) => { if (typeof fn === 'function' && options.runTimers !== false) { try { fn(); } catch (_) {} } return 1; },
        clearTimeout() {}, setInterval: () => 2, clearInterval() {},
        requestAnimationFrame: () => 3, cancelAnimationFrame() {},
        queueMicrotask: (fn) => { try { fn(); } catch (_) {} },
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
        open: () => ({ closed: false, close() {}, focus() {}, location: { href: '', assign() {}, replace() {} } }),
        close() {}, focus() {}, blur() {}, scrollTo() {}, scrollBy() {}, postMessage() {},
        innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, scrollX: 0, scrollY: 0, name: '', closed: false,
        encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, isNaN, isFinite, parseFloat, parseInt,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        fetch: () => Promise.reject(new Error('harness: 网络已禁用')),
        TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, URL, URLSearchParams, Blob, FormData,
        Image: function () { return mkEl('img'); },
        GM_info: { script: { name: 'harness', uuid: 'harness' }, version: 'harness' },
        GM_getValue: (k, d) => (store.has(k) ? store.get(k) : (d === undefined ? undefined : d)),
        GM_setValue: (k, v) => store.set(k, v),
        GM_deleteValue: (k) => store.delete(k),
        GM_listValues: () => Array.from(store.keys()),
        GM_addStyle: () => mkEl('style'),
        GM_registerMenuCommand: () => {},
        GM_openInTab: (u) => ({ closed: false, close() {}, focus() {}, url: String(u) }),
        GM_getResourceText: () => '', GM_getResourceURL: () => '', GM_log: () => {},
        GM_notification: () => {}, GM_setClipboard: () => {}, GM_download: () => {},
        GM_cookie: (a, b, c) => { const cb = typeof b === 'function' ? b : c; if (typeof cb === 'function') cb([]); },
        GM_xmlhttpRequest: (d) => {
            if (typeof options.onRequest === 'function') return options.onRequest(d, tokenExchanges);
            return defaultXhr(d);
        },
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.top = sandbox.parent = sandbox;
    sandbox.unsafeWindow = sandbox;

    return {
        sandbox, store, ids, navigations, tokenExchanges, missingSelectors,
        run(source) {
            const ctx = vm.createContext(sandbox);
            new vm.Script(source, { filename: options.filename || 'script.user.js' }).runInContext(ctx);
            return this;
        },
        // 让脚本里排队的 Promise/微任务跑完（网络回调都是同步触发的，这里只等微任务）
        async settle(times = 8) {
            for (let i = 0; i < times; i++) await Promise.resolve();
            return this;
        },
        click(id) {
            const el = ids.get(id);
            if (!el) return { ok: false, reason: 'no-element' };
            let fn = el._h.click;
            if (Array.isArray(fn)) fn = fn[0];
            if (typeof fn !== 'function') return { ok: false, reason: 'no-handler' };
            try { fn({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} }); return { ok: true }; }
            catch (e) { return { ok: false, reason: e.message }; }
        },
    };
}

module.exports = { createHarness };
