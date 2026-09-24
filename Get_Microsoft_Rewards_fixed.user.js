// ==UserScript==
// @name         Get Microsoft Rewards
// @namespace    http://tampermonkey.net/
// @version      1.0.2.0
// @description  微软 Rewards 助手 - 自动完成搜索、活动、签到、阅读任务，配备极简 UI 悬浮窗，一键全自动获取积分。（修复活动跨页面恢复、cookie API 兼容与进度核验）
// @updateURL    https://raw.githubusercontent.com/x1a0q1sx/microsoft-rewards-tampermonkey/main/Get_Microsoft_Rewards_fixed.user.js?v=1.0.1.55
// @downloadURL  https://raw.githubusercontent.com/x1a0q1sx/microsoft-rewards-tampermonkey/main/Get_Microsoft_Rewards_fixed.user.js?v=1.0.1.55
// @author       QingJ
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
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_log
// @connect      bing.com
// @connect      rewards.bing.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      login.live.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hot.baiwumm.com
// @connect      hotapi.nntool.cc
// @connect      cnxiaobai.com
// @license      MIT
// @run-at       document-end
// ==/UserScript==

    (function () {
        'use strict';

        // ========== 版本与就绪横幅 ==========
        const SCRIPT_VERSION = '1.0.2.0';
        // ========== 版本与安全增强 ==========
        const SCRIPT_VERSION = '1.0.2.0';
        // 安全增强：敏感凭证加密存储，活动完成验证改进
        const SCRIPT_UPDATE_URL = 'https://raw.githubusercontent.com/x1a0q1sx/microsoft-rewards-tampermonkey/main/Get_Microsoft_Rewards_fixed.user.js?v=1.0.2.0';
        window.__MR_VERSION__ = SCRIPT_VERSION;
        console.log(`%c🔒 Microsoft Rewards v${SCRIPT_VERSION} 安全增强版就绪`,
            'color:#fff;background:#0078d4;padding:2px 8px;border-radius:4px;font-weight:bold');
        console.log('📌 新特性：敏感凭证加密存储、活动完成验证改进');
    const SCRIPT_UPDATE_URL = 'https://raw.githubusercontent.com/x1a0q1sx/microsoft-rewards-tampermonkey/main/Get_Microsoft_Rewards_fixed.user.js?v=1.0.1.55';
        window.__MR_VERSION__ = SCRIPT_VERSION;
        console.log('%c🔔 Microsoft Rewards 助手 v' + SCRIPT_VERSION + ' 已就绪',
            'color:#fff;background:#0078d4;padding:2px 8px;border-radius:4px;font-weight:bold');
        console.log('📌 若版本号低于此值，说明 Tampermonkey 仍运行旧副本，请重新导入或在 TM 菜单点"检查更新"。');

    // ========== 配置 ==========
        const CONFIG = {
            pc: { minDelay: 5000, maxDelay: 8000 },
            mobile: { minDelay: 20000, maxDelay: 35000 },
        ua: {
            pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.81',
            mobile: 'Mozilla/5.0 (Linux; Android 16; MCE16 Build/BP3A.250905.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 EdgA/123.0.2420.102'
        },
        // 多个热搜API备用源
        hotApis: [
            { url: 'https://hot.baiwumm.com/api/', sources: ['weibo', 'douyin', 'baidu', 'zhihu', 'toutiao'] },
            { url: 'https://hotapi.nntool.cc/', sources: ['weibo', 'douyin', 'baidu', 'toutiao', 'zhihu'] },
            { url: 'https://cnxiaobai.com/DailyHotApi/', sources: ['weibo', 'douyin', 'baidu', 'toutiao'] }
        ],
        keywords: ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略"],
        // 暂停机制配置
        pause: {
            enabled: true,           // 是否启用暂停机制
            interval: 10,            // 每执行多少次搜索后暂停
            duration: 60 * 1000 // 暂停时长（毫秒），1分钟
        }
    };

    // ========== 状态 ==========
    let state = {
        level: 1, points: 0,
        pcCur: 0, pcMax: 0,
        mobileCur: 0, mobileMax: 0,
        promosTotal: 0, promosDone: 0,
        signDone: false, signPoints: -1,
        readCur: 0, readMax: 0,
        pcSearchOk: true, mobSearchOk: true, // 账户是否具备 PC/移动 搜索额度（区域限制自动检测）
        todayEarned: 0, todayEarnedSource: '',
        taskTabCompleted: 0,
        running: false,
        accessToken: null,
        accessTokenExpiresAt: 0,
        updating: false,
        updatingPromise: null,
        // 新增：搜索进度和暂停状态
        searchCount: 0,           // 当前搜索计数（用于暂停判断）
        isPaused: false,          // 是否处于暂停状态
        pauseEndTime: 0,          // 暂停结束时间戳
        countdownStartTime: 0,    // 倒计时开始时间（精确计时）
        countdownDuration: 0,     // 倒计时总时长
        manualPaused: false,      // 手动暂停
        pausePromise: null,
        pauseResolver: null,
        // 修复相关
        busyCount: 0,
        allRunning: false,
        authNeeded: false
    };
    let dashboard = null;
    let loginCookie = '';
    // 密钥管理键名（普通存储，无需加密）
    const STORAGE_KEYS = [
        STORAGE_KEY,          // 搜索进度
        PENDING_PROMO_KEY,    // 待办活动
        PROMO_RESUME_KEY,     // 恢复意图
        TASK_TABS_KEY,        // 任务标签
        TASK_TAB_STATES_KEY,  // 任务状态
        DAILY_POINTS_KEY,     // 今日积分
        AUTO_CLOSE_TAB_KEY    // 自动关闭标记
    ];
    // 敏感数据加密存储键名
    const ENCRYPTED_KEYS = ['refresh_token', 'auth_code'];
    // 普通数据存储键名（不含敏感信息）
    const NORMAL_KEYS = [];
    // 默认只在悬浮窗显示关键结果；完整诊断仍保留在代码中，排障时可改为 true。
    const SHOW_DETAIL_LOGS = false;
    const MAX_ACTIVITY_ATTEMPTS = 3;
    const DAILY_STREAK_KEY_VERSION = 2;
    const getActivityTitle = item => String(
        item?.title || item?.attributes?.title || item?.offerId || item?.attributes?.offerid || '未知活动'
    ).replace(/\s+/g, ' ').trim().slice(0, 40);
    const getActivityError = error => error?.status
        ? `HTTP ${error.status}`
        : (error?.message || '未知错误');
    let promoPageReady = false;
    let dailyStreakGroupHandled = false;
    let autoCloseAfterPromo = false;
    let autoCloseMarkerId = '';
    let autoCloseTabMode = false;
    let autoCloseMarkerKind = '';
    let autoCloseMarkerOpenedInNewTab = false;
    let lastDataLogSignature = '';
    let lastDashboardSource = '';
    let lastQuotaLogSignature = '';

    // ========== 进度保存/恢复 ==========
    const STORAGE_KEY = 'mr_search_progress';

    function saveProgress() {
        const today = getDateHyphen();
        const data = {
            date: today,
            searchCount: state.searchCount
        };
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function loadProgress() {
        try {
            const saved = GM_getValue(STORAGE_KEY);
            if (!saved) return null;
            const data = JSON.parse(saved);
            // 只恢复当天的进度
            if (data.date === getDateHyphen()) {
                state.searchCount = data.searchCount || 0;
                return data;
            }
        } catch (e) { }
        return null;
    }

    async function withAccessTokenRequest(requestFn) {
        let token = await getAccessToken();
        if (!token) return null;
        try {
            return await requestFn(token);
        } catch (e) {
            if (e && e.status === 401) {
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                token = await getAccessToken({ forceRefresh: true });
                if (!token) throw e;
                return await requestFn(token);
            }
            throw e;
        }
    }

    function resetProgress() {
        state.searchCount = 0;
        GM_setValue(STORAGE_KEY, '');
    }

    // ========== 工具函数 ==========
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomPick = arr => arr[Math.floor(Math.random() * arr.length)];
    const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const uuid = () => crypto.randomUUID();
    const getDateStr = () => {
        const d = new Date();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    const getDateHyphen = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const isJSON = s => { try { JSON.parse(s); return true; } catch { return false; } };

    // ========== 加密/解密工具（安全增强）==========
    // 使用简单 XOR + base64 加密（Tampermonkey 环境限制，无法使用 Web Crypto API）
    const SECRET_KEY = 'rewards_secret_key_' + location.hostname.split('.').slice(-2).join('') || 'default';

    function encrypt(data) {
        if (!data) return '';
        try {
            const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
            const bytes = new TextEncoder().encode(plaintext);
            const encrypted = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                encrypted[i] = bytes[i] ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
            }
            return btoa(String.fromCharCode(...encrypted));
        } catch (e) {
            console.warn('[MR] 加密失败:', e.message);
            return '';
        }
    }

    function decrypt(encryptedBase64) {
        if (!encryptedBase64) return null;
        try {
            const bytes = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
            const decryptedBytes = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                decryptedBytes[i] = bytes[i] ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
            }
            return new TextDecoder().decode(decryptedBytes);
        } catch (e) {
            console.warn('[MR] 解密失败:', e.message);
            return null;
        }
    }

    // 检查是否支持 Web Crypto API（未来升级用）
    const supportsCryptoAPI = typeof window !== 'undefined' && window.crypto && window.crypto.subtle;

    // 安全的 GM_setValue 包装器
    function safeSetValue(key, value) {
        const isEncryptedKey = ENCRYPTED_KEYS.includes(key);
        const storedKey = isEncryptedKey ? `enc_${key}` : key;
        const storedValue = isEncryptedKey ? encrypt(value) : value;
        GM_setValue(storedKey, storedValue);
    }

    // 安全的 GM_getValue 包装器
    function safeGetValue(key) {
        const isEncryptedKey = ENCRYPTED_KEYS.includes(key);
        const storedKey = isEncryptedKey ? `enc_${key}` : key;
        const storedValue = GM_getValue(storedKey);
        if (isEncryptedKey) {
            const decrypted = decrypt(storedValue);
            try {
                // 尝试解析为 JSON
                return JSON.parse(decrypted);
            } catch (_) {
                return decrypted;
            }
        }
        return storedValue;
    }

    // 删除敏感数据（用于退出或清理）
    function clearSensitiveData() {
        ENCRYPTED_KEYS.forEach(key => {
            safeSetValue(key, '');
        });
    }

    // ========== GM_xmlhttpRequest 封装 ==========
    async function gmRequest(options) {
        const retries = options.retries ?? 2;
        const retryDelay = options.retryDelay ?? 1000;
        let attempt = 0;

        const shouldRetry = (err) => {
            const status = err?.status || 0;
            return status === 0 || status === 429 || status >= 500 || err?.message === 'Timeout';
        };

        while (true) {
            try {
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        timeout: 20000,
                        ...options,
                        onload: xhr => {
                            // 诊断模式：无论状态码都返回 {status, text, finalUrl}，不吞 4xx/3xx 真实响应
                            if (options.withStatus) {
                                resolve({ status: xhr.status, text: xhr.responseText, finalUrl: xhr.finalUrl });
                            } else if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(options.returnUrl ? xhr.finalUrl : xhr.responseText);
                            } else if (xhr.status >= 300 && xhr.status < 400) {
                                const loc = xhr.responseHeaders.match(/Location:\s*(.*?)\s*[\r\n]/i);
                                resolve(loc ? loc[1] : xhr.responseText);
                            } else {
                                const err = new Error(`HTTP ${xhr.status}`);
                                err.status = xhr.status;
                                err.responseText = xhr.responseText;
                                err.finalUrl = xhr.finalUrl;
                                reject(err);
                            }
                        },
                        onerror: () => {
                            const err = new Error('Network Error');
                            err.status = 0;
                            reject(err);
                        },
                        ontimeout: () => {
                            const err = new Error('Timeout');
                            err.status = 0;
                            reject(err);
                        }
                    });
                });
            } catch (e) {
                if (attempt >= retries || !shouldRetry(e)) throw e;
                const delay = retryDelay * Math.pow(2, attempt);
                attempt++;
                await sleep(delay + randomRange(0, 250));
            }
        }
    }

    // 获取热搜词（支持多源自动切换）
    async function getHotQuery() {
        // 打乱API顺序，随机选择
        const apis = [...CONFIG.hotApis].sort(() => Math.random() - 0.5);

        for (const api of apis) {
            try {
                const src = randomPick(api.sources);
                const res = await gmRequest({ method: 'GET', url: api.url + src, timeout: 8000 });
                const data = JSON.parse(res);
                if (data.code === 200 && data.data?.length) {
                    const title = randomPick(data.data).title || '';
                    // 随机截取长度，更自然
                    const len = randomRange(8, 25);
                    return title.substring(0, len);
                }
            } catch { /* 尝试下一个API */ }
        }
        // 所有API都失败，使用本地关键词
        return `${randomPick(CONFIG.keywords)} ${Math.random().toString(36).slice(2, 6)}`;
    }

    // Cookie 管理
    function getCookies(url) {
        return new Promise(resolve => {
            let settled = false;
            const done = value => {
                if (settled) return;
                settled = true;
                resolve(value || '');
            };
            try {
                if (typeof GM_cookie === 'undefined' || !GM_cookie) {
                    return done('');
                }
                const callback = (cookies) => {
                    if (!cookies || !Array.isArray(cookies)) return done('');
                    const str = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    done(str);
                };
                if (typeof GM_cookie.list === 'function') {
                    GM_cookie.list({ url }, callback);
                } else if (typeof GM_cookie === 'function') {
                    GM_cookie('list', { url }, callback);
                } else {
                    done('');
                }
                setTimeout(() => done(''), 3000);
            } catch (e) {
                done('');
            }
        });
    }

    function deleteCookie(name, host = 'bing.com') {
        return new Promise(resolve => {
            try {
                const details = { url: `https://${host}`, name };
                if (typeof GM_cookie !== 'undefined' && GM_cookie && typeof GM_cookie.delete === 'function') {
                    GM_cookie.delete(details, resolve);
                } else if (typeof GM_cookie === 'function') {
                    GM_cookie('delete', details, resolve);
                } else resolve();
            } catch (e) { resolve(); }
        });
    }

    // ========== 样式 (极简版) ==========
    GM_addStyle(`
        #mr-panel {
            position: fixed;
            bottom: 20px;
            left: 20px;
            right: auto;
            display: block;
            min-width: 44px;
            min-height: 44px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #fff;
            border: 1px solid #e0e0e0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-radius: 8px;
        }

        /* 收起状态 */
        #mr-panel.collapsed {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #fff;
            color: #0078d4;
            box-shadow: 0 4px 16px rgba(0,120,212,0.3);
            border: 1px solid #e0e0e0;
            transition: all 0.2s;
        }
        #mr-panel.collapsed:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(0,120,212,0.4); }
        #mr-panel.collapsed svg { width: 24px; height: 24px; fill: currentColor; }
        #mr-panel.collapsed #mr-container { display: none; }

        /* 展开状态 */
        #mr-panel:not(.collapsed) { width: 300px; }
        #mr-panel:not(.collapsed) svg { display: none; }

        #mr-header {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8f9fa;
            border-radius: 8px 8px 0 0;
        }
        #mr-title { font-weight: 600; font-size: 14px; color: #333; }
        #mr-close { cursor: pointer; color: #999; font-size: 18px; line-height: 1; }
        #mr-close:hover { color: #333; }

        #mr-body { padding: 16px; }

        .mr-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #555; }
        .mr-val { font-weight: 600; color: #333; }

        .mr-progress-bg { height: 4px; background: #eee; border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
        .mr-bar { height: 100%; background: #0078d4; }

        .mr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
        .mr-btn {
            border: 1px solid #d0d0d0;
            background: #fff;
            color: #333;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .mr-btn:hover { background: #f0f0f0; border-color: #bbb; }
        .mr-btn:active { background: #e5e5e5; }
        .mr-full { grid-column: span 2; background: #0078d4; color: #fff; border: none; }
        .mr-full:hover { background: #006abc; }

        /* Auth */
        #mr-auth { margin-bottom: 12px; padding: 10px; background: #fff8e1; border: 1px solid #ffe0b2; border-radius: 4px; }
        .mr-input { width: 100%; padding: 4px; border: 1px solid #ccc; font-size: 11px; margin: 4px 0; }

        /* Log */
        #mr-log {
            margin-top: 12px;
            height: 80px;
            background: #fafafa;
            border: 1px solid #eee;
            padding: 8px;
            font-size: 10px;
            color: #666;
            overflow-y: auto;
            font-family: monospace;
        }
    `);

    // ========== UI 结构 ==========
    const panel = document.createElement('div');
    panel.id = 'mr-panel';
    panel.className = 'collapsed'; // 默认折叠
    // 礼盒 SVG
    const svgIcon = `<svg viewBox="0 0 24 24"><path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zm-9-2h2v2h-2V4zm0 16H6v-9h5v9zm6 0h-5v-9h5v9zm1.5-11H16V7h2v2zm-4.5 0h-2V7h2v2zm-4.5 0H7V7h2v2zm-3.5 0H4V7h1.5v2z"/></svg>`;

    panel.innerHTML = `
        ${svgIcon}
        <div id="mr-container">
            <div id="mr-header">
                <div id="mr-title"><span>🎁</span> Microsoft Rewards</div>
                <div id="mr-close">×</div>
            </div>

            <div id="mr-body">
                <!-- 状态 -->
                <div class="mr-row">
                    <span>等级 <span id="mr-level" style="font-weight:600">-</span></span>
                    <span style="color:#d83b01"><span id="mr-points">0</span> pts</span>
                </div>

                <!-- 进度 -->
                <div class="mr-row"><span>💰 今日积分</span><span id="mr-today" style="font-weight:600;color:#0078d4">+0</span></div>

                <div class="mr-row"><span>💻 PC搜索</span><span id="mr-pc">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-pc-bar"></div></div>

                <div class="mr-row"><span>📱 移动搜索</span><span id="mr-mobile">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-mobile-bar"></div></div>

                <div class="mr-row"><span>📖 阅读任务</span><span id="mr-read">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-read-bar" style="background:#ff8c00"></div></div>

                <!-- 授权 -->
                <div id="mr-auth" style="display:none">
                    <div style="font-weight:bold;margin-bottom:5px">⚠️ 需授权</div>
                    <button class="mr-btn" id="mr-auth-link" style="width:100%">🔗 获取授权码</button>
                    <input type="text" id="mr-auth-in" class="mr-input" placeholder="粘贴URL...">
                    <button class="mr-btn" id="mr-auth-save" style="width:100%">保存</button>
                </div>

                <!-- 按钮 -->
                <div class="mr-grid">
                    <button id="btn-search" class="mr-btn">🔍 搜索</button>
                    <button id="btn-promo" class="mr-btn">🎯 活动 <span id="val-promo">0/0</span></button>
                    <button id="btn-sign" class="mr-btn">✅ 每日活动签到</button>
                    <button id="btn-read" class="mr-btn">📖 阅读</button>
                    <button id="btn-all" class="mr-btn mr-full">🚀 一键全部执行</button>
                </div>

                <!-- 日志 -->
                <div id="mr-log"></div>
            </div>
        </div>
    `;
    const mountPanel = () => {
        const target = document.body || document.documentElement;
        if (target && !target.querySelector('#mr-panel')) target.appendChild(panel);
    };
    mountPanel();
    // Rewards 是 React 页面，偶尔会在首屏后续重绘中移除脚本节点；这里自动补回。
    new MutationObserver(() => {
        if (!document.getElementById('mr-panel')) mountPanel();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // 元素引用
    const $ = id => document.querySelector(id);
    const nodes = {
        panel: $('#mr-panel'),
        close: $('#mr-close'),
        level: $('#mr-level'),
        points: $('#mr-points'),
        pc: $('#mr-pc'),
        pcBar: $('#mr-pc-bar'),
        mob: $('#mr-mobile'),
        mobBar: $('#mr-mobile-bar'),
        read: $('#mr-read'),
        readBar: $('#mr-read-bar'),
        btnSearch: $('#btn-search'),
        btnPromo: $('#btn-promo'),
        valPromo: $('#val-promo'),
        today: $('#mr-today'),
        btnSign: $('#btn-sign'),
        btnRead: $('#btn-read'),
        btnAll: $('#btn-all'),
        boxAuth: $('#mr-auth'),
        btnAuthLink: $('#mr-auth-link'),
        inAuth: $('#mr-auth-in'),
        btnAuthSave: $('#mr-auth-save'),
        logBox: $('#mr-log')
    };

    // ========== 交互逻辑 ==========

    // 展开/收起
    nodes.panel.onclick = (e) => {
        if (nodes.panel.classList.contains('collapsed')) {
            nodes.panel.classList.remove('collapsed');
        }
    };
    nodes.close.onclick = (e) => {
        e.stopPropagation();
        nodes.panel.classList.add('collapsed');
    };

    const LOG_MAX_LINES = 100;
    const isDetailLog = (msg) => {
        if (SHOW_DETAIL_LOGS) return false;
        const text = String(msg || '').trim();
        // 错误和警告始终保留；其余只隐藏高频诊断、长 URL 和逐项底层请求。
        if (/^[❌⚠️]/.test(text) || /失败|错误/.test(text)) return false;
        return [
            /^🔍 dailySet 位置/, /^🔍 顶层keys/, /^🔍 dashboard\.keys/, /^🔍 response\.keys/,
            /^🔍 任务集\(/, /^🔎 dapi promos/, /^🔎 子卡:/, /^🧪/,
            /token来源|子活动页无 token|未获取到活动Token/,
            /^🔍 捕获 code/, /^🔑 dapi\/me/, /POST 失败，回退 GET/,
            /^\s*🖱️ 尝试页面内点击完成/, /已 click 卡片元素/,
            /^▶️ 执行:/, /dest=/, /页面点击(?:完成|未命中卡片|异常)/,
            /上报成功|已上报/, /已获取活动Token/, /^⏳ 等待 \d+ 秒/, /^📊 当前搜索计数:/,
            /^📖 阅读文章 /, /^✓ [📱💻]/, /^✓ 数据已更新:/
        ].some(pattern => pattern.test(text));
    };
    const log = (msg) => {
        if (isDetailLog(msg)) return;
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString().slice(0, 5)}] ${msg}`;
        nodes.logBox.appendChild(div);
        while (nodes.logBox.childNodes.length > LOG_MAX_LINES) {
            nodes.logBox.removeChild(nodes.logBox.firstChild);
        }
        nodes.logBox.scrollTop = nodes.logBox.scrollHeight;
    };

    const updateAllButton = () => {
        if (!nodes.btnAll) return;
        if (state.manualPaused) {
            nodes.btnAll.textContent = '▶️ 继续执行';
        } else if (state.running || state.allRunning || state.busyCount > 0) {
            nodes.btnAll.textContent = '⏸️ 暂停执行';
        } else {
            nodes.btnAll.textContent = '🚀 一键全部执行';
        }
    };

    const setManualPause = (paused, opts = {}) => {
        if (paused === state.manualPaused) return;
        const silent = !!opts.silent;
        state.manualPaused = paused;
        if (paused) {
            if (!state.pausePromise) {
                state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
            }
        } else if (state.pauseResolver) {
            const resolve = state.pauseResolver;
            state.pauseResolver = null;
            state.pausePromise = null;
            resolve();
        }
        updateAllButton();
        if (!silent) {
            log(paused ? '⏸️ 已手动暂停' : '▶️ 已继续执行');
        }
    };

    const markBusy = (delta) => {
        state.busyCount = Math.max(0, (state.busyCount || 0) + delta);
        updateAllButton();
    };

    const waitWhilePaused = async () => {
        if (!state.manualPaused) return 0;
        if (!state.pausePromise) {
            state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
        }
        const start = Date.now();
        await state.pausePromise;
        return Date.now() - start;
    };

    // 授权相关
    const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf';

    nodes.btnAuthLink.onclick = () => window.open(AUTH_URL, '_blank');

    // 从完整 URL 或直接授权码中稳健提取 code
    // URL 里的 code 是 percent-encoded；先解码一次，后续兑换时再编码一次。
    // 保留 '+' 而不用 URLSearchParams，避免微软授权码中的字面加号被误转为空格。
    const safeDecodeAuthCode = value => {
        try {
            return decodeURIComponent(value);
        } catch (_) {
            return value;
        }
    };
    function extractAuthCode(raw) {
        if (!raw) return null;
        raw = raw.trim();
        if (raw.includes('code=')) {
            const m = raw.match(/[?&]code=([^&?#]+)/);
            if (m && m[1]) return safeDecodeAuthCode(m[1]);
        }
        const c = raw.split(/[&\s]/)[0].trim();          // 直接粘贴的裸 code
        // 回调页消费 code 后可能变成 ...?removed=true；这不是授权码，不能当 code 兑换。
        if (/^https?:\/\//i.test(c) && !c.includes('code=')) return null;
        return c || null;
    }

    nodes.btnAuthSave.onclick = () => {
        const code = extractAuthCode(nodes.inAuth.value);
        if (code) {
            safeSetValue('auth_code', code);              // 保存解码后的逻辑值；发送时统一 encode 一次
            state.authNeeded = false;
            nodes.boxAuth.style.display = 'none';
            log('✅ 授权码已保存，正在兑换 token...');
            (async () => {
                const token = await getAccessToken({ preferCode: true });
                if (token) {
                    log('🔑 授权成功，可开始任务');
                    await updateData();
                } else {
                    nodes.boxAuth.style.display = 'block';
                    state.authNeeded = true;
                    log('⚠️ 兑换失败，请检查授权码是否有效或重新获取');
                }
            })();
        } else {
            log('❌ 格式错误：请粘贴完整回调 URL 或授权码');
        }
    };
    updateAllButton();

    // 一键导出原始 Dashboard（用于精准定位每日任务集结构）
    function exportRawDashboard() {
        const ds = window.__MR_DS__ || (window.__MR_DASH__ && (window.__MR_DASH__.dashboard?.dailySetPromotions || window.__MR_DASH__.response?.dailySetPromotions || window.__MR_DASH__.dailySetPromotions));
        if (!window.__MR_DASH__) {
            log('⚠️ 还没抓取过数据，请先点一次「🚀 一键全部执行」或等自动刷新');
            return;
        }
        let out;
        if (ds) {
            const key = Object.keys(ds).find(k => Array.isArray(ds[k]) && ds[k].length) || Object.keys(ds)[0];
            out = { dailySetKey: key, items: (ds[key] || []).map(p => ({
                offerId: p.offerId, hash: p.hash, title: p.title,
                type: p.type || p.completionType, complete: p.complete,
                pointProgress: p.pointProgress, pointProgressMax: p.pointProgressMax,
                allKeys: Object.keys(p)
            })) };
        } else {
            out = { note: '响应中未找到 dailySetPromotions', topKeys: Object.keys(window.__MR_DASH__),
                dashKeys: window.__MR_DASH__.dashboard ? Object.keys(window.__MR_DASH__.dashboard) : [],
                respKeys: window.__MR_DASH__.response ? Object.keys(window.__MR_DASH__.response) : [] };
        }
        const json = JSON.stringify(out, null, 2);
        console.log('[MR] 原始Dashboard:\n' + json);
        try { window.prompt('已生成原始数据，请全选复制发给我（完整版也在控制台 F12）:', json); } catch {}
        log('📋 已导出到控制台(F12)，或弹窗里复制发我');
    }
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('导出原始Dashboard JSON', exportRawDashboard, '诊断');
        GM_registerMenuCommand('扫描页面可执行活动卡片', scanActivityCards, '诊断');
        // 重放最近一次缓存的 dashboard，离线核对 normalizePromotions 抓取逻辑（无需浏览器回传）
        GM_registerMenuCommand('重放最近Dashboard(本地验证)', () => {
            let raw = null;
            try { raw = GM_getValue('mr_dashboard_cache'); } catch {}
            if (!raw) { log('⚠️ 无缓存：请先点一次「🚀 一键全部执行」生成缓存'); return; }
            let data;
            try { data = JSON.parse(raw); } catch (e) { log('⚠️ 缓存解析失败: ' + e.message); return; }
            // 用真实逻辑重放，核对 dailySet 抓取
            const promos = normalizePromotions(data, data);
            window.__MR_DASH__ = data;
            const ds = data.dashboard?.dailySetPromotions || data.response?.dailySetPromotions || data.dailySetPromotions;
            const dsCount = ds ? Object.values(ds).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) : 0;
            log('🧪 重放验证: 缓存 dashboard 解析成功');
            log(`🧪 dailySet 项数=${dsCount} | 归一化 promos 总数=${promos.length}`);
            log('🧪 web(有hash)项=' + promos.filter(p => p.offerId && p.hash).length +
                ' | dapi(无hash)项=' + promos.filter(p => !p.hash && p.attributes && p.attributes.offerid).length);
            // 打印前若干 dailySet 子活动字段，便于核对打卡 token/进度
            if (ds) {
                const items = [];
                for (const k of Object.keys(ds)) if (Array.isArray(ds[k])) items.push(...ds[k]);
                items.slice(0, 6).forEach((p, i) => log(`🧪 [${i + 1}] ${p.title || '?'} | offerId=${p.offerId || '?'} | hash=${(p.hash || '').slice(0, 8) || '无'} | prog=${p.pointProgress}/${p.pointProgressMax} | complete=${p.complete}`));
            }
            log('🧪 重放完成。若 dailySet 项数>0 且 web 项有 hash，则抓取逻辑正常。');
        }, '诊断');
    }

    async function checkAuth() {
        const code = safeGetValue('auth_code');
        if (!code) {
            nodes.boxAuth.style.display = 'block';
            log('⚠️ 请先获取授权码');
            return false;
        }
        return code;
    }

    // ========== Dashboard 获取（兼容 cookie / Bearer 两种鉴权，修复 401） ==========

    // 方式1：rewards.bing.com 会话 cookie（原逻辑，显式带 cookie 更稳）
    async function fetchDashboardViaCookie() {
        const url = `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`;
        const headers = {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: 'https://rewards.bing.com/'
        };
        // 当前页面已经在 rewards.bing.com 时，用页面同源 fetch 才能稳定带上登录 Cookie。
        if (location.origin === 'https://rewards.bing.com') {
            try {
                const r = await fetch(url, { headers, credentials: 'include', cache: 'no-store' });
                const t = await r.text();
                if (r.ok && t && t.startsWith('{')) return t;
            } catch (_) {}
        }
        const cookie = await getCookies('https://rewards.bing.com');
        return await gmRequest({
            url,
            headers: {
                ...headers,
                ...(cookie ? { Cookie: cookie } : {})
            },
            anonymous: false,
            retries: 0
        });
    }

    // 方式2：OAuth Bearer（与 sign/read 一致，不依赖 rewards.bing.com cookie）
    async function fetchDashboardViaToken(token) {
        return await gmRequest({
            url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613&_=' + Date.now(),
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Rewards-AppId': 'SAAndroid/31.4.2110003555',
                'X-Rewards-IsMobile': 'true',
                'X-Rewards-Country': 'cn',
                'Content-Type': 'application/json'
            }
        });
    }

    // Chrome 里旧版 Rewards API 可能拿不到 userStatus；SAAndroid 又不给 PC 计数器。
    // Bing Flyout 是浏览器侧数据源，能补上 PCSearch/MobileSearch。
    function mapBingFlyoutData(flyout) {
        const status = flyout?.flyoutResult?.userStatus;
        const profile = flyout?.profile || flyout?.userInfo?.profile;
        const counters = status?.counters;
        if (!status || !counters) {
            throw new Error('Bing Flyout 未返回完整账户数据');
        }
        const nonuser = String(profile?.attributes?.nonuser || '').toLowerCase() === 'true';
        const hasCounterData = Object.values(counters).some(arr =>
            Array.isArray(arr) && arr.some(x => Number(x?.pointProgressMax ?? 0) > 0 || Number(x?.pointProgress ?? 0) > 0)
        );
        if (nonuser || !hasCounterData) {
            throw new Error('Bing Flyout 返回游客/空账户数据');
        }
        return {
            profile,
            dashboard: {
                ...flyout.flyoutResult,
                userStatus: {
                    ...status,
                    availablePoints: status.availablePoints ?? flyout.userInfo.balance ?? 0,
                    counters: {
                        pcSearch: counters.PCSearch ?? counters.pcSearch ?? [],
                        mobileSearch: counters.MobileSearch ?? counters.mobileSearch ?? [],
                        activityAndQuiz: counters.ActivityAndQuiz ?? counters.activityAndQuiz ?? [],
                        dailyPoint: counters.DailyPoint ?? counters.dailyPoint ?? []
                    }
                },
                dailySetPromotions: flyout.flyoutResult?.dailySetPromotions ?? {},
                morePromotions: flyout.flyoutResult?.morePromotions ?? []
            }
        };
    }

    async function requestBingFlyoutOnce(url) {
        const u = new URL(url);
        const headers = {
            Accept: 'application/json',
            Referer: `${u.origin}/`,
            Origin: u.origin,
            'X-Requested-With': 'XMLHttpRequest'
        };
        if (location.origin === u.origin) {
            const r = await fetch(url, { headers, credentials: 'include', cache: 'no-store' });
            const t = await r.text();
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return t;
        }
        const cookie = await getCookies(u.origin);
        return await gmRequest({
            url,
            headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
            anonymous: !!cookie,
            retries: 0
        });
    }

    async function fetchDashboardViaBingFlyout() {
        const qs = `channel=BingFlyout&partnerId=BingRewards&_=${Date.now()}`;
        const candidates = [];
        if (location.hostname === 'rewards.bing.com') {
            candidates.push(`${location.origin}/rewards/panelflyout/getuserinfo?${qs}`);
        }
        candidates.push(`https://www.bing.com/rewards/panelflyout/getuserinfo?${qs}`);
        candidates.push(`https://cn.bing.com/rewards/panelflyout/getuserinfo?${qs}`);

        let lastError = null;
        for (const url of candidates) {
            try {
                return mapBingFlyoutData(JSON.parse(await requestBingFlyoutOnce(url)));
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error('Bing Flyout 请求失败');
    }

    function readDomAccountSnapshot() {
        const snapshot = { points: 0, level: 0 };
        try {
            const nodes = [...document.querySelectorAll(
                'button[aria-label*="profile" i],button[aria-label*="个人资料"],[role="button"],[aria-label*="Rewards" i]'
            )];
            const texts = nodes.map(el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
            texts.push((document.body?.innerText || '').slice(0, 4000));
            for (const text of texts) {
                const pointMatch = text.match(/([\d,]{3,})\s*pts/i) || text.match(/积分[：:\s]*([\d,]{3,})/i);
                if (pointMatch) {
                    const value = Number(pointMatch[1].replace(/,/g, ''));
                    if (value > snapshot.points) snapshot.points = value;
                }
                const levelMatch = text.match(/Lv\.?\s*(\d+)/i);
                if (levelMatch) snapshot.level = Math.max(snapshot.level, Number(levelMatch[1]) || 0);
            }
        } catch (_) {}
        return snapshot;
    }

    // 归一化 promotion 列表，兼容两种返回结构
    function normalizePromotions(dash, data) {
        const d = new Date();
        // 多种日期格式兜底：微软不同接口/区域对 dailySetPromotions 的 key 格式不一致
        const dateKeys = [
            `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
            `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`,
            `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        ];
        const resp = data.response || data;
        // 候选容器：dashboard / response / data 本身 / data.dashboard，覆盖 cookie 与 Bearer 两种 schema
        const sources = [dash, resp, data, data.dashboard].filter(Boolean);
        let list = [];
        let dsHit = false;
        for (const src of sources) {
            if (src.dailySetPromotions) {
                for (const key of dateKeys) {
                    if (Array.isArray(src.dailySetPromotions[key])) { list.push(...src.dailySetPromotions[key]); dsHit = true; }
                }
                // 兜底：日期 key 格式对不上时，把 dailySetPromotions 下所有数组都收进来（去重由后面处理）
                if (!dsHit) {
                    for (const k of Object.keys(src.dailySetPromotions)) {
                        if (Array.isArray(src.dailySetPromotions[k])) list.push(...src.dailySetPromotions[k]);
                    }
                }
            }
            if (Array.isArray(src.morePromotions)) list.push(...src.morePromotions);
            if (Array.isArray(src.promotions)) list.push(...src.promotions);
        }
        const seen = new Set();
        const out = [];
        for (const p of list) {
            const id = p.offerId || p.id || (p.attributes && p.attributes.offerid);
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            out.push(p);
        }
        dash.promotions = out;
        return out;
    }

    // 数据刷新
    async function updateData() {
        if (state.updatingPromise) return state.updatingPromise;
        state.updating = true;
        state.updatingPromise = (async () => {
            try {
                let data = null, source = null;

                // 1) rewards.bing.com 会话 cookie（结构最全：含 dailySet/morePromotions）
                try {
                    const cookie = await getCookies('https://rewards.bing.com');
                    let r = null, lastErr = null;
                    // getuserinfo 偶发被截断（返回 200 但 JSON 不完整）→ 校验后重试一次
                    for (let attempt = 0; attempt < 2 && !r; attempt++) {
                        try {
                            const resp = await gmRequest({
                                url: `https://rewards.bing.com/api/getuserinfo?type=1&_=${Date.now()}`,
                                headers: {
                                    'X-Requested-With': 'XMLHttpRequest',
                                    'Referer': 'https://rewards.bing.com/',
                                    ...(cookie ? { 'Cookie': cookie } : {})
                                },
                                anonymous: !!cookie
                            });
                            JSON.parse(resp); // 校验完整性，截断则抛错进入重试
                            r = resp;
                        } catch (e) { lastErr = e; if (attempt < 1) await sleep(600); }
                    }
                    if (r) {
                        const d = JSON.parse(r);
                        if (d && (d.dashboard?.userStatus || d.response?.userStatus)) { data = d; source = 'cookie'; lastDashboardSource = source; }
                    } else if (lastErr && lastErr.status !== 401) {
                        log('🍪 getuserinfo: ' + lastErr.message);
                    }
                } catch (e) {
                    if (e.status !== 401) log('🍪 getuserinfo: ' + e.message);
                }

                // Bing Flyout 兜底：Chrome 下旧 API/移动 API 可能缺失 PCSearch 计数器
                if (!data) {
                    try {
                        data = await fetchDashboardViaBingFlyout();
                        source = 'BingFlyout';
                        lastDashboardSource = source;
                    } catch (e) {
                        log('⚠️ Bing Flyout 数据获取失败: ' + e.message);
                    }
                }

                // === 调试：确认 dailySetPromotions 实际位置与每日任务集字段 ===
                if (data) {
                    const dsSrc = data.dashboard?.dailySetPromotions || data.response?.dailySetPromotions || data.dailySetPromotions;
                    const dsLoc = data.dashboard?.dailySetPromotions ? 'dashboard'
                        : data.response?.dailySetPromotions ? 'response'
                        : data.dailySetPromotions ? 'data'
                        : 'ABSENT';
                    const dsKeys = dsSrc ? Object.keys(dsSrc) : [];
                    log('🔍 dailySet 位置: ' + dsLoc + ' | keys: ' + JSON.stringify(dsKeys));
                    log('🔍 顶层keys: ' + JSON.stringify(Object.keys(data).slice(0, 20)));
                    if (data.dashboard) log('🔍 dashboard.keys: ' + JSON.stringify(Object.keys(data.dashboard).slice(0, 30)));
                    if (data.response) log('🔍 response.keys: ' + JSON.stringify(Object.keys(data.response).slice(0, 30)));
                    // 抓任意一个 key 下的原始条目，打印真实字段，便于精准匹配
                    let sample = null, sampleKey = null;
                    if (dsSrc) {
                        for (const k of dsKeys) { if (Array.isArray(dsSrc[k]) && dsSrc[k].length) { sample = dsSrc[k]; sampleKey = k; break; } }
                    }
                    if (sample) {
                        log('🔍 任务集(key=' + sampleKey + ') 样例: ' + JSON.stringify(sample.slice(0, 4).map(p => ({
                            offerId: p.offerId, hash: (p.hash || '').slice(0, 8), title: p.title,
                            type: p.type || p.completionType, complete: p.complete,
                            prog: p.pointProgress, max: p.pointProgressMax,
                            allKeys: Object.keys(p)
                        }))));
                    }
                    // 存全局，供菜单命令导出原始 JSON
                    window.__MR_DASH__ = data;
                    window.__MR_DS__ = dsSrc || null;
                    // 持久化最近一次原始 dashboard，供"重放验证"菜单离线核对抓取逻辑
                    try { GM_setValue('mr_dashboard_cache', JSON.stringify(data)); } catch (e) {}
                }

                // 2) OAuth Bearer 兜底（与签到/阅读同源，已验证可用）
                //    关键：cookie 返回 200 但无 userStatus（跨站 cookie 被拦/未鉴权）时也必须走这里
                if (!data) {
                    const token = await getAccessToken();
                    if (!token) {
                        log('🔑 未拿到 access_token（token 兑换失败或未授权）');
                    } else {
                        log('🔑 access_token 就绪，尝试 dapi/me...');
                        // 先试 options=613，拿不到 userStatus 再试不带 options 的全量接口
                        const optList = [613, ''];
                        for (const opt of optList) {
                            try {
                                const r = await gmRequest({
                                    url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid' + (opt !== '' ? `&options=${opt}` : '') + '&_=' + Date.now(),
                                    headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'X-Rewards-AppId': 'SAAndroid/31.4.2110003555',
                                        'X-Rewards-IsMobile': 'true',
                                        'X-Rewards-Country': 'cn',
                                        'Content-Type': 'application/json'
                                    }
                                });
                                const d = JSON.parse(r);
                                const rr = d && d.response;
                                // dapi/me 用 balance/counters/promotions 结构（无 userStatus），需一并接受
                                if (d && (rr?.userStatus || d.dashboard?.userStatus ||
                                          (rr && (rr.balance !== undefined || rr.counters || rr.promotions)))) {
                                    data = d; source = 'Bearer'; lastDashboardSource = source; break;
                                }
                                const topKeys = d ? Object.keys(d).join(',') : '(空)';
                                const respKeys = rr ? Object.keys(rr).join(',') : '(无 response)';
                                log(`🔑 dapi/me(opt=${opt || '无'}) 200 但结构未知 | top: ${topKeys} | resp: ${respKeys}`);
                                console.warn('[MR] dapi/me raw:', String(r).slice(0, 600));
                            } catch (e) {
                                log('🔑 dapi/me' + (opt !== '' ? `(opt=${opt})` : '') + ' 请求失败: ' + e.message);
                            }
                        }
                    }
                }

                if (!data) {
                    state.authNeeded = true;
                    nodes.boxAuth.style.display = 'block';
                    log('⚠️ 获取数据失败：请登录 rewards.bing.com 或完成 OAuth 授权');
                    return;
                }

                const resp = data.response || {};
                const dashCookie = data.dashboard || null;
                // 两种 schema：
                //  A) cookie getuserinfo → dashboard.userStatus.{availablePoints,levelInfo,counters}
                //  B) Bearer dapi/me    → response.{balance,profile,counters,promotions}（无 userStatus）
                const user = (dashCookie && dashCookie.userStatus) || resp.userStatus || {};

                // 积分：优先 userStatus.availablePoints，其次 dapi 的 response.balance
                if (user.availablePoints !== undefined) {
                    state.points = user.availablePoints || 0;
                } else if (resp.balance !== undefined) {
                    state.points = resp.balance || 0;
                }

                // 等级：userStatus.levelInfo 或 dapi 的 profile.attributes
                let rawLevel = user.levelInfo?.activeLevel
                    || resp.profile?.attributes?.level
                    || resp.profile?.attributes?.epuserstate
                    || '';
                const lvNum = parseInt(String(rawLevel).replace(/\D/g, ''));
                if (lvNum) state.level = lvNum;

                // API 偶发延迟/返回游客数据时，用页面当前显示值兜底。
                const domSnapshot = readDomAccountSnapshot();
                if (domSnapshot.points > 0) state.points = domSnapshot.points;
                if (domSnapshot.level > 0) state.level = domSnapshot.level;

                // 搜索计数器：两种 schema 的 counters 都是 {pcSearch:[],mobileSearch:[]}
                const c = user.counters || resp.counters || {};
                let pc = 0, pcM = 0, mob = 0, mobM = 0;
                const sumCounter = (arr, add) => {
                    if (Array.isArray(arr)) arr.forEach(i => add(i.pointProgress || 0, i.pointProgressMax || i.pointMax || 0));
                };
                sumCounter(c.pcSearch, (p, m) => { pc += p; pcM += m; });
                sumCounter(c.mobileSearch, (p, m) => { mob += p; mobM += m; });

                // 搜索额度可用性：API 是否真的返回了搜索计数器（CN 等区域不返回 → 无搜索分，自动跳过）
                state.pcSearchOk = !!(Array.isArray(c.pcSearch) && c.pcSearch.length);
                state.mobSearchOk = !!(Array.isArray(c.mobileSearch) && c.mobileSearch.length);

                if (mobM === 0 && state.level > 1) mobM = 60;
                if (pcM === 0) pcM = state.level > 1 ? 150 : 90;

                state.pcCur = pc; state.pcMax = pcM;
                state.mobileCur = mob; state.mobileMax = mobM;

                const quotaLog = `⚠️ 搜索额度：PC ${pc}/${pcM}（${state.pcSearchOk ? '有计数器' : '无计数器'}） | 移动 ${mob}/${mobM}（${state.mobSearchOk ? '有计数器' : '无计数器'}） | 来源 ${lastDashboardSource || 'unknown'}`;
                if (quotaLog !== lastQuotaLogSignature) {
                    lastQuotaLogSignature = quotaLog;
                    log(quotaLog);
                }

                // promotion 列表：cookie schema 用 dashboard.dailySet/more；dapi schema 用 response.promotions
                dashboard = dashCookie || resp;
                let allP = normalizePromotions(dashboard, data);
                if ((!allP || allP.length === 0) && Array.isArray(resp.promotions)) {
                    allP = resp.promotions;
                }
                const isDone = (p) => p.complete === true || p.complete === 'True'
                    || p.attributes?.complete === 'True' || p.attributes?.complete === true
                    || p.attributes?.state === 'Complete';
                state.promosTotal = allP.length;
                state.promosDone = allP.filter(isDone).length;

                // 今日积分只认 Bing/Rewards 官方字段；counters 可能是周/月累计，不能当今日。
                const officialProfile = data?.profile?.attributes || data?.dashboard?.userProfile?.attributes || {};
                const officialTodayRaw = officialProfile.todays_points ?? officialProfile.daily_points ??
                    officialProfile.todaysPoints ?? officialProfile.dailyPoints;
                const officialToday = Number(officialTodayRaw);
                let todayEarned = Number.isFinite(officialToday) && officialToday >= 0 ? officialToday : 0;
                let todayEarnedSource = Number.isFinite(officialToday) ? 'official' : '';
                if (!todayEarnedSource) {
                    // 没有官方今日字段时宁可不显示，避免把累计积分当今日积分。
                    todayEarnedSource = 'unavailable';
                }

                state.todayEarned = todayEarned;
                state.todayEarnedSource = todayEarnedSource || 'unavailable';

                state.authNeeded = false;
                nodes.boxAuth.style.display = 'none';
                render();
                const todayText = state.todayEarnedSource === 'unavailable' ? '今日 --' : `今日 +${state.todayEarned}`;
                const dataLog = `✓ 数据已更新: Lv.${state.level} ${state.points}pts | ${todayText} | PC ${pc}/${pcM} 移动 ${mob}/${mobM} 活动 ${state.promosDone}/${state.promosTotal}`;
                if (dataLog !== lastDataLogSignature) {
                    lastDataLogSignature = dataLog;
                    log(dataLog);
                }
            } catch (e) {
                console.error('updateData error:', e);
                log(`⚠️ 获取数据出错: ${e.message}`);
            } finally {
                state.updating = false;
                state.updatingPromise = null;
            }
        })();
        return state.updatingPromise;
    }

    function render() {
        nodes.level.textContent = `Lv.${state.level}`;
        nodes.points.textContent = state.points.toLocaleString();
        if (nodes.today) nodes.today.textContent = state.todayEarnedSource === 'unavailable' ? '--' : `+${state.todayEarned}`;

        if (state.pcSearchOk === false) {
            nodes.pc.textContent = '无搜索额度';
            nodes.pcBar.style.width = '0%';
        } else {
            nodes.pc.textContent = `${state.pcCur}/${state.pcMax}`;
            nodes.pcBar.style.width = state.pcMax ? `${(state.pcCur / state.pcMax) * 100}%` : '0%';
        }

        if (state.mobSearchOk === false) {
            nodes.mob.textContent = '无搜索额度';
            nodes.mobBar.style.width = '0%';
        } else {
            nodes.mob.textContent = `${state.mobileCur}/${state.mobileMax}`;
            nodes.mobBar.style.width = state.mobileMax ? `${(state.mobileCur / state.mobileMax) * 100}%` : '0%';
        }

        nodes.read.textContent = `${state.readCur}/${state.readMax}`;
        nodes.readBar.style.width = state.readMax ? `${(state.readCur / state.readMax) * 100}%` : '0%';

        nodes.valPromo.textContent = `${state.promosDone}/${state.promosTotal}`;
    }

    // Token 获取
    let tokenExchangeBusy = false;
    const AUTH_CODE_CLAIM_KEY = 'auth_code_claim';
    const TOKEN_EXCHANGE_OWNER = uuid();

    const readAuthCodeClaim = () => {
        try {
            return JSON.parse(GM_getValue(AUTH_CODE_CLAIM_KEY) || 'null');
        } catch (_) {
            return null;
        }
    };

    const releaseAuthCodeClaim = () => {
        const claim = readAuthCodeClaim();
        if (claim?.owner === TOKEN_EXCHANGE_OWNER) GM_setValue(AUTH_CODE_CLAIM_KEY, '');
    };

    async function claimAuthCodeExchange(code) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const claim = readAuthCodeClaim();
            if (claim?.code === code && claim.owner !== TOKEN_EXCHANGE_OWNER &&
                Date.now() - Number(claim.at || 0) < 15000) return false;

            GM_setValue(AUTH_CODE_CLAIM_KEY, JSON.stringify({
                owner: TOKEN_EXCHANGE_OWNER,
                code,
                at: Date.now()
            }));
            await sleep(80 + randomRange(0, 160));

            const confirmed = readAuthCodeClaim();
            if (confirmed?.owner === TOKEN_EXCHANGE_OWNER) return true;
            if (confirmed?.code === code && Date.now() - Number(confirmed.at || 0) < 15000) return false;
        }
        return false;
    }

    async function getAccessToken(opts = {}) {
        const forceRefresh = !!opts.forceRefresh;
        const preferCode = !!opts.preferCode;
        const now = Date.now();
        if (!forceRefresh && !preferCode && state.accessToken && state.accessTokenExpiresAt && now < (state.accessTokenExpiresAt - 60000)) {
            return state.accessToken;
        }
        if (forceRefresh) {
            state.accessToken = null;
            state.accessTokenExpiresAt = 0;
        }

        // 自动捕获与手动保存可能同时触发，避免并发重复兑换
        if (tokenExchangeBusy) {
            for (let i = 0; i < 16 && tokenExchangeBusy; i++) await sleep(500);
            if (state.accessToken) return state.accessToken;
        }

        const code = safeGetValue('auth_code');
        let refreshToken = safeGetValue('refresh_token');

        if (!code && !refreshToken) {
            nodes.boxAuth.style.display = 'block';
            log('⚠️ 请先获取授权码');
            return null;
        }

        // 刚粘贴/捕获到新授权码 → 优先用 code 兑换；否则用 refresh_token 续期
        let useCode = !!code && (preferCode || !refreshToken);

        // 一次性 code 必须全局只兑换一次：回调页和已打开的 Rewards 页会共享 GM 存储。
        if (useCode && !(await claimAuthCodeExchange(code))) {
            for (let i = 0; i < 16; i++) {
                await sleep(500);
                const latestRefresh = safeGetValue('refresh_token');
                if (latestRefresh) {
                    refreshToken = latestRefresh;
                    useCode = false;
                    break;
                }
                if (safeGetValue('auth_code') !== code) break;
            }
            if (useCode) {
                log('🔑 授权码正由另一个标签页兑换，本页稍后刷新数据');
                return null;
            }
        }

        // 调试：打印捕获到的 code 特征，便于定位 invalid_grant（格式错/过期/已用/被篡改）
        if (code) {
            const flags = ['len=' + code.length];
            if (code.includes('+')) flags.push('含+');
            if (code.includes('%')) flags.push('含%');
            if (code.includes('/')) flags.push('含/');
            if (!/^M\./.test(code)) flags.push('无M.前缀');
            log('🔍 捕获 code: ' + code.slice(0, 10) + '… [' + flags.join(', ') + ']');
        }

        const base = 'https://login.live.com/oauth20_token.srf';
        const params = {
            client_id: '0000000040170455',
            scope: 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'
        };
        if (useCode) {
            params.code = code;                          // code 为原始值，这里只 encode 一次
            params.redirect_uri = 'https://login.live.com/oauth20_desktop.srf';
            params.grant_type = 'authorization_code';
        } else {
            params.refresh_token = refreshToken;
            params.grant_type = 'REFRESH_TOKEN';
        }
        const body = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');

        const doExchange = (usePost) => gmRequest({
            method: usePost ? 'POST' : 'GET',
            url: usePost ? base : `${base}?${body}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            ...(usePost ? { data: body } : {}),
            anonymous: true
        });

        tokenExchangeBusy = true;
        try {
            const grantLabel = useCode ? 'auth_code' : 'refresh_token';
            log(`🔑 兑换 token（${grantLabel}）...`);
            let res;
            try {
                res = await doExchange(true);            // 首选标准 POST
            } catch (e1) {
                if (e1?.status === 400 && e1.responseText) {
                    // OAuth 400 的 body 就是 token 错误 JSON；回退 GET 只会重复消费一次性 code。
                    res = e1.responseText;
                } else if (e1 && e1.status === 0) {
                    log('🔑 POST 失败，回退 GET 方式...');
                    res = await doExchange(false);
                } else {
                    throw e1;
                }
            }
            const data = JSON.parse(res);
            if (data.access_token) {
                state.accessToken = data.access_token;
                state.accessTokenExpiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0;
                if (data.refresh_token) safeSetValue('refresh_token', data.refresh_token);
                if (useCode) safeSetValue('auth_code', '');   // 一次性码用完即清
                state.authNeeded = false;
                nodes.boxAuth.style.display = 'none';
                log('🔑 token 兑换成功');
                return data.access_token;
            } else if (data.error) {
                // 打印微软返回的具体错误码，便于区分 code 过期 / 已使用 / 区域限制
                log(`❌ token 兑换失败: ${data.error}${data.error_description ? ' - ' + String(data.error_description).slice(0, 160) : ''}`);
                if (useCode) safeSetValue('auth_code', '');
                else safeSetValue('refresh_token', '');
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                nodes.boxAuth.style.display = 'block';
                if (data.error === 'invalid_grant' || data.error === 'invalid_request') {
                    state.authNeeded = true;
                    if (useCode) GM_setValue('auth_code_bad', code);
                    log('⚠️ 授权码已失效，请重新点击「🔗 获取授权码」拿新码（旧码一次性，不可重复使用）');
                }
            } else {
                log('❌ token 响应异常（无 access_token/error），顶层key: ' + Object.keys(data).join(','));
            }
        } catch (e) {
            // 微软在 400 时仍会在响应体返回 JSON 错误，解析出来给用户看真实原因
            let detail = e.status ? 'HTTP ' + e.status : e.message;
            let errName = '';
            try {
                const errJson = JSON.parse(e.responseText || '{}');
                if (errJson.error) {
                    errName = errJson.error;
                    detail += ` | ${errJson.error}${errJson.error_description ? ': ' + String(errJson.error_description).slice(0, 160) : ''}`;
                }
            } catch (_) {}
            log('❌ token 请求异常: ' + detail);
            // invalid_grant/invalid_request：code 失效/已用/格式错，不可恢复，清掉废 code 避免死循环
            if (errName === 'invalid_grant' || errName === 'invalid_request') {
                safeSetValue('auth_code', '');
                GM_setValue('auth_code_bad', code);
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                state.authNeeded = true;
                nodes.boxAuth.style.display = 'block';
                log('⚠️ 授权码已失效，请重新点击「🔗 获取授权码」拿新码（旧码一次性，不可重复使用）');
            }
        } finally {
            tokenExchangeBusy = false;
            if (useCode) releaseAuthCodeClaim();
        }
        return null;
    }

    // 每日活动签到：使用 Rewards 页面卡片流程。
    // 移动 App 签到（SAAndroid/type=103）需要真实手机端环境，浏览器脚本不再伪造该请求。
    const runSign = async () => {
        if (state.busyCount > 0 && !state.allRunning) {
            log('⚠️ 当前已有任务执行中，请等待完成');
            return;
        }
        nodes.btnSign.disabled = true;
        try {
            log('⏳ 开始执行每日活动签到（页面卡片流程）...');
            await runPromo(true);
        } catch (e) {
            log('❌ 每日活动签到出错: ' + (e?.message || '未知错误'));
        } finally {
            nodes.btnSign.disabled = false;
        }
    };
    nodes.btnSign.onclick = runSign;

    // 阅读
    const runRead = async () => {
        nodes.btnRead.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 开始阅读任务...');
        try {
            const info = await withAccessTokenRequest(token => gmRequest({
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
            }));
            if (info) {
                const d = JSON.parse(info);
                const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                if (p) {
                    let cur = +p.attributes.progress, max = +p.attributes.max;
                    state.readCur = cur; state.readMax = max; render();

                    if (cur >= max) { log('✅ 阅读任务已完成'); }
                    else {
                        for (let i = cur; i < max; i++) {
                            await waitWhilePaused();
                            log(`📖 阅读文章 ${i + 1}/${max}`);
                            await withAccessTokenRequest(token => gmRequest({
                                method: 'POST',
                                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                                headers: {
                                    'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
                                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true', 'X-Rewards-Country': 'cn'
                                },
                                data: JSON.stringify({
                                    amount: 1, country: 'cn', id: uuid(), type: 101, attributes: { offerid: 'ENUS_readarticle3_30points' }
                                })
                            }));
                            await sleep(2500);
                            state.readCur++; render();
                        }
                        log('✅ 阅读完成');
                    }
                }
            }
        } catch (e) { log('❌ 阅读出错'); }
        nodes.btnRead.disabled = false;
        markBusy(-1);
    };
    nodes.btnRead.onclick = runRead;

    // 获取 Reward Token (活动专用 __RequestVerificationToken)
    // 策略：子活动页(destinationUrl, 服务端渲染带表单) → 单一稳定正则提取表单 token；
    // 失败再回退一层 DOM input 兜底。SPA 仪表盘 HTML 不含该 token，故不再全量扫描。
    // 同一 URL 的 token 走缓存，避免重复拉取。
    const _tokenCache = new Map();
    async function fetchTokenFromUrl(url) {
        // 放宽：不再硬排除 rewards.bing.com（其活动子页含 token 表单）。
        // 仅对纯 bing.com 搜索结果页（/search 通常无 token 表单）静默返回，让上层回退 DOM 兜底。
        if (!url) return null;
        if (_tokenCache.has(url)) return _tokenCache.get(url);
        const cookie = await getCookies('https://rewards.bing.com');
        try {
            const html = await gmRequest({
                url,
                headers: { 'Accept': 'text/html,application/xhtml+xml', ...(cookie ? { 'Cookie': cookie } : {}) },
                anonymous: !!cookie
            });
            // 服务端渲染页的 token 是标准隐藏 input 表单字段，单一正则即可稳定命中
            const m = html && html.match(/<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/i);
            const t = m && m[1] && m[1].length > 12 ? m[1] : null;
            _tokenCache.set(url, t);
            if (t) log('🔑 token来源: ' + url + ' (len=' + html.length + ')');
            else log('🔍 子活动页无 token 表单: ' + url + ' (len=' + (html ? html.length : 0) + ')');
            return t;
        } catch (e) {
            _tokenCache.set(url, null);
            log('🔍 拉取 ' + url + ' 失败: ' + e.message);
            return null;
        }
    }
    async function getSearchToken(activityUrl) {
        // 1) 子活动页（服务端渲染，最可靠）：支持 rewards.bing.com 与 www.bing.com 各类活动子页
        if (activityUrl && /^https?:\/\/(www\.|cn\.|rewards\.)?bing\.com\//i.test(activityUrl)) {
            const t = await fetchTokenFromUrl(activityUrl);
            if (t) return t;
        }
        // 2) 轻量 DOM 兜底：页面上若已存在隐藏 input/meta（部分活动内页会带）
        try {
            const el = document.querySelector('input[name="__RequestVerificationToken"], meta[name="__RequestVerificationToken"]');
            if (el) {
                const v = el.value || el.getAttribute('content');
                if (v) { log('🔑 token来源: DOM'); return v; }
            }
        } catch (e) {}
        log('🔍 未获取到活动Token（子活动页 + DOM 兜底均未命中）');
        return null;
    }

    // 新版 Rewards 已逐步废弃旧 reportactivity 接口；当旧 token 不可用时，
    // 从 /earn 的 Next.js bundle 中发现 reportActivity Server Action 并直接调用。
    const REWARDS_ORIGIN = 'https://rewards.bing.com';
    let rewardsActionContext = null;
    let rewardsActionContextPromise = null;
    let rewardsActionUnavailable = '';

    async function fetchRewardsText(url, accept, cookie) {
        return await gmRequest({
            url,
            headers: {
                Accept: accept,
                ...(cookie ? { Cookie: cookie } : {})
            },
            anonymous: !!cookie
        });
    }

    function extractRewardsActionIds(js) {
        const byName = {};
        const seen = new Set();
        const hex = '[a-f0-9]{40,64}';
        const knownNonNames = new Set(['callServer', 'findSourceMapURL', 'encodeFormAction', 'default']);
        const patterns = [
            new RegExp(`createServerReference\\s*\\)?\\s*\\(\\s*"(${hex})"([\\s\\S]{0,800}?)\\)`, 'g'),
            new RegExp(`registerServerReference\\s*\\)?\\s*\\([^,]+,\\s*"(${hex})"([\\s\\S]{0,800}?)\\)`, 'g')
        ];

        for (const pattern of patterns) {
            for (const match of js.matchAll(pattern)) {
                const id = match[1];
                if (!id || seen.has(id)) continue;
                seen.add(id);
                const names = [...String(match[2] || '').matchAll(/"([A-Za-z_$][\w$]*)"/g)]
                    .map(item => item[1])
                    .filter(name => !knownNonNames.has(name) && name.length > 3);
                if (names.length) byName[names[names.length - 1]] = id;
            }
        }
        return byName;
    }

    function extractDynamicRewardsChunks(js) {
        const paths = new Set();
        for (const match of js.matchAll(/"(static\/(?:immutable|chunks|media)\/[\w\-./()]+?\.js)"/g)) {
            paths.add('/_next/' + match[1]);
        }
        for (const match of js.matchAll(/\b(\d{2,6}):"([a-f0-9]{12,})"/g)) {
            paths.add(`/_next/static/chunks/${match[1]}-${match[2]}.js`);
            paths.add(`/_next/static/chunks/${match[1]}.${match[2]}.js`);
        }
        return [...paths];
    }

    function rewardsRouterStateTree() {
        const refreshFlag = 4096;
        const tree = [
            '',
            {
                children: [
                    '(nav)',
                    {
                        children: [
                            'earn',
                            { children: ['PAGE', {}, null, null, refreshFlag] },
                            null,
                            null,
                            refreshFlag
                        ]
                    },
                    null,
                    null,
                    refreshFlag
                ]
            },
            null,
            null,
            refreshFlag + 16
        ];
        return encodeURIComponent(JSON.stringify(tree));
    }

    function buildRewardsDeploymentId(html) {
        return html.match(/[?&](?:amp;)?dpl=([A-Za-z0-9._-]+)/i)?.[1] ||
            html.match(/\/_next\/static\/([A-Za-z0-9._-]+)\//)?.[1] || '';
    }

    async function getRewardsServerActionContext() {
        if (rewardsActionContext) return rewardsActionContext;
        if (rewardsActionUnavailable) throw new Error(rewardsActionUnavailable);
        if (rewardsActionContextPromise) return rewardsActionContextPromise;

        rewardsActionContextPromise = (async () => {
            try {
                const cookie = await getCookies('https://rewards.bing.com');
                const [earnHtml, dashboardHtml] = await Promise.all([
                    fetchRewardsText(REWARDS_ORIGIN + '/earn', 'text/html,application/xhtml+xml', cookie).catch(() => ''),
                    fetchRewardsText(REWARDS_ORIGIN + '/dashboard', 'text/html,application/xhtml+xml', cookie).catch(() => '')
                ]);
                const htmlBundle = [earnHtml, dashboardHtml].filter(Boolean).join('\n');
                if (!htmlBundle) throw new Error('Rewards 页面拉取失败');

                const paths = new Set();
                for (const match of htmlBundle.matchAll(/(?:\/_next\/)?(static\/chunks\/[\w\-./()]+?\.js)/g)) {
                    paths.add('/_next/' + match[1]);
                }

                let jsTexts = await Promise.all([...paths].map(async path => {
                    try {
                        return await fetchRewardsText(REWARDS_ORIGIN + path, 'application/javascript,*/*', '');
                    } catch (_) {
                        return '';
                    }
                }));

                const dynamicPaths = new Set();
                for (const js of jsTexts) {
                    if (!js) continue;
                    for (const path of extractDynamicRewardsChunks(js)) dynamicPaths.add(path);
                }
                const moreTexts = await Promise.all([...dynamicPaths].slice(0, 80).map(async path => {
                    try {
                        return await fetchRewardsText(REWARDS_ORIGIN + path, 'application/javascript,*/*', '');
                    } catch (_) {
                        return '';
                    }
                }));
                jsTexts = jsTexts.concat(moreTexts);

                let actionId = '';
                for (const js of jsTexts) {
                    if (!js) continue;
                    const ids = extractRewardsActionIds(js);
                    actionId = ids.reportActivity ||
                        Object.entries(ids).find(([name]) => /report.*activity|activity.*report/i.test(name))?.[1] ||
                        actionId;
                    if (actionId) break;
                }
                if (!actionId) throw new Error('未找到新版上报入口');

                rewardsActionContext = {
                    actionId,
                    deploymentId: buildRewardsDeploymentId(earnHtml || dashboardHtml),
                    routerStateTree: rewardsRouterStateTree(),
                    cookie
                };
                log('🔑 已准备新版活动上报');
                return rewardsActionContext;
            } catch (e) {
                rewardsActionUnavailable = e?.message || '新版上报入口不可用';
                rewardsActionContextPromise = null;
                throw e;
            }
        })();
        return rewardsActionContextPromise;
    }

    async function reportWebActivityServerAction(item) {
        const context = await getRewardsServerActionContext();
        const rawActivityType = item.activityType ?? item.attributes?.activityType ?? item.attributes?.activity_type;
        const parsedActivityType = Number(rawActivityType);
        const activityType = Number.isInteger(parsedActivityType) && parsedActivityType > 0 ? parsedActivityType : 11;
        const rawPromotional = item.attributes?.promotional ?? item.isPromotional;
        const isPromotional = rawPromotional === true || String(rawPromotional).toLowerCase() === 'true';
        const body = JSON.stringify([
            item.hash,
            activityType,
            {
                offerid: item.offerId,
                isPromotional: isPromotional ? true : '$undefined',
                timezoneOffset: new Date().getTimezoneOffset()
            }
        ]);

        try {
            const response = await gmRequest({
                method: 'POST',
                url: REWARDS_ORIGIN + '/earn',
                headers: {
                    Accept: 'text/x-component',
                    'Content-Type': 'text/plain;charset=UTF-8',
                    Origin: REWARDS_ORIGIN,
                    Referer: REWARDS_ORIGIN + '/earn',
                    'Next-Action': context.actionId,
                    'Next-Router-State-Tree': context.routerStateTree,
                    ...(context.deploymentId ? { 'X-Deployment-Id': context.deploymentId } : {}),
                    ...(context.cookie ? { Cookie: context.cookie } : {})
                },
                data: body,
                anonymous: !!context.cookie
            });
            if (!/^\d+:true\s*$/m.test(String(response || ''))) throw new Error('新版上报未确认');
            return true;
        } catch (e) {
            if (e?.status === 401 || e?.status === 403) rewardsActionContext = null;
            const message = '新版上报' + (e?.status ? ` HTTP ${e.status}` : `：${e?.message || '失败'}`);
            if (e?.status !== 401 && e?.status !== 403 && e?.status !== 429) rewardsActionUnavailable = message;
            throw new Error(message);
        }
    }

    // ===== 在 rewards 页面 DOM 里真实点击每日活动子卡（方案 B：模拟人工点击，绕过 rnoreward=1 不计分问题）=====
    // 关键经验（来自 Kimi WebBridge 实战）：每日活动子卡 URL 带 rnoreward=1，奖励由"点击卡片"发放，
    // 而非访问 href。navigate / fetch /reportactivity 全部不计分。必须真实 .click() 卡片元素。
    // 由于 CN 区 rewards 面板是 React 应用（class 名带 hash），这里用"文本 + 标签"多层兜底定位，不依赖固定 class。
    const getPromotionKey = (item) => String(
        item?.offerId || item?.id || item?.attributes?.offerid || item?.destinationUrl || item?.title || ''
    );

    const isPromotionDone = (item) => item && (
        item.complete === true || item.complete === 'True' || item.complete === 'true' ||
        item.attributes?.complete === true || item.attributes?.complete === 'True' ||
        item.attributes?.state === 'Complete'
    );

    function readPendingPromo() {
        try {
            const raw = GM_getValue(PENDING_PROMO_KEY, '');
            if (!raw) return null;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!data || !Array.isArray(data.items) || !data.items.length) return null;
            if (data.createdAt && Date.now() - data.createdAt > 12 * 60 * 60 * 1000) {
                GM_setValue(PENDING_PROMO_KEY, '');
                return null;
            }
            return data;
        } catch (e) { return null; }
    }

    function savePendingPromo(items) {
        const list = (items || []).map(item => ({
            key: getPromotionKey(item),
            title: item?.title || '',
            destinationUrl: item?.destinationUrl || ''
        })).filter(item => item.key);
        if (list.length) GM_setValue(PENDING_PROMO_KEY, JSON.stringify({ createdAt: Date.now(), items: list }));
    }

    function clearPendingPromo() {
        GM_setValue(PENDING_PROMO_KEY, '');
        GM_setValue(PROMO_RESUME_KEY, '');
    }

    function setPromoResumeIntent() {
        GM_setValue(PROMO_RESUME_KEY, JSON.stringify({ createdAt: Date.now() }));
    }

    function hasPromoResumeIntent() {
        try {
            const raw = GM_getValue(PROMO_RESUME_KEY, '');
            if (!raw) return false;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!data?.createdAt || Date.now() - data.createdAt > 10 * 60 * 1000) {
                GM_setValue(PROMO_RESUME_KEY, '');
                return false;
            }
            return true;
        } catch (e) {
            GM_setValue(PROMO_RESUME_KEY, '');
            return false;
        }
    }

    function clearPromoResumeIntent() {
        GM_setValue(PROMO_RESUME_KEY, '');
    }

    function readAutoCloseTabs() {
        try {
            const raw = GM_getValue(AUTO_CLOSE_TAB_KEY, '');
            const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
            const list = Array.isArray(data) ? data : [];
            const fresh = list.filter(item => item && item.id && item.url &&
                item.createdAt && Date.now() - item.createdAt < 15 * 60 * 1000);
            if (fresh.length !== list.length) GM_setValue(AUTO_CLOSE_TAB_KEY, JSON.stringify(fresh));
            return fresh;
        } catch (e) {
            return [];
        }
    }

    function writeAutoCloseTabs(list) {
        GM_setValue(AUTO_CLOSE_TAB_KEY, JSON.stringify((list || []).slice(-12)));
    }

    function readTaskTabs() {
        try {
            const raw = GM_getValue(TASK_TABS_KEY, '');
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (_) {
            return [];
        }
    }

    function writeTaskTabs(list) {
        GM_setValue(TASK_TABS_KEY, JSON.stringify((list || []).slice(-12)));
    }

    function addTaskTab(id, url) {
        let abs = url;
        try { abs = new URL(url, location.href).href; } catch (_) {}
        const list = readTaskTabs().filter(item => item.id !== id && item.url !== abs);
        list.push({ id, url: abs, ts: Date.now() });
        writeTaskTabs(list);
        return abs;
    }

    function matchTaskTab(entry) {
        try {
            const expected = new URL(entry.url);
            const current = new URL(location.href);
            const rootHost = host => String(host || '').toLowerCase().replace(/^(www|cn)\./, '');
            if (rootHost(expected.hostname) !== rootHost(current.hostname)) return false;
            if (expected.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')) return false;
            if (expected.pathname.toLowerCase() === '/search') {
                return !!expected.searchParams.get('q') &&
                    expected.searchParams.get('q') === current.searchParams.get('q');
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function readTaskTabStates() {
        try {
            const raw = GM_getValue(TASK_TAB_STATES_KEY, '');
            const data = raw ? JSON.parse(raw) : {};
            const now = Date.now();
            Object.keys(data).forEach(id => {
                if (!data[id] || now - Number(data[id].at || 0) > TASK_TAB_TTL) delete data[id];
            });
            return data;
        } catch (_) {
            return {};
        }
    }

    function markTaskTabDone(id) {
        const data = readTaskTabStates();
        data[id] = { done: true, at: Date.now() };
        GM_setValue(TASK_TAB_STATES_KEY, JSON.stringify(data));
    }

    async function waitTaskTabDone(id, timeout = TASK_TAB_TIMEOUT) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            if (readTaskTabStates()[id]?.done) return true;
            await sleep(500);
        }
        return false;
    }

    function stripNoopener(el) {
        const anchor = el?.matches?.('a[href]') ? el : el?.querySelector?.('a[href]');
        if (!anchor) return null;
        const rel = anchor.getAttribute('rel') || '';
        if (!/noopener/i.test(rel)) return null;
        anchor.setAttribute('rel', rel.replace(/noopener/ig, '').replace(/\s+/g, ' ').trim() || 'noreferrer');
        return { anchor, rel };
    }

    function restoreNoopener(saved) {
        if (!saved?.anchor) return;
        try { saved.anchor.setAttribute('rel', saved.rel); } catch (_) {}
    }

    async function humanClickElement(el) {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        await sleep(randomRange(260, 620));
        const doc = el.ownerDocument || document;
        const pageWindow = doc.defaultView || window;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;

        const clientX = Math.round(rect.left + rect.width * (0.4 + Math.random() * 0.2));
        const clientY = Math.round(rect.top + rect.height * (0.4 + Math.random() * 0.2));
        let target = el;
        try {
            const hit = doc.elementFromPoint(clientX, clientY);
            if (hit && el.contains(hit)) target = hit;
        } catch (_) {}

        const isAnchor = target.tagName === 'A' && target.hasAttribute?.('href');
        if (isAnchor) {
            try { target.click(); } catch (_) {}
            return true;
        }

        const base = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            clientX,
            clientY
        };
        const fire = (name, extra = {}) => {
            const Ctor = /^pointer/.test(name)
                ? (pageWindow.PointerEvent || window.PointerEvent)
                : (pageWindow.MouseEvent || window.MouseEvent);
            if (typeof Ctor !== 'function') return;
            const init = { ...base, ...extra };
            if (/^pointer/.test(name)) {
                init.pointerType = 'mouse';
                init.isPrimary = true;
                init.pointerId = 1;
            }
            try { target.dispatchEvent(new Ctor(name, init)); } catch (_) {}
        };

        let opened = false;
        const originalOpen = window.open;
        try {
            window.open = function (...args) {
                opened = true;
                return originalOpen.apply(window, args);
            };
        } catch (_) {}

        fire('pointerover');
        fire('mouseover', { buttons: 0 });
        await sleep(randomRange(40, 110));
        fire('pointerdown');
        fire('mousedown');
        await sleep(randomRange(60, 150));
        fire('pointerup', { buttons: 0 });
        fire('mouseup', { buttons: 0 });
        await sleep(700);

        try { window.open = originalOpen; } catch (_) {}
        if (!opened) {
            try { target.click(); } catch (_) {}
        }
        return true;
    }

    function registerAutoCloseActivityTab(card, href, title, kind = 'subtask', openedInNewTab = true) {
        if (!card || !href || !openedInNewTab) return null;
        let url;
        try { url = new URL(href, location.href).href; } catch (e) { return null; }
        const marker = {
            id: uuid(),
            url,
            title: String(title || '').slice(0, 80),
            kind,
            source: location.href,
            openedInNewTab,
            createdAt: Date.now()
        };
        const list = readAutoCloseTabs().filter(item => item.url !== url);
        list.push(marker);
        writeAutoCloseTabs(list);
        if (!autoCloseAfterPromo) {
            autoCloseAfterPromo = true;
            log('🧹 检测到活动会打开新标签页，完成后自动关闭');
        }
        return marker;
    }

    function activityUrlMatchesMarker(marker) {
        if (!marker?.url) return false;
        try {
            const expected = new URL(marker.markedUrl || marker.url, location.href);
            const current = new URL(location.href);
            const rootHost = host => String(host || '').toLowerCase().replace(/^(www|cn)\./, '');
            if (rootHost(expected.hostname) !== rootHost(current.hostname)) return false;
            if (expected.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')) return false;
            // 搜索页可能追加 tracking 参数，只用 q 判断是不是同一张活动卡。
            if (expected.pathname.toLowerCase() === '/search') {
                const expectedQuery = expected.searchParams.get('q');
                const currentQuery = current.searchParams.get('q');
                return !!expectedQuery && expectedQuery === currentQuery;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function getAutoCloseMarkerFromCurrentUrl(list) {
        try {
            const current = new URL(location.href);
            const queryId = current.searchParams.get('mr_auto_close');
            const hashId = (current.hash.match(/(?:^#|&)mr_auto_close=([^&]+)/) || [])[1];
            const id = queryId || hashId;
            return id ? (list || []).find(item => item.id === id) || null : null;
        } catch (e) {
            return null;
        }
    }

    function getRewardsResumeUrl(markerId = '') {
        const url = new URL('https://rewards.bing.com/earn');
        if (markerId) url.searchParams.set('mr_auto_close', markerId);
        return url.href;
    }

    function prepareTrackedActivityTab(card, title, kind = 'subtask') {
        if (!card) return null;
        const anchor = card.matches?.('a[href]') ? card : card.querySelector?.('a[href]');
        if (!anchor) return null;
        const originalHref = anchor.getAttribute('href') || '';
        const originalTarget = String(anchor.getAttribute('target') || '').toLowerCase();
        const originalOpenedInNewTab = ['_blank', '_new', 'blank'].includes(originalTarget);
        if (!originalHref) return null;

        // 当前页跳转会把活动页误当成 Rewards 主页面，触发恢复并立即跳回。
        // 点击前先强制新标签打开；若站点逻辑仍改当前页，活动页会等待后再返回。
        let forcedNewTab = originalOpenedInNewTab;
        if (!forcedNewTab) {
            anchor.setAttribute('target', '_blank');
            forcedNewTab = true;
        }

        const marker = registerAutoCloseActivityTab(anchor, originalHref, title, kind, forcedNewTab);
        if (!marker) return null;
        // 同时给新标签页加一个 fragment 标记。fragment 不会发送到服务器，
        // 不改变 rnoreward/query；比 window.name 更能跨 www/rewards 域名识别。
        try {
            const markedUrl = new URL(originalHref, location.href);
            markedUrl.hash = `mr_auto_close=${encodeURIComponent(marker.id)}`;
            anchor.setAttribute('href', markedUrl.href);
            const list = readAutoCloseTabs().map(item => item.id === marker.id
                ? { ...item, markedUrl: markedUrl.href }
                : item);
            writeAutoCloseTabs(list);
        } catch (e) {}
        // 保留原 target，避免改变 Rewards 自己的打开方式；URL fragment
        // 和 GM 状态已经足够识别这次脚本触发的新标签页。
        return { marker, anchor, originalHref, originalTarget: originalTarget };
    }

    function restoreTrackedActivityTab(prepared) {
        if (!prepared?.anchor || !prepared.originalHref) return;
        // 新标签页已在 click 默认行为中同步创建。恢复原 href/target，
        // 避免 React 下一轮把“带标记的绝对 URL”误认成另一张活动卡。
        prepared.anchor.setAttribute('href', prepared.originalHref);
        if (prepared.originalTarget) prepared.anchor.setAttribute('target', prepared.originalTarget);
        else prepared.anchor.removeAttribute('target');
    }

    function findCurrentAutoCloseMarker() {
        const list = readAutoCloseTabs();
        return getAutoCloseMarkerFromCurrentUrl(list) || list.find(item =>
            (window.name && window.name === AUTO_CLOSE_TAB_PREFIX + item.id) ||
            activityUrlMatchesMarker(item)
        ) || null;
    }

    function markCurrentAutoCloseActivityTab() {
        const marker = findCurrentAutoCloseMarker();
        if (!marker) return false;
        autoCloseMarkerId = marker.id;
        autoCloseMarkerKind = marker.kind || 'subtask';
        autoCloseMarkerOpenedInNewTab = marker.openedInNewTab !== false;
        autoCloseTabMode = autoCloseMarkerOpenedInNewTab;
        autoCloseAfterPromo = autoCloseMarkerOpenedInNewTab;
        try {
            const clean = new URL(location.href);
            clean.searchParams.delete('mr_auto_close');
            if (clean.hash.includes('mr_auto_close=')) clean.hash = '';
            history.replaceState(null, '', clean.href);
        } catch (e) {}
        log(autoCloseMarkerOpenedInNewTab ? '🧹 活动标签页已接管，完成签到后自动关闭' : '🧹 活动页已在当前标签打开，先等待计分，再返回 Rewards');
        return true;
    }

    function closeCurrentAutoCloseActivityTab(reason = '每日活动已完成') {
        const marker = readAutoCloseTabs().find(item => item.id === autoCloseMarkerId) ||
            findCurrentAutoCloseMarker();
        if (!marker) return false;
        if (!autoCloseMarkerOpenedInNewTab && marker.openedInNewTab === false) return false;
        const left = readAutoCloseTabs().filter(item => item.id !== marker.id);
        writeAutoCloseTabs(left);
        autoCloseTabMode = false;
        autoCloseMarkerId = '';
        autoCloseMarkerKind = '';
        log('🧹 ' + reason + '，正在关闭新标签页');
        setTimeout(() => {
            try { window.close(); } catch (e) {}
            // 某些 Chromium 版本只允许关闭由脚本打开的页；再尝试一次
            // 常用的 self-close 方式，仍失败时只提示用户，不影响签到结果。
            if (!window.closed) {
                try { window.open('', '_self'); window.close(); } catch (e) {}
            }
            setTimeout(() => {
                if (!window.closed) log('⚠️ 浏览器阻止自动关闭，请手动关闭当前活动标签页');
            }, 300);
        }, 800);
        return true;
    }

    function startAutoCloseActivityTabMonitor() {
        if (!autoCloseTabMode) return;
        const timer = setInterval(() => {
            const marker = readAutoCloseTabs().find(item => item.id === autoCloseMarkerId) ||
                findCurrentAutoCloseMarker();
            if (!marker) {
                clearInterval(timer);
                return;
            }
            const requested = marker.closeRequested && Date.now() >= (marker.closeAt || 0);
            if (requested) {
                clearInterval(timer);
                closeCurrentAutoCloseActivityTab(marker.closeReason || '每日活动已完成');
            }
        }, 500);
    }

    function readDailyStreakState() {
        try {
            const raw = GM_getValue(DAILY_STREAK_STATE_KEY, '');
            const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
            if (!data || data.date !== getDateHyphen() || data.keyVersion !== DAILY_STREAK_KEY_VERSION) {
                return { date: getDateHyphen(), keyVersion: DAILY_STREAK_KEY_VERSION, clickedKeys: [] };
            }
            return {
                date: data.date,
                keyVersion: DAILY_STREAK_KEY_VERSION,
                clickedKeys: Array.isArray(data.clickedKeys) ? data.clickedKeys : [],
                inFlight: data.inFlight || null
            };
        } catch (e) {
            return { date: getDateHyphen(), keyVersion: DAILY_STREAK_KEY_VERSION, clickedKeys: [] };
        }
    }

    function saveDailyStreakState(data) {
        GM_setValue(DAILY_STREAK_STATE_KEY, JSON.stringify({
            date: getDateHyphen(),
            keyVersion: DAILY_STREAK_KEY_VERSION,
            clickedKeys: [...new Set(data.clickedKeys || [])].slice(-6),
            inFlight: data.inFlight || null
        }));
    }

    function clearDailyStreakState() {
        GM_setValue(DAILY_STREAK_STATE_KEY, '');
    }

    const isRewardsPage = () => /(^|\.)rewards\.bing\.com$/i.test(location.hostname);

    const isDailyPageType = (item) => {
        const type = String(item?.attributes?.type || item?.type || '').toLowerCase();
        const offerId = String(item?.attributes?.offerid || item?.offerId || '').toLowerCase();
        const title = String(item?.title || item?.attributes?.title || '').toLowerCase();
        return ['streak', 'dailyset', 'checkin', 'signin'].includes(type) ||
            /streak|dailyset|checkin|signin/.test(offerId) ||
            /每日连续打卡活动|daily\s*streak\s*activity/i.test(title);
    };

    const isPageClickItem = (item) => item?._pageClick ||
        /^https?:\/\/(www\.|cn\.|rewards\.)?bing\.com\//i.test(item?.destinationUrl || '');

    const normalizeDomText = value => (value || '').replace(/\s+/g, '').toLowerCase();

    const isAssistantUiElement = el => !!(el && (
        el.id === 'mr-panel' || (typeof el.closest === 'function' && el.closest('#mr-panel'))
    ));

    const isDailyStreakActivityItem = (item) => {
        const text = normalizeDomText([
            item?.title,
            item?.attributes?.title,
            item?.type,
            item?.attributes?.type,
            item?.offerId,
            item?.attributes?.offerid
        ].filter(Boolean).join(' '));
        return /每日连续打卡活动|dailystreakactivity|dailystreak|dailyset|streak/.test(text);
    };

    function getVisibleElements(selector) {
        return [...document.querySelectorAll(selector)].filter(el => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0;
        });
    }

    function findFixedPanelContaining(textNeedle) {
        const needle = normalizeDomText(textNeedle);
        const nodes = [...document.querySelectorAll('body *')].filter(el => {
            // The assistant log itself contains the words “每日连续打卡活动”.
            // Do not mistake the floating assistant panel for the Rewards drawer.
            if (isAssistantUiElement(el)) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const text = normalizeDomText(el.innerText || el.textContent);
            return text.includes(needle) && style.display !== 'none' &&
                style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });

        for (const node of nodes.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (ar.width * ar.height) - (br.width * br.height);
        })) {
            let el = node;
            for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const fixedLike = style.position === 'fixed' || style.position === 'sticky' ||
                    (style.position === 'absolute' && rect.right > window.innerWidth * 0.65);
                if (fixedLike && rect.width > 240 && rect.height > 160) return el;
            }
        }
        return null;
    }

    function getSidePanelRoot() {
        const candidates = getVisibleElements('[role=dialog], aside, [data-testid*="drawer"], [data-testid*="modal"]')
            .filter(el => !isAssistantUiElement(el));
        return candidates.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (br.width * br.height) - (ar.width * ar.height);
        })[0] || null;
    }

    function getPanelText(root) {
        return normalizeDomText(root ? root.innerText : '');
    }

    async function waitForDailyStreakPanel(timeout = 8000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const roots = getVisibleElements('[role=dialog], aside, [data-testid*="drawer"], [data-testid*="modal"]')
                .filter(el => !isAssistantUiElement(el));
            const root = roots.find(el => {
                const text = getPanelText(el);
                return text.includes('每日连续打卡活动') || text.includes('dailystreakactivity');
            });
            if (root) return root;
            const fallback = findFixedPanelContaining('每日连续打卡活动') ||
                findFixedPanelContaining('daily streak activity');
            if (fallback) return fallback;
            await sleep(500);
        }
        return null;
    }

    function isInteractiveElement(el) {
        return el && (el.matches('a, button, [role=link], [role=button], [tabindex]') ||
            el.closest('a, button, [role=link], [role=button], [tabindex]'));
    }

    function getInteractiveElement(el) {
        if (!el) return null;
        return el.matches('a, button, [role=link], [role=button], [tabindex]')
            ? el
            : el.closest('a, button, [role=link], [role=button], [tabindex]');
    }

    // 油猴沙箱里的 window 不是页面自己的 Window。把它作为 UIEventInit.view
    // 传给页面的 PointerEvent 构造器会触发：Failed to convert value to Window。
    // 事件构造器改用卡片所属文档的原生构造器，并且不传 view；Rewards/React
    // 只需要 bubbling 的 pointer/click 事件，不依赖 view 字段。
    function dispatchRewardsCardClick(card) {
        if (!card) return false;
        const doc = card.ownerDocument || document;
        const pageWindow = doc.defaultView || window;
        const eventBase = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1
        };
        const PointerCtor = pageWindow.PointerEvent || window.PointerEvent;
        const MouseCtor = pageWindow.MouseEvent || window.MouseEvent;

        // Synthetic pointer events are only an optional compatibility layer. If a
        // browser/Tampermonkey realm rejects one of their init dictionaries, the
        // real element click must still happen.
        try {
            if (typeof PointerCtor === 'function') {
                card.dispatchEvent(new PointerCtor('pointerdown', {
                    ...eventBase, pointerType: 'mouse', isPrimary: true
                }));
            }
        } catch (e) {}
        try {
            if (typeof MouseCtor === 'function') card.dispatchEvent(new MouseCtor('mousedown', eventBase));
        } catch (e) {}
        try {
            if (typeof PointerCtor === 'function') {
                card.dispatchEvent(new PointerCtor('pointerup', {
                    ...eventBase, pointerType: 'mouse', isPrimary: true, buttons: 0
                }));
            }
        } catch (e) {}
        try {
            if (typeof MouseCtor === 'function') card.dispatchEvent(new MouseCtor('mouseup', { ...eventBase, buttons: 0 }));
        } catch (e) {}
        card.click();
        return true;
    }

    // 很多 Rewards 卡片同时是 <a> 链接。只触发 click 会让浏览器跳到活动页；
    // React 的计分 handler 仍需要 click 冒泡，所以只 preventDefault，不 stopPropagation。
    function clickRewardsCardWithoutNavigation(card) {
        if (!card) return false;
        const anchor = card.closest?.('a[href]') || (card.querySelector?.('a[href]')) || card;
        const stopNavigation = e => {
            if (!isAssistantUiElement(card)) e.preventDefault();
        };
        try {
            anchor.addEventListener('click', stopNavigation, false);
            dispatchRewardsCardClick(card);
        } finally {
            setTimeout(() => {
                try { anchor.removeEventListener('click', stopNavigation, false); } catch (_) {}
            }, 1000);
        }
        return true;
    }

    function findDailyStreakEntry() {
        const candidates = getVisibleElements('a, button, [role=link], [role=button], [tabindex]')
            .map(getInteractiveElement)
            .filter(Boolean)
            .filter((el, index, list) => list.indexOf(el) === index)
            .filter(el => {
                if (el.closest('[role=dialog], aside, [aria-modal=true]')) return false;
                const text = normalizeDomText(el.innerText || el.textContent);
                return (text.includes('每日连续打卡活动') || text.includes('daily streak activity')) &&
                    !text.includes('关闭') && !text.includes('close');
            });
        return candidates.sort((a, b) => {
            const at = normalizeDomText(a.innerText || a.textContent).length;
            const bt = normalizeDomText(b.innerText || b.textContent).length;
            return at - bt;
        })[0] || null;
    }

    async function openDailyStreakActivityPanel() {
        let panel = await waitForDailyStreakPanel(800);
        if (panel) return panel;

        const trigger = findDailyStreakEntry();
        if (!trigger) {
            log('⚠️ 未找到“每日连续打卡活动”卡片');
            return null;
        }
        try {
            trigger.scrollIntoView({ block: 'center', inline: 'center' });
            await sleep(300);
            await humanClickElement(trigger);
            log('📂 已打开“每日连续打卡活动”侧边栏，等待子活动卡片...');
        } catch (e) {
            log('❌ 打开“每日连续打卡活动”失败: ' + e.message);
            return null;
        }
        panel = await waitForDailyStreakPanel(8000);
        if (!panel) log('⚠️ 侧边栏已触发，但没有检测到“每日连续打卡活动”内容');
        return panel;
    }

    function getDailyStreakSubCards(panel) {
        if (!panel) return [];
        const isVisible = el => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0;
        };
        const normalize = value => normalizeDomText(value);
        const isHeaderOrClose = el => {
            const text = normalize(el.innerText || el.textContent);
            const aria = normalize(el.getAttribute('aria-label') || '');
            return /每日连续打卡活动|close|关闭|返回|back/.test(text + aria);
        };

        // 官方每日活动对话框里的子任务是 <a href> 卡片。优先取这一层，
        // 避免把外层标题、整个面板或普通 tabindex 元素误认为任务卡。
        const linkCards = [...panel.querySelectorAll('a[href]')]
            .filter(isVisible)
            .filter(el => !isAssistantUiElement(el))
            .filter(el => !isHeaderOrClose(el))
            .filter(el => {
                const text = normalize(el.innerText || el.textContent);
                const href = (el.getAttribute('href') || '').toLowerCase();
                return href.includes('rnoreward') || /\+\d+|活动|完成|搜索|阅读|测验|quiz|activity/.test(text);
            })
            .map(getInteractiveElement)
            .filter(Boolean)
            .filter((el, index, list) => list.indexOf(el) === index);

        if (linkCards.length) {
            const score = el => {
                const text = normalize(el.innerText || el.textContent);
                const href = (el.getAttribute('href') || '').toLowerCase();
                return (href.includes('rnoreward') ? 4 : 0) + (/\+\d+/.test(text) ? 3 : 0) +
                    (/活动|完成|搜索|阅读|测验|quiz|activity/.test(text) ? 1 : 0);
            };
            return linkCards
                .map((el, index) => ({ el, index, score: score(el) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .sort((a, b) => a.index - b.index)
                .map(item => item.el);
        }

        // 兼容个别页面不用 a 标签而用 button/role=link 的版本。
        const raw = [...panel.querySelectorAll('button, [role=link], [role=button], [tabindex]')]
            .filter(el => {
                return isVisible(el) && !isAssistantUiElement(el);
            })
            .map(getInteractiveElement)
            .filter(Boolean)
            .filter((el, index, list) => list.indexOf(el) === index);

        const cards = [];
        const seen = new Set();
        for (const el of raw) {
            const text = normalize(el.innerText || el.textContent);
            const href = (el.getAttribute('href') || '').trim();
            if (!text || isHeaderOrClose(el)) continue;
            // 子活动卡通常是带 href 的链接，并显示 +10/+30 等奖励；过滤掉标题、关闭按钮和普通导航。
            const rewardLike = /\+\d+|活动|完成|搜索|阅读|测验|quiz|activity/.test(text);
            if (!href && !rewardLike) continue;
            const key = href || text;
            if (seen.has(key)) continue;
            seen.add(key);
            cards.push(el);
        }

        // 侧边栏预期是 3 张子活动卡；优先选择带奖励值或 rnoreward 的链接。
        return cards.map((el, index) => ({ el, index })).sort((a, b) => {
            const score = el => {
                const text = normalizeDomText(el.innerText || el.textContent);
                const href = (el.getAttribute('href') || '').toLowerCase();
                return (href.includes('rnoreward') ? 4 : 0) + (/\+\d+/.test(text) ? 3 : 0) +
                    (/活动|activity/.test(text) ? 1 : 0);
            };
            return score(b.el) - score(a.el);
        }).slice(0, 3).sort((a, b) => a.index - b.index).map(item => item.el);
    }

    function normalizeDailyStreakCardHref(href) {
        if (!href) return '';
        try {
            const url = new URL(href, location.href);
            url.hash = '';
            url.searchParams.delete('mr_auto_close');
            url.searchParams.sort();
            return url.href;
        } catch (e) {
            return href.replace(/#mr_auto_close=[^#&]+$/i, '');
        }
    }

    const getDailyStreakCardKey = card => {
        if (!card) return '';
        const href = card.getAttribute('href') || '';
        // 相对/绝对 URL、查询参数顺序和自动关闭标记都不能改变业务 key。
        return normalizeDailyStreakCardHref(href) ||
            String(card.innerText || card.textContent || '').trim().replace(/\s+/g, ' ');
    };

    const isDailyStreakCardComplete = card => {
        if (!card) return false;
        const status = [
            card.getAttribute('aria-label'),
            card.getAttribute('aria-pressed'),
            card.getAttribute('data-status'),
            card.getAttribute('data-state'),
            card.className,
            card.innerText || card.textContent
        ].filter(Boolean).join(' ').toLowerCase();
        return /已完成|已领取|已获得|completed|complete|claimed|done/.test(status);
    };

    async function waitForDailyStreakSubCards(panel, timeout = 6000) {
        const end = Date.now() + timeout;
        let root = panel;
        while (Date.now() < end) {
            const cards = getDailyStreakSubCards(root);
            if (cards.length >= 3) return { panel: root, cards };
            await sleep(250);
            root = await waitForDailyStreakPanel(350) || root;
        }
        return { panel: root, cards: getDailyStreakSubCards(root) };
    }

    async function waitForDailyStreakCardResult(panel, key, beforeProgress, timeout = 6000) {
        const end = Date.now() + timeout;
        let root = panel;
        let progress = beforeProgress;
        let cards = getDailyStreakSubCards(root);
        let missingPolls = 0;
        while (Date.now() < end) {
            root = await waitForDailyStreakPanel(350) || root;
            progress = readDailyStreakProgress(root);
            cards = getDailyStreakSubCards(root);
            const current = cards.find(card => getDailyStreakCardKey(card) === key);
            const advanced = beforeProgress != null && progress != null && progress > beforeProgress;
            if (advanced || (current && isDailyStreakCardComplete(current))) {
                return { registered: true, panel: root, progress, cards };
            }
            missingPolls = cards.length && !current ? missingPolls + 1 : 0;
            if (missingPolls >= 3) return { registered: true, panel: root, progress, cards };
            await sleep(400);
        }
        return { registered: false, panel: root, progress, cards };
    }

    function getCardHref(card) {
        if (!card) return '';
        const anchor = card.matches?.('a[href]') ? card : card.querySelector?.('a[href]');
        return anchor?.getAttribute('href') || card.getAttribute?.('href') || '';
    }

    function getCardTarget(card) {
        if (!card) return '';
        const anchor = card.matches?.('a') ? card : card.querySelector?.('a');
        return String(anchor?.getAttribute('target') || card.getAttribute?.('target') || '').toLowerCase();
    }

    function registerCardTabIfNeeded(card, title) {
        const href = getCardHref(card);
        const target = getCardTarget(card);
        if (!href || !['_blank', '_new', 'blank'].includes(target)) return null;
        return registerAutoCloseActivityTab(card.matches?.('a[href]') ? card : card.querySelector('a[href]'), href, title);
    }

    function requestAutoCloseActivityTabs(reason = '活动完成') {
        const list = readAutoCloseTabs();
        if (!list.length) return false;
        const now = Date.now();
        writeAutoCloseTabs(list.map(item => ({
            ...item,
            closeRequested: true,
            closeReason: reason,
            closeAt: now + 1200
        }))); 
        if (!autoCloseAfterPromo) {
            autoCloseAfterPromo = true;
            log('🧹 ' + reason + '，准备关闭活动标签页');
        }
        return true;
    }

    function readDailyStreakProgress(panel) {
        const text = normalizeDomText(panel ? panel.innerText : document.body.innerText);
        const match = text.match(/活动:?([0-3])\/3|activity:?([0-3])\/3/i);
        return match ? Number(match[1] || match[2]) : null;
    }

    async function completeDailyStreakActivityGroup() {
        if (!isRewardsPage()) return false;
        if (dailyStreakGroupHandled) {
            log('ℹ️ 每日连续打卡活动本轮已处理，跳过重复点击');
            return true;
        }
        await ensureDailyActivityGroup();

        let panel = await openDailyStreakActivityPanel();
        if (!panel) return false;

        let cards;
        ({ panel, cards } = await waitForDailyStreakSubCards(panel));
        if (!cards.length) {
            log('⚠️ 侧边栏已打开，但没有找到内部子活动卡片；面板文字=' +
                String(panel.innerText || '').replace(/\s+/g, ' ').slice(0, 180));
            return false;
        }
        log('🔎 子卡: ' + cards.map(card => {
            const text = String(card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
            const href = card.getAttribute('href') || '';
            return `${text.slice(0, 35)}${href ? ` <${href.slice(0, 80)}>` : ''}`;
        }).join(' | '));
        log(`📋 找到 ${cards.length} 张“每日连续打卡活动”子卡，开始逐项点击`);

        const streakState = readDailyStreakState();
        const clicked = new Set(streakState.clickedKeys || []);
        const plannedKeys = [...new Set(cards.map(getDailyStreakCardKey).filter(Boolean))].slice(0, 3);
        // 如果上一次 click 导致页面跳转，旧页面来不及写入 clickedKeys；
        // inFlight 表示该卡已经发起过真实点击，恢复时不要再次点它。
        if (streakState.inFlight) clicked.add(streakState.inFlight);
        const failedAttempts = new Map();
        while (true) {
            panel = await waitForDailyStreakPanel(1200) || panel;
            cards = getDailyStreakSubCards(panel);
            const key = plannedKeys.find(candidateKey =>
                !clicked.has(candidateKey) && (failedAttempts.get(candidateKey) || 0) < MAX_ACTIVITY_ATTEMPTS
            );
            if (!key) break;
            const card = cards.find(candidate => getDailyStreakCardKey(candidate) === key);
            if (!card) {
                failedAttempts.set(key, MAX_ACTIVITY_ATTEMPTS);
                log(`❌ 活动卡片已从侧边栏消失，跳过本轮：任务 ${plannedKeys.indexOf(key) + 1}/3`);
                continue;
            }
            const text = (card.innerText || card.textContent || '').trim().replace(/\s+/g, ' ');
            const taskNumber = plannedKeys.indexOf(key) + 1;
            const attempt = (failedAttempts.get(key) || 0) + 1;
            failedAttempts.set(key, attempt);
            const beforeProgress = readDailyStreakProgress(panel);
            streakState.inFlight = key;
            saveDailyStreakState(streakState);
            try {
                card.scrollIntoView({ block: 'center', inline: 'center' });
                await sleep(250);
                // 每日连续打卡子卡在侧边栏内，按真实点击处理，不强制跳转。
                await humanClickElement(card);
                await sleep(700);
                const result = await waitForDailyStreakCardResult(panel, key, beforeProgress, 6000);
                panel = result.panel;
                const progress = result.progress;
                const registered = result.registered;
                if (registered) {
                    clicked.add(key);
                    streakState.clickedKeys = [...clicked];
                    log(`✅ 活动完成 ${taskNumber}/3：${text.slice(0, 40)}${progress == null ? '' : `（${progress}/3）`}`);
                } else {
                    if (attempt < MAX_ACTIVITY_ATTEMPTS) {
                        log(`🔁 活动失败，准备重试 ${attempt + 1}/${MAX_ACTIVITY_ATTEMPTS}：${text.slice(0, 40)}`);
                    } else {
                        log(`❌ 活动失败，已达到 ${MAX_ACTIVITY_ATTEMPTS} 次尝试：${text.slice(0, 40)}`);
                    }
                }
                streakState.inFlight = null;
                saveDailyStreakState(streakState);
            } catch (e) {
                if (attempt < MAX_ACTIVITY_ATTEMPTS) {
                    log(`🔁 活动失败，准备重试 ${attempt + 1}/${MAX_ACTIVITY_ATTEMPTS}：${text.slice(0, 40)}`);
                } else {
                    log(`❌ 活动失败，已达到 ${MAX_ACTIVITY_ATTEMPTS} 次尝试：${text.slice(0, 40)}`);
                }
                streakState.inFlight = null;
                saveDailyStreakState(streakState);
            }

            // React 重新渲染后下一轮会重新扫描剩余卡片。
        }

        const finalProgress = readDailyStreakProgress(panel);
        const allPlannedCardsCompleted = plannedKeys.length === 3 && plannedKeys.every(key => clicked.has(key));
        const groupCompleted = finalProgress === 3 || allPlannedCardsCompleted;
        if (groupCompleted) {
            log('🎉 每日连续打卡活动已完成（活动 3/3）');
            dailyStreakGroupHandled = true;
            clearDailyStreakState();
            clearPromoResumeIntent();
            requestAutoCloseActivityTabs('每日连续打卡完成');
            return true;
        }
        log(`⚠️ 每日连续打卡活动点击结束，当前进度 ${finalProgress == null ? '未读到' : finalProgress + '/3'}`);
        return plannedKeys.some(key => clicked.has(key));
    }

    async function ensureDailyActivityGroup() {
        if (promoPageReady) return true;
        for (let attempt = 0; attempt < 8; attempt++) {
            const candidates = [...document.querySelectorAll('button, [role=button], div[aria-expanded]')];
            for (const el of candidates) {
                const text = (el.textContent || '').replace(/\s+/g, '');
                // 这里只允许点击“每日活动”分组；“每日连续打卡”是另一个入口，不能当作分组按钮。
                if (!/每日活动|daily(activity|set)/i.test(text)) continue;
                if (/每日连续打卡|daily\s*streak/i.test(text)) continue;
                if (el.getAttribute('aria-expanded') !== 'true') {
                    try {
                        el.click();
                        log('📂 已展开「每日活动」分组，等待卡片出现...');
                        // 不固定等待；后面的卡片定位会每 2 秒轮询一次，最多等待 10 秒。
                        await sleep(500);
                    } catch (e) {
                        log('⚠️ 展开每日活动失败: ' + e.message);
                        return false;
                    }
                }
                promoPageReady = true;
                return true;
            }
            await sleep(1500);
        }
        log('⚠️ 未找到「每日活动」分组，可能尚未登录或页面仍在加载');
        return false;
    }

    const clickActivityCardOnPage = async (item) => {
        const title = (item.title || '').trim();
        const dest = (item.destinationUrl || '').toLowerCase();
        log(`  🖱️ 尝试页面内点击完成: ${title || item.offerId}`);

        // 页面跳转会销毁当前 async 上下文，跨页面切换由 pending 状态统一恢复。
        if (!isRewardsPage()) {
            log('  ⚠️ 当前不在 rewards 页面，交由跨页面恢复流程处理');
            return false;
        }

        // “每日连续打卡活动”不是普通单卡：先打开侧边栏，再点击其中的 3 张子卡。
        // 之前这里只点击外壳，所以只能看到侧边栏，活动进度不会增加。
        if (isDailyStreakActivityItem(item)) {
            return await completeDailyStreakActivityGroup();
        }

        // 先展开分组；只展开一次，避免每点一张卡又把分组折叠回去。
        await ensureDailyActivityGroup();

        // 2) 在 DOM 全树里按标题/链接定位可点击卡片，真实 .click()
        const findCard = () => {
            const all = [...document.querySelectorAll('a, button, [role=link], [role=button], [tabindex]')];
            const normalize = value => (value || '').replace(/\s+/g, '').toLowerCase();

            // 每日连续打卡的正确目标是“每日连续打卡活动”卡片。
            // 不要命中只写“每日连续打卡”的外层侧边栏入口。
            if (isDailyPageType(item)) {
                const streakCards = all.filter(el => {
                    const text = normalize(el.textContent);
                    return text === '每日连续打卡活动' || text.includes('每日连续打卡活动');
                }).sort((a, b) => normalize(a.textContent).length - normalize(b.textContent).length);
                if (streakCards.length) return streakCards[0];
            }

            const wantedTitle = normalize(title);
            // 优先：标题文本精确匹配
            if (title) {
                for (const el of all) {
                    const t = normalize(el.textContent);
                    if (isDailyPageType(item) && t === '每日连续打卡') continue;
                    if (wantedTitle && t.includes(wantedTitle)) return el;
                }
            }
            // 兜底：href 命中 destinationUrl（去掉查询参数比较）
            if (dest) {
                let base = dest.split('?')[0];
                try { base = new URL(base, location.href).pathname.toLowerCase(); } catch (e) {}
                for (const el of all) {
                    const h = (el.getAttribute('href') || '').toLowerCase();
                    if (!h) continue;
                    try {
                        if (new URL(h, location.href).pathname.toLowerCase() === base) return el;
                    } catch (e) {}
                }
            }
            return null;
        };

        let card = findCard();
        for (let attempt = 0; !card && attempt < 5; attempt++) {
            await sleep(2000);
            card = findCard();
        }
        if (!card) {
            log('  ⚠️ 未在页面 DOM 找到匹配卡片（标题=' + JSON.stringify(title) + '），跳过');
            return false;
        }
        try {
            card.scrollIntoView({ block: 'center', inline: 'center' });
            await sleep(300);
            const anchor = card.matches?.('a[href]') ? card : card.querySelector?.('a[href]');
            const href = anchor?.getAttribute?.('href') || item.destinationUrl || '';
            const taskId = uuid();
            if (href) addTaskTab(taskId, href);
            const savedRel = stripNoopener(card);
            await humanClickElement(card);
            setTimeout(() => restoreNoopener(savedRel), 5000);
            if (href) {
                const done = await waitTaskTabDone(taskId, TASK_TAB_TIMEOUT);
                log(done
                    ? `  ✅ 任务页已完成并关闭：${title || item.offerId}`
                    : `  ⚠️ 未收到任务页完成回报：${title || item.offerId}`);
                return done;
            }
            await sleep(5000);
            return true;
        } catch (e) {
            log('  ❌ click 失败: ' + e.message);
            return false;
        }
    };

    async function refreshPointsAfterRun(seconds = 20) {
        const deadline = Date.now() + seconds * 1000;
        let lastPoints = state.points, lastLevel = state.level, lastToday = state.todayEarned;
        while (Date.now() < deadline) {
            await sleep(5000);
            await updateData();
            if (state.points !== lastPoints || state.level !== lastLevel || state.todayEarned !== lastToday) {
                log(`✓ 积分已刷新: ${state.points} pts`);
                return;
            }
        }
        log(`ℹ️ 积分暂未刷新，当前 ${state.points} pts`);
    }

    // 只扫描不点击：列出当前页面真正定位到的可执行卡片，用于定位“活动没完成”。
    async function scanActivityCards() {
        if (!isRewardsPage()) {
            log('⚠️ 请在 rewards.bing.com 页面执行扫描');
            return null;
        }
        await ensureDailyActivityGroup();
        const nodes = [...document.querySelectorAll('a[href], button, [role=link], [role=button]')];
        const visible = nodes.filter(el => {
            if (isAssistantUiElement(el)) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        const cards = [];
        const seen = new Set();
        for (const el of visible) {
            const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length < 4 || seen.has(text)) continue;
            const href = el.getAttribute('href') || el.querySelector?.('a[href]')?.getAttribute?.('href') || '';
            const looksLikeTask = /\+?\d+\s*分|rvreward|rnoreward|\/search\?|每日连续打卡活动|活动|测验|quiz/i.test(text + ' ' + href);
            const done = /已完成|completed/i.test(text);
            if (!looksLikeTask || done) continue;
            seen.add(text);
            cards.push({ text: text.slice(0, 50), href: href.slice(0, 120) });
        }
        log(`🔎 扫描完成：可执行卡片 ${cards.length} 个`);
        cards.slice(0, 12).forEach((c, i) => log(`   ${i + 1}. ${c.text}`));
        if (!cards.length) log('   ⚠️ 没有识别到任何可执行卡片，可能当天已完成或页面结构变化');
        return cards;
    }

    const runPromo = async (userInitiated = false) => {
        if (userInitiated) setPromoResumeIntent();
        nodes.btnPromo.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 开始执行活动...');
        await updateData();

        const pendingPromo = readPendingPromo();
        const pendingKeys = new Set((pendingPromo?.items || []).map(item => item.key).filter(Boolean));
        const resumingPromo = pendingKeys.size > 0;
        if (resumingPromo) log(`↩️ 恢复上次被页面跳转中断的活动（${pendingKeys.size} 项）`);

        const promos = (dashboard && (dashboard.promotions || dashboard.morePromotions)) || [];
        if (!promos.length) {
            log('⚠️ 未获取到活动列表，请先完成授权');
            nodes.btnPromo.disabled = false;
            markBusy(-1);
            return;
        }

        // ===== 路由：按"项"分流，而非整组 =====
        // cookie 每日任务集/更多奖励：带顶层 offerId + hash → 必须用 web 的 reportactivity(id+hash) 才算数
        // Bearer schema 活动：仅带 attributes.offerid（无顶层 hash）→ 走 dapi activities
        // 关键：每日任务集项两者都带，但 dapi 的 activities 接口对其无效（已验证 prog 不增长），故优先按 hash 判 web
        const rawDapiItems = promos.filter(p => !p.hash && p.attributes && p.attributes.offerid);
        const pageFallbackItems = rawDapiItems.filter(isDailyPageType).map(p => ({
            ...p,
            offerId: p.offerId || p.attributes.offerid,
            title: p.title || p.attributes.title || p.attributes.offerid,
            _pageClick: true
        }));
        const allWebItems = promos.filter(p => p.offerId && p.hash).concat(pageFallbackItems);
        const webItems = resumingPromo
            ? allWebItems.filter(p => pendingKeys.has(getPromotionKey(p)))
            : allWebItems;
        // 恢复页面点击时只处理待恢复的 web 卡片，避免重放其它 API 活动。
        const dapiItems = resumingPromo ? [] : rawDapiItems.filter(p => !isDailyPageType(p));

        if (resumingPromo && !webItems.length) {
            clearPendingPromo();
            log('✅ 待恢复活动已完成或已从当天列表移除');
        }

        // ===== dapi(Bearer) 路径：仅用于无 hash 的 attributes.offerid 活动 =====
        if (dapiItems.length) {
            // 调试：打印所有 promo 的真实类型，便于定位「完成不了」的活动（确认 root cause）
            log('🔎 dapi promos: ' + JSON.stringify(dapiItems.map(p => ({
                t: p.attributes?.type,
                id: (p.attributes?.offerid || '').slice(0, 14),
                prog: p.attributes?.progress,
                max: p.attributes?.max ?? p.attributes?.total,
                done: p.attributes?.complete || p.attributes?.state,
                title: p.attributes?.title
            }))));

            // offer 类型 → dapi activity type 映射
            // 连续打卡/每日签到/每日任务集类本质是签到，需走 103（与 runSign 一致）；
            // 写死 101 会被服务端当普通内容活动、无法回写完成态。
            const ACT_TYPE = {
                urlreward: 104, quiz: 101, streak: 103,
                dailyset: 103, prompt: 101, read: 101,
                readtoearn: 101, checkin: 103, signin: 103
            };
            const actTypeFor = (type) => (type ? (ACT_TYPE[type.toLowerCase()] ?? 101) : 101);

            // 放宽白名单：加入 dailyset / checkin / signin，避免连续打卡类被整条跳过
            const DOABLE = ['urlreward', 'quiz', 'streak', 'dailyset', 'prompt', 'read', 'readtoearn', 'checkin', 'signin'];
            const pending = dapiItems.filter(p => {
                const a = p.attributes || {};
                const done = a.complete === 'True' || a.complete === true || a.state === 'Complete';
                const type = (a.type || '').toLowerCase();
                // 只尝试可通过 activities 上报完成的类型；search/其它跳过
                const doable = !type || DOABLE.includes(type);
                return !done && a.offerid && doable;
            });
            if (!pending.length) {
                log('✅ 所有 dapi 活动已完成');
            } else {
            log(`📅 检测到 ${pending.length} 个待执行活动(Bearer)`);
            let ok = 0;
            for (const p of pending) {
                await waitWhilePaused();
                const a = p.attributes;
                const atype = actTypeFor(a.type);
                const type = (a.type || '').toLowerCase();
                // 连续打卡/每日任务集奖励属服务端自动发放（集齐 3 项活动后自动结算），无需手动多次上报
                const isAuto = (type === 'streak' || type === 'dailyset');
                // quiz/投票等需多次上报：单发一次只推进 1/N，导致「活动 1/3」卡住
                let need = 1;
                if (!isAuto) {
                    const total = (a.total != null) ? +a.total : (a.max != null) ? +a.max : 0;
                    const progress = (a.progress != null) ? +a.progress : 0;
                    if (total > 1) need = Math.max(1, total - progress);
                    else if (type === 'quiz') need = 3;   // 常见 3 题 quiz，total 未知时兜底多发
                    else need = 1;                         // urlreward/read/poll 等单次即可
                    need = Math.min(need, 12);             // 安全上限
                }
                let completed = false;
                for (let attempt = 1; attempt <= MAX_ACTIVITY_ATTEMPTS && !completed; attempt++) {
                    try {
                        if (attempt > 1) log(`🔁 活动失败，准备重试 ${attempt}/${MAX_ACTIVITY_ATTEMPTS}：${getActivityTitle(p)}`);
                        for (let k = 0; k < need; k++) {
                            await waitWhilePaused();
                            const res = await withAccessTokenRequest(token => gmRequest({
                                method: 'POST',
                                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                                headers: {
                                    'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
                                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true', 'X-Rewards-Country': 'cn'
                                },
                                data: JSON.stringify({
                                    amount: 1, country: 'cn', id: uuid(), type: atype, attributes: { offerid: a.offerid }
                                })
                            }));
                            let gained = '';
                            try { const d = JSON.parse(res); if (d.response?.activity?.p) gained = ' +' + d.response.activity.p + '分'; } catch {}
                            if (k < need - 1) await sleep(randomRange(1200, 2500));
                        }
                        completed = true;
                        ok++;
                        log(`✅ 活动完成：${getActivityTitle(p)}`);
                    } catch (e) {
                        if (attempt === MAX_ACTIVITY_ATTEMPTS) {
                            log(`❌ 活动失败，已达到 ${MAX_ACTIVITY_ATTEMPTS} 次尝试：${getActivityTitle(p)}（${getActivityError(e)}）`);
                        }
                    }
                }
                await sleep(randomRange(1500, 3000));
            }
            log(`✅ 完成尝试，共上报 ${ok}/${pending.length} 个活动`);
            }
        }

        // ===== web 路径 =====
        if (webItems.length) {
        const pageItems = webItems;
        if (pageItems.length) {
            // 无论当前是否已在 rewards 页，都先保存待办，防止点击或导航导致脚本上下文被卸载。
            savePendingPromo(webItems);
            if (!isRewardsPage()) {
                // 只有用户主动点击“活动/每日活动签到/一键执行”才设置恢复意图。
                setPromoResumeIntent();
                log('🧭 活动卡片需要在 Rewards 页面点击，正在跳转并准备自动恢复...');
                nodes.btnPromo.disabled = false;
                markBusy(-1);
                location.href = 'https://rewards.bing.com/earn';
                return;
            }
        }
        // 有目标链接的活动优先点击 Rewards 页面里的任务卡；只有无卡片/无链接时才走接口兜底。
        let token = null;
        const nonSiteItems = webItems.filter(p => p.destinationUrl && !/^https?:\/\/(www\.|cn\.)bing\.com\//i.test(p.destinationUrl));
        if (nonSiteItems.length) {
            const isActivityUrl = (u) => u && /^https?:\/\/(rewards\.)?bing\.com\//i.test(u) && !/\/($|\?)/.test(u);
            const urls = [...new Set(nonSiteItems.map(p => p.destinationUrl).filter(isActivityUrl))];
            for (const u of urls) {
                const t = await fetchTokenFromUrl(u);
                if (t) { token = t; break; }
            }
            if (!token) token = await fetchTokenFromUrl('https://rewards.bing.com/');
            if (!token) token = await getSearchToken(urls[0]);
        }
        if (token) log('🔑 已获取活动Token: ' + token.slice(0, 8) + '…(len=' + token.length + ')');

        // 收集所有需要完成的任务：dailySet 项可能无 priority / 无 exclusiveLockedFeatureStatus / complete 为字符串 "False"
        // —— 默认保留，仅明确标记完成/锁定才排除
        let taskList = webItems.filter(p => {
            const done = isPromotionDone(p);
            if (done) return false;
            if (typeof p.priority === 'number' && p.priority <= -2) return false;
            if (p.exclusiveLockedFeatureStatus === 'locked') return false;
            return true;
        });

        if (taskList.length === 0) {
            log('✅ 所有 web 活动已完成！');
        } else {
        log(`📅 检测到 ${taskList.length} 个待执行活动(web)`);

        let count = 0;
        for (const p of taskList) {
            await waitWhilePaused();
            const ptype = (p.type || p.completionType || p.attributes?.type || '').toLowerCase();
            const isQuiz = ptype.includes('quiz');
            // Kimi/WebBridge 实测：Rewards 页里的任务卡必须真实点击才稳定计分，
            // 直接导航或接口上报都可能不回写进度。
            const canPageClick = true;
            let need = 1;
            if (canPageClick) {
                need = 1;
            } else if (token && p.pointProgressMax && p.pointProgressMax > (p.pointProgress || 0)) {
                const remain = p.pointProgressMax - (p.pointProgress || 0);
                need = Math.max(1, remain);
                if (p.pointProgressMax >= 10 && need < 3) need = 3;
            } else if (isQuiz) {
                need = 3;
            }
            need = Math.min(need, 12);
            let completed = false;
            for (let attempt = 1; attempt <= MAX_ACTIVITY_ATTEMPTS && !completed; attempt++) {
                try {
                    if (attempt > 1) log(`🔁 活动失败，准备重试 ${attempt}/${MAX_ACTIVITY_ATTEMPTS}：${getActivityTitle(p)}`);

                    for (let k = 0; k < need; k++) {
                        await waitWhilePaused();
                        if (canPageClick) {
                            const clicked = await clickActivityCardOnPage(p);
                            if (!clicked) throw new Error('未命中活动卡片');
                        } else if (token) {
                            // rewards.bing.com 子活动：标准 ReportActivity（id + hash + 活动Token，值必须 URL 编码）
                            await gmRequest({
                                method: 'POST',
                                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    'X-Requested-With': 'XMLHttpRequest',
                                    'Referer': 'https://rewards.bing.com/',
                                    'Origin': 'https://rewards.bing.com',
                                    'RequestVerificationToken': token
                                },
                                data: `id=${encodeURIComponent(p.offerId)}&hash=${encodeURIComponent(p.hash)}&activityAmount=1&__RequestVerificationToken=${encodeURIComponent(token)}`
                            });
                        } else {
                            // 新版 Rewards 面板不再稳定提供旧版 RequestVerificationToken。
                            await reportWebActivityServerAction(p);
                        }

                        // 请求2: V1 API（仅 quiz 类辅助触发；失败不影响主流程）
                        if (isQuiz) {
                            try {
                                await gmRequest({
                                    method: 'POST',
                                    url: 'https://www.bing.com/msrewards/api/v1/ReportActivity?ajaxreq=1',
                                    headers: { 'Content-Type': 'application/json' },
                                    data: JSON.stringify({
                                        "ActivitySubType": "quiz",
                                        "ActivityType": "notification",
                                        "OfferId": p.offerId,
                                        "Channel": "Bing.Com",
                                        "PartnerId": "BingTrivia",
                                        "Timezone": -480
                                    })
                                });
                            } catch (e2) { /* V1 辅助失败忽略 */ }
                        }
                        if (k < need - 1) await sleep(randomRange(1500, 3000));
                    }
                    // 模拟简单交互延迟
                    await sleep(randomRange(1500, 3000));
                    completed = true;
                    count++;
                    log(`✅ 活动完成：${getActivityTitle(p)}`);
                } catch (e) {
                    if (attempt === MAX_ACTIVITY_ATTEMPTS) {
                        log(`❌ 活动失败，已达到 ${MAX_ACTIVITY_ATTEMPTS} 次尝试：${getActivityTitle(p)}（${getActivityError(e)}）`);
                    }
                }
            }
        }

            log(`✅ 完成尝试，共执行 ${count} 个活动`);
        } // end else taskList
        } // end if webItems.length

        await updateData();
        const pendingAfter = readPendingPromo();
        if (pendingAfter) {
            const afterKeys = new Set(pendingAfter.items.map(item => item.key).filter(Boolean));
            const latestPromos = (dashboard && (dashboard.promotions || dashboard.morePromotions)) || [];
            const left = latestPromos.filter(item => afterKeys.has(getPromotionKey(item)) && !isPromotionDone(item)).length;
            if (left === 0) {
                clearPendingPromo();
                log('✅ 活动进度已核对，待办已清除');
            } else {
                log(`⚠️ 仍有 ${left} 项活动未确认完成，保留待办，下次进入 Rewards 会继续`);
            }
        }
        nodes.btnPromo.disabled = false;
        markBusy(-1);
    };
    nodes.btnPromo.onclick = () => runPromo(true);

    const runSearch = async () => {
        if (state.running) {
            state.running = false;
            if (state.manualPaused) setManualPause(false, { silent: true });
            nodes.btnSearch.textContent = '🔍 搜索';
            updateAllButton();
            return;
        }
        state.running = true;
        nodes.btnSearch.textContent = '⏹ 停止';
        updateAllButton();
        await waitWhilePaused();

        await updateData();

        // 辅助函数：执行单次搜索并报告活动
        const doSearch = async (query, isMobile) => {
            await waitWhilePaused();
            const host = isMobile ? 'cn.bing.com' : 'www.bing.com';
            const ua = isMobile ? CONFIG.ua.mobile : CONFIG.ua.pc;
            const deviceCookie = isMobile ? `_Rwho=u=m&ts=${getDateHyphen()}` : `_Rwho=u=d&ts=${getDateHyphen()}`;
            const searchUrl = `https://${host}/search?q=${encodeURIComponent(query)}&form=QBLH`;

            await deleteCookie('_EDGE_S', host);
            await deleteCookie('_Rwho', host);
            await deleteCookie('_RwBf', host);

            try {
                // 执行搜索
                const searchResult = await gmRequest({
                    url: searchUrl,
                    headers: {
                        'User-Agent': ua,
                        'Cookie': deviceCookie,
                        'Referer': `https://${host}/?form=QBLH`
                    }
                });

                // 尝试提取 IG 参数用于报告
                const igMatch = searchResult.match(/,IG:"([^"]+)"/);
                const ig = igMatch ? igMatch[1] : crypto.randomUUID().replace(/-/g, '').toUpperCase();

                // 报告搜索活动 (关键！这是计分的核心)
                const reportHeaders = {
                    'User-Agent': ua,
                    'Cookie': deviceCookie,
                    'Referer': searchUrl,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                };

                // ncheader 请求
                try {
                    await gmRequest({
                        method: 'POST',
                        url: `https://${host}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                        headers: reportHeaders,
                        data: 'wb=1%3bi%3d1%3bv%3d1'
                    });
                } catch (e) {
                    log(`⚠️ ncheader 失败: ${e.message}`);
                }

                // reportActivity 请求
                await gmRequest({
                    method: 'POST',
                    url: `https://${host}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&q=${encodeURIComponent(query)}&ajaxreq=1`,
                    headers: reportHeaders,
                    data: `url=${encodeURIComponent(searchUrl)}&V=web`
                });

                log(`✓ ${isMobile ? '📱' : '💻'} "${query.substring(0, 15)}..."`);
            } catch (e) {
                log(`✗ 搜索失败: ${e.message}`);
            }
        };

        // 精确等待函数（不受标签页切换影响）
        const preciseWait = async (ms) => {
            state.countdownStartTime = Date.now();
            state.countdownDuration = ms;
            let endTime = Date.now() + ms;

            while (Date.now() < endTime && state.running) {
                if (state.manualPaused) {
                    const pausedMs = await waitWhilePaused();
                    endTime += pausedMs;
                    state.countdownStartTime += pausedMs;
                    continue;
                }
                const remaining = Math.max(0, endTime - Date.now());
                // 更新UI显示剩余时间
                const secs = Math.ceil(remaining / 1000);
                if (secs % 5 === 0 || secs <= 10) {
                    log(`⏳ 等待 ${secs} 秒...`);
                }
                await sleep(Math.min(1000, remaining));
            }
            state.countdownStartTime = 0;
            state.countdownDuration = 0;
        };

        // 暂停检查函数
        const checkPause = async () => {
            if (!CONFIG.pause.enabled) return;

            state.searchCount++;
            saveProgress(); // 保存进度

            if (state.searchCount % CONFIG.pause.interval === 0) {
                state.isPaused = true;
                const pauseMinutes = CONFIG.pause.duration / 60000;
                log(`⏸️ 已完成 ${state.searchCount} 次搜索，暂停 ${pauseMinutes} 分钟降低风险...`);

                state.pauseEndTime = Date.now() + CONFIG.pause.duration;
                await preciseWait(CONFIG.pause.duration);

                state.isPaused = false;
                state.pauseEndTime = 0;
                log(`▶️ 暂停结束，继续搜索...`);
            }
        };

        // 加载之前的进度
        loadProgress();
        log(`📊 当前搜索计数: ${state.searchCount}`);

        // PC Search
        if (!state.pcSearchOk) {
            log('⏭️ PC 无搜索额度（区域限制），自动跳过');
        } else {
            const pcNeed = Math.ceil((state.pcMax - state.pcCur) / 3);
            if (pcNeed > 0) {
                log(`💻 PC搜索 ${pcNeed}次`);
                for (let i = 0; i < pcNeed && state.running; i++) {
                    await waitWhilePaused();
                    const q = await getHotQuery();
                    await doSearch(q, false);
                    await checkPause(); // 暂停检查
                    if (!state.running) break;
                    await preciseWait(randomRange(CONFIG.pc.minDelay, CONFIG.pc.maxDelay));
                    if ((i + 1) % 3 === 0) await updateData();
                }
            } else {
                log('✅ PC 搜索已完成');
            }
        }

        // Mobile Search
        if (!state.mobSearchOk) {
            log('⏭️ 移动搜索无额度（区域限制），自动跳过');
        } else if (state.running) {
            const mobNeed = Math.ceil((state.mobileMax - state.mobileCur) / 3);
            if (mobNeed > 0) {
                log(`📱 移动搜索 ${mobNeed}次`);
                for (let i = 0; i < mobNeed && state.running; i++) {
                    await waitWhilePaused();
                    const q = await getHotQuery();
                    await doSearch(q, true);
                    await checkPause(); // 暂停检查
                    if (!state.running) break;
                    await preciseWait(randomRange(CONFIG.mobile.minDelay, CONFIG.mobile.maxDelay));
                    if ((i + 1) % 3 === 0) await updateData();
                }
            } else {
                log('✅ 移动搜索已完成');
            }
        }

        await updateData();
        state.running = false;
        nodes.btnSearch.textContent = '🔍 搜索';
        updateAllButton();
        log('🏁 搜索结束');
        saveProgress(); // 最终保存进度
    };
    nodes.btnSearch.onclick = runSearch;

    nodes.btnAll.onclick = async () => {
        if (state.manualPaused || state.running || state.allRunning || state.busyCount > 0) {
            setManualPause(!state.manualPaused);
            return;
        }
        state.allRunning = true;
        updateAllButton();
        log('🚀 一键执行开始');
        try {
            await waitWhilePaused();
            await runSign();
            await runRead();
            await runSearch();
            await refreshPointsAfterRun(25);
        } finally {
            state.allRunning = false;
            updateAllButton();
        }
    };

    // ========== 自动捕获 OAuth 回调（login.live.com/oauth20_desktop.srf?code=...） ==========
    // 点完“获取授权码”跳到该页后，无需手动复制 URL，脚本自动提取并换取令牌
    (function autoCaptureAuth() {
        try {
            const staleAuthCode = safeGetValue('auth_code');
            if (staleAuthCode && /^https?:\/\//i.test(staleAuthCode) && !staleAuthCode.includes('code=')) {
                safeSetValue('auth_code', '');
                GM_setValue('auth_code_claim', '');
            }
            const code = extractAuthCode(location.href);
            // 同一废 code 不要反复捕获兑换（避免刷新该页面时死循环）
            if (code && GM_getValue('auth_code_bad') !== code) {
                safeSetValue('auth_code', code);
                state.authNeeded = false;
                nodes.boxAuth.style.display = 'none';
                if (typeof GM_notification === 'function') {
                    GM_notification({ title: 'Microsoft Rewards', text: '✅ 授权码已自动捕获，正在换取令牌...' });
                }
                log('✅ 已自动捕获授权码，正在换取令牌...');
                (async () => {
                    const token = await getAccessToken({ preferCode: true });
                    if (token) { await updateData(); log('🔑 自动授权成功'); }
                    else { nodes.boxAuth.style.display = 'block'; state.authNeeded = true; }
                })();
            }
        } catch (e) { /* ignore */ }
    })();

    function showTaskTabOverlay(text) {
        try {
            let box = document.getElementById('mr-task-tab-overlay');
            if (!box) {
                box = document.createElement('div');
                box.id = 'mr-task-tab-overlay';
                box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.15);padding:12px 14px;font:13px/1.5 sans-serif;color:#333';
                (document.body || document.documentElement).appendChild(box);
            }
            box.textContent = text;
        } catch (_) {}
    }

    function handleRewardsTaskTab() {
        const pending = readTaskTabs();
        if (!pending.length) return false;
        const hit = pending.find(matchTaskTab);
        if (!hit) return false;

        // 立即消费，避免 www→cn 重定向第二次命中。
        writeTaskTabs(pending.filter(item => item.id !== hit.id));
        const stay = randomRange(4, 8);
        showTaskTabOverlay(`🎁 Rewards 任务页已记录，${stay} 秒后自动关闭`);
        setTimeout(() => {
            markTaskTabDone(hit.id);
            showTaskTabOverlay('🎁 Rewards 任务页已完成，正在关闭…');
            try { window.close(); } catch (_) {}
            setTimeout(() => {
                if (!window.closed) showTaskTabOverlay('任务页已完成；浏览器阻止自动关闭，请手动关闭本标签');
            }, 700);
        }, stay * 1000);
        return true;
    }

    // Init
    (async () => {
        try {
            if (handleRewardsTaskTab()) return;
            const isTrackedActivityTab = markCurrentAutoCloseActivityTab();
            startAutoCloseActivityTabMonitor();
            loginCookie = await getCookies('https://login.live.com');
            await updateData();
            // 青龙/计划任务自动执行入口：
            // 用 Edge 打开 https://rewards.bing.com/?mr_auto_run=1 时，
            // 油猴脚本在数据就绪后自动点击“一键全部执行”，无需人工点悬浮窗。
            const autoRun = new URLSearchParams(location.search).get('mr_auto_run');
            if (autoRun === '1' && isRewardsPage()) {
                setTimeout(() => {
                    if (!state.allRunning && !state.running && nodes.btnAll && nodes.btnAll.textContent.includes('一键全部执行')) {
                        log('⚙️ 检测到自动执行参数，开始一键任务...');
                        nodes.btnAll.click();
                    }
                }, 2500);
            }
            // Try load read progress if token exists
            try {
                const info = await withAccessTokenRequest(token => gmRequest({
                    url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
                }));
                if (info) {
                    const d = JSON.parse(info);
                    const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                    if (p) { state.readCur = +p.attributes.progress; state.readMax = +p.attributes.max; render(); }
                }
            } catch { }

            const pending = readPendingPromo();
            // 新开的活动标签页只负责让目标页面完成计分并等待主页面关闭。
            // 若它也恢复 runPromo，会与主页面并发点击，出现 1、2、2 而漏掉第 3 张卡。
            if (pending && hasPromoResumeIntent()) {
                if (isTrackedActivityTab && !autoCloseMarkerOpenedInNewTab) {
                    log('⏳ 活动页已打开，先等待 12 秒计分，再返回 Rewards...');
                    await sleep(12000);
                    location.replace(getRewardsResumeUrl(autoCloseMarkerId));
                    return;
                } else if (isTrackedActivityTab) {
                    log('🧹 活动页面已加载，等待主页面完成剩余任务');
                } else if (isRewardsPage()) {
                    log('↩️ 继续执行刚才主动开始的活动...');
                    clearPromoResumeIntent();
                    await runPromo(false);
                } else if (/(^|\.)bing\.com$/i.test(location.hostname)) {
                    log('↩️ 继续前往 Rewards 页面完成刚才主动开始的活动...');
                    location.href = getRewardsResumeUrl('');
                }
            } else if (pending) {
                log('ℹ️ 有未完成活动待办；请点击“活动”或“一键全部执行”后继续。');
            }
        } catch { }
        try {
                GM_setValue('mr_last_run_debug', JSON.stringify({
                    version: SCRIPT_VERSION,
                    time: new Date().toISOString(),
                    url: location.href,
                    panel: !!document.getElementById('mr-panel'),
                    body: !!document.body,
                    source: lastDashboardSource,
                    pc: `${state.pcCur}/${state.pcMax}`,
                    mobile: `${state.mobileCur}/${state.mobileMax}`,
                    pcOk: state.pcSearchOk,
                    mobileOk: state.mobSearchOk,
                    todayEarned: state.todayEarned,
                    todayEarnedSource: state.todayEarnedSource
                }));
        } catch (_) {}
        log('🌟 脚本就绪 v' + SCRIPT_VERSION);
    })();

    // 周期刷新：未授权时不要无脑刷 401
    setInterval(() => {
        if (state.authNeeded && !safeGetValue('auth_code') && !safeGetValue('refresh_token')) return;
        updateData();
    }, 60000);

})();
