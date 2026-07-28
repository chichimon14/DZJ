// ==UserScript==
// @name         网页考试助手 - 同名题目选项协同精准识别版
// @namespace    http://tampermonkey.net/
// @version      30.0.0
// @description  当题干完全相同时，自动抓取网页当前选项组合，精准识别并定位唯一正确答案！
// @author       Antigravity
// @match        *://*/*
// @match        http://*/*
// @match        https://*/*
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
    const URLS = [
        { type: 'wss', url: 'wss://127.0.0.1:8000/ws' },
        { type: 'ws', url: 'ws://127.0.0.1:8000/ws' },
        { type: 'https', url: 'https://127.0.0.1:8000/api/search' },
        { type: 'http', url: 'http://127.0.0.1:8000/api/search' }
    ];

    let socket = null;
    let activeType = null;
    let isConnected = false;
    let isCollapsed = false;
    let autoCheckEnabled = true;
    let lastSelectedText = '';
    let selectionTimer = null;
    let container = null;

    // 1. 破解防选中
    function forceEnableSelection() {
        try {
            if (!document.getElementById('ea-force-select-style')) {
                const style = document.createElement('style');
                style.id = 'ea-force-select-style';
                style.type = 'text/css';
                style.innerHTML = `
                    html, body, div, span, p, label, td, th, h1, h2, h3, h4, h5, h6, *, *::before, *::after {
                        -webkit-user-select: text !important;
                        -moz-user-select: text !important;
                        -ms-user-select: text !important;
                        user-select: text !important;
                        pointer-events: auto !important;
                    }
                `;
                (document.head || document.documentElement).appendChild(style);
            }

            const events = ['selectstart', 'contextmenu', 'mousedown', 'mouseup', 'keydown'];
            events.forEach(eventName => {
                window.addEventListener(eventName, function (e) {
                    if (container && container.contains(e.target)) return;
                    e.stopPropagation();
                }, true);
            });
        } catch(e) {}
    }

    // 2. 注入框体 CSS 样式
    const cssText = `
        #exam-assistant-container {
            position: fixed !important;
            width: 340px !important;
            max-height: 560px !important;
            z-index: 2147483647 !important;
            background: #121826 !important;
            border: 2px solid #3b82f6 !important;
            border-radius: 12px !important;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(59, 130, 246, 0.5) !important;
            color: #f3f4f6 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            font-size: 13px !important;
            overflow: hidden !important;
            user-select: none !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }

        #exam-assistant-header {
            padding: 10px 14px;
            background: linear-gradient(135deg, #2563eb, #7c3aed) !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: move !important;
            touch-action: none !important;
        }

        .ea-title-box {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: #fff;
            pointer-events: none;
        }

        .ea-status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: #ef4444;
            box-shadow: 0 0 8px #ef4444;
            transition: all 0.3s;
        }

        .ea-status-dot.online {
            background-color: #10b981;
            box-shadow: 0 0 8px #10b981;
        }

        .ea-actions {
            display: flex;
            gap: 6px;
        }

        .ea-btn-icon {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: #fff;
            border-radius: 4px;
            width: 24px;
            height: 24px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
        }

        .ea-btn-icon:hover {
            background: rgba(255, 255, 255, 0.4);
        }

        #exam-assistant-body {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: 500px;
            overflow-y: auto;
            background: #121826;
        }

        .ea-tip-box {
            background: rgba(16, 185, 129, 0.18);
            border: 1px solid rgba(16, 185, 129, 0.4);
            color: #34d399;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 11px;
            line-height: 1.4;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .ea-switch-label {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            color: #fbbf24;
            font-size: 11px;
        }

        .ea-search-bar {
            display: flex;
            gap: 6px;
        }

        .ea-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 6px;
            padding: 6px 10px;
            color: #fff;
            font-size: 12px;
            outline: none;
        }

        .ea-search-btn {
            background: #3b82f6;
            border: none;
            color: #fff;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
        }

        .ea-search-btn:hover {
            background: #2563eb;
        }

        .ea-exact-card {
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid rgba(16, 185, 129, 0.5);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            user-select: text;
        }

        .ea-notfound-card {
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(239, 68, 68, 0.5);
            border-radius: 8px;
            padding: 12px;
            color: #fca5a5;
            line-height: 1.5;
            font-size: 12px;
        }

        .ea-exact-ans-box {
            background: #10b981;
            color: #064e3b;
            padding: 10px 12px;
            border-radius: 6px;
            font-size: 15px;
            font-weight: 700;
            display: flex;
            justify-content: space-between;
            align-items: center;
            word-break: break-all;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }

        .ea-copy-btn-bright {
            background: #047857;
            border: none;
            color: #fff;
            cursor: pointer;
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
        }

        .ea-copy-btn-bright:hover {
            background: #065f46;
        }

        .ea-auto-status {
            font-size: 11px;
            color: #6ee7b7;
            font-weight: normal;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(cssText);
    } else {
        const styleNode = document.createElement('style');
        styleNode.type = 'text/css';
        styleNode.appendChild(document.createTextNode(cssText));
        (document.head || document.documentElement).appendChild(styleNode);
    }

    let inputQ, searchBtn, resultsList, toggleBtn, body, statusDot, autoCheckCb;

    function createFloatingUI() {
        if (document.getElementById('exam-assistant-container')) return;

        container = document.createElement('div');
        container.id = 'exam-assistant-container';
        container.style.top = '20px';
        container.style.right = '20px';

        container.innerHTML = `
            <div id="exam-assistant-header" title="MacBook: 按住此处全向顺滑拖拽">
                <div class="ea-title-box">
                    <span class="ea-status-dot" id="ea-status" title="连接状态"></span>
                    <span>考试助手 (同名题目选项识别版)</span>
                </div>
                <div class="ea-actions">
                    <button class="ea-btn-icon" id="ea-toggle-btn" title="最小化/展开">─</button>
                </div>
            </div>
            <div id="exam-assistant-body">
                <div class="ea-tip-box">
                    <span>✨ 智能比对选项，绝不重名混淆</span>
                    <label class="ea-switch-label">
                        <input type="checkbox" id="ea-auto-check-cb" checked> 自动勾选
                    </label>
                </div>
                <div class="ea-search-bar">
                    <input type="text" class="ea-input" id="ea-input-q" placeholder="光标扫过题目即可自动带入...">
                    <button class="ea-search-btn" id="ea-search-btn">搜答案</button>
                </div>
                <div id="ea-results-list"></div>
            </div>
        `;

        const targetParent = document.body || document.documentElement;
        if (targetParent) {
            targetParent.appendChild(container);
        } else {
            return;
        }

        inputQ = document.getElementById('ea-input-q');
        searchBtn = document.getElementById('ea-search-btn');
        resultsList = document.getElementById('ea-results-list');
        toggleBtn = document.getElementById('ea-toggle-btn');
        body = document.getElementById('exam-assistant-body');
        statusDot = document.getElementById('ea-status');
        autoCheckCb = document.getElementById('ea-auto-check-cb');

        if (autoCheckCb) {
            autoCheckCb.addEventListener('change', (e) => {
                autoCheckEnabled = e.target.checked;
            });
        }

        const header = document.getElementById('exam-assistant-header');
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        function startDrag(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            isDragging = true;
            
            const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            
            startX = clientX;
            startY = clientY;

            const rect = container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            container.style.setProperty('right', 'auto', 'important');
            container.style.setProperty('bottom', 'auto', 'important');
            container.style.setProperty('left', initialLeft + 'px', 'important');
            container.style.setProperty('top', initialTop + 'px', 'important');

            window.addEventListener('mousemove', moveDrag, true);
            window.addEventListener('mouseup', stopDrag, true);
            window.addEventListener('touchmove', moveDrag, { passive: false });
            window.addEventListener('touchend', stopDrag, true);
        }

        function moveDrag(e) {
            if (!isDragging) return;

            const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

            const dx = clientX - startX;
            const dy = clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            const maxLeft = window.innerWidth - container.offsetWidth - 5;
            const maxTop = window.innerHeight - container.offsetHeight - 5;

            newLeft = Math.max(5, Math.min(maxLeft, newLeft));
            newTop = Math.max(5, Math.min(maxTop, newTop));

            container.style.setProperty('left', newLeft + 'px', 'important');
            container.style.setProperty('top', newTop + 'px', 'important');

            if (e.cancelable) e.preventDefault();
        }

        function stopDrag() {
            isDragging = false;
            window.removeEventListener('mousemove', moveDrag, true);
            window.removeEventListener('mouseup', stopDrag, true);
            window.removeEventListener('touchmove', moveDrag);
            window.removeEventListener('touchend', stopDrag, true);
        }

        header.addEventListener('mousedown', startDrag);
        header.addEventListener('touchstart', startDrag, { passive: false });

        toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            if (isCollapsed) {
                body.style.display = 'none';
                container.style.height = '42px';
                toggleBtn.innerText = '□';
            } else {
                body.style.display = 'flex';
                container.style.height = 'auto';
                toggleBtn.innerText = '─';
            }
        });

        searchBtn.addEventListener('click', () => {
            sendSearchQuery(inputQ.value);
        });
        
        inputQ.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendSearchQuery(inputQ.value);
            }
        });

        document.addEventListener('selectionchange', function () {
            if (selectionTimer) clearTimeout(selectionTimer);
            selectionTimer = setTimeout(checkAndSearchSelection, 120);
        }, true);

        document.addEventListener('mouseup', function (e) {
            if (container && container.contains(e.target)) return;
            checkAndSearchSelection();
        }, true);
    }

    // 🌟 自动抓取当前页面上的所有选项文本，防止同名题目干扰
    function collectCurrentPageOptions() {
        try {
            const selectors = `
                .choose-list-item, .opt-item, .singleChoose, .ques-answers, .select-item,
                .checkbox, label.checkbox-inline, .radio, label.radio-inline,
                .el-checkbox, .el-radio, label.el-checkbox, label.el-radio,
                [class*="option"], [class*="choice"]
            `;
            const nodes = Array.from(document.querySelectorAll(selectors));
            const optionsText = [];

            nodes.forEach(el => {
                if (container && container.contains(el)) return;
                const text = (el.innerText || el.textContent || '').trim();
                if (text && text.length >= 1 && text.length <= 150) {
                    // 过滤掉包含过多字符的大框架
                    if (!text.includes('上一题') && !text.includes('下一题')) {
                        optionsText.push(text);
                    }
                }
            });

            return Array.from(new Set(optionsText));
        } catch(e) {
            return [];
        }
    }

    function checkAndSearchSelection() {
        try {
            const selObj = window.getSelection();
            if (!selObj) return;

            const selectedText = selObj.toString().trim();
            if (container && container.contains(document.activeElement)) return;

            if (selectedText && selectedText.length >= 2 && selectedText !== lastSelectedText) {
                lastSelectedText = selectedText;
                if (inputQ) inputQ.value = selectedText;
                sendSearchQuery(selectedText);
            }
        } catch(e) {}
    }

    function autoConnectBackend() {
        if (isConnected) return;

        try {
            socket = new WebSocket(URLS[0].url);

            socket.onopen = function () {
                isConnected = true;
                activeType = 'wss';
                if (statusDot) {
                    statusDot.classList.add('online');
                    statusDot.title = 'Python 服务 (WSS 闪电通道已连通)';
                }
            };

            socket.onmessage = function (event) {
                try {
                    const data = JSON.parse(event.data);
                    renderSingleResult(data);
                } catch (e) {}
            };

            socket.onerror = function () {
                tryWs();
            };

            socket.onclose = function () {
                if (activeType === 'wss') {
                    isConnected = false;
                    if (statusDot) statusDot.classList.remove('online');
                    setTimeout(autoConnectBackend, 2000);
                }
            };
        } catch(e) {
            tryWs();
        }
    }

    function tryWs() {
        try {
            socket = new WebSocket(URLS[1].url);
            socket.onopen = function () {
                isConnected = true;
                activeType = 'ws';
                if (statusDot) {
                    statusDot.classList.add('online');
                    statusDot.title = 'Python 服务 (WS 通道已连通)';
                }
            };
            socket.onmessage = function (event) {
                try { renderSingleResult(JSON.parse(event.data)); } catch (e) {}
            };
            socket.onerror = function () {
                startHttpHeartbeat();
            };
            socket.onclose = function () {
                if (activeType === 'ws') {
                    isConnected = false;
                    if (statusDot) statusDot.classList.remove('online');
                    setTimeout(autoConnectBackend, 2000);
                }
            };
        } catch(e) {
            startHttpHeartbeat();
        }
    }

    function startHttpHeartbeat() {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'http://127.0.0.1:8000/',
                onload: function(res) {
                    if (res.status === 200) {
                        isConnected = true;
                        activeType = 'http';
                        if (statusDot) statusDot.classList.add('online');
                    }
                }
            });
        }
    }

    function sendSearchQuery(queryText) {
        if (!queryText || queryText.trim().length < 2) return;

        if (resultsList) {
            resultsList.innerHTML = '<div style="color: #9ca3af; text-align: center; padding: 10px;">⚡ 检索答案中...</div>';
        }

        const currentOptions = collectCurrentPageOptions();

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ query: queryText, options: currentOptions }));
        } else {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'http://127.0.0.1:8000/api/search',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ query: queryText, options: currentOptions, limit: 1 }),
                    onload: function (res) {
                        if (res.status === 200) {
                            if (statusDot) statusDot.classList.add('online');
                            try {
                                renderSingleResult(JSON.parse(res.responseText));
                            } catch(e) {}
                        } else {
                            renderErrorUI();
                        }
                    },
                    onerror: renderErrorUI
                });
            } else {
                renderErrorUI();
            }
        }
    }

    // 🌟 支持判断题 (正确/对 -> A, 错误/错 -> B) + 多选大容器隔离的秒勾引擎
    function autoClickAnswerOption(matchData) {
        if (!autoCheckEnabled || !matchData) return false;

        const rawAns = (matchData.answer_letter || matchData.display_answer || '').trim();
        if (!rawAns) return false;

        let targetLetters = [];
        let isTrueFalseQuestion = false;

        if (rawAns.includes('正确') || rawAns === '对' || rawAns.toLowerCase() === 'true' || rawAns === '√') {
            targetLetters = ['A'];
            isTrueFalseQuestion = true;
        } else if (rawAns.includes('错误') || rawAns === '错' || rawAns.toLowerCase() === 'false' || rawAns === '×') {
            targetLetters = ['B'];
            isTrueFalseQuestion = true;
        } else {
            targetLetters = Array.from(new Set(rawAns.replace(/[^A-Za-z]/g, '').toUpperCase().split('')));
        }

        if (targetLetters.length === 0) return false;

        const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        let totalSuccessCount = 0;

        targetLetters.forEach((letter, index) => {
            const delay = index * 140;

            setTimeout(() => {
                let letterPrefixes = [
                    `${letter}.`, `${letter}、`, `${letter}:`, `${letter} `,
                    `${letter} .`, `${letter} 、`, `(${letter})`, `（${letter}）`
                ];

                if (isTrueFalseQuestion) {
                    if (letter === 'A') letterPrefixes.push('对', '正确', '√');
                    if (letter === 'B') letterPrefixes.push('错', '错误', '×');
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
                const targetNode = candidateNodes[0];

                try {
                    const jq = win.jQuery || win.$ || (typeof $ !== 'undefined' ? $ : null);
                    
                    if (jq) {
                        try { jq(targetNode).trigger('click'); } catch(e) {}
                        if (targetNode.parentElement) { try { jq(targetNode.parentElement).trigger('click'); } catch(e) {} }
                    }

                    if (typeof targetNode.click === 'function') {
                        targetNode.click();
                    }
                    if (targetNode.parentElement && typeof targetNode.parentElement.click === 'function') {
                        targetNode.parentElement.click();
                    }

                    const evtOpts = { bubbles: true, cancelable: true, view: win || window };
                    targetNode.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                    targetNode.dispatchEvent(new MouseEvent('mouseup', evtOpts));
                    targetNode.dispatchEvent(new MouseEvent('click', evtOpts));

                    const innerSquare = targetNode.querySelector ? targetNode.querySelector('i, input, .el-checkbox__inner, .el-radio__inner') : null;
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

    function renderErrorUI() {
        if (statusDot) statusDot.classList.remove('online');
        if (resultsList) {
            resultsList.innerHTML = `
                <div class="ea-notfound-card">
                    <strong>⚠️ 未能连接到 Python 后端</strong><br>
                    <span style="font-size: 11px; opacity: 0.8;">请确保在终端运行了 ./start.sh 守护进程！</span>
                </div>
            `;
        }
    }

    function renderSingleResult(data) {
        if (!resultsList) return;
        if (!data || !data.found) {
            const scoreMsg = data.highest_score ? ` (最高相似度 ${data.highest_score}%)` : '';
            resultsList.innerHTML = `
                <div class="ea-notfound-card">
                    <strong>⚠️ 未在 Excel 题库中匹配到答案</strong>${scoreMsg}<br>
                    <span style="font-size: 11px; opacity: 0.8;">请检查 final.xlsx 是否包含此题。</span>
                </div>
            `;
            return;
        }

        const match = data.match;
        const displayAns = match.display_answer;

        const autoChecked = autoClickAnswerOption(match);
        const autoTag = autoChecked ? '<span class="ea-auto-status">⚡ 已为您自动勾选选项</span>' : '';

        resultsList.innerHTML = `
            <div class="ea-exact-card">
                <div style="display: flex; justify-content: space-between; color: #34d399; font-size: 11px; font-weight: 600;">
                    <span>✅ 匹配成功</span>
                    <span>${data.score}% 相似 ${autoTag}</span>
                </div>
                <div style="color: #e5e7eb; font-size: 12px; line-height: 1.4;">${escapeHtml(match.title)}</div>
                <div class="ea-exact-ans-box">
                    <span>正确答案: ${escapeHtml(displayAns)}</span>
                    <button class="ea-copy-btn-bright" id="ea-copy-single-btn">复制答案</button>
                </div>
            </div>
        `;

        const copyBtn = document.getElementById('ea-copy-single-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                navigator.clipboard.writeText(displayAns).then(() => {
                    this.innerText = '已复制!';
                    setTimeout(() => this.innerText = '复制答案', 1500);
                });
            });
        }
    }

    function escapeHtml(text) {
        return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function startRun() {
        forceEnableSelection();
        createFloatingUI();
        autoConnectBackend();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startRun();
    } else {
        window.addEventListener('DOMContentLoaded', startRun);
        window.addEventListener('load', startRun);
    }

    setInterval(startRun, 1000);

})();
