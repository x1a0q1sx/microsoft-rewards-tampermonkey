/*
 * 会话失效防护回归测试
 *
 * 背景（2026-09-25 线上日志实证）：
 *   rewards.bing.com 会话失效（接口 401）时，站点会把任何活动卡片的点击弹到它自己的
 *   OAuth（client_id 9c941f7c → /auth/callback），主页面整个被销毁；脚本的自动恢复
 *   立刻再跑一轮 → "弹走 → 恢复 → 再点 → 再弹" 死循环。
 *
 * 覆盖：
 *   [1] 非脚本跳转到登录页 → 计一次弹跳
 *   [2] 弹跳达到上限 → 停止自动恢复（不再自动 runPromo）
 *   [3] 会话 401 时不应出现任何卡片点击
 *   [4] 会话正常时不改变原有行为（不误伤）
 *
 * 用法：node tools/test-session-guard.js
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

// 所有接口 401（模拟"未登录/会话失效"）；可选放行指定 URL 返回 200
function makeHandler(okUrls = []) {
    return (d) => {
        const url = String(d.url || '');
        const ok = okUrls.some(u => url.includes(u));
        setTimeout(() => {
            if (ok) {
                d.onload({ status: 200, responseText: '{"dashboard":{"userStatus":{}}}', finalUrl: url });
            } else {
                const err = { status: 401, statusText: 'unauthorized' };
                if (d.onload) d.onload({ status: 401, responseText: '', finalUrl: url });
            }
        }, 0);
        return { abort() {} };
    };
}

function page(store, url, okUrls) {
    const h = createHarness({ url, store, onRequest: makeHandler(okUrls) });
    let err = null;
    try { h.run(src); } catch (e) { err = e; }
    return { h, err };
}

// 脚本的 init 是长异步链（含真实 setTimeout 延迟的重试/回退请求），
// harness.settle 只 drain 微任务，这里额外等待真实定时器推进。
const drain = (ms = 900) => new Promise(r => setTimeout(r, ms));

const debugLog = store => {
    try { return JSON.parse(store.get('mr_debug_log') || '[]').map(e => e.m).join('\n'); }
    catch (_) { return ''; }
};

(async () => {
    console.log('会话失效防护回归测试\n');

    // ---------- [1] 非脚本弹跳到登录页 → 计入熔断统计 ----------
    {
        console.log('[1] 非脚本跳转落到登录页：计一次弹跳');
        const store = new Map();
        store.set('mr_last_unload', JSON.stringify({
            url: 'https://rewards.bing.com/earn', ts: Date.now() - 3000,
            s: 'other-session', p: 'rewards.bing.com/e', busy: true, vis: 'visible'
        }));
        const p = page(store, 'https://login.live.com/oauth20_authorize.srf?client_id=9c941f7c-a811-4e9c-8e66-29fdec50490f&redirect_uri=https%3A%2F%2Frewards.bing.com%2Fauth%2Fcallback');
        await drain();
        const st = JSON.parse(store.get('mr_promo_bounce') || '{}');
        check(Number(st.count) === 1, '弹跳计数 +1', 'count=' + st.count);
        check(!p.err, '登录页顶层无异常', p.err && p.err.message);
    }

    // ---------- [2] 熔断：达到上限后不再自动恢复 ----------
    {
        console.log('\n[2] 弹跳达到上限：停止自动恢复，提示重新登录');
        const store = new Map();
        store.set('mr_promo_bounce', JSON.stringify({ count: 2, firstAt: Date.now() - 60 * 1000 }));
        store.set('mr_pending_promo', JSON.stringify({
            createdAt: Date.now(), items: [{ key: 'k1', title: '迪拜清凉沙漠', destinationUrl: 'https://www.bing.com/search?q=x' }]
        }));
        store.set('mr_promo_resume_intent', JSON.stringify({ createdAt: Date.now() }));
        const p = page(store, 'https://rewards.bing.com/earn');
        await drain();
        const log = debugLog(store);
        check(!log.includes('继续执行刚才主动开始的活动'), '没有自动恢复 runPromo');
        check(log.includes('已停止自动恢复活动'), '面板给出熔断提示', log.split('\n').find(l => l.includes('停止自动恢复')) || '(无)');
        check(p.h.navigations.filter(u => u === 'reload').length === 0, '没有触发刷新');
    }

    // ---------- [3] 会话 401：不产生任何卡片点击 ----------
    {
        console.log('\n[3] 会话 401：不应出现卡片点击（防站点弹登录）');
        const store = new Map();
        const p = page(store, 'https://rewards.bing.com/earn');
        await drain();
        p.h.click('btn-promo');
        await drain();
        const log = debugLog(store);
        check(log.includes('会话已失效') || log.includes('会话闸门') || log.includes('请先获取授权码'),
            '明确说明会话失效/需授权，而不是静默尝试点击',
            (log.split('\n').find(l => l.includes('会话已失效')) || '(无会话提示)').slice(0, 90));
        check(!log.includes('🖱️ 尝试页面内点击完成'), '没有任何卡片点击尝试');
    }

    // ---------- [4] 会话正常时不误伤 ----------
    {
        console.log('\n[4] 会话正常：不出现会话熔断提示（不误伤）');
        const store = new Map();
        const p = page(store, 'https://rewards.bing.com/earn', ['/api/getuserinfo']);
        await drain();
        const log = debugLog(store);
        check(!log.includes('会话已失效'), '没有会话失效告警');
        check(!log.includes('已停止自动恢复活动'), '没有熔断');
        check(!p.err, '顶层无异常', p.err && p.err.message);
    }

    const failed = results.filter(r => !r.ok);
    console.log('\n' + (failed.length ? 'FAILED (' + failed.length + ' 项)' : 'PASSED'));
    failed.forEach(f => console.log('   - ' + f.label + (f.detail ? ' (' + f.detail + ')' : '')));
    process.exit(failed.length ? 1 : 0);
})();
