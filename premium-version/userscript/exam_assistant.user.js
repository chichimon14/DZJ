// ==UserScript==
// @name         网页考试助手 Premium v52 - 云端Token授权 + 私有题库上传 + 全平台
// @namespace    http://tampermonkey.net/
// @version      52.0.0
// @description  云端 WSS 极速搜题 + Token 一键激活 + 私有题库拖拽上传 + 全自动3秒切题 + 全平台(PC/Android/iOS)
// @author       Antigravity
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ===== 云端服务器配置 =====
    const CLOUD_DOMAIN = GM_getValue('cloud_domain', '175.178.78.88');
    const isIP = /^\d+\.\d+\.\d+\.\d+/.test(CLOUD_DOMAIN);
    const WS_SCHEME   = (location.protocol === 'https:' && !isIP) ? 'wss://' : 'ws://';
    const HTTP_SCHEME = (location.protocol === 'https:' && !isIP) ? 'https://' : 'http://';

    const WSS_URL         = `${WS_SCHEME}${CLOUD_DOMAIN}/ws/search`;
    const HTTP_URL        = `${HTTP_SCHEME}${CLOUD_DOMAIN}/api/search`;
    const BANK_UPLOAD_URL = `${HTTP_SCHEME}${CLOUD_DOMAIN}/api/bank/upload`;
    const BANK_CLEAR_URL  = `${HTTP_SCHEME}${CLOUD_DOMAIN}/api/bank/clear`;
    const BANK_INFO_URL   = `${HTTP_SCHEME}${CLOUD_DOMAIN}/api/bank/info`;
    const TOKEN_INFO_URL  = `${HTTP_SCHEME}${CLOUD_DOMAIN}/api/token/info`;

    // ===== 持久化存储的配置项 =====
    let USER_TOKEN   = GM_getValue('user_token', '');
    let DEVICE_ID    = GM_getValue('device_id', '');

    // 若无 device_id，生成并持久化（浏览器指纹混合随机）
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
    let socket             = null;
    let isConnected        = false;
    let isCollapsed        = false;
    let autoCheckEnabled   = GM_getValue('autoCheckEnabled', true);
    let fullAutoEnabled    = false;
    let lastSwitchTimestamp = 0;
    let isSwitchingQuestion = false;
    let currentTitleHash   = '';
    let container          = null;
    let fallbackMode       = false;
    let lastAutoProcessTime = 0;
    let activeTab          = 'search';   // 'search' | 'settings'
    let tokenStatus        = null;

    // ===== CSS =====
    const cssText = `
    #exam-assistant-container {
        position: fixed !important; width: 360px !important; max-height: 620px !important;
        z-index: 2147483647 !important; background: #0f172a !important;
        border: 2px solid #3b82f6 !important; border-radius: 14px !important;
        box-shadow: 0 10px 40px rgba(0,0,0,.9), 0 0 24px rgba(59,130,246,.4) !important;
        color: #f1f5f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important; overflow: hidden !important;
        user-select: none !important; display: block !important;
        visibility: visible !important; opacity: 1 !important;
    }
    #exam-assistant-header {
        padding: 10px 14px;
        background: linear-gradient(135deg, #1d4ed8, #7c3aed) !important;
        border-bottom: 1px solid rgba(255,255,255,.15);
        display: flex; align-items: center; justify-content: space-between;
        cursor: move !important; touch-action: none !important;
    }
    .ea-title-box { display:flex; align-items:center; gap:8px; font-weight:700; color:#fff; pointer-events:none; font-size:13px; }
    .ea-status-dot { width:10px; height:10px; border-radius:50%; background:#ef4444; box-shadow:0 0 8px #ef4444; transition:all .4s; }
    .ea-status-dot.online { background:#10b981; box-shadow:0 0 10px #10b981; }
    .ea-btn-icon { background:rgba(255,255,255,.2); border:none; color:#fff; border-radius:4px; width:24px; height:24px; cursor:pointer; font-size:11px; font-weight:bold; display:flex; align-items:center; justify-content:center; transition:background .2s; }
    .ea-btn-icon:hover { background:rgba(255,255,255,.4); }

    /* 标签页 */
    .ea-tabs { display:flex; background:#0a1120; border-bottom:1px solid rgba(255,255,255,.08); }
    .ea-tab { flex:1; padding:9px 0; text-align:center; font-size:12px; font-weight:600; color:#64748b; cursor:pointer; border:none; background:none; transition:all .2s; }
    .ea-tab.active { color:#60a5fa; border-bottom:2px solid #3b82f6; }
    .ea-tab:hover { color:#94a3b8; }

    #exam-assistant-body { padding:12px; display:flex; flex-direction:column; gap:10px; max-height:520px; overflow-y:auto; background:#0f172a; }

    /* 控制栏 */
    .ea-control-bar { display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,.04); padding:7px 10px; border-radius:8px; font-size:11px; border:1px solid rgba(255,255,255,.07); }
    .ea-switch-label {
        display:flex; align-items:center; gap:6px; cursor:pointer;
        padding:4px 9px; border-radius:6px; font-size:11px; font-weight:600;
        background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.35);
        color:#fca5a5; transition:all .3s;
    }
    .ea-switch-label.active { background:rgba(16,185,129,.18); border-color:rgba(16,185,129,.45); color:#34d399; box-shadow:0 0 8px rgba(16,185,129,.25); }
    .ea-full-auto-label {
        display:flex; align-items:center; gap:6px; cursor:pointer;
        padding:4px 9px; border-radius:6px; font-size:11px; font-weight:600;
        background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.35);
        color:#fca5a5; transition:all .3s;
    }
    .ea-full-auto-label.active { background:rgba(59,130,246,.18); border-color:rgba(59,130,246,.45); color:#60a5fa; box-shadow:0 0 8px rgba(59,130,246,.25); }

    .ea-debug-bar { background:rgba(96,165,250,.08); border:1px solid rgba(96,165,250,.2); border-radius:6px; padding:5px 9px; font-size:10px; color:#93c5fd; min-height:20px; word-break:break-all; line-height:1.5; }
    .ea-search-bar { display:flex; gap:6px; }
    .ea-input { flex:1; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.2); border-radius:8px; padding:8px 10px; color:#fff; font-size:12px; outline:none; transition:border-color .2s; }
    .ea-input:focus { border-color:#3b82f6; }
    .ea-btn { padding:8px 14px; border-radius:8px; border:none; font-size:12px; font-weight:600; cursor:pointer; transition:all .2s; }
    .ea-btn-blue { background:linear-gradient(135deg,#2563eb,#7c3aed); color:#fff; }
    .ea-btn-blue:hover { opacity:.85; transform:translateY(-1px); }
    .ea-btn-red { background:rgba(239,68,68,.2); border:1px solid rgba(239,68,68,.4); color:#fca5a5; }
    .ea-btn-red:hover { background:rgba(239,68,68,.35); }

    /* 答案展示 */
    .ea-answer-box { background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.25); border-radius:8px; padding:10px; }
    .ea-answer-title { font-size:10px; color:#6ee7b7; font-weight:600; margin-bottom:6px; letter-spacing:.05em; }
    .ea-answer-text { font-size:13px; font-weight:700; color:#34d399; margin-bottom:6px; }
    .ea-options { display:flex; flex-direction:column; gap:3px; margin-top:4px; }
    .ea-option { font-size:12px; color:#94a3b8; padding:2px 0; display:flex; gap:6px; }
    .ea-option.match { color:#6ee7b7; font-weight:600; }
    .ea-option-letter { color:#60a5fa; font-weight:700; min-width:16px; }
    .ea-miss { color:#f87171; font-size:12px; text-align:center; padding:8px 0; }

    /* 设置面板 */
    .ea-settings { display:flex; flex-direction:column; gap:12px; }
    .ea-setting-group { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:12px; }
    .ea-setting-group h4 { font-size:11px; color:#60a5fa; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:.08em; }
    .ea-setting-row { display:flex; gap:6px; align-items:center; }
    .ea-setting-input { flex:1; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.15); border-radius:6px; padding:8px 10px; color:#fff; font-size:12px; outline:none; font-family:monospace; }
    .ea-setting-input:focus { border-color:#3b82f6; }
    .ea-badge-ok { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:99px; background:rgba(16,185,129,.15); border:1px solid rgba(16,185,129,.35); color:#34d399; font-size:11px; font-weight:600; }
    .ea-badge-err { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:99px; background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.35); color:#fca5a5; font-size:11px; font-weight:600; }

    /* 拖拽上传区 */
    .ea-drop-zone { border:2px dashed rgba(255,255,255,.15); border-radius:8px; padding:20px; text-align:center; cursor:pointer; transition:all .3s; }
    .ea-drop-zone:hover,.ea-drop-zone.drag { border-color:#3b82f6; background:rgba(59,130,246,.08); }
    .ea-drop-zone p { color:#64748b; font-size:12px; margin-top:6px; }
    .ea-drop-zone .dz-icon { font-size:28px; }

    /* 进度条 */
    .ea-progress { height:4px; border-radius:2px; background:rgba(255,255,255,.1); overflow:hidden; margin-top:6px; display:none; }
    .ea-progress-bar { height:100%; background:linear-gradient(90deg,#3b82f6,#10b981); border-radius:2px; transition:width .3s; width:0%; }
    `;

    GM_addStyle(cssText);

    // ===== 工具函数 =====
    function setDebug(msg) {
        const el = document.getElementById('ea-debug-bar');
        if (el) el.textContent = msg;
    }

    function genId(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

    function titleHash(t) {
        let h = 0;
        for (let i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
        return h.toString(36);
    }

    function saveToken(token) {
        USER_TOKEN = token.trim();
        GM_setValue('user_token', USER_TOKEN);
    }

    // ===== 建立 WSS 连接 =====
    function connectWS() {
        if (!USER_TOKEN) {
            setDebug('⚠️ 请先在【设置】中填写激活码');
            return;
        }
        if (socket && socket.readyState === WebSocket.OPEN) return;

        const url = `${WSS_URL}?token=${encodeURIComponent(USER_TOKEN)}&device_id=${encodeURIComponent(DEVICE_ID)}`;
        setDebug('🔄 正在连接云端服务器...');

        try {
            socket = new WebSocket(url);
        } catch (e) {
            fallbackMode = true;
            setDebug('⚠️ WSS 连接失败，已切换 HTTP 备用通道');
            return;
        }

        socket.onopen = () => {
            isConnected = true;
            fallbackMode = false;
            updateStatusDot(true);
            setDebug('🟢 云端连接成功，随时可以搜题');
        };

        socket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.status === 'connected') return;
                if (data.error) {
                    setDebug('❌ ' + data.error);
                    if (data.code === 4003 || data.code === 4002) updateStatusDot(false);
                    return;
                }
                handleSearchResult(data);
            } catch (err) {}
        };

        socket.onerror = () => {
            isConnected = false;
            fallbackMode = true;
            updateStatusDot(false);
            setDebug('⚠️ WSS 断开，已切换 HTTP 备用模式');
        };

        socket.onclose = () => {
            isConnected = false;
            updateStatusDot(false);
            setTimeout(() => { if (USER_TOKEN) connectWS(); }, 3000);
        };
    }

    function updateStatusDot(online) {
        const dot = document.getElementById('ea-status-dot');
        if (dot) dot.classList.toggle('online', online);
    }

    // ===== 搜题入口（带 Version & 题干校验，防错位）=====
    let currentSearchingQuery = '';

    function searchQuestion(query) {
        if (!query) return;
        // 清洗题干：剥离题号前缀（如 '21、单选题：根据题干信息，在选项中...'）
        const cleanQuery = query
            .replace(/^\d+[\s\S]*?(单选题|多选题|判断题|填空题)[：:\s]*/i, '')
            .replace(/^\d+[.、．\s]+/, '')
            .trim();

        if (cleanQuery.length < 4) return;
        currentSearchingQuery = cleanQuery;
        setDebug('🔍 搜索中: ' + cleanQuery.slice(0, 26) + '...');

        if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(cleanQuery);
        } else {
            const url = `${HTTP_URL}?q=${encodeURIComponent(cleanQuery)}&token=${encodeURIComponent(USER_TOKEN)}&device_id=${encodeURIComponent(DEVICE_ID)}`;
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload: (r) => {
                    try { handleSearchResult(JSON.parse(r.responseText), cleanQuery); }
                    catch (e) { setDebug('❌ HTTP 响应解析失败'); }
                },
                onerror: () => setDebug('❌ 网络请求失败，请检查服务器')
            });
        }
    }

    // ===== 处理搜题结果（带防错位丢弃机制）=====
    function handleSearchResult(data, reqQuery) {
        if (!data) {
            setDebug('❌ 返回数据为空');
            return;
        }

        if (data.error) {
            setDebug('❌ ' + data.error);
            const box = document.getElementById('ea-answer-box');
            if (box) box.innerHTML = `<div class="ea-miss">❌ ${data.error}</div>`;
            return;
        }

        // 如果当前页面的题干已经切换，丢弃过期的旧搜题响应
        const currentTitleEl = findQuestionTitle();
        if (currentTitleEl) {
            const curTitle = cleanQuestionTitleText(currentTitleEl.textContent);
            if (reqQuery && curTitle && !curTitle.includes(reqQuery.slice(0, 10)) && !reqQuery.includes(curTitle.slice(0, 10))) {
                setDebug('⚠️ 丢弃跨题过期响应');
                return;
            }
        }

        lastResult = data;
        renderAnswer(data);
        if (data.found && autoCheckEnabled) {
            setTimeout(() => autoCheck(data), 150);
        }
    }

    function renderAnswer(data) {
        const box = document.getElementById('ea-answer-box');
        if (!box) return;

        if (data.error) {
            box.innerHTML = `<div class="ea-miss">❌ ${data.error}</div>`;
            return;
        }

        if (!data.found) {
            box.innerHTML = `<div class="ea-miss">😕 ${data.msg || '未找到匹配题目'}</div>`;
            return;
        }

        const answerLetters = data.q_type === 'judge'
            ? (data.answer === 'correct' ? '✅ 正确' : '❌ 错误')
            : (data.answer || '-');

        const opts = data.options || {};
        const ansArr = (data.answer || '').split('');
        const optsHtml = ['A', 'B', 'C', 'D'].filter(k => opts[k]).map(k =>
            `<div class="ea-option${ansArr.includes(k) ? ' match' : ''}">
               <span class="ea-option-letter">${k}.</span>
               <span>${opts[k]}</span>
             </div>`
        ).join('');

        box.innerHTML = `
            <div class="ea-answer-title">🎯 匹配答案（相似度 ${data.score || 0}%，来源: ${data.source === 'private' ? '私有库' : '公共库'}）</div>
            <div class="ea-answer-text" style="font-size:16px;color:#10b981">${answerLetters}</div>
            ${optsHtml ? `<div class="ea-options">${optsHtml}</div>` : ''}
        `;
    }

    // ===== 极速仿真点击与勾选引擎 =====
    function triggerFullClick(el) {
        if (!el) return false;
        try {
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
                const evt = new MouseEvent(evtType, { bubbles: true, cancelable: true, view: win });
                el.dispatchEvent(evt);
            });
            if (typeof el.click === 'function') el.click();
            return true;
        } catch (e) {
            return false;
        }
    }

    function autoCheck(data) {
        if (!data || !data.found) return;

        if (data.q_type === 'judge') {
            autoCheckJudge(data.answer);
            return;
        }

        const answerLetters = (data.answer || '').toUpperCase().split('').filter(c => /[A-D]/.test(c));
        const opts = data.options || {};

        // 仅抓取屏幕上当前可见的选项节点
        const elements = getVisibleOptionElements();
        let matchedCount = 0;

        answerLetters.forEach(letter => {
            const targetText = opts[letter] ? cleanOptionText(opts[letter]) : '';

            for (const el of elements) {
                const raw = el.textContent.trim();
                const cleaned = cleanOptionText(raw);

                const letterMatch = raw.match(/^[○●\s]*[（(]?([A-Da-d])[)）.、\s]/);
                const elLetter = letterMatch ? letterMatch[1].toUpperCase() : '';

                let matched = false;
                if (elLetter && elLetter === letter) matched = true;
                if (targetText && targetText.length >= 2 && cleaned.includes(targetText.slice(0, 6))) matched = true;

                if (matched) {
                    const input = el.querySelector('input[type=radio], input[type=checkbox]') || el.closest('label')?.querySelector('input');
                    const targetEl = input || el;
                    triggerFullClick(targetEl);
                    matchedCount++;
                    break;
                }
            }
        });

        if (matchedCount > 0) setDebug(`✅ 已自动勾选答案: ${data.answer}`);
        else setDebug(`⚠️ 勾选未命中，答案为: ${data.answer}`);
    }

    function getVisibleOptionElements() {
        const all = Array.from(document.querySelectorAll('body *'));
        return all.filter(el => {
            if (el.offsetParent === null) return false; // 排除隐藏节点
            const tag = el.tagName.toLowerCase();
            if (!['label', 'li', 'div', 'span', 'td', 'p'].includes(tag)) return false;
            if (el.children.length > 5) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 15 || rect.top < 0 || rect.top > window.innerHeight) return false;
            const text = el.textContent.trim();
            if (text.length < 1 || text.length > 250) return false;
            return true;
        });
    }

    function cleanQuestionTitleText(raw) {
        return (raw || '')
            .replace(/^\d+[\s\S]*?(单选题|多选题|判断题|填空题)[：:\s]*/i, '')
            .replace(/^\d+[.、．\s]+/, '')
            .trim();
    }

    function findQuestionTitle() {
        const selectors = [
            '.question-title', '.q-title', '.stem', '.exam-title',
            '[class*="questionStem"]', '[class*="question_title"]',
            '[class*="ques-title"]', '[class*="title"][class*="ques"]',
            '.exam-question-title'
        ];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (el.offsetParent !== null && el.textContent.trim().length > 6) {
                    return el;
                }
            }
        }
        return null;
    }

    function autoCheckJudge(answer) {
        const isCorrect = answer === 'correct';
        const keywords = isCorrect ? ['正确', '对', '是', 'true', '√'] : ['错误', '错', '否', 'false', '×'];

        const elements = getAllOptionElements();
        for (const el of elements) {
            const text = el.textContent.trim().toLowerCase();
            if (keywords.some(k => text === k || text.includes(k))) {
                const input = el.querySelector('input') || el.closest('label')?.querySelector('input');
                if (input) { singleClick(input); break; }
                singleClick(el); break;
            }
        }
        setDebug(`✅ 判断题已选: ${isCorrect ? '正确' : '错误'}`);
    }

    // ===== 3 秒全自动切题（继承 v51 守护机制）=====
    function getCurrentQuestionNumber() {
        const candidates = document.querySelectorAll('.question-item.active, .cur-question, [class*="current"][class*="question"]');
        for (const el of candidates) {
            const text = el.textContent.trim();
            const m = text.match(/\d+/);
            if (m) return parseInt(m[0]);
        }
        return null;
    }

    function switchToNextQuestion() {
        if (isSwitchingQuestion) return;
        isSwitchingQuestion = true;
        setTimeout(() => { isSwitchingQuestion = false; }, 1000);

        // 策略一：答题卡 N+1 跳转
        const curNum = getCurrentQuestionNumber();
        if (curNum) {
            const next = document.querySelector(`[data-index="${curNum}"], [data-num="${curNum + 1}"]`);
            if (next) { singleClick(next); return; }
        }

        // 策略二：独立"下一题"按钮
        const btns = document.querySelectorAll('button, .btn, [class*="next"], [class*="下一题"]');
        for (const btn of btns) {
            const text = btn.textContent.trim();
            if (/下一题|next/i.test(text) && btn.offsetParent) { singleClick(btn); return; }
        }

        // 策略三：全局叶子节点兜底
        const allLinks = document.querySelectorAll('a, li, div[onclick]');
        for (const el of allLinks) {
            if (/下一题|下一道|next/i.test(el.textContent) && el.offsetParent) { singleClick(el); return; }
        }
    }

    function autoProcessCurrentQuestion() {
        const now = Date.now();
        if (now - lastAutoProcessTime < 1500) return;
        lastAutoProcessTime = now;

        // 自动提取题干
        const titleEl = findQuestionTitle();
        if (!titleEl) return;
        const title = titleEl.textContent.trim();
        const hash = titleHash(title);
        if (hash === currentTitleHash) return;
        currentTitleHash = hash;
        searchQuestion(title);
    }

    function findQuestionTitle() {
        const selectors = [
            '.question-title', '.q-title', '.stem', '.exam-title',
            '[class*="questionStem"]', '[class*="question_title"]',
            '[class*="ques-title"]', '[class*="title"][class*="ques"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 5) return el;
        }
        return null;
    }

    // 300ms 心跳守护
    setInterval(() => {
        if (!fullAutoEnabled) return;
        const now = Date.now();
        if (now - lastSwitchTimestamp >= 3000) {
            autoProcessCurrentQuestion();
            if (now - lastSwitchTimestamp >= 3000 + 800) {
                switchToNextQuestion();
                lastSwitchTimestamp = now;
            }
        }
    }, 300);

    // ===== 题库上传功能 =====
    function uploadBankFile(file) {
        const progress = document.getElementById('ea-upload-progress');
        const bar = document.getElementById('ea-upload-bar');
        const status = document.getElementById('ea-upload-status');

        if (progress) progress.style.display = 'block';
        if (bar) bar.style.width = '30%';
        if (status) status.textContent = '⏳ 上传中...';

        const fd = new FormData();
        fd.append('file', file);
        fd.append('token', USER_TOKEN);
        fd.append('device_id', DEVICE_ID);
        fd.append('target', 'private');

        GM_xmlhttpRequest({
            method: 'POST',
            url: BANK_UPLOAD_URL,
            data: fd,
            upload: {
                onprogress: (e) => {
                    if (e.lengthComputable && bar) {
                        bar.style.width = Math.round(e.loaded / e.total * 80) + '%';
                    }
                }
            },
            onload: (r) => {
                if (bar) bar.style.width = '100%';
                try {
                    const data = JSON.parse(r.responseText);
                    if (data.success) {
                        if (status) status.textContent = `✅ 成功导入 ${data.imported} 道题目！`;
                        setDebug(`✅ 私有题库已更新：${data.imported} 题`);
                    } else {
                        if (status) status.textContent = '❌ 上传失败';
                    }
                } catch (e) {
                    if (status) status.textContent = '❌ 解析响应失败';
                }
            },
            onerror: () => {
                if (status) status.textContent = '❌ 网络错误，请检查服务器连接';
            }
        });
    }

    function clearPrivateBank() {
        if (!confirm('确认清空你的私有题库？')) return;
        const url = `${BANK_CLEAR_URL}?target=private&token=${encodeURIComponent(USER_TOKEN)}&device_id=${encodeURIComponent(DEVICE_ID)}`;
        GM_xmlhttpRequest({
            method: 'DELETE', url,
            onload: (r) => {
                const d = JSON.parse(r.responseText);
                if (d.success) { setDebug('✅ 私有题库已清空'); loadBankInfo(); }
            }
        });
    }

    function loadBankInfo() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${BANK_INFO_URL}?token=${encodeURIComponent(USER_TOKEN)}`,
            onload: (r) => {
                try {
                    const d = JSON.parse(r.responseText);
                    const el = document.getElementById('ea-bank-info');
                    if (el) el.textContent = `公共库: ${d.public} 题 / 私有库: ${d.private} 题`;
                } catch(e) {}
            }
        });
    }

    function verifyToken(token) {
        const el = document.getElementById('ea-token-status');
        if (el) el.textContent = '验证中...';
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${TOKEN_INFO_URL}?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(DEVICE_ID)}`,
            onload: (r) => {
                try {
                    const d = JSON.parse(r.responseText);
                    tokenStatus = d;
                    if (d.valid) {
                        const exp = d.expires_at ? `到期: ${d.expires_at}` : '永久有效';
                        if (el) el.innerHTML = `<span class="ea-badge-ok">✅ 已激活 (${d.card_type === 'LIFETIME' ? '买断' : exp})</span>`;
                        saveToken(token);
                        connectWS();
                    } else {
                        if (el) el.innerHTML = `<span class="ea-badge-err">❌ ${d.msg || '无效 Token'}</span>`;
                    }
                } catch(e) {}
            },
            onerror: () => {
                if (el) el.innerHTML = `<span class="ea-badge-err">❌ 网络错误</span>`;
            }
        });
    }

    // ===== 构建 UI =====
    function buildUI() {
        if (document.getElementById('exam-assistant-container')) return;

        container = document.createElement('div');
        container.id = 'exam-assistant-container';
        container.style.cssText = 'top:80px!important;right:20px!important;';

        container.innerHTML = `
        <div id="exam-assistant-header">
            <div class="ea-title-box">
                <div class="ea-status-dot" id="ea-status-dot"></div>
                <span>🎯 考试助手 Premium</span>
            </div>
            <div style="display:flex;gap:5px">
                <button class="ea-btn-icon" id="ea-min-btn" title="最小化">_</button>
            </div>
        </div>

        <div class="ea-tabs" id="ea-tabs">
            <button class="ea-tab active" id="ea-tab-btn-search">🔍 搜题</button>
            <button class="ea-tab" id="ea-tab-btn-settings">⚙️ 设置</button>
        </div>

        <div id="exam-assistant-body">

          <!-- 搜题面板 -->
          <div id="ea-tab-search">
            <div style="display:flex;flex-direction:column;gap:10px">
              <div class="ea-control-bar">
                  <label class="ea-switch-label" id="ea-auto-label" for="ea-auto-cb">
                      <input type="checkbox" id="ea-auto-cb" style="display:none" ${autoCheckEnabled ? 'checked' : ''}/>
                      ${autoCheckEnabled ? '🤖 自动勾选 ON' : '⏸ 自动勾选 OFF'}
                  </label>
                  <label class="ea-full-auto-label" id="ea-full-auto-label" for="ea-full-auto-cb">
                      <input type="checkbox" id="ea-full-auto-cb" style="display:none"/>
                      ⚡ 3s 全自动
                  </label>
              </div>
              <div class="ea-debug-bar" id="ea-debug-bar">${USER_TOKEN ? '正在连接云端...' : '⚠️ 请在设置中填写激活码'}</div>
              <div class="ea-search-bar">
                  <input class="ea-input" id="ea-search-input" placeholder="粘贴题干手动搜索..." />
                  <button class="ea-btn ea-btn-blue" id="ea-search-btn">搜题</button>
              </div>
              <div class="ea-answer-box" id="ea-answer-box">
                  <div class="ea-miss">等待搜题中...</div>
              </div>
            </div>
          </div>

          <!-- 设置面板 -->
          <div id="ea-tab-settings" style="display:none">
            <div class="ea-settings">

              <div class="ea-setting-group">
                <h4>🔑 激活码设置</h4>
                <div class="ea-setting-row">
                    <input class="ea-setting-input" id="ea-token-input" placeholder="输入激活码 XXXX-XXXX-XXXX-XXXX-XXXX" value="${USER_TOKEN}"/>
                    <button class="ea-btn ea-btn-blue" id="ea-activate-btn" style="font-size:11px;padding:8px 10px">激活</button>
                </div>
                <div style="margin-top:8px" id="ea-token-status">
                    ${USER_TOKEN ? '<span style="color:#64748b;font-size:11px">请点击激活验证状态</span>' : '<span style="color:#64748b;font-size:11px">尚未填写激活码</span>'}
                </div>
              </div>

              <div class="ea-setting-group">
                <h4>📚 私有题库管理</h4>
                <div id="ea-bank-info" style="font-size:11px;color:#64748b;margin-bottom:10px">加载中...</div>
                <div class="ea-drop-zone" id="ea-drop-zone" onclick="document.getElementById('ea-bank-file').click()">
                    <div class="dz-icon">📊</div>
                    <p>点击或拖拽 Excel/CSV 到此处</p>
                    <p>列名: 序号 | 题干 | 答案 | 详细答案</p>
                </div>
                <input type="file" id="ea-bank-file" accept=".xlsx,.xls,.csv" style="display:none" />
                <div class="ea-progress" id="ea-upload-progress">
                    <div class="ea-progress-bar" id="ea-upload-bar"></div>
                </div>
                <div id="ea-upload-status" style="font-size:11px;color:#64748b;margin-top:6px"></div>
                <button class="ea-btn ea-btn-red" id="ea-clear-bank-btn" style="margin-top:10px;width:100%;font-size:11px">🗑️ 清空私有题库</button>
              </div>

              <div class="ea-setting-group">
                <h4>🌐 服务器地址</h4>
                <div class="ea-setting-row">
                    <input class="ea-setting-input" id="ea-domain-input" placeholder="your-domain.com" value="${CLOUD_DOMAIN}"/>
                    <button class="ea-btn ea-btn-blue" id="ea-save-domain-btn" style="font-size:11px;padding:8px 10px">保存</button>
                </div>
              </div>

            </div>
          </div>

        </div>`;

        document.body.appendChild(container);

        // 标签切换
        const tabSearchBtn = document.getElementById('ea-tab-btn-search');
        const tabSettingsBtn = document.getElementById('ea-tab-btn-settings');
        const tabSearchContent = document.getElementById('ea-tab-search');
        const tabSettingsContent = document.getElementById('ea-tab-settings');

        function switchTab(target) {
            if (target === 'search') {
                tabSearchContent.style.display = '';
                tabSettingsContent.style.display = 'none';
                tabSearchBtn.classList.add('active');
                tabSettingsBtn.classList.remove('active');
            } else {
                tabSearchContent.style.display = 'none';
                tabSettingsContent.style.display = '';
                tabSettingsBtn.classList.add('active');
                tabSearchBtn.classList.remove('active');
                if (USER_TOKEN) loadBankInfo();
            }
        }

        if (tabSearchBtn) tabSearchBtn.addEventListener('click', () => switchTab('search'));
        if (tabSettingsBtn) tabSettingsBtn.addEventListener('click', () => switchTab('settings'));

        // 激活卡密
        const activateBtn = document.getElementById('ea-activate-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', () => {
                const token = document.getElementById('ea-token-input').value.trim();
                if (!token) { alert('请填写激活码'); return; }
                verifyToken(token);
            });
        }

        // 清空私有题库
        const clearBankBtn = document.getElementById('ea-clear-bank-btn');
        if (clearBankBtn) {
            clearBankBtn.addEventListener('click', () => clearPrivateBank());
        }

        // 保存域名并重新连接
        const saveDomainBtn = document.getElementById('ea-save-domain-btn');
        if (saveDomainBtn) {
            saveDomainBtn.addEventListener('click', () => {
                const domain = document.getElementById('ea-domain-input').value.trim();
                if (!domain) return;
                GM_setValue('cloud_domain', domain);
                setDebug('✅ 服务器域名已更新，正在重连...');
                if (socket) { try { socket.close(); } catch(e){} }
                setTimeout(() => connectWS(), 500);
            });
        }

        // 文件上传控件绑定
        const bankFileInput = document.getElementById('ea-bank-file');
        if (bankFileInput) {
            bankFileInput.addEventListener('change', function() {
                if (this.files && this.files[0]) uploadBankFile(this.files[0]);
            });
        }

        // 拖拽上传
        const dropZone = document.getElementById('ea-drop-zone');
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag');
            const file = e.dataTransfer.files[0];
            if (file) uploadBankFile(file);
        });

        // 搜题按钮
        document.getElementById('ea-search-btn').addEventListener('click', () => {
            const q = document.getElementById('ea-search-input').value.trim();
            if (q) searchQuestion(q);
        });
        document.getElementById('ea-search-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') { const q = e.target.value.trim(); if (q) searchQuestion(q); }
        });

        // 自动勾选开关
        const autoCb = document.getElementById('ea-auto-cb');
        const autoLabel = document.getElementById('ea-auto-label');
        if (autoLabel && autoCb.checked) autoLabel.classList.add('active');
        autoCb.addEventListener('change', e => {
            autoCheckEnabled = e.target.checked;
            GM_setValue('autoCheckEnabled', autoCheckEnabled);
            autoLabel.classList.toggle('active', autoCheckEnabled);
            autoLabel.querySelector('span') || (autoLabel.lastChild.textContent = autoCheckEnabled ? '🤖 自动勾选 ON' : '⏸ 自动勾选 OFF');
        });

        // 全自动开关
        const fullAutoCb = document.getElementById('ea-full-auto-cb');
        const fullAutoLabel = document.getElementById('ea-full-auto-label');
        fullAutoCb.addEventListener('change', e => {
            fullAutoEnabled = e.target.checked;
            fullAutoLabel.classList.toggle('active', fullAutoEnabled);
            if (fullAutoEnabled) { lastSwitchTimestamp = Date.now(); setDebug('⚡ 全自动已启动，3秒后切题...'); }
            else setDebug('⏸ 全自动已关闭');
        });

        // 最小化
        let collapsed = false;
        document.getElementById('ea-min-btn').addEventListener('click', () => {
            collapsed = !collapsed;
            const body = document.getElementById('exam-assistant-body');
            const tabs = document.getElementById('ea-tabs');
            if (collapsed) { body.style.display = 'none'; tabs.style.display = 'none'; }
            else { body.style.display = ''; tabs.style.display = ''; }
        });

        // 拖拽移动
        makeDraggable(container, document.getElementById('exam-assistant-header'));

        // 启动连接
        if (USER_TOKEN) connectWS();
    }

    // ===== 拖拽功能 =====
    function makeDraggable(el, handle) {
        let ox, oy, startX, startY;
        const onMove = e => {
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startX + cx - ox)) + 'px';
            el.style.top  = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startY + cy - oy)) + 'px';
            el.style.right = 'auto';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
        };
        handle.addEventListener('mousedown', e => {
            ox = e.clientX; oy = e.clientY;
            startX = el.offsetLeft; startY = el.offsetTop;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        handle.addEventListener('touchstart', e => {
            ox = e.touches[0].clientX; oy = e.touches[0].clientY;
            startX = el.offsetLeft; startY = el.offsetTop;
            document.addEventListener('touchmove', onMove, { passive: true });
            document.addEventListener('touchend', onUp);
        }, { passive: true });
    }

    // ===== 初始化 =====
    function init() {
        buildUI();
        // 页面变化时自动触发搜题（适配 SPA 单页应用）
        const observer = new MutationObserver(() => {
            if (fullAutoEnabled) autoProcessCurrentQuestion();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 800);
    }

})();
