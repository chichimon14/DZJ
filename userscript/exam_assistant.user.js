// ==UserScript==
// @name         网页考试助手 v51 - 剥离○图标前缀精准勾选 + 单次点击防双跳
// @namespace    http://tampermonkey.net/
// @version      51.0.0
// @description  剥离选项前导○图标/全角句号后再匹配，彻底解决未找到选项A的问题
// @author       Antigravity
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ===== 全局状态 =====
    let socket = null;
    let activeType = null;
    let isConnected = false;
    let isCollapsed = false;
    let autoCheckEnabled = true;
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
        position: fixed !important; width: 340px !important; max-height: 580px !important;
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
    #exam-assistant-body { padding:12px; display:flex; flex-direction:column; gap:10px; max-height:520px; overflow-y:auto; background:#121826; }
    .ea-control-bar { display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,.05); padding:6px 10px; border-radius:6px; font-size:11px; }
    .ea-switch-label { display:flex; align-items:center; gap:4px; cursor:pointer; color:#fbbf24; font-size:11px; }
    .ea-full-auto-label { display:flex; align-items:center; gap:4px; cursor:pointer; color:#60a5fa; font-weight:600; font-size:11px; }
    .ea-debug-bar { background:rgba(96,165,250,.1); border:1px solid rgba(96,165,250,.3); border-radius:5px; padding:4px 8px; font-size:10px; color:#93c5fd; min-height:18px; word-break:break-all; }
    .ea-search-bar { display:flex; gap:6px; }
    .ea-input { flex:1; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.3); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; outline:none; }
    .ea-search-btn { background:#3b82f6; border:none; color:#fff; padding:6px 12px; border-radius:6px; font-weight:600; cursor:pointer; }
    .ea-search-btn:hover { background:#2563eb; }
    .ea-exact-card { background:rgba(16,185,129,.2); border:1px solid rgba(16,185,129,.5); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:8px; user-select:text; }
    .ea-notfound-card { background:rgba(239,68,68,.2); border:1px solid rgba(239,68,68,.5); border-radius:8px; padding:12px; color:#fca5a5; line-height:1.5; font-size:12px; }
    .ea-exact-ans-box { background:#10b981; color:#064e3b; padding:10px 12px; border-radius:6px; font-size:15px; font-weight:700; display:flex; justify-content:space-between; align-items:center; word-break:break-all; box-shadow:0 4px 12px rgba(16,185,129,.4); }
    .ea-copy-btn-bright { background:#047857; border:none; color:#fff; cursor:pointer; font-size:12px; padding:4px 8px; border-radius:4px; font-weight:600; }
    .ea-copy-btn-bright:hover { background:#065f46; }
    .ea-auth-link { color:#60a5fa; text-decoration:underline; cursor:pointer; font-weight:bold; }
    `;
    if (typeof GM_addStyle !== 'undefined') { GM_addStyle(cssText); }
    else { const s = document.createElement('style'); s.textContent = cssText; (document.head || document.documentElement).appendChild(s); }

    let inputQ, searchBtn, resultsList, toggleBtn, bodyEl, statusDot, autoCheckCb, fullAutoCb, debugBar;

    // ===== 创建浮窗 =====
    function createFloatingUI() {
        if (document.getElementById('exam-assistant-container')) return;
        container = document.createElement('div');
        container.id = 'exam-assistant-container';
        container.style.cssText = 'top:20px;right:20px;';
        container.innerHTML = `
            <div id="exam-assistant-header">
                <div class="ea-title-box">
                    <span class="ea-status-dot" id="ea-status"></span>
                    <span>考试助手 v49</span>
                </div>
                <button class="ea-btn-icon" id="ea-toggle-btn">─</button>
            </div>
            <div id="exam-assistant-body">
                <div class="ea-control-bar">
                    <label class="ea-switch-label"><input type="checkbox" id="ea-auto-check-cb" checked> 自动勾选答案</label>
                    <label class="ea-full-auto-label"><input type="checkbox" id="ea-full-auto-cb"> ⚡ 3s全自动切题</label>
                </div>
                <div class="ea-debug-bar" id="ea-debug-bar">等待题目...</div>
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

        autoCheckCb.addEventListener('change', e => { autoCheckEnabled = e.target.checked; });
        fullAutoCb.addEventListener('change', e => {
            fullAutoEnabled = e.target.checked;
            if (fullAutoEnabled) { lastSwitchTimestamp = Date.now(); setDebug('全自动已启动，3秒后切题...'); }
        });

        // 拖拽
        const header = document.getElementById('exam-assistant-header');
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

        toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            bodyEl.style.display = isCollapsed ? 'none' : 'flex';
            container.style.height = isCollapsed ? '42px' : 'auto';
            toggleBtn.innerText = isCollapsed ? '□' : '─';
        });
        searchBtn.addEventListener('click', () => sendSearchQuery(inputQ.value));
        inputQ.addEventListener('keypress', e => { if (e.key === 'Enter') sendSearchQuery(inputQ.value); });
        document.addEventListener('selectionchange', () => {
            if (selectionTimer) clearTimeout(selectionTimer);
            selectionTimer = setTimeout(checkAndSearchSelection, 120);
        }, true);
        document.addEventListener('mouseup', e => { if (container && container.contains(e.target)) return; checkAndSearchSelection(); }, true);
    }

    function setDebug(msg) { if (debugBar) debugBar.textContent = msg; }

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

    // ===== 切题引擎 - 优先"下一题"按钮 =====
    function triggerNextQuestion() {
        if (isSwitchingQuestion) return;
        isSwitchingQuestion = true;
        setTimeout(() => { isSwitchingQuestion = false; }, 1500);

        // 策略1：找 <a> 或 <button>，innerText 严格等于"下一题"
        const btns = Array.from(document.querySelectorAll('a, button')).filter(el => {
            if (container && container.contains(el)) return false;
            const t = (el.innerText || el.textContent || '').trim();
            return (t === '下一题' || t === '下一页') && el.offsetWidth > 0;
        });
        if (btns.length > 0) {
            setDebug(`✅ 策略1: 点击 <${btns[0].tagName}>"下一题"`);
            singleClick(btns[0]);
            return;
        }

        // 策略2：任意元素严格等于"下一题"，取最叶子节点
        const all = Array.from(document.querySelectorAll('*')).filter(el => {
            if (container && container.contains(el)) return false;
            const t = (el.innerText || el.textContent || '').trim();
            return t === '下一题' && el.offsetWidth > 0 && el.offsetHeight > 0;
        });
        if (all.length > 0) {
            all.sort((a, b) => a.children.length - b.children.length);
            setDebug(`✅ 策略2: 降级点击 <${all[0].tagName}>"下一题" cls="${all[0].className.slice(0,25)}"`);
            singleClick(all[0]);
            return;
        }

        // 策略3：全局扫描数字格子 N+1
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
                setDebug(`✅ 策略3: 点击答题卡格子 "${target}"`);
                singleClick(cards[0]);
                return;
            }
        }

        setDebug('⚠️ 三种策略均未找到目标，请截图反馈！');
    }

    // ===== 🌟 单次点击：只用一种方式，绝对不重复，杜绝跳2题 =====
    function singleClick(el) {
        if (!el) return;
        try {
            // 如果是内联叶子元素，上升到可点击父级
            let node = el;
            if (['SPAN','I','P','EM','STRONG'].includes(el.tagName) && el.parentElement &&
                ['A','BUTTON','DIV','LI'].includes(el.parentElement.tagName)) {
                node = el.parentElement;
            }
            // 只选一种方式点击！优先 jQuery（兼容 Regular.js）
            const jq = win.jQuery || win.$ || null;
            if (jq) {
                jq(node).trigger('click');
                return; // ← 立即返回，不再执行后续任何点击
            }
            // jQuery 不可用，用原生 .click()
            if (typeof node.click === 'function') {
                node.click();
                return;
            }
            // 最后兜底，MouseEvent
            node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: win || window }));
        } catch(e) {}
    }

    // ===== 验证码检测 =====
    function isCaptchaPresent() {
        const kws = ['安全验证','拖动滑块','完成验证','验证码','拼图'];
        for (const el of document.querySelectorAll('div,span')) {
            if (container && container.contains(el)) continue;
            const t = (el.innerText || el.textContent || '').trim();
            if (kws.some(k => t.includes(k)) && el.offsetWidth > 0) return true;
        }
        return false;
    }

    // ===== 题干提取（按位置过滤侧边栏）=====
    function getRawTitleText() {
        // 优先：精确 CSS 选择器
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
        // 回退：全局扫描，但过滤左侧边栏（left < 160px 的元素跳过）
        for (const el of document.querySelectorAll('body *')) {
            if (container && container.contains(el)) continue;
            try {
                const rect = el.getBoundingClientRect();
                if (rect.left < 160 || rect.width < 80) continue; // 跳过侧边栏
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

    // ===== 自动扫描 =====
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
            setDebug('题干已更新，搜题中...');
            sendSearchQuery(title);
        }
    }

    // ===== 收集选项文本（供后端参考）=====
    function collectOptions() {
        try {
            const texts = [];
            // 在主内容区（left > 160px）找选项
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

    // ===== 划词搜索 =====
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

    // ===== 🌟 自动打钩 - 恢复 v24 原版逻辑（body * 全扫，稳定可用）=====
    function autoClickAnswerOption(matchData) {
        if (!autoCheckEnabled || !matchData) return false;
        const rawAns = (matchData.answer_letter || matchData.display_answer || '').trim();
        if (!rawAns) return false;

        // 判断题特殊处理
        let targetLetters = [];
        let isTF = false;
        if (/正确|^对$|^√$|^true$/i.test(rawAns)) { targetLetters = ['A']; isTF = true; }
        else if (/错误|^错$|^×$|^false$/i.test(rawAns)) { targetLetters = ['B']; isTF = true; }
        else {
            targetLetters = [...new Set(rawAns.replace(/[^A-Za-z]/g, '').toUpperCase().split(''))].filter(Boolean);
        }
        if (targetLetters.length === 0) return false;

        const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        let totalSuccessCount = 0;

        targetLetters.forEach((letter, index) => {
            const delay = index * 140;

            setTimeout(() => {
                // 与 v24 完全相同的前缀列表
                const letterPrefixes = [
                    `${letter}.`, `${letter}、`, `${letter}:`, `${letter} `,
                    `${letter} .`, `${letter} 、`, `(${letter})`, `（${letter}）`
                ];
                if (isTF) {
                    if (letter === 'A') letterPrefixes.push('对', '正确', '√');
                    if (letter === 'B') letterPrefixes.push('错', '错误', '×');
                }

                const otherLetters = ALL_LETTERS.filter(l => l !== letter);

                // 🌟 与 v24 完全相同：扫全部 body 元素，不限标签
                const candidateNodes = Array.from(document.querySelectorAll('body *')).filter(el => {
                    if (container && container.contains(el)) return false;

                    const text = (el.innerText || el.textContent || '').trim();
                    if (!text || text.length > 300) return false;

                    // 剔除包含其他选项字母的大父框
                    const containsOtherOptions = otherLetters.some(ol =>
                        text.includes(`${ol}.`) || text.includes(`${ol}、`) || text.includes(`${ol}:`)
                    );
                    if (containsOtherOptions) return false;

                    return letterPrefixes.some(p => text.startsWith(p)) || text === letter;
                });

                if (candidateNodes.length === 0) {
                    setDebug(`⚠️ 未找到选项 ${letter}，跳过`);
                    return;
                }

                // 取 innerText 最短的（最叶子节点）
                candidateNodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
                const targetNode = candidateNodes[0];
                setDebug(`⚡ 勾选 ${letter}: "${(targetNode.innerText || '').trim().slice(0, 20)}"`);

                try {
                    // 与 v24 完全相同的点击逻辑
                    const jq = win.jQuery || win.$ || (typeof $ !== 'undefined' ? $ : null);
                    if (jq) {
                        try { jq(targetNode).trigger('click'); } catch(e) {}
                        if (targetNode.parentElement) { try { jq(targetNode.parentElement).trigger('click'); } catch(e) {} }
                    }
                    if (typeof targetNode.click === 'function') targetNode.click();
                    if (targetNode.parentElement && typeof targetNode.parentElement.click === 'function') targetNode.parentElement.click();

                    const evtOpts = { bubbles: true, cancelable: true, view: win || window };
                    targetNode.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                    targetNode.dispatchEvent(new MouseEvent('mouseup', evtOpts));
                    targetNode.dispatchEvent(new MouseEvent('click', evtOpts));

                    // 尝试点击内部 radio/checkbox input
                    const innerSquare = targetNode.querySelector
                        ? targetNode.querySelector('i, input, .el-checkbox__inner, .el-radio__inner')
                        : null;
                    if (innerSquare) {
                        if (typeof innerSquare.click === 'function') innerSquare.click();
                        innerSquare.dispatchEvent(new MouseEvent('click', evtOpts));
                    }
                } catch(e) {}
            }, delay);

            totalSuccessCount++;
        });

        return totalSuccessCount > 0;
    }

    // ===== 后端连接 =====
    function autoConnectBackend() {
        if (isConnected && !fallbackMode) return;
        tryWss();
    }
    function tryWss() {
        try {
            socket = new WebSocket('wss://127.0.0.1:8000/ws');
            socket.onopen = () => { isConnected = true; fallbackMode = false; activeType = 'wss'; markOnline('WSS'); };
            socket.onmessage = e => { try { renderSingleResult(JSON.parse(e.data)); } catch(err) {} };
            socket.onerror = () => tryWs();
            socket.onclose = () => { if (activeType === 'wss') tryWs(); };
        } catch(e) { tryWs(); }
    }
    function tryWs() {
        try {
            socket = new WebSocket('ws://127.0.0.1:8000/ws');
            socket.onopen = () => { isConnected = true; fallbackMode = false; activeType = 'ws'; markOnline('WS'); };
            socket.onmessage = e => { try { renderSingleResult(JSON.parse(e.data)); } catch(err) {} };
            socket.onerror = () => startHttpFallback();
            socket.onclose = () => startHttpFallback();
        } catch(e) { startHttpFallback(); }
    }
    function startHttpFallback() {
        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        GM_xmlhttpRequest({ method:'GET', url:'https://127.0.0.1:8000/', timeout:2000,
            onload: r => { if (r.status===200) { isConnected=true; fallbackMode=true; activeType='gm_https'; markOnline('HTTPS'); } else tryHttpFallback(); },
            onerror: tryHttpFallback, ontimeout: tryHttpFallback });
    }
    function tryHttpFallback() {
        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        GM_xmlhttpRequest({ method:'GET', url:'http://127.0.0.1:8000/', timeout:2000,
            onload: r => { if (r.status===200) { isConnected=true; fallbackMode=true; activeType='gm_http'; markOnline('HTTP'); } else renderErrorUI(); },
            onerror: renderErrorUI, ontimeout: renderErrorUI });
    }
    function markOnline(label) { if (statusDot) { statusDot.classList.add('online'); statusDot.title=`已连接(${label})`; } }

    // ===== 搜索请求 =====
    function sendSearchQuery(query) {
        if (!query || query.trim().length < 2) return;
        if (resultsList) resultsList.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:10px;">⚡ 检索中...</div>';
        const options = collectOptions();
        const payload = JSON.stringify({ query, options, limit: 1 });
        if (socket && socket.readyState === WebSocket.OPEN && !fallbackMode) {
            socket.send(JSON.stringify({ query, options })); return;
        }
        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        const url = (activeType === 'gm_https' || location.protocol === 'https:')
            ? 'https://127.0.0.1:8000/api/search' : 'http://127.0.0.1:8000/api/search';
        GM_xmlhttpRequest({ method:'POST', url, headers:{'Content-Type':'application/json'}, data:payload,
            onload: r => { if (r.status===200) { markOnline(activeType||'HTTP'); try { renderSingleResult(JSON.parse(r.responseText)); } catch(e) {} } else retryHttp(payload); },
            onerror: () => retryHttp(payload) });
    }
    function retryHttp(payload) {
        if (typeof GM_xmlhttpRequest === 'undefined') { renderErrorUI(); return; }
        GM_xmlhttpRequest({ method:'POST', url:'http://127.0.0.1:8000/api/search',
            headers:{'Content-Type':'application/json'}, data:payload,
            onload: r => { if (r.status===200) { markOnline('HTTP'); try { renderSingleResult(JSON.parse(r.responseText)); } catch(e) {} } else renderErrorUI(); },
            onerror: renderErrorUI });
    }

    // ===== 渲染结果 =====
    function renderErrorUI() {
        if (statusDot) statusDot.classList.remove('online');
        if (!resultsList) return;
        resultsList.innerHTML = `<div class="ea-notfound-card"><strong>⚠️ 未能连接到 Python 后端</strong><br>
            <span style="font-size:11px;">请授权：<a class="ea-auth-link" href="https://127.0.0.1:8000/" target="_blank">https://127.0.0.1:8000/</a></span></div>`;
    }

    function renderSingleResult(data) {
        if (!resultsList) return;
        if (!data || !data.found) {
            const s = (data && data.highest_score) ? ` (最高相似${data.highest_score}%)` : '';
            resultsList.innerHTML = `<div class="ea-notfound-card"><strong>⚠️ 题库未匹配</strong>${s}<br>
                <span style="font-size:11px;opacity:.8;">3秒后自动跳过本题...</span></div>`;
            return;
        }
        const match = data.match, ans = match.display_answer;
        autoClickAnswerOption(match);
        resultsList.innerHTML = `
            <div class="ea-exact-card">
                <div style="display:flex;justify-content:space-between;color:#34d399;font-size:11px;font-weight:600;">
                    <span>✅ 匹配成功 (${data.score}%)</span>
                    <span style="color:#60a5fa;font-weight:bold;">⚡ 3s后切下一题</span>
                </div>
                <div style="color:#e5e7eb;font-size:12px;line-height:1.4;">${esc(match.title)}</div>
                <div class="ea-exact-ans-box">
                    <span>正确答案: ${esc(ans)}</span>
                    <button class="ea-copy-btn-bright" id="ea-copy-btn">复制</button>
                </div>
            </div>`;
        const btn = document.getElementById('ea-copy-btn');
        if (btn) btn.addEventListener('click', function() {
            navigator.clipboard.writeText(ans).then(() => { this.innerText='已复制!'; setTimeout(()=>this.innerText='复制',1500); });
        });
    }

    function esc(t) { return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // ===== 启动 =====
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
