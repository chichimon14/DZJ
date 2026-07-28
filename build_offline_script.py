import json
import os

bank_path = '/Users/julian/antigravity/DZZ/bank_data.json'
userscript_path = '/Users/julian/antigravity/DZZ/userscript/exam_assistant.user.js'

with open(bank_path, 'r', encoding='utf-8') as f:
    bank_json_str = f.read()

template = f"""// ==UserScript==
// @name         网页考试助手 - 纯离线零网络版
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  离线内嵌 2123 道 Excel 题库，0 毫秒瞬间查答案，无任何网络或跨域限制。
// @author       Antigravity
// @match        *://*/*
// @run-at       document-end
// ==/UserScript==

(function () {{
    'use strict';

    // 内置 2123 道离线 Excel 题库数据
    const BANK_DATA = {bank_json_str};

    let isCollapsed = false;

    function initAssistant() {{
        if (!document.body && !document.documentElement) {{
            setTimeout(initAssistant, 100);
            return;
        }}
        try {{
            enableSelection();
            injectCSS();
            createFloatingUI();
        }} catch (e) {{
            console.error('[考试助手] 初始化失败:', e);
        }}
    }}

    function enableSelection() {{
        try {{
            const style = document.createElement('style');
            style.type = 'text/css';
            style.innerHTML = `
                * {{
                    -webkit-user-select: text !important;
                    -moz-user-select: text !important;
                    -ms-user-select: text !important;
                    user-select: text !important;
                }}
            `;
            (document.head || document.documentElement).appendChild(style);

            const events = ['copy', 'cut', 'selectstart', 'contextmenu', 'dragstart'];
            events.forEach(event => {{
                document.addEventListener(event, function (e) {{
                    e.stopPropagation();
                }}, true);
            }});
        }} catch(e) {{}}
    }}

    function injectCSS() {{
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `
            #exam-assistant-container {{
                position: fixed;
                top: 20px;
                right: 20px;
                width: 330px;
                max-height: 520px;
                z-index: 9999999;
                background: rgba(18, 24, 38, 0.94);
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 0 15px rgba(59, 130, 246, 0.2);
                color: #f3f4f6;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                overflow: hidden;
                user-select: none;
            }}

            #exam-assistant-header {{
                padding: 10px 14px;
                background: linear-gradient(135deg, rgba(37, 99, 235, 0.5), rgba(124, 58, 237, 0.5));
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: move;
            }}

            .ea-title-box {{
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
            }}

            .ea-status-dot {{
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #10b981;
                box-shadow: 0 0 6px #10b981;
            }}

            .ea-actions {{
                display: flex;
                gap: 6px;
            }}

            .ea-btn-icon {{
                background: rgba(255, 255, 255, 0.15);
                border: none;
                color: #d1d5db;
                border-radius: 4px;
                width: 22px;
                height: 22px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
            }}

            .ea-btn-icon:hover {{
                background: rgba(255, 255, 255, 0.3);
                color: #fff;
            }}

            #exam-assistant-body {{
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 460px;
                overflow-y: auto;
            }}

            .ea-tip-box {{
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid rgba(16, 185, 129, 0.3);
                color: #34d399;
                padding: 8px 10px;
                border-radius: 6px;
                font-size: 11px;
                line-height: 1.4;
            }}

            .ea-search-bar {{
                display: flex;
                gap: 6px;
            }}

            .ea-input {{
                flex: 1;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 6px;
                padding: 6px 10px;
                color: #fff;
                font-size: 12px;
                outline: none;
            }}

            .ea-search-btn {{
                background: #3b82f6;
                border: none;
                color: #fff;
                padding: 6px 12px;
                border-radius: 6px;
                font-weight: 500;
                cursor: pointer;
            }}

            .ea-search-btn:hover {{
                background: #2563eb;
            }}

            .ea-exact-card {{
                background: rgba(16, 185, 129, 0.12);
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 8px;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                user-select: text;
            }}

            .ea-notfound-card {{
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 8px;
                padding: 12px;
                color: #fca5a5;
                line-height: 1.5;
                font-size: 12px;
            }}

            .ea-exact-ans-box {{
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
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            }}

            .ea-copy-btn-bright {{
                background: #047857;
                border: none;
                color: #fff;
                cursor: pointer;
                font-size: 12px;
                padding: 4px 8px;
                border-radius: 4px;
                font-weight: 600;
            }}

            .ea-copy-btn-bright:hover {{
                background: #065f46;
            }}
        `;
        (document.head || document.documentElement).appendChild(style);
    }}

    let container, inputQ, searchBtn, resultsList, toggleBtn, body;

    function createFloatingUI() {{
        if (document.getElementById('exam-assistant-container')) return;

        container = document.createElement('div');
        container.id = 'exam-assistant-container';
        container.innerHTML = `
            <div id="exam-assistant-header">
                <div class="ea-title-box">
                    <span class="ea-status-dot"></span>
                    <span>考试助手 (纯离线秒查版)</span>
                </div>
                <div class="ea-actions">
                    <button class="ea-btn-icon" id="ea-toggle-btn" title="最小化/展开">─</button>
                </div>
            </div>
            <div id="exam-assistant-body">
                <div class="ea-tip-box">
                    ⚡ 纯离线内置 2123 道题库！选中文本或点击搜答案瞬间即出！
                </div>
                <div class="ea-search-bar">
                    <input type="text" class="ea-input" id="ea-input-q" placeholder="选中文本或在此输入...">
                    <button class="ea-search-btn" id="ea-search-btn">搜答案</button>
                </div>
                <div id="ea-results-list"></div>
            </div>
        `;
        (document.body || document.documentElement).appendChild(container);

        inputQ = document.getElementById('ea-input-q');
        searchBtn = document.getElementById('ea-search-btn');
        resultsList = document.getElementById('ea-results-list');
        toggleBtn = document.getElementById('ea-toggle-btn');
        body = document.getElementById('exam-assistant-body');

        const header = document.getElementById('exam-assistant-header');
        let isDragging = false;
        let offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', (e) => {{
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - container.offsetLeft;
            offsetY = e.clientY - container.offsetTop;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }});

        function onMouseMove(e) {{
            if (!isDragging) return;
            let left = e.clientX - offsetX;
            let top = e.clientY - offsetY;
            left = Math.max(10, Math.min(window.innerWidth - container.offsetWidth - 10, left));
            top = Math.max(10, Math.min(window.innerHeight - container.offsetHeight - 10, top));
            container.style.left = left + 'px';
            container.style.top = top + 'px';
            container.style.right = 'auto';
        }}

        function onMouseUp() {{
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }}

        toggleBtn.addEventListener('click', () => {{
            isCollapsed = !isCollapsed;
            if (isCollapsed) {{
                body.style.display = 'none';
                container.style.height = '42px';
                toggleBtn.innerText = '□';
            }} else {{
                body.style.display = 'flex';
                container.style.height = 'auto';
                toggleBtn.innerText = '─';
            }}
        }});

        searchBtn.addEventListener('click', () => {{
            searchOffline(inputQ.value);
        }});
        
        inputQ.addEventListener('keypress', (e) => {{
            if (e.key === 'Enter') {{
                searchOffline(inputQ.value);
            }}
        }});

        document.addEventListener('mouseup', (e) => {{
            if (container.contains(e.target)) return;
            const selection = window.getSelection().toString().trim();
            if (selection && selection.length >= 2) {{
                inputQ.value = selection;
                searchOffline(selection);
            }}
        }});
    }}

    function cleanStr(s) {{
        return (s || '').replace(/<[^>]+>/g, '').replace(/^[（(]?\d+[）).、\s]*/, '').replace(/[\\s，。！？,!?（）()\\n\\r]/g, '').toLowerCase();
    }}

    // 0 毫秒纯本地离线搜索
    function searchOffline(queryText) {{
        if (!queryText || queryText.trim().length < 2) return;
        if (!resultsList) return;

        const qClean = cleanStr(queryText);
        if (!qClean) return;

        let matchItem = null;

        for (let item of BANK_DATA) {{
            const tClean = cleanStr(item.t);
            if (tClean.includes(qClean) || qClean.includes(tClean)) {{
                matchItem = item;
                break;
            }}
        }}

        if (matchItem) {{
            const ansLetter = matchItem.a;
            const optVal = (matchItem.opts && matchItem.opts[ansLetter]) ? matchItem.opts[ansLetter] : '';
            const displayAns = optVal ? `${{ansLetter}}. ${{optVal}}` : ansLetter;

            resultsList.innerHTML = `
                <div class="ea-exact-card">
                    <div style="display: flex; justify-content: space-between; color: #34d399; font-size: 11px; font-weight: 600;">
                        <span>✅ 匹配成功</span>
                    </div>
                    <div style="color: #e5e7eb; font-size: 12px; line-height: 1.4;">${{escapeHtml(matchItem.t)}}</div>
                    <div class="ea-exact-ans-box">
                        <span>正确答案: ${{escapeHtml(displayAns)}}</span>
                        <button class="ea-copy-btn-bright" id="ea-copy-single-btn">复制答案</button>
                    </div>
                </div>
            `;

            const copyBtn = document.getElementById('ea-copy-single-btn');
            if (copyBtn) {{
                copyBtn.addEventListener('click', function() {{
                    navigator.clipboard.writeText(displayAns).then(() => {{
                        this.innerText = '已复制!';
                        setTimeout(() => this.innerText = '复制答案', 1500);
                    }});
                }});
            }}
        }} else {{
            resultsList.innerHTML = `
                <div class="ea-notfound-card">
                    <strong>⚠️ 未在 Excel 题库中匹配到本题</strong><br>
                    <span style="font-size: 11px; opacity: 0.8;">请检查 final.xlsx 题库中是否有该题。</span>
                </div>
            `;
        }}
    }}

    function escapeHtml(text) {{
        return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }}

    if (document.readyState === 'complete' || document.readyState === 'interactive') {{
        initAssistant();
    }} else {{
        document.addEventListener('DOMContentLoaded', initAssistant);
        window.addEventListener('load', initAssistant);
    }}

}})();
"""

with open(userscript_path, 'w', encoding='utf-8') as f:
    f.write(template)

print('Done!')
