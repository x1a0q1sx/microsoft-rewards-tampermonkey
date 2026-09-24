// ==UserScript==
// @name         Get Microsoft Rewards
// @namespace    http://tampermonkey.net/
// @version      4.0.2
// @description  微软 Rewards 助手 · 2026 新版适配 —— 任务全部在新标签页完成并自动关闭，主页面永不跳转；真实点击 + 真实搜索 + 积分增量自校准
// @author       QingJ · 2026 适配
// @icon         https://rewards.bing.com/rewardscdn/images/rewards.png
// @match        https://www.bing.com/*
// @match        https://cn.bing.com/*
// @match        https://rewards.bing.com/*
// @match        https://login.live.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      rewards.bing.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      login.live.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hot.baiwumm.com
// @connect      hotapi.nntool.cc
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

/* ============================================================================
 * v4 架构（相对 v3 的核心变化：单标签 → 新标签）
 * ----------------------------------------------------------------------------
 * 老大的要求：不要在主页面（积分首页）上直接跳转，任务要在新标签里完成，
 * 完成后把新标签关掉，主页面保持不动。
 *
 * 【关键修复】rel="noopener" 是"关不掉标签"的真正原因
 *   实测每日活动卡：<a target="_blank" rel="noopener noreferrer" href="bing.com/search?...">
 *   Chrome 规定：window.opener === null 的标签不允许被脚本 window.close()。
 *   所以 v2「打开后自我关闭」注定失败。
 *   v4 做法：点击前把 rel 里的 noopener 去掉，让新标签保留 opener，
 *   于是新标签里的脚本可以正常 window.close() 自己。
 *
 * 【流程结构】
 *   [积分页] 全程不动
 *     ├─ 搜索步骤 → GM_openInTab 开新标签（发起方持有句柄，可强制关闭）
 *     └─ 活动步骤 → 去 noopener + 真实点击 → 新标签自己开 → 新标签自我关闭
 *   [新标签] 识别自己是任务页 → 停留数秒 → 写完成标记 → 关闭自己
 *
 * 【搜索计分】新版页面不显示这个计数器。实测真实搜索一次 +3 分，日上限约 60 分。
 *   采用积分增量自校准：每 batchSize 次回积分页比对总分，涨了继续，连续两批不涨即到顶。
 * ==========================================================================*/

(function () {
    'use strict';

    const VERSION = '4.0.2';

    /* ======================= 配置 ======================= */

    const CONFIG = {
        searchScoring: {
            enabled: true,
            maxAttemptsPerDay: 20,   // 20 次 × 3 分 ≈ 60 分
            batchSize: 4,            // 每 4 次核对一次积分增量
            maxZeroBatches: 2,       // 连续 2 批 0 增量判定到顶
            stay: [5, 10]            // 新标签在搜索结果页停留秒数
        },
        streakSearchTarget: 3,       // 连续打卡搜索（每天 3 次）
        activityStay: [4, 8],        // 新标签在活动页停留秒数
        stepDelay: [1000, 2200],
        tabWaitTimeout: 60 * 1000,   // 等待新标签回报完成的超时
        tabStateTTL: 10 * 60 * 1000,
        hotApis: [
            { url: 'https://hot.baiwumm.com/api/', sources: ['baidu', 'weibo', 'zhihu', 'toutiao', 'douyin'] },
            { url: 'https://hotapi.nntool.cc/', sources: ['baidu', 'weibo', 'zhihu', 'toutiao', 'douyin'] }
        ],
        fallbackKeywords: [
            '天气预报', '今日新闻', '体育赛事', '股票行情', '电影推荐', '科技资讯',
            '美食食谱', '旅游攻略', '人工智能', '新能源汽车', '健康养生', '历史故事',
            '摄影技巧', '家居装修', '健身计划', '读书推荐', '咖啡知识', '园艺种植'
        ]
    };

    const K = {
        authCode: 'auth_code',
        authCodeBad: 'auth_code_bad',
        refreshToken: 'refresh_token',
        pendingTabs: 'mr4_pending_tabs',   // 待识别的任务标签 URL
        tabStates: 'mr4_tab_states',       // 新标签回报的完成状态
        searchHost: 'mr4_search_host',
        todaySearch: 'mr4_today_search',
        lastRunDate: 'mr4_last_run_date'
    };

    /* ======================= 状态 ======================= */

    const state = {
        level: 0, points: 0,
        search: { cur: 0, max: 0 },
        dailyList: { cur: 0, max: 0 },
        checkin: { cur: 0, max: 0 },
        scan: null,
        running: false,
        busyCount: 0,
        paused: false,
        pausePromise: null,
        pauseResolver: null,
        accessToken: null,
        accessTokenExpiresAt: 0,
        authNeeded: false
    };

    let uiReady = false;

    /* ======================= 工具 ======================= */

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

    const getDateHyphen = () => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const isRewards = () => /rewards\.bing\.com$/i.test(location.hostname);
    const normText = el => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();

    async function gmRequest(options) {
        const retries = options.retries == null ? 2 : options.retries;
        const shouldRetry = err => {
            const s = (err && err.status) || 0;
            return s === 0 || s === 429 || s >= 500;
        };
        let attempt = 0;
        for (;;) {
            try {
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest(Object.assign({
                        timeout: 20000,
                        onload: xhr => {
                            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
                            else {
                                const e = new Error('HTTP ' + xhr.status);
                                e.status = xhr.status;
                                e.responseText = xhr.responseText;
                                reject(e);
                            }
                        },
                        onerror: () => { const e = new Error('Network Error'); e.status = 0; reject(e); },
                        ontimeout: () => { const e = new Error('Timeout'); e.status = 0; reject(e); }
                    }, options));
                });
            } catch (e) {
                if (attempt >= retries || !shouldRetry(e)) throw e;
                await sleep(1000 * Math.pow(2, attempt) + rand(0, 250));
                attempt++;
            }
        }
    }

    /* ======================= 授权 ======================= */

    let lastRawCodeValue = '';
    function decodeCodeValue(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
        try { const d = decodeURIComponent(s); return d || s; } catch (e) { return s; }
    }

    function extractAuthCode(raw) {
        if (!raw) return null;
        raw = String(raw).trim();
        if (raw.indexOf('code=') >= 0) {
            const m = raw.match(/[?&]code=([^&?#\s]+)/);
            if (m && m[1]) { lastRawCodeValue = m[1]; return decodeCodeValue(m[1]) || null; }
        }
        const c = raw.split(/[&\s]/)[0].trim();
        lastRawCodeValue = c;
        return decodeCodeValue(c) || null;
    }

    function stripCodeFromUrl() {
        try {
            const u = new URL(location.href);
            if (!u.searchParams.has('code')) return;
            u.searchParams.delete('code');
            history.replaceState(null, '', u.href);
        } catch (e) { /* ignore */ }
    }

    let tokenBusy = false;
    async function getAccessToken(opts) {
        opts = opts || {};
        const now = Date.now();
        if (!opts.forceRefresh && !opts.preferCode && state.accessToken &&
            state.accessTokenExpiresAt && now < state.accessTokenExpiresAt - 60000) {
            return state.accessToken;
        }
        if (opts.forceRefresh) { state.accessToken = null; state.accessTokenExpiresAt = 0; }
        if (tokenBusy) {
            for (let i = 0; i < 16 && tokenBusy; i++) await sleep(500);
            if (state.accessToken) return state.accessToken;
        }

        const code = GM_getValue(K.authCode, '');
        const refreshToken = GM_getValue(K.refreshToken, '');
        if (!code && !refreshToken) { state.authNeeded = true; return null; }

        const useCode = !!code && (opts.preferCode || !refreshToken);
        const base = 'https://login.live.com/oauth20_token.srf';
        const params = {
            client_id: '0000000040170455',
            scope: 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'
        };
        if (useCode) {
            params.code = code;
            params.redirect_uri = 'https://login.live.com/oauth20_desktop.srf';
            params.grant_type = 'authorization_code';
        } else {
            params.refresh_token = refreshToken;
            params.grant_type = 'REFRESH_TOKEN';
        }

        const buildBody = cv => {
            const p = Object.assign({}, params);
            if (useCode && cv !== undefined) p.code = cv;
            return Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
        };
        const body = buildBody();
        const doExchange = (usePost, overrideBody) => {
            const b = overrideBody || body;
            return gmRequest({
                method: usePost ? 'POST' : 'GET',
                url: usePost ? base : base + '?' + b,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: usePost ? b : undefined
            });
        };

        tokenBusy = true;
        try {
            let res;
            try { res = await doExchange(true); }
            catch (e1) { if (e1 && e1.status === 0) res = await doExchange(false); else throw e1; }

            const data = JSON.parse(res);
            if (data.access_token) {
                state.accessToken = data.access_token;
                state.accessTokenExpiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0;
                if (data.refresh_token) GM_setValue(K.refreshToken, data.refresh_token);
                if (useCode) { GM_setValue(K.authCode, ''); stripCodeFromUrl(); }
                state.authNeeded = false;
                return data.access_token;
            }
            if (data.error) {
                log('❌ token 兑换失败: ' + data.error);
                if (useCode) GM_setValue(K.authCode, ''); else GM_setValue(K.refreshToken, '');
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                state.authNeeded = true;
            }
        } catch (e) {
            let errName = '';
            try {
                const j = JSON.parse((e && e.responseText) || '{}');
                if (j.error) errName = j.error;
            } catch (_) { /* ignore */ }
            if (useCode && errName === 'invalid_grant' && lastRawCodeValue && lastRawCodeValue !== code) {
                try {
                    const d2 = JSON.parse(await doExchange(true, buildBody(lastRawCodeValue)));
                    if (d2.access_token) {
                        state.accessToken = d2.access_token;
                        state.accessTokenExpiresAt = d2.expires_in ? Date.now() + Number(d2.expires_in) * 1000 : 0;
                        if (d2.refresh_token) GM_setValue(K.refreshToken, d2.refresh_token);
                        GM_setValue(K.authCode, '');
                        state.authNeeded = false;
                        stripCodeFromUrl();
                        log('✅ 对照重试成功（保留地址栏原值）');
                        return state.accessToken;
                    }
                } catch (_) { /* ignore */ }
            }
            log('❌ token 请求异常: ' + (e && e.status ? 'HTTP ' + e.status : (e && e.message)));
            if (errName === 'invalid_grant' || errName === 'invalid_request') {
                GM_setValue(K.authCode, '');
                GM_setValue(K.authCodeBad, code);
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                state.authNeeded = true;
            }
        } finally {
            tokenBusy = false;
        }
        return null;
    }

    async function withToken(fn) {
        let token = await getAccessToken();
        if (!token) return null;
        try { return await fn(token); }
        catch (e) {
            if (e && e.status === 401) {
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                token = await getAccessToken({ forceRefresh: true });
                if (!token) throw e;
                return await fn(token);
            }
            throw e;
        }
    }

    async function fetchBearerOverview() {
        try {
            const raw = await withToken(tk => gmRequest({
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613&_=' + Date.now(),
                headers: {
                    'Authorization': 'Bearer ' + tk,
                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555',
                    'X-Rewards-IsMobile': 'true',
                    'X-Rewards-Country': 'cn'
                }
            }));
            if (!raw) return null;
            const r = (JSON.parse(raw).response) || {};
            return {
                balance: r.balance,
                level: r.profile && r.profile.attributes
                    ? parseInt(String(r.profile.attributes.level || r.profile.attributes.epuserstate || '').replace(/\D/g, ''), 10) || 0
                    : 0
            };
        } catch (e) { return null; }
    }

    /* ======================= 积分读取 ======================= */

    function readPointsOnce() {
        try {
            const btn = document.querySelector(
                'button[aria-label*="个人资料"], button[aria-label*="profile"], button[aria-label*="Profile"]');
            if (btn) {
                const m = normText(btn).match(/([\d,]{3,})/);
                if (m) return Number(m[1].replace(/,/g, ''));
            }
            const m2 = normText(document.body).match(/([\d,]{3,})\s*pts/i);
            if (m2) return Number(m2[1].replace(/,/g, ''));
        } catch (e) { /* ignore */ }
        return 0;
    }

    async function readPointsRetry(tries) {
        tries = tries || 6;
        for (let i = 0; i < tries; i++) {
            const p = readPointsOnce();
            if (p > 0) { state.points = p; return p; }
            await sleep(1200);
        }
        return state.points || 0;
    }

    /* ======================= 任务标签页注册表 ======================= */

    function readPendingTabs() {
        try {
            const raw = GM_getValue(K.pendingTabs, '');
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }
    const writePendingTabs = list => GM_setValue(K.pendingTabs, JSON.stringify((list || []).slice(-12)));

    function addPendingTab(id, url) {
        let abs = url;
        try { abs = new URL(url, location.href).href; } catch (e) { /* ignore */ }
        const list = readPendingTabs().filter(i => i.id !== id && i.url !== abs);
        list.push({ id: id, url: abs, ts: Date.now() });
        writePendingTabs(list);
        return abs;
    }

    function matchPendingTab(entry) {
        try {
            const exp = new URL(entry.url);
            const cur = new URL(location.href);
            const rootHost = h => String(h || '').toLowerCase().replace(/^(www|cn)\./, '');
            if (rootHost(exp.hostname) !== rootHost(cur.hostname)) return false;
            if (exp.pathname.replace(/\/$/, '') !== cur.pathname.replace(/\/$/, '')) return false;
            if (exp.pathname.toLowerCase() === '/search') {
                const a = exp.searchParams.get('q');
                const b = cur.searchParams.get('q');
                return !!a && a === b;
            }
            return true;
        } catch (e) { return false; }
    }

    function readTabStates() {
        try {
            const raw = GM_getValue(K.tabStates, '');
            const m = raw ? JSON.parse(raw) : {};
            const now = Date.now();
            Object.keys(m).forEach(k => {
                if (!m[k] || now - m[k].at > CONFIG.tabStateTTL) delete m[k];
            });
            return m;
        } catch (e) { return {}; }
    }

    function markTabDone(id, extra) {
        try {
            const m = readTabStates();
            m[id] = Object.assign({ done: true, at: Date.now() }, extra || {});
            GM_setValue(K.tabStates, JSON.stringify(m));
        } catch (e) { /* ignore */ }
    }

    async function waitTabDone(id, timeoutMs) {
        const end = Date.now() + (timeoutMs || CONFIG.tabWaitTimeout);
        while (Date.now() < end) {
            if (state.paused) await waitWhilePaused();
            const m = readTabStates();
            if (m[id] && m[id].done) return true;
            await sleep(600);
        }
        return false;
    }

    /* ======================= 任务发现 ======================= */

    function parseProgress(text) {
        const m = String(text || '').match(/([^\s:：]{1,6})\s*[:：]\s*(\d{1,3})\s*\/\s*(\d{1,3})/);
        return m ? { label: m[1], cur: Number(m[2]), max: Number(m[3]) } : null;
    }

    function isDisabled(el) {
        if (!el) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        if (el.getAttribute('data-disabled') === 'true') return true;
        if (el.hasAttribute('disabled')) return true;
        return !!(el.closest && el.closest('[aria-disabled="true"],[data-disabled="true"]'));
    }

    function getSections() {
        return [...document.querySelectorAll('main section')].map(sec => {
            const h = sec.querySelector('h1,h2,h3');
            return { el: sec, title: h ? normText(h).slice(0, 40) : '' };
        });
    }

    function scanTasks() {
        const out = { search: null, streak: null, checkin: null, daily: [], punchcards: [], skipped: [], sections: [] };
        const secs = getSections();
        out.sections = secs.map(s => s.title);

        // 连续打卡任务区（/earn）
        const streakSec = secs.find(s => /连续打卡|打卡任务/.test(s.title));
        if (streakSec) {
            const seen = new Set();
            for (const card of streakSec.el.querySelectorAll('button,[role=button]')) {
                const t = normText(card);
                if (!t || t.length < 4 || seen.has(t)) continue;
                seen.add(t);
                const item = { el: card, text: t.slice(0, 70), progress: parseProgress(t) };
                if (/必应搜索连续打卡/.test(t)) out.search = item;
                else if (/每日连续打卡活动/.test(t)) out.streak = item;
                else if (/必应应用连续打卡/.test(t)) { item.skipReason = '移动端任务'; out.checkin = item; out.skipped.push(item); }
                else if (/Edge\s*浏览连续打卡/i.test(t)) { item.skipReason = '需 Edge 独立触发'; out.skipped.push(item); }
                else if (/印章/.test(t)) { item.skipReason = '进度展示项'; out.skipped.push(item); }
            }
        }

        // 每日活动区：/dashboard 叫「每日活动」，/earn 叫「日常任务」，卡片在两边分别是 a / span
        const dailySec = secs.find(s => /每日活动|日常任务/.test(s.title));
        if (dailySec) {
            const seen = new Set();
            for (const card of dailySec.el.querySelectorAll('a[href],span[href],[role=link]')) {
                const t = normText(card);
                if (!t || t.length < 4 || /提供反馈/.test(t) || seen.has(t)) continue;
                const href = card.getAttribute('href') || '';
                if (!href) continue;
                seen.add(t);

                const item = { el: card, text: t.slice(0, 70), href: href };

                if (/referandearn|redeem\/sku|\/about|\/faq|\/refer/.test(href)) {
                    item.skipReason = '推广或兑换入口';
                    out.skipped.push(item);
                    continue;
                }
                if (!/bing\.com|\/search\?q=/.test(href)) {
                    item.skipReason = '非搜索类任务卡';
                    out.skipped.push(item);
                    continue;
                }
                if (/已完成|completed/i.test(t)) {
                    item.skipReason = '页面显示已完成';
                    out.skipped.push(item);
                    continue;
                }
                if (isDisabled(card)) {
                    item.skipReason = '页面标记不可用（多为仅限 App）';
                    out.skipped.push(item);
                    continue;
                }
                out.daily.push(item);
            }
        }

        // 长期任务卡
        for (const a of document.querySelectorAll('a[href*="/earn/quest/"]')) {
            const t = normText(a);
            const m = t.match(/(\d+)\s*\/\s*(\d+)\s*个?任务/);
            out.punchcards.push({
                el: a, text: t.slice(0, 70), href: a.getAttribute('href') || '',
                done: m ? Number(m[1]) >= Number(m[2]) : false
            });
        }

        if (out.search && out.search.progress) state.search = Object.assign({}, out.search.progress);
        if (out.streak && out.streak.progress) state.dailyList = Object.assign({}, out.streak.progress);
        if (out.checkin && out.checkin.progress) state.checkin = Object.assign({}, out.checkin.progress);

        state.scan = out;
        return out;
    }

    /* ======================= 真实点击 ======================= */

    // 去掉 noopener：让新标签保留 window.opener，这样它才能自己 window.close()
    function stripNoopener(el) {
        const a = (el && el.matches && el.matches('a[href]')) ? el
            : (el && el.querySelector ? el.querySelector('a[href]') : null);
        if (!a) return null;
        const rel = a.getAttribute('rel') || '';
        if (!/noopener/i.test(rel)) return null;
        const cleaned = rel.replace(/noopener/ig, '').replace(/\s+/g, ' ').trim() || 'noreferrer';
        a.setAttribute('rel', cleaned);
        return { el: a, rel: rel };
    }

    function restoreRel(saved) {
        if (!saved) return;
        try { saved.el.setAttribute('rel', saved.rel); } catch (e) { /* ignore */ }
    }

    async function humanClick(el) {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ }
        await sleep(rand(260, 620));

        const doc = el.ownerDocument || document;
        const W = doc.defaultView || window;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) { log('  ⚠️ 目标不可见，跳过'); return false; }

        const cx = rect.left + rect.width * (0.4 + Math.random() * 0.2);
        const cy = rect.top + rect.height * (0.4 + Math.random() * 0.2);
        let target = el;
        try {
            const hit = doc.elementFromPoint(cx, cy);
            if (hit && el.contains(hit)) target = hit;
        } catch (e) { /* ignore */ }

        const base = {
            bubbles: true, cancelable: true, composed: true,
            button: 0, buttons: 1, clientX: Math.round(cx), clientY: Math.round(cy)
        };
        const fire = (name, extra) => {
            const Ctor = /^pointer/.test(name)
                ? (W.PointerEvent || window.PointerEvent) : (W.MouseEvent || window.MouseEvent);
            if (typeof Ctor !== 'function') return;
            const init = Object.assign({}, base, extra || {});
            if (/^pointer/.test(name)) { init.pointerType = 'mouse'; init.isPrimary = true; init.pointerId = 1; }
            try { target.dispatchEvent(new Ctor(name, init)); } catch (e) { /* ignore */ }
        };

        // 【关键】点击事件只能产生一次。
        // 对 <a target="_blank"> 而言，多派发一次 click 就会多开一个标签页 ——
        // 「点一次活动卡开两个标签」的根因正是这里：
        // 合成 click 事件 + 原生 .click() 叠加，等于点了两次。
        const isNativeAnchor = target.tagName === 'A' &&
            target.hasAttribute && target.hasAttribute('href');
        if (isNativeAnchor) {
            // 原生链接：单次原生 click 已能触发默认导航与 React 的 onClick
            try { target.click(); } catch (e) { /* ignore */ }
            return true;
        }

        // React 组件（如 span[role=link]）：先走指针事件链让 Pressable 进入 pressed 态。
        // 期间监听 window.open —— 如果 Pressable 在 pointerup 时已经自己发起了打开动作，
        // 就绝不能再补原生 click，否则同样会变成"点一次开两个标签"。
        let opened = false;
        const origOpen = window.open;
        try {
            window.open = function () { opened = true; return origOpen.apply(window, arguments); };
        } catch (e) { /* ignore */ }

        fire('pointerover'); fire('mouseover', { buttons: 0 });
        await sleep(rand(40, 110));
        fire('pointerdown'); fire('mousedown');
        await sleep(rand(60, 150));
        fire('pointerup', { buttons: 0 });
        fire('mouseup', { buttons: 0 });
        await sleep(700);

        try { window.open = origOpen; } catch (e) { /* ignore */ }
        if (!opened) {
            try { target.click(); } catch (e) { /* ignore */ }
        }
        return true;
    }

    async function ensureSectionExpanded(titleRe) {
        const sec = [...document.querySelectorAll('main section')]
            .find(s => titleRe.test(normText(s.querySelector('h1,h2,h3'))));
        if (!sec) return false;
        const btn = sec.querySelector('button[aria-expanded]');
        if (!btn || btn.getAttribute('aria-expanded') === 'true') return true;
        await humanClick(btn);
        await sleep(rand(600, 1200));
        return true;
    }

    /* ======================= 每日搜索计数 ======================= */

    function readTodaySearch() {
        try {
            const raw = GM_getValue(K.todaySearch, '');
            const d = raw ? JSON.parse(raw) : null;
            if (!d || d.date !== getDateHyphen()) return { date: getDateHyphen(), count: 0 };
            return { date: d.date, count: d.count || 0 };
        } catch (e) { return { date: getDateHyphen(), count: 0 }; }
    }

    function bumpTodaySearch(n) {
        const d = readTodaySearch();
        d.count += (n || 1);
        GM_setValue(K.todaySearch, JSON.stringify(d));
        return d.count;
    }

    /* ======================= 关键词 ======================= */

    function getSearchHost() { return GM_getValue(K.searchHost, '') || 'www.bing.com'; }
    function buildSearchUrl(q, host) {
        return 'https://' + (host || getSearchHost()) + '/search?q=' + encodeURIComponent(q) + '&form=QBLH';
    }

    async function fetchKeywordPool(minSize) {
        const pool = [];
        for (const api of CONFIG.hotApis.slice().sort(() => Math.random() - 0.5)) {
            try {
                const res = await gmRequest({ method: 'GET', url: api.url + pick(api.sources), timeout: 8000, retries: 0 });
                const d = JSON.parse(res);
                const arr = d && (d.data || d.result);
                if (Array.isArray(arr)) {
                    arr.forEach(it => {
                        const t = (it && (it.title || it.name)) || '';
                        if (t) pool.push(String(t).slice(0, 20));
                    });
                }
                if (pool.length >= minSize) break;
            } catch (e) { /* 换源 */ }
        }
        return pool;
    }

    async function buildKeywordQueue(n) {
        const pool = await fetchKeywordPool(Math.max(n, 12));
        const out = [], used = new Set();
        for (const q of pool.slice().sort(() => Math.random() - 0.5)) {
            if (out.length >= n) break;
            if (!q || used.has(q)) continue;
            used.add(q); out.push(q);
        }
        while (out.length < n) {
            const q = pick(CONFIG.fallbackKeywords) + ' ' + Math.random().toString(36).slice(2, 6);
            if (!used.has(q)) { used.add(q); out.push(q); }
        }
        return out;
    }

    /* ======================= 执行：单个步骤 ======================= */

    // 搜索步骤：用 GM_openInTab 开新标签（发起方持有句柄，可强制关闭）
    async function doSearchStep(step) {
        const id = uuid();
        addPendingTab(id, step.url);

        let tab = null;
        try {
            if (typeof GM_openInTab === 'function') {
                tab = GM_openInTab(step.url, { active: true, insert: true, setParent: true });
            } else {
                const w = window.open(step.url, '_blank');
                tab = w ? { close: () => { try { w.close(); } catch (e) { /* ignore */ } } } : null;
            }
        } catch (e) {
            log('  ❌ 打开新标签失败: ' + (e && e.message));
            return false;
        }

        log('  🔍 已在新标签搜索：「' + step.title + '」');
        const done = await waitTabDone(id, CONFIG.tabWaitTimeout);
        if (done) bumpTodaySearch(1);

        try { if (tab && typeof tab.close === 'function') tab.close(); } catch (e) { /* ignore */ }
        if (!done) log('  ⚠️ 新标签未回报完成（可能被拦截或加载超时），已尝试关闭');
        return done;
    }

    // 活动步骤：去 noopener + 真实点击，让卡片自己开新标签，新标签自我关闭
    async function doClickStep(step) {
        await ensureSectionExpanded(/每日活动|日常任务/);
        const tasks = scanTasks();
        const item = tasks.daily.find(d => d.text.slice(0, 26) === step.match);
        if (!item) { log('  ℹ️ 卡片已消失或已完成，跳过'); return null; }

        const id = uuid();
        addPendingTab(id, item.href);

        const savedRel = stripNoopener(item.el);
        if (savedRel) log('  🔓 已临时移除 noopener（否则新标签无法自我关闭）');

        await humanClick(item.el);
        setTimeout(() => restoreRel(savedRel), 5000);

        log('  🖱️ 已点击：「' + step.title.slice(0, 30) + '」');
        const done = await waitTabDone(id, CONFIG.tabWaitTimeout);
        if (done) log('  ✅ 任务页已完成并关闭');
        else log('  ⚠️ 未收到完成回报，请检查是否残留标签页');
        return done;
    }

    /* ======================= 执行：总流程 ======================= */

    async function buildSteps(kind) {
        const tasks = scanTasks();
        const steps = [];

        if (kind === 'all' || kind === 'search') {
            // 连续打卡搜索（未完成时补足）
            const sp = tasks.search && tasks.search.progress;
            if (!sp || sp.cur < sp.max) {
                const n = sp ? Math.max(1, sp.max - sp.cur) : CONFIG.streakSearchTarget;
                const qs = await buildKeywordQueue(n);
                qs.forEach((q, i) => steps.push({
                    type: 'search', url: buildSearchUrl(q), title: q,
                    note: '连续打卡搜索 ' + (i + 1) + '/' + n
                }));
            }
            // 搜索计分
            if (CONFIG.searchScoring.enabled) {
                const t = readTodaySearch();
                const need = Math.max(0, CONFIG.searchScoring.maxAttemptsPerDay - t.count);
                if (need > 0) {
                    const qs = await buildKeywordQueue(need);
                    qs.forEach((q, i) => steps.push({
                        type: 'search', url: buildSearchUrl(q), title: q, scoring: true,
                        note: '搜索计分 ' + (t.count + i + 1) + '/' + CONFIG.searchScoring.maxAttemptsPerDay
                    }));
                }
            }
        }

        if (kind === 'all' || kind === 'daily') {
            tasks.daily.forEach(it => steps.push({
                type: 'click',
                title: it.text,
                href: it.href,
                match: it.text.slice(0, 26),
                note: '活动点击：「' + it.text.slice(0, 24) + '」'
            }));
        }

        return steps;
    }

    async function runSteps(kind) {
        if (state.running) { log('⏳ 已有任务在执行中'); return; }
        state.running = true;
        updateAllButton();

        try {
            log('🧭 正在组装任务…（本页面不会跳转，任务都在新标签完成）');
            const steps = await buildSteps(kind);
            if (!steps.length) {
                log('✅ 没有需要执行的任务（今天可能已全部完成）');
                return;
            }
            log('📋 本次共 ' + steps.length + ' 步');

            let scoringCount = 0;
            let zeroBatches = 0;
            let lastPoints = state.points || 0;
            let stopScoring = false;

            for (let i = 0; i < steps.length; i++) {
                if (state.paused) await waitWhilePaused();
                const step = steps[i];
                if (stopScoring && step.scoring) continue;

                log('▶️ [' + (i + 1) + '/' + steps.length + '] ' + step.note);

                let ok = null;
                try {
                    ok = (step.type === 'search') ? await doSearchStep(step) : await doClickStep(step);
                } catch (e) {
                    log('  ❌ 步骤异常: ' + (e && e.message));
                }

                // 搜索计分：每 batchSize 次核对积分增量
                if (step.scoring && ok) {
                    scoringCount++;
                    if (scoringCount % CONFIG.searchScoring.batchSize === 0) {
                        await sleep(2500);
                        const p = await readPointsRetry(4);
                        if (p > lastPoints) {
                            log('  📈 积分 ' + lastPoints + ' → ' + p + '（+' + (p - lastPoints) + '）');
                            lastPoints = p;
                            zeroBatches = 0;
                        } else {
                            zeroBatches++;
                            log('  ⚠️ 本批积分未增长（连续 ' + zeroBatches + ' 批）');
                        }
                        render();
                        if (zeroBatches >= CONFIG.searchScoring.maxZeroBatches) {
                            log('  ✅ 判定搜索已达今日上限，跳过剩余计分步骤');
                            stopScoring = true;
                        }
                    }
                }

                await sleep(rand(CONFIG.stepDelay[0], CONFIG.stepDelay[1]));
            }

            log('🎉 全部任务执行完毕');
            await refreshOverview();
            render();
            if (typeof GM_notification === 'function') {
                try { GM_notification({ title: 'Microsoft Rewards', text: '今日任务执行完毕' }); } catch (e) { /* ignore */ }
            }
        } catch (e) {
            log('❌ 流程出错: ' + (e && e.message));
        } finally {
            state.running = false;
            updateAllButton();
        }
    }

    /* ======================= 运行控制 ======================= */

    async function waitWhilePaused() {
        if (!state.paused) return 0;
        if (!state.pausePromise) state.pausePromise = new Promise(r => { state.pauseResolver = r; });
        const t = Date.now();
        await state.pausePromise;
        return Date.now() - t;
    }

    function setPaused(p) {
        if (p === state.paused) return;
        state.paused = p;
        if (p) {
            if (!state.pausePromise) state.pausePromise = new Promise(r => { state.pauseResolver = r; });
            log('⏸️ 已暂停（新标签若已打开，请稍候或手动关闭）');
        } else if (state.pauseResolver) {
            const r = state.pauseResolver;
            state.pauseResolver = null;
            state.pausePromise = null;
            r();
            log('▶️ 已继续');
        }
        updateAllButton();
    }

    const markBusy = d => {
        state.busyCount = Math.max(0, state.busyCount + d);
        updateAllButton();
    };

    async function refreshOverview() {
        const domP = readPointsRetry(3);
        const info = await fetchBearerOverview();
        if (info) {
            if (info.balance !== undefined && info.balance > 0) state.points = info.balance;
            if (info.level) state.level = info.level;
        }
        const p = await domP;
        if (p > 0) state.points = p;
        scanTasks();
        render();
        return state.scan;
    }

    /* ======================= 日志 ======================= */

    const LOG_MAX = 300;
    function log(msg) {
        console.log('[MR4] ' + msg);
        if (!uiReady) return;
        try {
            const box = document.getElementById('mr-log');
            if (!box) return;
            const div = document.createElement('div');
            div.textContent = '[' + new Date().toLocaleTimeString().slice(0, 5) + '] ' + msg;
            box.appendChild(div);
            while (box.childNodes.length > LOG_MAX) box.removeChild(box.firstChild);
            box.scrollTop = box.scrollHeight;
        } catch (e) { /* ignore */ }
    }

    /* ======================= UI ======================= */

    GM_addStyle(`
        #mr-panel {
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #fff; border: 1px solid #e0e0e0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-radius: 8px;
        }
        #mr-panel.collapsed {
            width: 44px; height: 44px; border-radius: 50%; cursor: pointer;
            display: flex; justify-content: center; align-items: center;
            background: #fff; color: #0078d4;
            box-shadow: 0 4px 16px rgba(0,120,212,0.3);
            border: 1px solid #e0e0e0; transition: all 0.2s;
        }
        #mr-panel.collapsed:hover { transform: scale(1.1); }
        #mr-panel.collapsed svg { width: 24px; height: 24px; fill: currentColor; }
        #mr-panel.collapsed #mr-container { display: none; }
        #mr-panel:not(.collapsed) { width: 300px; }
        #mr-panel:not(.collapsed) svg { display: none; }
        #mr-header {
            padding: 12px 16px; border-bottom: 1px solid #eee;
            display: flex; justify-content: space-between; align-items: center;
            background: #f8f9fa; border-radius: 8px 8px 0 0;
        }
        #mr-title { font-weight: 600; font-size: 14px; color: #333; }
        #mr-close { cursor: pointer; color: #999; font-size: 18px; line-height: 1; }
        #mr-body { padding: 16px; }
        .mr-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #555; }
        .mr-progress-bg { height: 4px; background: #eee; border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
        .mr-bar { height: 100%; background: #0078d4; }
        .mr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
        .mr-btn {
            border: 1px solid #d0d0d0; background: #fff; color: #333;
            padding: 6px 10px; border-radius: 4px; font-size: 12px; cursor: pointer;
        }
        .mr-btn:hover { background: #f0f0f0; border-color: #bbb; }
        .mr-full { grid-column: span 2; background: #0078d4; color: #fff; border: none; }
        .mr-full:hover { background: #006abc; }
        #mr-auth { margin-bottom: 12px; padding: 10px; background: #fff8e1; border: 1px solid #ffe0b2; border-radius: 4px; }
        .mr-input { width: 100%; padding: 4px; border: 1px solid #ccc; font-size: 11px; margin: 4px 0; box-sizing: border-box; }
        #mr-log {
            margin-top: 12px; height: 120px; background: #fafafa; border: 1px solid #eee;
            padding: 8px; font-size: 10px; color: #666; overflow-y: auto; font-family: monospace;
        }
        #mr-summary { font-size: 11px; color: #666; margin-top: 10px; line-height: 1.7; }
        #mr4-task-overlay {
            position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
            background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
            padding: 10px 14px; color: #333;
            font: 12px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,.1);
        }
    `);

    const ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zm-9-2h2v2h-2V4zm0 16H6v-9h5v9zm6 0h-5v-9h5v9z"/></svg>';

    function buildPanel() {
        if (document.getElementById('mr-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'mr-panel';
        panel.className = 'collapsed';
        panel.innerHTML = ICON_SVG + `
            <div id="mr-container">
                <div id="mr-header">
                    <div id="mr-title"><span>🎁</span> Microsoft Rewards</div>
                    <div id="mr-close">×</div>
                </div>
                <div id="mr-body">
                    <div class="mr-row">
                        <span>等级 <span id="mr-level" style="font-weight:600">-</span></span>
                        <span style="color:#d83b01"><span id="mr-points">0</span> pts</span>
                    </div>

                    <div class="mr-row"><span>🔍 搜索计分</span><span id="mr-score">0/20</span></div>
                    <div class="mr-progress-bg"><div class="mr-bar" id="mr-score-bar"></div></div>

                    <div class="mr-row"><span>📋 每日活动</span><span id="mr-daily">0/0</span></div>
                    <div class="mr-progress-bg"><div class="mr-bar" id="mr-daily-bar" style="background:#ff8c00"></div></div>

                    <div class="mr-row"><span>✅ 签到</span><span id="mr-checkin">0/0</span></div>
                    <div class="mr-progress-bg"><div class="mr-bar" id="mr-checkin-bar" style="background:#107c10"></div></div>

                    <div id="mr-auth" style="display:none">
                        <div style="font-weight:bold;margin-bottom:5px">⚠️ 需授权</div>
                        <button class="mr-btn" id="mr-auth-link" style="width:100%">🔗 获取授权码</button>
                        <input type="text" id="mr-auth-in" class="mr-input" placeholder="粘贴回调 URL 或 code">
                        <button class="mr-btn" id="mr-auth-save" style="width:100%">保存</button>
                    </div>

                    <div class="mr-grid">
                        <button id="btn-scan" class="mr-btn">🔎 扫描任务</button>
                        <button id="btn-score" class="mr-btn">🔍 搜索计分</button>
                        <button id="btn-daily" class="mr-btn">📋 日常任务</button>
                        <button id="btn-clean" class="mr-btn">🧹 清理记录</button>
                        <button id="btn-all" class="mr-btn mr-full">🚀 一键全部执行</button>
                    </div>

                    <div id="mr-summary"></div>
                    <div id="mr-log"></div>
                </div>
            </div>`;
        document.body.appendChild(panel);
    }

    function render() {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const bar = (id, cur, max) => {
            const e = document.getElementById(id);
            if (e) e.style.width = max ? Math.min(100, (cur / max) * 100) + '%' : '0%';
        };
        const t = readTodaySearch();
        const target = CONFIG.searchScoring.maxAttemptsPerDay;
        set('mr-level', 'Lv.' + (state.level || '-'));
        set('mr-points', (state.points || 0).toLocaleString());
        set('mr-score', t.count + '/' + target);
        bar('mr-score-bar', t.count, target);
        set('mr-daily', state.dailyList.cur + '/' + state.dailyList.max);
        bar('mr-daily-bar', state.dailyList.cur, state.dailyList.max);
        set('mr-checkin', state.checkin.cur + '/' + state.checkin.max);
        bar('mr-checkin-bar', state.checkin.cur, state.checkin.max);
        updateAllButton();
    }

    function renderSummary(tasks) {
        const box = document.getElementById('mr-summary');
        if (!box || !tasks) return;
        const lines = ['<b>当天任务扫描</b>'];
        lines.push('可执行活动：' + tasks.daily.length + ' 个');
        lines.push('长期任务卡：' + tasks.punchcards.length + ' 个');
        lines.push('今日搜索计分：' + readTodaySearch().count + '/' + CONFIG.searchScoring.maxAttemptsPerDay + ' 次');
        if (tasks.skipped.length) {
            lines.push('<span style="color:#999">已跳过 ' + tasks.skipped.length + ' 项</span>');
        }
        box.innerHTML = lines.join('<br>');
    }

    function updateAllButton() {
        const b = document.getElementById('btn-all');
        if (!b) return;
        if (state.paused) b.textContent = '▶️ 继续执行';
        else if (state.running || state.busyCount > 0) b.textContent = '⏸️ 暂停执行';
        else b.textContent = '🚀 一键全部执行';
    }

    function bindUI() {
        const $ = id => document.getElementById(id);
        const panel = $('mr-panel');
        panel.onclick = () => { if (panel.classList.contains('collapsed')) panel.classList.remove('collapsed'); };
        $('mr-close').onclick = e => { e.stopPropagation(); panel.classList.add('collapsed'); };

        $('mr-auth-link').onclick = () => window.open(
            'https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455' +
            '&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL' +
            '&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf', '_blank');

        $('mr-auth-save').onclick = () => {
            const code = extractAuthCode($('mr-auth-in').value);
            if (!code) { log('❌ 请粘贴完整的回调 URL 或授权码'); return; }
            GM_setValue(K.authCode, code);
            log('✅ 授权码已保存，正在兑换…');
            getAccessToken({ preferCode: true }).then(tk => {
                if (tk) { $('mr-auth').style.display = 'none'; refreshOverview(); }
                else log('⚠️ 兑换失败，请重新获取授权码');
            });
        };

        $('btn-scan').onclick = async () => {
            markBusy(1);
            try {
                const t = await refreshOverview();
                renderSummary(t);
                log('🔎 扫描完成：可执行活动 ' + t.daily.length + ' 个');
                t.daily.forEach((d, i) => log('   ' + (i + 1) + '. ' + d.text.slice(0, 44)));
                t.skipped.slice(0, 6).forEach(s => log('   ⏭️ ' + s.text.slice(0, 30) + ' —— ' + s.skipReason));
            } finally { markBusy(-1); }
        };

        $('btn-score').onclick = async () => {
            markBusy(1);
            try { await runSteps('search'); } finally { markBusy(-1); }
        };

        $('btn-daily').onclick = async () => {
            markBusy(1);
            try { await runSteps('daily'); } finally { markBusy(-1); }
        };

        $('btn-clean').onclick = () => {
            writePendingTabs([]);
            GM_setValue(K.tabStates, '{}');
            log('🧹 已清理标签记录');
        };

        $('btn-all').onclick = async () => {
            if (state.running || state.busyCount > 0) { setPaused(!state.paused); return; }
            markBusy(1);
            updateAllButton();
            try { await refreshOverview(); await runSteps('all'); }
            finally { markBusy(-1); updateAllButton(); }
        };
    }

    /* ======================= 菜单 ======================= */

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('重置今日搜索计数', () => {
            GM_setValue(K.todaySearch, JSON.stringify({ date: getDateHyphen(), count: 0 }));
            log('🔄 今日搜索计数已重置');
        }, '诊断');
        GM_registerMenuCommand('重置搜索域名记忆', () => {
            GM_setValue(K.searchHost, '');
            log('🔄 搜索域名已重置');
        }, '诊断');
        GM_registerMenuCommand('清理标签记录', () => {
            writePendingTabs([]);
            GM_setValue(K.tabStates, '{}');
            log('🧹 已清理');
        }, '诊断');
    }

    /* ======================= 新标签页侧：任务页自我关闭 ======================= */

    function showTaskOverlay(text) {
        try {
            let box = document.getElementById('mr4-task-overlay');
            if (!box) {
                box = document.createElement('div');
                box.id = 'mr4-task-overlay';
                document.body.appendChild(box);
            }
            box.innerHTML = text;
        } catch (e) { /* ignore */ }
    }

    function handleTaskTab() {
        const pending = readPendingTabs();
        if (!pending.length) return false;
        const hit = pending.find(matchPendingTab);
        if (!hit) return false;

        // 一次性消费：立刻移除，避免 www→cn 重定向的第二跳重复处理
        writePendingTabs(pending.filter(i => i.id !== hit.id));

        const stay = rand(CONFIG.activityStay[0], CONFIG.activityStay[1]);
        showTaskOverlay('<b style="color:#0078d4">🎁 Rewards 任务页</b><br>' +
            '任务已记录 ✓<br><span style="color:#888">' + stay + ' 秒后自动关闭本标签</span>');

        setTimeout(() => {
            markTabDone(hit.id);
            showTaskOverlay('<b style="color:#0078d4">🎁 Rewards 任务页</b><br>' +
                '任务已记录 ✓<br><span style="color:#888">正在关闭…</span>');
            try { window.close(); } catch (e) { /* ignore */ }
            setTimeout(() => {
                if (!window.closed) {
                    showTaskOverlay('<b style="color:#0078d4">🎁 Rewards 任务页</b><br>' +
                        '任务已记录 ✓<br><span style="color:#d83b01">浏览器阻止自动关闭，请手动关闭本标签</span>');
                }
            }, 700);
        }, stay * 1000);

        return true;
    }

    /* ======================= 初始化 ======================= */

    async function bootstrap() {
        // 1) 授权回调页
        try {
            const code = extractAuthCode(location.href);
            if (code && GM_getValue(K.authCodeBad, '') !== code) {
                GM_setValue(K.authCode, code);
                getAccessToken({ preferCode: true });
            }
        } catch (e) { /* ignore */ }

        // 2) 新标签侧：若是被流程打开的任务页，停留后自我关闭
        if (handleTaskTab()) return;

        // 3) 只在 rewards 页面渲染主面板
        if (!isRewards()) return;

        buildPanel();
        uiReady = true;
        bindUI();
        await refreshOverview();
        renderSummary(state.scan);
        render();
        log('🌟 脚本就绪 v' + VERSION);
        log('ℹ️ 任务将在新标签中执行，本页面不会跳转');

        const today = getDateHyphen();
        if (GM_getValue(K.lastRunDate, '') !== today) {
            GM_setValue(K.lastRunDate, today);
            log('📅 新的一天，已扫描当天任务');
        }

        setInterval(() => {
            if (state.running || state.busyCount) return;
            readPointsOnce();
            render();
        }, 60000);
    }

    bootstrap().catch(e => console.error('[MR4] bootstrap error', e));

})();
