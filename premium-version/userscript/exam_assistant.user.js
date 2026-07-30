// ==UserScript==
// @name         网页考试助手 Premium v89 - 彻底攻克kyexam单选/判断重复点击取消+全类名识别终极版
// @namespace    http://tampermonkey.net/
// @version      89.0.0
// @description  包含 z-checked/is-checked/selected/active 等 kyexam 框架类名全扫描 + 单选题再点取消绝对防御
// @author       Antigravity
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      175.178.78.88
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ===== 云端服务器配置 =====
    const CLOUD_DOMAIN    = GM_getValue('cloud_domain', '175.178.78.88');
    const WSS_URL         = `ws://${CLOUD_DOMAIN}/ws/search`;
    const HTTP_URL        = `http://${CLOUD_DOMAIN}/api/search`;
    const TOKEN_INFO_URL  = `http://${CLOUD_DOMAIN}/api/token/info`;

    // ===== 持久化配置 =====
    let USER_TOKEN   = GM_getValue('user_token', 'TEST-VIP-2026-8888');
    let DEVICE_ID    = GM_getValue('device_id', '');

    if (!DEVICE_ID) {
        const fp = [
            navigator.userAgent.length,
            screen.width, screen.height, screen.colorDepth,
            navigator.language,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 4,
            Math.random().toString(36).slice(2, 10)
        ].join('-');
        DEVICE_ID = btoa(fp).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
        GM_setValue('device_id', DEVICE_ID);
    }

    // ===== 全局状态 =====
    let socket = null;
    let activeType = null;
    let isConnected = false;
    let isCollapsed = false;
    let autoCheckEnabled = GM_getValue('autoCheckEnabled', true);
    let fullAutoEnabled = false;
    let lastSwitchTimestamp = 0;
    let isSwitchingQuestion = false;
    let lastSelectedText = '';
    let currentTitleHash = '';
    let selectionTimer = null;
    let container = null;
    let fallbackMode = false;
    let lastAutoProcessTime = 0;

    // ===== CSS =====
    const cssText = `
    #exam-assistant-container {
        position: fixed !important; width: 350px !important; max-height: 600px !important;
        top: 20px !important; right: 20px !important;
        z-index: 2147483647 !important; background: #121826 !important;
        border: 2px solid #3b82f6 !important; border-radius: 12px !important;
        box-shadow: 0 10px 30px rgba(0,0,0,.8), 0 0 20px rgba(59,130,246,.5) !important;
        color: #f3f4f6 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important; overflow: hidden !important;
        user-select: none !important; display: block !important;
        visibility: visible !important; opacity: 1 !important;
    }
    #exam-assistant-header {
        padding: 10px 14px;
        background: linear-gradient(135deg, #2563eb, #7c3aed) !important;
        border-bottom: 1px solid rgba(255,255,255,.2);
        display: flex; align-items: center; justify-content: space-between;
        cursor: move !important; touch-action: none !important;
    }
    .ea-title-box { display:flex; align-items:center; gap:8px; font-weight:600; color:#fff; pointer-events:none; }
    .ea-status-dot { width:10px; height:10px; border-radius:50%; background-color:#ef4444; box-shadow:0 0 8px #ef4444; transition:all .3s; }
    .ea-status-dot.online { background-color:#10b981; box-shadow:0 0 8px #10b981; }
    .ea-btn-icon { background:rgba(255,255,255,.2); border:none; color:#fff; border-radius:4px; width:24px; height:24px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; justify-content:center; }
    .ea-btn-icon:hover { background:rgba(255,255,255,.4); }
    #exam-assistant-body { padding:12px; display:flex; flex-direction:column; gap:10px; max-height:540px; overflow-y:auto; background:#121826; }
    .ea-control-bar { display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,.05); padding:6px 10px; border-radius:6px; font-size:11px; }
    .ea-switch-label { display:flex; align-items:center; gap:4px; cursor:pointer; color:#fbbf24; font-size:11px; }
    .ea-full-auto-label { display:flex; align-items:center; gap:4px; cursor:pointer; color:#60a5fa; font-weight:600; font-size:11px; }
    .ea-debug-bar { background:rgba(96,165,250,.1); border:1px solid rgba(96,165,250,.3); border-radius:5px; padding:4px 8px; font-size:10px; color:#93c5fd; min-height:18px; word-break:break-all; }
    .ea-search-bar { display:flex; gap:6px; }
    .ea-input { flex:1; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.3); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; outline:none; }
    .ea-search-btn { background:#3b82f6; border:none; color:#fff; padding:6px 12px; border-radius:6px; font-weight:600; cursor:pointer; }
    .ea-search-btn:hover { background:#2563eb; }
    .ea-exact-card { background:rgba(16,185,129,.15); border:1px solid rgba(16,185,129,.4); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:8px; user-select:text; }
    .ea-notfound-card { background:rgba(239,68,68,.2); border:1px solid rgba(239,68,68,.5); border-radius:8px; padding:12px; color:#fca5a5; line-height:1.5; font-size:12px; }
    .ea-exact-ans-box { background:#10b981; color:#064e3b; padding:8px 12px; border-radius:6px; font-size:16px; font-weight:700; display:flex; justify-content:space-between; align-items:center; word-break:break-all; box-shadow:0 4px 12px rgba(16,185,129,.3); }
    .ea-copy-btn-bright { background:#047857; border:none; color:#fff; cursor:pointer; font-size:11px; padding:4px 8px; border-radius:4px; font-weight:600; }
    .ea-copy-btn-bright:hover { background:#065f46; }
    .ea-option-detail { display:flex; gap:6px; font-size:12px; padding:3px 6px; background:rgba(255,255,255,.05); border-radius:4px; margin-top:3px; word-break:break-all; }
    .ea-option-letter { color:#10b981; font-weight:bold; min-width:16px; }
    .ea-option-text { color:#e2e8f0; line-height:1.4; }
    `;

    try {
        if (typeof GM_addStyle !== 'undefined') { GM_addStyle(cssText); }
        else { const s = document.createElement('style'); s.textContent = cssText; (document.head || document.documentElement).appendChild(s); }
    } catch(e) {}

    let inputQ, searchBtn, resultsList, toggleBtn, bodyEl, statusDot, autoCheckCb, fullAutoCb, debugBar;

    // ===== 创建浮窗 =====
    function createFloatingUI() {
        if (document.getElementById('exam-assistant-container')) return;
        container = document.createElement('div');
        container.id = 'exam-assistant-container';
        container.style.cssText = 'top:20px!important;right:20px!important;position:fixed!important;z-index:2147483647!important;display:block!important;visibility:visible!important;';
        container.innerHTML = `
            <div id="exam-assistant-header">
                <div class="ea-title-box">
                    <span class="ea-status-dot" id="ea-status"></span>
                    <span>🎯 考试助手 Premium v89</span>
                </div>
                <button class="ea-btn-icon" id="ea-toggle-btn">─</button>
            </div>
            <div id="exam-assistant-body">
                <div class="ea-control-bar">
                    <label class="ea-switch-label"><input type="checkbox" id="ea-auto-check-cb" ${autoCheckEnabled ? 'checked' : ''}> 自动勾选答案</label>
                    <label class="ea-full-auto-label"><input type="checkbox" id="ea-full-auto-cb"> ⚡ 3s全自动切题</label>
                </div>
                <div class="ea-debug-bar" id="ea-debug-bar">正在连接云端服务器 (${CLOUD_DOMAIN})...</div>
                <div class="ea-search-bar">
                    <input type="text" class="ea-input" id="ea-input-q" placeholder="正在读取题干...">
                    <button class="ea-search-btn" id="ea-search-btn">搜答案</button>
                </div>
                <div id="ea-results-list"></div>
            </div>`;
        
        (document.body || document.documentElement).appendChild(container);

        inputQ = document.getElementById('ea-input-q');
        searchBtn = document.getElementById('ea-search-btn');
        resultsList = document.getElementById('ea-results-list');
        toggleBtn = document.getElementById('ea-toggle-btn');
        bodyEl = document.getElementById('exam-assistant-body');
        statusDot = document.getElementById('ea-status');
        autoCheckCb = document.getElementById('ea-auto-check-cb');
        fullAutoCb = document.getElementById('ea-full-auto-cb');
        debugBar = document.getElementById('ea-debug-bar');

        if (autoCheckCb) autoCheckCb.addEventListener('change', e => {
            autoCheckEnabled = e.target.checked;
            GM_setValue('autoCheckEnabled', autoCheckEnabled);
        });
        if (fullAutoCb) fullAutoCb.addEventListener('change', e => {
            fullAutoEnabled = e.target.checked;
            if (fullAutoEnabled) { lastSwitchTimestamp = Date.now(); setDebug('全自动已启动，3秒后切题...'); }
            else { setDebug('全自动已关闭'); }
        });

        // 拖拽
        const header = document.getElementById('exam-assistant-header');
        if (header) {
            let drag = false, sx = 0, sy = 0, il = 0, it = 0;
            header.addEventListener('mousedown', e => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                drag = true; sx = e.clientX; sy = e.clientY;
                const r = container.getBoundingClientRect(); il = r.left; it = r.top;
                container.style.setProperty('right', 'auto', 'important');
                container.style.setProperty('left', il + 'px', 'important');
                container.style.setProperty('top', it + 'px', 'important');
                const mv = e2 => {
                    if (!drag) return;
                    let nl = il + e2.clientX - sx, nt = it + e2.clientY - sy;
                    nl = Math.max(5, Math.min(window.innerWidth - container.offsetWidth - 5, nl));
                    nt = Math.max(5, Math.min(window.innerHeight - container.offsetHeight - 5, nt));
                    container.style.setProperty('left', nl + 'px', 'important');
                    container.style.setProperty('top', nt + 'px', 'important');
                };
                const up = () => { drag = false; window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true); };
                window.addEventListener('mousemove', mv, true);
                window.addEventListener('mouseup', up, true);
            });
        }

        if (toggleBtn) toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            if (bodyEl) bodyEl.style.display = isCollapsed ? 'none' : 'flex';
            container.style.height = isCollapsed ? '42px' : 'auto';
            toggleBtn.innerText = isCollapsed ? '□' : '─';
        });
        if (searchBtn) searchBtn.addEventListener('click', () => sendSearchQuery(inputQ ? inputQ.value : ''));
        if (inputQ) inputQ.addEventListener('keypress', e => { if (e.key === 'Enter') sendSearchQuery(inputQ.value); });
        
        document.addEventListener('selectionchange', () => {
            if (selectionTimer) clearTimeout(selectionTimer);
            selectionTimer = setTimeout(checkAndSearchSelection, 120);
        }, true);
        document.addEventListener('mouseup', e => { if (container && container.contains(e.target)) return; checkAndSearchSelection(); }, true);
    }

    function setDebug(msg) { if (debugBar) debugBar.textContent = msg; }
    function markOnline(label) { if (statusDot) { statusDot.classList.add('online'); statusDot.title=`云端在线 (${label})`; } }
    function markOffline() { if (statusDot) { statusDot.classList.remove('online'); } }

    // ===== 破解防选中 =====
    function forceEnableSelection() {
        try {
            if (document.getElementById('ea-force-select-style')) return;
            const s = document.createElement('style');
            s.id = 'ea-force-select-style';
            s.innerHTML = `*,*::before,*::after{-webkit-user-select:text!important;user-select:text!important;pointer-events:auto!important;}`;
            (document.head || document.documentElement).appendChild(s);
            ['selectstart','contextmenu','mousedown','mouseup','keydown'].forEach(ev =>
                window.addEventListener(ev, e => { if (container && container.contains(e.target)) return; e.stopPropagation(); }, true)
            );
        } catch(e) {}
    }

    // ===== 时间戳托管守护引擎 =====
    function hostingDaemon() {
        if (!fullAutoEnabled || isCaptchaPresent()) return;
        const now = Date.now();
        if (lastSwitchTimestamp === 0) { lastSwitchTimestamp = now; return; }
        if (now - lastSwitchTimestamp >= 3000) {
            lastSwitchTimestamp = now;
            triggerNextQuestion();
        }
    }

    // ===== 切题引擎 =====
    function triggerNextQuestion() {
        if (isSwitchingQuestion) return;
        isSwitchingQuestion = true;
        setTimeout(() => { isSwitchingQuestion = false; }, 1500);

        const btns = Array.from(document.querySelectorAll('a, button')).filter(el => {
            if (container && container.contains(el)) return false;
            const t = (el.innerText || el.textContent || '').trim();
            return (t === '下一题' || t === '下一页') && el.offsetWidth > 0;
        });
        if (btns.length > 0) {
            setDebug(`✅ 点击下一题`);
            singleClick(btns[0]);
            return;
        }

        const all = Array.from(document.querySelectorAll('*')).filter(el => {
            if (container && container.contains(el)) return false;
            const t = (el.innerText || el.textContent || '').trim();
            return t === '下一题' && el.offsetWidth > 0 && el.offsetHeight > 0;
        });
        if (all.length > 0) {
            all.sort((a, b) => a.children.length - b.children.length);
            setDebug(`✅ 降级点击下一题`);
            singleClick(all[0]);
            return;
        }

        const currentNum = getCurrentQuestionNumber();
        if (currentNum !== null && currentNum > 0) {
            const target = String(currentNum + 1);
            const cards = Array.from(document.querySelectorAll('span,div,a,button,li,td')).filter(el => {
                if (container && container.contains(el)) return false;
                const t = (el.innerText || el.textContent || '').trim();
                if (t !== target) return false;
                const w = el.offsetWidth, h = el.offsetHeight;
                return w >= 15 && w <= 70 && h >= 15 && h <= 70;
            });
            if (cards.length > 0) {
                setDebug(`✅ 点击答题卡 "${target}"`);
                singleClick(cards[0]);
                return;
            }
        }

        setDebug('⚠️ 未找到"下一题"');
    }

    // ===== 单次精准物理点击派发引擎 =====
    function singleClick(el) {
        if (!el) return;
        try {
            let node = el;
            if (['SPAN','I','P','EM','STRONG'].includes(el.tagName) && el.parentElement &&
                ['A','BUTTON','DIV','LI','LABEL'].includes(el.parentElement.tagName)) {
                node = el.parentElement;
            }
            const jq = win.jQuery || win.$ || null;
            if (jq) {
                try { jq(node).trigger('click'); return; } catch(e) {}
            }
            if (typeof node.click === 'function') {
                node.click();
                return;
            }
            node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: win || window }));
        } catch(e) {}
    }

    function isCaptchaPresent() {
        const kws = ['安全验证','拖动滑块','完成验证','验证码','拼图'];
        for (const el of document.querySelectorAll('div,span')) {
            if (container && container.contains(el)) continue;
            const t = (el.innerText || el.textContent || '').trim();
            if (kws.some(k => t.includes(k)) && el.offsetWidth > 0) return true;
        }
        return false;
    }

    function getRawTitleText() {
        const sels = ['.ques-title','.question-title','.question-item-title','.question-content','.ques-name','.question_title',
                      '[class*="ques-title"]','[class*="question-title"]','[class*="ques-name"]'];
        for (const sel of sels) {
            try {
                const el = document.querySelector(sel);
                if (el && container && !container.contains(el)) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t.length >= 4) return t;
                }
            } catch(e) {}
        }
        for (const el of document.querySelectorAll('body *')) {
            if (container && container.contains(el)) continue;
            try {
                const rect = el.getBoundingClientRect();
                if (rect.left < 160 || rect.width < 80) continue;
            } catch(e) { continue; }
            const t = (el.innerText || el.textContent || '').trim();
            if (t.length >= 5 && t.length <= 500 && /^\d+[、.（(]/.test(t)) return t;
        }
        return '';
    }

    function autoExtractTitle() {
        const raw = getRawTitleText();
        if (!raw || raw.length < 4) return '';
        return raw
            .replace(/^[（(]?\d+[）).、\s]*/, '')
            .replace(/^(单选题|多选题|判断题|填空题|问答题)[：:\s]*/, '')
            .replace(/\(\s*\d+\s*分\s*\)/g, '')
            .trim();
    }

    function getCurrentQuestionNumber() {
        try {
            const raw = getRawTitleText();
            if (!raw) return null;
            const m = raw.match(/^[（(]?(\d+)[）).、\s]/);
            if (m) return parseInt(m[1], 10);
        } catch(e) {}
        return null;
    }

    function autoScanLoop() {
        if (isCaptchaPresent()) {
            if (resultsList) resultsList.innerHTML = `
                <div class="ea-notfound-card" style="background:rgba(251,191,36,.2);border-color:rgba(251,191,36,.6);color:#fbbf24;">
                    <strong>🛡️ 已触发滑动验证</strong><br>
                    <span style="font-size:11px;">请手动完成验证后，助手将自动恢复。</span>
                </div>`;
            return;
        }
        const now = Date.now();
        if (now - lastAutoProcessTime < 600) return;
        const title = autoExtractTitle();
        if (title && title.length >= 4 && title !== currentTitleHash) {
            currentTitleHash = title;
            lastAutoProcessTime = now;
            if (inputQ) inputQ.value = title;
            setDebug('题干已更新，云端搜题中...');
            sendSearchQuery(title);
        }
    }

    function collectOptions() {
        try {
            const texts = [];
            document.querySelectorAll('div,label,li,span,p').forEach(el => {
                if (container && container.contains(el)) return;
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect.left < 160 || rect.width < 20) return;
                } catch(e) { return; }
                const t = (el.innerText || el.textContent || '').trim();
                if (t && t.length >= 1 && t.length <= 100 &&
                    !t.includes('上一题') && !t.includes('下一题') &&
                    /^[A-G][.、:\s（(]|^[A-G]$/.test(t)) {
                    texts.push(t);
                }
            });
            return [...new Set(texts)];
        } catch(e) { return []; }
    }

    function checkAndSearchSelection() {
        try {
            const sel = window.getSelection();
            if (!sel) return;
            const t = sel.toString().trim();
            if (container && container.contains(document.activeElement)) return;
            if (t && t.length >= 2 && t !== lastSelectedText) {
                lastSelectedText = t;
                if (inputQ) inputQ.value = t;
                sendSearchQuery(t);
            }
        } catch(e) {}
    }

    // ===== 🌟 深度选框识别引擎 (全框架 z-checked/is-checked/selected 判重与二次点击锁死) =====
    function isOptionCheckedDeep(optionBox) {
        if (!optionBox) return false;
        
        // 1. 原生 input 检查
        const input = optionBox.querySelector('input[type="checkbox"], input[type="radio"]') || (optionBox.tagName === 'INPUT' ? optionBox : null);
        if (input && (input.checked || input.getAttribute('aria-checked') === 'true')) return true;

        // 2. 扫描容器及其所有子元素的 class 和属性 (全方位兼容 kyexam/regular.js/vue/element)
        const allNodes = [optionBox, ...Array.from(optionBox.querySelectorAll('*'))];
        for (const node of allNodes) {
            const cls = (node.className || '').toString();
            if (/(z-checked|z-sel|is-checked|checked|selected|active|on|cur|current)/i.test(cls)) {
                return true;
            }
            if (node.getAttribute('aria-checked') === 'true') return true;
        }
        return false;
    }

    function autoClickAnswerOption(data) {
        if (!autoCheckEnabled || !data) return false;
        const match = data.match || data;
        const rawAns = (data.answer || match.display_answer || match.answer_letter || '').toString().trim();
        if (!rawAns) return false;

        let targetLetters = [];
        let isTF = false;

        if (/^(correct|true|正确|对|√|yes|right)$/i.test(rawAns)) {
            targetLetters = ['A'];
            isTF = true;
        } else if (/^(wrong|false|错误|错|×|no)$/i.test(rawAns)) {
            targetLetters = ['B'];
            isTF = true;
        } else {
            targetLetters = [...new Set(rawAns.replace(/[^A-Za-z]/g, '').toUpperCase().split(''))].filter(Boolean);
        }

        if (targetLetters.length === 0) return false;

        const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        const targetSet = new Set(targetLetters);

        ALL_LETTERS.forEach((letter, index) => {
            const delay = index * 140;

            setTimeout(() => {
                const letterPrefixes = [
                    `${letter}.`, `${letter}、`, `${letter}:`, `${letter} `,
                    `${letter} .`, `${letter} 、`, `(${letter})`, `（${letter}）`
                ];
                if (isTF) {
                    if (letter === 'A') letterPrefixes.push('对', '正确', '√', 'A. 对', 'A.正确');
                    if (letter === 'B') letterPrefixes.push('错', '错误', '×', 'B. 错', 'B.错误');
                }

                const otherLetters = ALL_LETTERS.filter(l => l !== letter);

                const candidateNodes = Array.from(document.querySelectorAll('body *')).filter(el => {
                    if (container && container.contains(el)) return false;
                    const text = (el.innerText || el.textContent || '').trim();
                    if (!text || text.length > 300) return false;

                    const containsOtherOptions = otherLetters.some(ol =>
                        text.includes(`${ol}.`) || text.includes(`${ol}、`) || text.includes(`${ol}:`)
                    );
                    if (containsOtherOptions) return false;

                    return letterPrefixes.some(p => text.startsWith(p)) || text === letter;
                });

                if (candidateNodes.length === 0) return;

                candidateNodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
                const targetTextNode = candidateNodes[0];

                let optionBox = targetTextNode;
                while (optionBox && optionBox.parentElement && optionBox.parentElement.tagName !== 'BODY') {
                    if (optionBox.tagName === 'LABEL' || 
                        optionBox.classList.contains('el-checkbox') || 
                        optionBox.classList.contains('el-radio') ||
                        (optionBox.offsetWidth > 100 && optionBox.children.length > 1)) {
                        break;
                    }
                    optionBox = optionBox.parentElement;
                }

                // 🌟 使用深层识别算法判断是否已经勾选
                const isCurrentlyChecked = isOptionCheckedDeep(optionBox);
                const shouldBeChecked = targetSet.has(letter);
                const clickTarget = (optionBox && optionBox.querySelector) 
                    ? (optionBox.querySelector('input, .el-checkbox__inner, .el-radio__inner, i') || optionBox)
                    : targetTextNode;

                // 🌟 强力保护决策：已勾选的正确选项，绝对禁止第二次点击！
                if (shouldBeChecked && !isCurrentlyChecked) {
                    setDebug(`⚡ 补勾选漏选选项 ${letter}`);
                    singleClick(clickTarget);
                } else if (!shouldBeChecked && isCurrentlyChecked) {
                    setDebug(`🧹 撤销误勾选选项 ${letter}`);
                    singleClick(clickTarget);
                } else if (shouldBeChecked && isCurrentlyChecked) {
                    setDebug(`🔒 选项 ${letter} 已在页面勾选，绝对保护不动`);
                }

            }, delay);
        });

        return true;
    }

    // ===== 🌐 云端在线搜题网络通信 =====
    function autoConnectBackend() {
        if (isConnected && !fallbackMode) return;
        tryCloudWs();
    }

    function tryCloudWs() {
        try {
            const url = `ws://${CLOUD_DOMAIN}/ws/search`;
            socket = new WebSocket(url);
            socket.onopen = () => { isConnected = true; fallbackMode = false; activeType = 'wss_cloud'; markOnline('云端WSS'); };
            socket.onmessage = e => { try { handleResponseData(JSON.parse(e.data)); } catch(err) {} };
            socket.onerror = () => startCloudHttp();
            socket.onclose = () => startCloudHttp();
        } catch(e) { startCloudHttp(); }
    }

    function startCloudHttp() {
        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        const token = USER_TOKEN || 'TEST-VIP-2026-8888';
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${TOKEN_INFO_URL}?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(DEVICE_ID)}`,
            timeout: 2500,
            onload: r => { isConnected = true; fallbackMode = true; activeType = 'cloud_http'; markOnline('云端HTTP'); },
            onerror: renderErrorUI,
            ontimeout: renderErrorUI
        });
    }

    function sendSearchQuery(query) {
        if (!query || query.trim().length < 2) return;
        if (resultsList) resultsList.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:10px;">⚡ 云端检索答案中...</div>';

        const cleanQuery = query
            .replace(/^\d+[\s\S]*?(单选题|多选题|判断题|填空题)[：:\s]*/i, '')
            .replace(/^\d+[.、．\s]+/, '')
            .trim();

        const token = USER_TOKEN || 'TEST-VIP-2026-8888';
        const options = collectOptions();

        if (socket && socket.readyState === WebSocket.OPEN && !fallbackMode) {
            socket.send(JSON.stringify({ query: cleanQuery, options, token }));
            return;
        }

        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        const cloudUrl = `${HTTP_URL}?q=${encodeURIComponent(cleanQuery)}&token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(DEVICE_ID)}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: cloudUrl,
            headers: { 'Content-Type': 'application/json' },
            timeout: 8000,
            onload: r => {
                if (r.status === 200) {
                    markOnline(activeType || '云端在线');
                    try { handleResponseData(JSON.parse(r.responseText)); } catch(e) {}
                } else {
                    renderErrorUI();
                }
            },
            onerror: renderErrorUI
        });
    }

    function handleResponseData(data) {
        renderSingleResult(data);
    }

    function renderErrorUI() {
        markOffline();
        if (!resultsList) return;
        resultsList.innerHTML = `<div class="ea-notfound-card"><strong>⚠️ 未能连接到云端服务器 (${CLOUD_DOMAIN})</strong><br>
            <span style="font-size:11px;">请检查云端服务在线状态，配置域名: ${CLOUD_DOMAIN}</span></div>`;
    }

    function renderSingleResult(data) {
        if (!resultsList) return;
        if (!data || (!data.found && !data.success)) {
            const s = (data && data.highest_score) ? ` (最高相似${data.highest_score}%)` : '';
            resultsList.innerHTML = `<div class="ea-notfound-card"><strong>⚠️ 题库未匹配</strong>${s}<br>
                <span style="font-size:11px;opacity:.8;">请检查云端数据库...</span></div>`;
            return;
        }

        const match = data.match || data;
        let ansLetters = (data.answer || match.display_answer || match.answer_letter || '未知').toString().trim();
        const opts = data.options || match.options || {};
        
        if (/^(correct|true|正确|对|√)$/i.test(ansLetters)) {
            ansLetters = 'A. 正确';
        } else if (/^(wrong|false|错误|错|×)$/i.test(ansLetters)) {
            ansLetters = 'B. 错误';
        }

        autoClickAnswerOption(data);

        const targetLetters = ansLetters.toUpperCase().replace(/[^A-Z]/g, '').split('');
        let optionDetailsHtml = '';

        if (targetLetters.length > 0 && Object.keys(opts).length > 0) {
            optionDetailsHtml = targetLetters.map(letter => {
                const optText = opts[letter];
                if (!optText) return '';
                return `
                    <div class="ea-option-detail">
                        <span class="ea-option-letter">${letter}.</span>
                        <span class="ea-option-text">${esc(optText)}</span>
                    </div>
                `;
            }).join('');
        }

        resultsList.innerHTML = `
            <div class="ea-exact-card">
                <div style="display:flex;justify-content:space-between;color:#34d399;font-size:11px;font-weight:600;">
                    <span>✅ 云端匹配成功 (${data.score || 100}%)</span>
                    <span style="color:#60a5fa;font-weight:bold;">⚡ 3s后切下一题</span>
                </div>
                <div style="color:#e5e7eb;font-size:12px;line-height:1.4;">${esc(match.title || match.q_title || '当前题目')}</div>
                <div class="ea-exact-ans-box">
                    <span>正确答案: ${esc(ansLetters)}</span>
                    <button class="ea-copy-btn-bright" id="ea-copy-btn">复制答案</button>
                </div>
                ${optionDetailsHtml ? `<div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;">${optionDetailsHtml}</div>` : ''}
            </div>`;

        const btn = document.getElementById('ea-copy-btn');
        if (btn) btn.addEventListener('click', function() {
            navigator.clipboard.writeText(ansLetters).then(() => { this.innerText='已复制!'; setTimeout(()=>this.innerText='复制答案',1500); });
        });
    }

    function esc(t) { return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // ===== 启动主入口 =====
    function startRun() {
        forceEnableSelection();
        createFloatingUI();
        autoConnectBackend();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') { startRun(); }
    else { window.addEventListener('DOMContentLoaded', startRun); window.addEventListener('load', startRun); }

    setInterval(startRun, 1000);
    setInterval(autoScanLoop, 350);
    setInterval(hostingDaemon, 300);

})();
