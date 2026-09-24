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
const { createHarness } = require('./harness');
const harness = createHarness({ url: 'https://rewards.bing.com/earn', runTimers: false });
const ids = harness.ids;
const missingSelectors = harness.missingSelectors;
try {
    harness.run(src);
    note(true, '顶层执行无异常');
} catch (e) {
    const at = e && e.stack ? String(e.stack).split('\n')[1] : '';
    note(false, '顶层执行抛错', (e && e.message ? e.message : String(e)) + (at ? ' @' + at.trim() : ''));
}
note(missingSelectors.length === 0, '面板元素全部命中',
    missingSelectors.length ? '未找到 #' + missingSelectors.join(', #') : ids.size + ' 个 id 已注册');

const PANEL_BUTTONS = ['btn-search', 'btn-promo', 'btn-read', 'btn-all', 'btn-sign', 'mr-auth-link', 'mr-auth-save'];

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
