/*
 * 本地回归检查：把脚本推上 GitHub 之前先跑一遍。
 *
 *   node tools/check-script.js                    # 检查默认脚本
 *   node tools/check-script.js path/to/x.user.js  # 检查指定脚本
 *
 * 三层检查：
 *   1) 语法 +（若装了 acorn）全量"引用未声明标识符"静态扫描
 *   2) 用极简 DOM/GM 桩真正执行脚本顶层，捕获运行期异常
 *      —— 1.0.3.1 就是这样被一个 ReferenceError 干掉了整个悬浮窗：
 *         node --check 只查语法，查不出"用了但没声明"的常量。
 *   3) 触发面板按钮的 click 处理函数，跑一遍各流程的同步前段
 *
 * 静态扫描需要 acorn：npm i --prefix tools acorn（没装则自动跳过，前两层照常）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'Get_Microsoft_Rewards_fixed.user.js');

if (!fs.existsSync(target)) {
    console.error('找不到脚本文件: ' + target);
    process.exit(1);
}

const src = fs.readFileSync(target, 'utf8');
const failures = [];
const note = (ok, label, detail) => {
    console.log((ok ? '  + ' : '  ! ') + label + (detail ? ' - ' + detail : ''));
    if (!ok) failures.push(label + (detail ? ': ' + detail : ''));
};

console.log('检查目标: ' + path.basename(target) + ' (' + (src.length / 1024).toFixed(1) + ' KB)');

console.log('');
console.log('[1] 语法');
try {
    new vm.Script(src, { filename: target });
    note(true, '可解析');
} catch (e) {
    note(false, '语法错误', e.message);
}

let acorn = null;
try {
    acorn = require(path.join(__dirname, 'node_modules', 'acorn'));
} catch (_) {
    try { acorn = require('acorn'); } catch (__) { acorn = null; }
}

if (acorn) {
    const GLOBALS = new Set((
        'Object Function Boolean Symbol Error EvalError RangeError ReferenceError SyntaxError TypeError ' +
        'URIError Number String Date RegExp Array Map Set WeakMap WeakSet Promise Proxy Reflect JSON Math Intl ' +
        'console setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone ' +
        'encodeURIComponent decodeURIComponent encodeURI decodeURI isNaN isFinite parseFloat parseInt btoa atob ' +
        'fetch Headers Request Response AbortController AbortSignal FormData URL URLSearchParams Blob File ' +
        'FileReader Crypto crypto SubtleCrypto performance navigator screen window document location history ' +
        'localStorage sessionStorage IndexedDB customElements DOMParser XMLSerializer Event CustomEvent ' +
        'KeyboardEvent MouseEvent Node NodeList HTMLElement Element MutationObserver IntersectionObserver ' +
        'ResizeObserver Image Audio WebSocket Worker getComputedStyle matchMedia requestAnimationFrame ' +
        'cancelAnimationFrame alert confirm prompt open close scrollTo scrollBy onmessage TextEncoder ' +
        'TextDecoder Uint8Array ArrayBuffer DataView globalThis process undefined NaN Infinity ' +
        'GM_getValue GM_setValue GM_deleteValue GM_listValues GM_addStyle GM_registerMenuCommand ' +
        'GM_openInTab GM_getResourceText GM_getResourceURL GM_xmlhttpRequest GM_log GM_notification ' +
        'GM_setClipboard GM_download GM_cookie GM_unsafeWindow GM_info unsafeWindow'
    ).split(/\s+/));

    const declared = new Set();
    const bind = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') declared.add(p.name);
        else if (p.type === 'ObjectPattern') p.properties.forEach(pr => bind(pr.type === 'RestElement' ? pr.argument : pr.value));
        else if (p.type === 'ArrayPattern') p.elements.forEach(bind);
        else if (p.type === 'AssignmentPattern') bind(p.left);
        else if (p.type === 'RestElement') bind(p.argument);
    };
    const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (!node.type) return;
        if (node.type === 'VariableDeclarator') bind(node.id);
        if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) declared.add(node.id.name);
        if ((node.type === 'FunctionExpression' || node.type === 'ClassExpression') && node.id) declared.add(node.id.name);
        if (node.params) node.params.forEach(bind);
        if (node.type === 'CatchClause') bind(node.param);
        Object.keys(node).forEach(k => { if (k !== 'loc' && k !== 'start' && k !== 'end') collect(node[k]); });
    };
    try {
        const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
        collect(ast);
        const bad = new Map();
        const walk = (node, parent) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(n => walk(n, parent));
            if (!node.type) return;
            const bindingPos =
                (parent && parent.type === 'VariableDeclarator' && parent.id === node) ||
                (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
                (parent && parent.type === 'Property' && parent.key === node && !parent.computed && !(parent.shorthand && parent.value === node)) ||
                (parent && parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) ||
                (parent && parent.type === 'ObjectPattern') ||
                (parent && ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type));
            if (node.type === 'Identifier' && !bindingPos && !GLOBALS.has(node.name) && !declared.has(node.name)) {
                if (!bad.has(node.name)) bad.set(node.name, node.loc.start.line);
            }
            Object.keys(node).forEach(k => { if (k !== 'loc' && k !== 'start' && k !== 'end') walk(node[k], node); });
        };
        walk(ast, null);
        if (bad.size) {
            note(false, '存在未声明就被引用的标识符', [...bad].map(n => n[0] + '(第' + n[1] + '行)').join(', '));
        } else {
            note(true, '无未声明标识符引用');
        }
    } catch (e) {
        note(false, '静态扫描失败', e.message);
    }
} else {
    console.log('  · 跳过静态扫描（未安装 acorn：npm i --prefix tools acorn）');
}

console.log('');
console.log('[2] 顶层执行（极简 DOM/GM 桩）');
const ids = new Map();
const missingSelectors = [];
const registerHtml = (html) => {
    const re = /id\s*=\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(html))) if (!ids.has(m[1])) { const e = mkEl('div'); e.id = m[1]; }
};
const q = (sel) => {
    if (typeof sel !== 'string') return null;
    const s = sel.trim();
    if (s.charAt(0) === '#') {
        const id = s.slice(1).split(/[[\s:.[#]/)[0];
        const hit = ids.get(id) || null;
        if (!hit && !missingSelectors.includes(id)) missingSelectors.push(id);
        return hit;
    }
    return mkEl('div');
};
function mkEl(tag) {
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
        querySelector: (s) => q(s), querySelectorAll: () => [],
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
}

const store = new Map();
const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};
const documentStub = {
    readyState: 'complete', title: 'Microsoft Rewards', cookie: '', visibilityState: 'visible', hidden: false,
    documentElement: mkEl('html'), head: mkEl('head'), body: mkEl('body'),
    createElement: mkEl, createTextNode: (t) => ({ nodeValue: t }), createDocumentFragment: () => mkEl('fragment'),
    querySelector: q, querySelectorAll: () => [], getElementById: (id) => ids.get(id) || null,
    addEventListener() {}, removeEventListener() {}, execCommand: () => true,
};
const locationStub = {
    href: 'https://rewards.bing.com/earn', protocol: 'https:', host: 'rewards.bing.com', hostname: 'rewards.bing.com',
    origin: 'https://rewards.bing.com', pathname: '/earn', search: '', hash: '', reload() {},
    assign(u) { locationStub.href = String(u); }, replace(u) { locationStub.href = String(u); },
    toString: () => 'https://rewards.bing.com/earn',
};
const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: documentStub, location: locationStub, localStorage: storage, sessionStorage: storage,
    navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        language: 'zh-CN', languages: ['zh-CN'], platform: 'Win32',
        clipboard: { writeText: () => Promise.resolve() }, sendBeacon: () => true,
    },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {}, go() {}, state: null, length: 1 },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i % 251; return a; }, randomUUID: () => 'uuid-check' },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; this.addEventListener = () => {}; },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
    requestAnimationFrame: () => 3, cancelAnimationFrame() {},
    queueMicrotask: (fn) => { try { fn(); } catch (_) {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    open: () => ({ closed: false, close() {}, focus() {}, location: { href: '', assign() {}, replace() {} } }),
    close() {}, focus() {}, blur() {}, scrollTo() {}, scrollBy() {}, postMessage() {},
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, scrollX: 0, scrollY: 0, name: '', closed: false,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, isNaN, isFinite, parseFloat, parseInt,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('check-script: 网络请求已禁用')),
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, URL, URLSearchParams, Blob, FormData,
    Image: function () { return mkEl('img'); },
    GM_info: { script: { name: 'check', uuid: 'check' }, version: 'check' },
    GM_getValue: (k, d) => (store.has(k) ? store.get(k) : (d === undefined ? undefined : d)),
    GM_setValue: (k, v) => store.set(k, v),
    GM_deleteValue: (k) => store.delete(k),
    GM_listValues: () => Array.from(store.keys()),
    GM_addStyle: () => mkEl('style'),
    GM_registerMenuCommand: () => {},
    GM_openInTab: (url) => ({ closed: false, close() {}, focus() {}, url: String(url) }),
    GM_getResourceText: () => '', GM_getResourceURL: () => '', GM_log: () => {},
    GM_notification: () => {}, GM_setClipboard: () => {}, GM_download: () => {},
    GM_xmlhttpRequest: (d) => { if (d && typeof d.onerror === 'function') { try { d.onerror({ status: 0, statusText: 'check-script-blocked' }); } catch (_) {} } return { abort() {} }; },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.top = sandbox.parent = sandbox;
sandbox.unsafeWindow = sandbox;

const PANEL_BUTTONS = ['btn-search', 'btn-promo', 'btn-read', 'btn-all', 'btn-sign', 'mr-auth-link', 'mr-auth-save'];
try {
    const ctx = vm.createContext(sandbox);
    new vm.Script(src, { filename: target }).runInContext(ctx);
    note(true, '顶层执行无异常');
} catch (e) {
    const at = e && e.stack ? String(e.stack).split('\n')[1] : '';
    note(false, '顶层执行抛错', (e && e.message ? e.message : String(e)) + (at ? ' @' + at.trim() : ''));
}

note(missingSelectors.length === 0, '面板元素全部命中',
    missingSelectors.length ? '未找到 #' + missingSelectors.join(', #') : ids.size + ' 个 id 已注册');

console.log('');
console.log('[3] 按钮处理函数');
PANEL_BUTTONS.forEach(id => {
    const el = ids.get(id);
    if (!el) { console.log('  · ' + id + ' 不存在（面板若无此按钮可忽略）'); return; }
    let fn = el._h.click;
    if (Array.isArray(fn)) fn = fn[0];
    if (typeof fn !== 'function') { note(false, id + ' 没有 click 处理函数'); return; }
    try {
        fn({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} });
        note(true, id + ' 同步前段通过');
    } catch (e) {
        note(false, id + ' 抛错', e.message);
    }
});

console.log('');
console.log(failures.length ? 'FAILED (' + failures.length + ' 项):' : 'PASSED');
failures.forEach(f => console.log('   - ' + f));
process.exit(failures.length ? 1 : 0);
