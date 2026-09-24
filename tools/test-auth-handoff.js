/*
 * 授权交接回归测试
 *
 * 覆盖曾经导致"要授权码 → 刷新 → 死循环"的几个场景：
 *   [1] 正常一轮：回调页只回传 code 并返回主页，自己绝不兑换
 *   [2] 死循环场景：回调页与另一个已打开的 Rewards 页同时看到同一 code
 *   [3] 第三方/无 nonce 的回调必须被忽略
 *   [4] code 失效时应停止尝试，而不是刷新重试
 *   [5] 未登录而非接口异常时，不应把用户推进授权死循环
 *
 * 用法：node tools/test-auth-handoff.js
 */
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./harness');

const SCRIPT = path.resolve(__dirname, '..', 'Get_Microsoft_Rewards_fixed.user.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

const results = [];
const check = (ok, label, detail) => {
    console.log((ok ? '  + ' : '  ! ') + label + (detail ? ' - ' + detail : ''));
    results.push({ ok, label, detail });
};

// 模拟微软 token 端点：同一个 code 只能用一次，第二次返回 invalid_grant
function makeTokenHandler(store) {
    return (d, exchanges) => {
        const url = String(d.url || '');
        if (/oauth20_token\.srf|login\.microsoftonline\.com/i.test(url)) {
            const body = String(d.data || '');
            const m = body.match(/code=([^&]*)/);
            const rawCode = m ? m[1] : '';
            const code = rawCode ? decodeURIComponent(rawCode.replace(/\+/g, '%2B')) : '';
            let payload;
            if (code) {
                exchanges.push(code);
                const used = store.get('__used_code') === code;
                store.set('__used_code', code);
                payload = used
                    ? { error: 'invalid_grant', error_description: "The provided value for the 'code' parameter is not valid." }
                    : { access_token: 'AT-' + code, refresh_token: 'RT-' + code, expires_in: 3600, token_type: 'bearer' };
            } else {
                exchanges.push('(refresh_token)');
                payload = { access_token: 'AT-rt', refresh_token: 'RT-rt', expires_in: 3600, token_type: 'bearer' };
            }
            const status = payload.error ? 400 : 200;
            const text = JSON.stringify(payload);
            setTimeout(() => { if (d.onload) d.onload({ status, responseText: text, finalUrl: url }); }, 0);
            return { abort() {} };
        }
        // 其它接口：当作未登录环境，返回 401，避免测试里出现假数据
        setTimeout(() => { if (d.onerror) d.onerror({ status: 401, statusText: 'unauthorized' }); }, 0);
        return { abort() {} };
    };
}

function page(store, url) {
    const h = createHarness({
        url,
        store,
        onRequest: makeTokenHandler(store),
    });
    let err = null;
    try { h.run(src); } catch (e) { err = e; }
    return { h, err };
}

(async () => {
    console.log('授权交接回归测试\n');

    // ---------- [1] 正常授权一轮 ----------
    {
        console.log('[1] 正常一轮：回调页回传 code 并返回主页，自己不兑换');
        const store = new Map();
        const nonce = 'ntest1';
        store.set('mr_auth_nonce', nonce);
        store.set('mr_auth_code_ready', '');

        const cb = page(store, 'https://login.live.com/oauth20_desktop.srf?code=CODE_ONE&mr_nonce=' + nonce);
        check(!cb.err, '回调页顶层无异常', cb.err && cb.err.message);
        const ready = store.get('mr_auth_code_ready') || '';
        check(ready.includes('CODE_ONE'), 'code 已写入 GM 存储', ready.slice(0, 80));
        check(cb.h.tokenExchanges.length === 0, '回调页没有自己兑换 token', '兑换 ' + cb.h.tokenExchanges.length + ' 次');
        check(cb.h.navigations.some(u => u.includes('rewards.bing.com')), '回调页跳回 Rewards', JSON.stringify(cb.h.navigations));
        check(store.get('mr_auth_nonce') === '', 'nonce 已消费，避免复发');
    }

    // ---------- [2] 死循环场景：两个页面同时看到同一 code ----------
    {
        console.log('\n[2] 死循环场景：回调页 + 已打开的 Rewards 页同时看到同一 code');
        const store = new Map();
        const nonce = 'ntest2';
        store.set('mr_auth_nonce', nonce);
        const cb = page(store, 'https://login.live.com/oauth20_desktop.srf?code=CODE_TWO&mr_nonce=' + nonce);
        const home = page(store, 'https://rewards.bing.com/earn');
        await home.h.settle();
        const total = cb.h.tokenExchanges.length + home.h.tokenExchanges.length;
        check(cb.h.tokenExchanges.length === 0, '回调页不参与兑换', '兑换 ' + cb.h.tokenExchanges.length + ' 次');
        check(total <= 1, '同一 code 最多兑换 1 次', '合计 ' + total + ' 次');
        check(Number(home.h.sandbox.__mrRefreshLoop || 0) === 0, '主页未触发刷新循环');
    }

    // ---------- [3] 无 nonce 的第三方回调 ----------
    {
        console.log('\n[3] 非本脚本发起的授权回调应被忽略');
        const store = new Map();
        const p = page(store, 'https://login.live.com/oauth20_desktop.srf?code=FOREIGN_CODE');
        check(p.h.tokenExchanges.length === 0, '没有兑换任何 token');
        check(!store.get('mr_auth_code_ready'), '没有写入 GM 存储');
        check(!p.h.navigations.some(u => u.includes('rewards.bing.com')), '没有跳转 Rewards', JSON.stringify(p.h.navigations));
    }

    // ---------- [4] code 失效 ----------
    {
        console.log('\n[4] code 已失效：应停止尝试，而不是刷新重试');
        const store = new Map();
        store.set('__used_code', 'CODE_BAD');
        const nonce = 'ntest4';
        store.set('mr_auth_nonce', nonce);
        const cb = page(store, 'https://login.live.com/oauth20_desktop.srf?code=CODE_BAD&mr_nonce=' + nonce);
        const home = page(store, 'https://rewards.bing.com/earn');
        await home.h.settle();
        const reloads = [...cb.h.navigations, ...home.h.navigations].filter(u => u === 'reload').length;
        check(reloads === 0, '没有触发任何页面 reload', 'reload ' + reloads + ' 次');
        check(home.h.tokenExchanges.length <= 1, '主页最多尝试一次', '实际 ' + home.h.tokenExchanges.length + ' 次');
    }

    // ---------- [5] 未登录环境不应强行推进授权 ----------
    {
        console.log('\n[5] 接口 401（未登录）：不应把用户推入授权刷新循环');
        const store = new Map();
        const home = page(store, 'https://rewards.bing.com/earn');
        await home.h.settle();
        const reloads = home.h.navigations.filter(u => u === 'reload').length;
        check(reloads === 0, '没有 reload', 'reload ' + reloads + ' 次');
        check(home.h.tokenExchanges.length === 0, '没有尝试兑换 token');
    }

    const failed = results.filter(r => !r.ok);
    console.log('\n' + (failed.length ? 'FAILED (' + failed.length + ' 项)' : 'PASSED'));
    failed.forEach(f => console.log('   - ' + f.label + (f.detail ? ' (' + f.detail + ')' : '')));
    process.exit(failed.length ? 1 : 0);
})();
