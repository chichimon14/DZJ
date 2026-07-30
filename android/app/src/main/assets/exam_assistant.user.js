// ==UserScript==
// @name         网页考试助手 Premium v95 - 仅展示正确选项详细文本+极致暗黑UI
// @namespace    http://tampermonkey.net/
// @version      95.0.0
// @description  极简高端暗黑UI：精准仅展示正确选项详细文本/拨片式开关/蓝紫光晕边框/发光答案卡片/玻璃拟态搜索栏 + 选项内容双向校验
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

    const CLOUD_DOMAIN   = GM_getValue('cloud_domain', '175.178.78.88');
    const HTTP_URL       = `http://${CLOUD_DOMAIN}/api/search`;
    const TOKEN_INFO_URL = `http://${CLOUD_DOMAIN}/api/token/info`;

    let USER_TOKEN = GM_getValue('user_token', 'TEST-VIP-2026-8888');
    let DEVICE_ID  = GM_getValue('device_id', '');
    if (!DEVICE_ID) {
        const fp = [navigator.userAgent.length,screen.width,screen.height,screen.colorDepth,navigator.language,new Date().getTimezoneOffset(),navigator.hardwareConcurrency||4,Math.random().toString(36).slice(2,10)].join('-');
        DEVICE_ID = btoa(fp).replace(/[^A-Za-z0-9]/g,'').slice(0,32);
        GM_setValue('device_id', DEVICE_ID);
    }

    let socket=null,activeType=null,isConnected=false,isCollapsed=false;
    let autoCheckEnabled=GM_getValue('autoCheckEnabled',true);
    let fullAutoEnabled=false,lastSwitchTimestamp=0,isSwitchingQuestion=false;
    let lastSelectedText='',currentTitleHash='',selectionTimer=null;
    let container=null,fallbackMode=false,lastAutoProcessTime=0;
    let inputQ,searchBtn,resultsList,toggleBtn,bodyEl,statusDot,debugBar;
    let autoCheckToggle, fullAutoToggle;

    // ===== 🎨 极致高端 CSS =====
    const cssText = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    #ea-root {
        position: fixed !important;
        width: 330px !important;
        top: 18px !important; right: 18px !important;
        z-index: 2147483647 !important;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
        font-size: 13px !important;
        display: block !important;
        visibility: visible !important;
        user-select: none !important;
    }
    #ea-panel {
        background: rgba(8, 11, 20, 0.97) !important;
        border: 1px solid rgba(99, 102, 241, 0.35) !important;
        border-radius: 16px !important;
        overflow: hidden !important;
        box-shadow:
            0 0 0 1px rgba(99,102,241,0.1),
            0 20px 60px rgba(0,0,0,0.8),
            0 0 40px rgba(99,102,241,0.12),
            inset 0 1px 0 rgba(255,255,255,0.06) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
    }

    /* Header */
    #ea-header {
        padding: 12px 14px 11px !important;
        background: linear-gradient(135deg, rgba(30,27,75,0.95) 0%, rgba(49,46,129,0.9) 50%, rgba(67,56,202,0.85) 100%) !important;
        border-bottom: 1px solid rgba(99,102,241,0.2) !important;
        display: flex !important; align-items: center !important; justify-content: space-between !important;
        cursor: move !important;
    }
    #ea-header-left { display:flex; align-items:center; gap:8px; pointer-events:none; }
    #ea-status-wrap { position:relative; width:10px; height:10px; flex-shrink:0; }
    #ea-status-dot {
        width:10px; height:10px; border-radius:50%;
        background:#475569; transition: background .4s, box-shadow .4s;
    }
    #ea-status-dot.online {
        background: #10b981 !important;
        box-shadow: 0 0 0 3px rgba(16,185,129,0.25), 0 0 10px rgba(16,185,129,0.6) !important;
        animation: ea-pulse 2s infinite !important;
    }
    @keyframes ea-pulse {
        0%,100% { box-shadow: 0 0 0 3px rgba(16,185,129,0.25), 0 0 10px rgba(16,185,129,0.5); }
        50% { box-shadow: 0 0 0 5px rgba(16,185,129,0.15), 0 0 18px rgba(16,185,129,0.7); }
    }
    #ea-title {
        font-size: 12.5px !important; font-weight: 600 !important;
        color: rgba(255,255,255,0.92) !important; letter-spacing: 0.3px !important;
    }
    #ea-version-tag {
        font-size: 9px !important; font-weight: 500 !important;
        background: rgba(99,102,241,0.4) !important;
        color: #a5b4fc !important; padding: 1px 6px !important;
        border-radius: 20px !important; border: 1px solid rgba(99,102,241,0.3) !important;
        letter-spacing: 0.5px !important;
    }
    #ea-collapse-btn {
        width: 24px !important; height: 24px !important;
        background: rgba(255,255,255,0.08) !important;
        border: 1px solid rgba(255,255,255,0.12) !important;
        border-radius: 6px !important; color: rgba(255,255,255,0.7) !important;
        cursor: pointer !important; font-size: 11px !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
        transition: all .2s !important; flex-shrink:0;
    }
    #ea-collapse-btn:hover { background:rgba(255,255,255,0.15) !important; color:#fff !important; }

    /* Body */
    #ea-body {
        padding: 12px !important;
        display: flex !important; flex-direction: column !important; gap: 10px !important;
        max-height: 520px !important; overflow-y: auto !important;
        background: transparent !important;
    }
    #ea-body::-webkit-scrollbar { width: 3px; }
    #ea-body::-webkit-scrollbar-track { background: transparent; }
    #ea-body::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 2px; }

    /* 拨片式 Toggle 开关区域 */
    #ea-toggles {
        display: flex !important; gap: 8px !important;
    }
    .ea-toggle-item {
        flex: 1 !important;
        display: flex !important; align-items: center !important; justify-content: space-between !important;
        padding: 7px 10px !important;
        background: rgba(255,255,255,0.03) !important;
        border: 1px solid rgba(255,255,255,0.07) !important;
        border-radius: 10px !important;
        cursor: pointer !important; transition: all .2s !important;
    }
    .ea-toggle-item:hover { background:rgba(255,255,255,0.06) !important; border-color:rgba(99,102,241,0.25) !important; }
    .ea-toggle-label {
        font-size: 10.5px !important; font-weight: 500 !important;
        color: rgba(255,255,255,0.55) !important; line-height:1 !important;
        pointer-events:none;
    }
    /* 真实拨片开关 */
    .ea-switch {
        position: relative !important; width: 30px !important; height: 16px !important;
        flex-shrink: 0 !important; pointer-events: none !important;
    }
    .ea-switch input { display:none !important; }
    .ea-switch-track {
        position: absolute !important; inset: 0 !important; border-radius: 20px !important;
        background: rgba(255,255,255,0.12) !important;
        transition: all .25s !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
    }
    .ea-switch-thumb {
        position: absolute !important; width: 12px !important; height: 12px !important;
        background: rgba(255,255,255,0.5) !important;
        border-radius: 50% !important; top: 1px !important; left: 1px !important;
        transition: all .25s cubic-bezier(.34,1.56,.64,1) !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
    }
    .ea-toggle-item.on .ea-switch-track {
        background: linear-gradient(135deg, #4f46e5, #6366f1) !important;
        border-color: rgba(99,102,241,0.5) !important;
        box-shadow: 0 0 8px rgba(99,102,241,0.4) !important;
    }
    .ea-toggle-item.on .ea-switch-thumb {
        left: 15px !important; background: #fff !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4) !important;
    }
    .ea-toggle-item.on .ea-toggle-label { color: rgba(165,180,252,0.9) !important; }

    /* Debug 状态栏 */
    #ea-debug {
        font-size: 10px !important; font-weight: 400 !important;
        color: rgba(148,163,184,0.7) !important;
        padding: 5px 8px !important;
        background: rgba(255,255,255,0.025) !important;
        border: 1px solid rgba(255,255,255,0.05) !important;
        border-radius: 8px !important;
        min-height: 16px !important; word-break: break-all !important;
        letter-spacing: 0.2px !important;
    }

    /* 搜索栏 */
    #ea-search-row {
        display: flex !important; gap: 7px !important; align-items: stretch !important;
    }
    #ea-input {
        flex: 1 !important;
        background: rgba(255,255,255,0.05) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        border-radius: 9px !important; padding: 7px 11px !important;
        color: rgba(255,255,255,0.9) !important; font-size: 12px !important;
        outline: none !important; transition: all .2s !important;
        font-family: inherit !important;
    }
    #ea-input::placeholder { color: rgba(255,255,255,0.25) !important; }
    #ea-input:focus {
        border-color: rgba(99,102,241,0.5) !important;
        background: rgba(99,102,241,0.06) !important;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.1) !important;
    }
    #ea-search-btn {
        background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%) !important;
        border: none !important; color: #fff !important;
        padding: 0 13px !important; border-radius: 9px !important;
        font-weight: 600 !important; font-size: 12px !important;
        cursor: pointer !important; transition: all .2s !important;
        font-family: inherit !important; white-space: nowrap !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.3) !important;
    }
    #ea-search-btn:hover { opacity: .88 !important; transform: translateY(-1px) !important; box-shadow: 0 4px 12px rgba(99,102,241,0.4) !important; }
    #ea-search-btn:active { transform: translateY(0) !important; }

    /* 结果卡片：匹配成功 */
    .ea-result-card {
        border-radius: 11px !important; overflow: hidden !important;
        border: 1px solid rgba(16,185,129,0.3) !important;
        background: rgba(16,185,129,0.06) !important;
        user-select: text !important;
    }
    .ea-result-card-header {
        padding: 7px 12px !important;
        display: flex !important; align-items: center !important; justify-content: space-between !important;
        background: rgba(16,185,129,0.1) !important;
        border-bottom: 1px solid rgba(16,185,129,0.15) !important;
    }
    .ea-match-label { font-size: 10px !important; font-weight: 600 !important; color: #34d399 !important; letter-spacing:0.3px; }
    .ea-auto-label { font-size: 10px !important; color: rgba(96,165,250,0.8) !important; font-weight:500; }

    .ea-question-text {
        padding: 8px 12px !important;
        font-size: 11.5px !important; color: rgba(226,232,240,0.75) !important;
        line-height: 1.5 !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important;
    }

    /* 答案大卡 */
    .ea-answer-block {
        padding: 10px 12px !important;
        display: flex !important; align-items: center !important; justify-content: space-between !important;
    }
    .ea-answer-letter {
        font-size: 26px !important; font-weight: 700 !important;
        background: linear-gradient(135deg, #10b981, #34d399) !important;
        -webkit-background-clip: text !important;
        -webkit-text-fill-color: transparent !important;
        background-clip: text !important;
        line-height: 1 !important; letter-spacing: -0.5px !important;
        filter: drop-shadow(0 0 8px rgba(16,185,129,0.5)) !important;
    }
    .ea-answer-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
    .ea-answer-full {
        font-size: 11px !important; font-weight: 500 !important;
        color: rgba(255,255,255,0.7) !important; text-align:right; max-width:200px; line-height:1.4;
    }
    .ea-copy-btn {
        background: rgba(16,185,129,0.15) !important;
        border: 1px solid rgba(16,185,129,0.3) !important;
        color: #34d399 !important; padding: 3px 9px !important;
        border-radius: 6px !important; font-size: 10px !important; font-weight: 600 !important;
        cursor: pointer !important; transition: all .2s !important; font-family:inherit;
    }
    .ea-copy-btn:hover { background:rgba(16,185,129,0.25) !important; }

    /* 选项详情 */
    .ea-options-list { padding: 0 12px 10px !important; display:flex; flex-direction:column; gap:4px; }
    .ea-opt-row {
        display: flex !important; gap: 7px !important; align-items: flex-start !important;
        padding: 4px 8px !important; border-radius: 6px !important;
        background: rgba(255,255,255,0.03) !important;
        border-left: 2px solid rgba(255,255,255,0.1) !important;
        transition: all .15s !important;
    }
    .ea-opt-row.correct {
        background: rgba(16,185,129,0.1) !important;
        border-left: 2px solid #10b981 !important;
        box-shadow: inset 0 0 12px rgba(16,185,129,0.06) !important;
    }
    .ea-opt-letter { color: rgba(148,163,184,0.6) !important; font-weight: 600 !important; font-size: 11px !important; min-width:14px; flex-shrink:0; margin-top:1px; }
    .ea-opt-row.correct .ea-opt-letter { color: #10b981 !important; }
    .ea-opt-text { color: rgba(203,213,225,0.65) !important; font-size: 11px !important; line-height: 1.45 !important; }
    .ea-opt-row.correct .ea-opt-text { color: rgba(226,240,233,0.9) !important; font-weight:500 !important; }
    .ea-opt-check { margin-left:auto; color:#10b981; font-size:11px; flex-shrink:0; }

    /* 警告卡片：选项不匹配 */
    .ea-warn-card {
        border-radius: 11px !important; overflow: hidden !important;
        border: 1px solid rgba(245,158,11,0.35) !important;
        background: rgba(245,158,11,0.06) !important;
        user-select: text !important;
    }
    .ea-warn-header {
        padding: 7px 12px !important;
        background: rgba(245,158,11,0.1) !important;
        border-bottom: 1px solid rgba(245,158,11,0.15) !important;
        font-size: 10px !important; font-weight: 600 !important; color: #fbbf24 !important;
    }
    .ea-warn-body { padding: 8px 12px !important; font-size: 11px !important; color: rgba(253,230,138,0.75) !important; line-height: 1.5 !important; }

    /* 未找到卡片 */
    .ea-notfound-card {
        border-radius: 11px !important;
        border: 1px solid rgba(239,68,68,0.25) !important;
        background: rgba(239,68,68,0.06) !important;
        padding: 10px 12px !important;
        font-size: 11px !important; color: rgba(252,165,165,0.8) !important; line-height:1.5;
    }

    /* 徽章 */
    .ea-badge-remap {
        display:inline-block; font-size:9px; font-weight:600; padding:1px 5px;
        background:rgba(139,92,246,0.3); color:#c4b5fd;
        border:1px solid rgba(139,92,246,0.4); border-radius:4px; margin-left:4px; vertical-align:middle;
    }
    .ea-badge-mismatch {
        display:inline-block; font-size:9px; font-weight:600; padding:1px 5px;
        background:rgba(239,68,68,0.25); color:#fca5a5;
        border:1px solid rgba(239,68,68,0.35); border-radius:4px; margin-left:4px; vertical-align:middle;
    }
    `;

    try {
        if (typeof GM_addStyle !== 'undefined') GM_addStyle(cssText);
        else { const s=document.createElement('style'); s.textContent=cssText; (document.head||document.documentElement).appendChild(s); }
    } catch(e) {}

    // ===== 创建浮窗 =====
    function createFloatingUI() {
        if (document.getElementById('ea-root')) return;
        container = document.createElement('div');
        container.id = 'ea-root';
        container.innerHTML = `
        <div id="ea-panel">
            <div id="ea-header">
                <div id="ea-header-left">
                    <div id="ea-status-wrap"><div id="ea-status-dot"></div></div>
                    <span id="ea-title">🎯 考试助手</span>
                    <span id="ea-version-tag">v95</span>
                </div>
                <button id="ea-collapse-btn">─</button>
            </div>
            <div id="ea-body">
                <div id="ea-toggles">
                    <div class="ea-toggle-item ${autoCheckEnabled?'on':''}" id="ea-toggle-auto">
                        <span class="ea-toggle-label">自动勾选</span>
                        <div class="ea-switch"><div class="ea-switch-track"></div><div class="ea-switch-thumb"></div></div>
                    </div>
                    <div class="ea-toggle-item" id="ea-toggle-full">
                        <span class="ea-toggle-label">⚡ 3s切题</span>
                        <div class="ea-switch"><div class="ea-switch-track"></div><div class="ea-switch-thumb"></div></div>
                    </div>
                </div>
                <div id="ea-debug">正在连接云端服务器 (${CLOUD_DOMAIN})...</div>
                <div id="ea-search-row">
                    <input type="text" id="ea-input" placeholder="正在读取题干...">
                    <button id="ea-search-btn">搜答案</button>
                </div>
                <div id="ea-results"></div>
            </div>
        </div>`;

        (document.body||document.documentElement).appendChild(container);

        inputQ      = document.getElementById('ea-input');
        searchBtn   = document.getElementById('ea-search-btn');
        resultsList = document.getElementById('ea-results');
        toggleBtn   = document.getElementById('ea-collapse-btn');
        bodyEl      = document.getElementById('ea-body');
        statusDot   = document.getElementById('ea-status-dot');
        debugBar    = document.getElementById('ea-debug');
        autoCheckToggle = document.getElementById('ea-toggle-auto');
        fullAutoToggle  = document.getElementById('ea-toggle-full');

        // 拨片 Toggle 点击
        autoCheckToggle.addEventListener('click', ()=>{
            autoCheckEnabled = !autoCheckEnabled;
            autoCheckToggle.classList.toggle('on', autoCheckEnabled);
            GM_setValue('autoCheckEnabled', autoCheckEnabled);
        });
        fullAutoToggle.addEventListener('click', ()=>{
            fullAutoEnabled = !fullAutoEnabled;
            fullAutoToggle.classList.toggle('on', fullAutoEnabled);
            if (fullAutoEnabled) { lastSwitchTimestamp=Date.now(); setDebug('⚡ 全自动已启动，3秒后切题...'); }
            else setDebug('全自动已关闭');
        });

        // 折叠
        toggleBtn.addEventListener('click', ()=>{
            isCollapsed = !isCollapsed;
            bodyEl.style.display = isCollapsed?'none':'flex';
            toggleBtn.innerText = isCollapsed?'□':'─';
        });

        if (searchBtn) searchBtn.addEventListener('click', ()=> sendSearchQuery(inputQ?inputQ.value:''));
        if (inputQ) inputQ.addEventListener('keypress', e=>{ if(e.key==='Enter') sendSearchQuery(inputQ.value); });

        // 拖拽（作用在 header 上）
        const header = document.getElementById('ea-header');
        if (header) {
            let drag=false,sx=0,sy=0,il=0,it=0;
            header.addEventListener('mousedown', e=>{
                if(e.target.tagName==='BUTTON'||e.target.id==='ea-collapse-btn') return;
                drag=true; sx=e.clientX; sy=e.clientY;
                const r=container.getBoundingClientRect(); il=r.left; it=r.top;
                container.style.setProperty('right','auto','important');
                container.style.setProperty('left',il+'px','important');
                container.style.setProperty('top',it+'px','important');
                const mv=e2=>{
                    if(!drag)return;
                    let nl=il+e2.clientX-sx, nt=it+e2.clientY-sy;
                    nl=Math.max(5,Math.min(window.innerWidth-container.offsetWidth-5,nl));
                    nt=Math.max(5,Math.min(window.innerHeight-container.offsetHeight-5,nt));
                    container.style.setProperty('left',nl+'px','important');
                    container.style.setProperty('top',nt+'px','important');
                };
                const up=()=>{ drag=false; window.removeEventListener('mousemove',mv,true); window.removeEventListener('mouseup',up,true); };
                window.addEventListener('mousemove',mv,true); window.addEventListener('mouseup',up,true);
            });
        }

        document.addEventListener('selectionchange',()=>{ if(selectionTimer)clearTimeout(selectionTimer); selectionTimer=setTimeout(checkAndSearchSelection,120); },true);
        document.addEventListener('mouseup',e=>{ if(container&&container.contains(e.target))return; checkAndSearchSelection(); },true);
    }

    function setDebug(msg) { if(debugBar) debugBar.textContent=msg; }
    function markOnline(label) { if(statusDot){ statusDot.classList.add('online'); statusDot.title=`云端在线 (${label})`; } }
    function markOffline() { if(statusDot) statusDot.classList.remove('online'); }

    function forceEnableSelection() {
        try {
            if(document.getElementById('ea-force-sel-style'))return;
            const s=document.createElement('style'); s.id='ea-force-sel-style';
            s.innerHTML='*,*::before,*::after{-webkit-user-select:text!important;user-select:text!important;pointer-events:auto!important;}';
            (document.head||document.documentElement).appendChild(s);
            ['selectstart','contextmenu','mousedown','mouseup','keydown'].forEach(ev=>
                window.addEventListener(ev,e=>{ if(container&&container.contains(e.target))return; e.stopPropagation(); },true)
            );
        } catch(e) {}
    }

    function hostingDaemon() {
        if(!fullAutoEnabled||isCaptchaPresent())return;
        const now=Date.now();
        if(lastSwitchTimestamp===0){lastSwitchTimestamp=now;return;}
        if(now-lastSwitchTimestamp>=3000){lastSwitchTimestamp=now;triggerNextQuestion();}
    }

    function triggerNextQuestion() {
        if(isSwitchingQuestion)return;
        isSwitchingQuestion=true; setTimeout(()=>isSwitchingQuestion=false,1500);
        const btns=Array.from(document.querySelectorAll('a,button')).filter(el=>{ if(container&&container.contains(el))return false; const t=(el.innerText||el.textContent||'').trim(); return (t==='下一题'||t==='下一页')&&el.offsetWidth>0; });
        if(btns.length>0){setDebug('✅ 点击下一题');singleClick(btns[0]);return;}
        const all=Array.from(document.querySelectorAll('*')).filter(el=>{ if(container&&container.contains(el))return false; const t=(el.innerText||el.textContent||'').trim(); return t==='下一题'&&el.offsetWidth>0&&el.offsetHeight>0; });
        if(all.length>0){all.sort((a,b)=>a.children.length-b.children.length);setDebug('✅ 降级点击下一题');singleClick(all[0]);return;}
        const cn=getCurrentQuestionNumber();
        if(cn!==null&&cn>0){
            const target=String(cn+1);
            const cards=Array.from(document.querySelectorAll('span,div,a,button,li,td')).filter(el=>{ if(container&&container.contains(el))return false; const t=(el.innerText||el.textContent||'').trim(); if(t!==target)return false; const w=el.offsetWidth,h=el.offsetHeight; return w>=15&&w<=70&&h>=15&&h<=70; });
            if(cards.length>0){setDebug(`✅ 点击答题卡 "${target}"`);singleClick(cards[0]);return;}
        }
        setDebug('⚠️ 未找到"下一题"');
    }

    function singleClick(el) {
        if(!el)return;
        try {
            let node=el;
            if(['SPAN','I','P','EM','STRONG'].includes(el.tagName)&&el.parentElement&&['A','BUTTON','DIV','LI','LABEL'].includes(el.parentElement.tagName))node=el.parentElement;
            const jq=win.jQuery||win.$||null;
            if(jq){try{jq(node).trigger('click');return;}catch(e){}}
            if(typeof node.click==='function'){node.click();return;}
            node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:win||window}));
        } catch(e){}
    }

    function isCaptchaPresent() {
        const kws=['安全验证','拖动滑块','完成验证','验证码','拼图'];
        for(const el of document.querySelectorAll('div,span')){
            if(container&&container.contains(el))continue;
            const t=(el.innerText||el.textContent||'').trim();
            if(kws.some(k=>t.includes(k))&&el.offsetWidth>0)return true;
        }
        return false;
    }

    function getRawTitleText() {
        const sels=['.ques-title','.question-title','.question-item-title','.question-content','.ques-name','.question_title','[class*="ques-title"]','[class*="question-title"]','[class*="ques-name"]'];
        for(const sel of sels){try{const el=document.querySelector(sel); if(el&&container&&!container.contains(el)){const t=(el.innerText||el.textContent||'').trim(); if(t.length>=4)return t;}}catch(e){}}
        for(const el of document.querySelectorAll('body *')){
            if(container&&container.contains(el))continue;
            try{const rect=el.getBoundingClientRect(); if(rect.left<160||rect.width<80)continue;}catch(e){continue;}
            const t=(el.innerText||el.textContent||'').trim();
            if(t.length>=5&&t.length<=500&&/^\d+[、.（(]/.test(t))return t;
        }
        return '';
    }

    function autoExtractTitle() {
        const raw=getRawTitleText(); if(!raw||raw.length<4)return '';
        return raw.replace(/^[（(]?\d+[）).、\s]*/,'').replace(/^(单选题|多选题|判断题|填空题|问答题)[：:\s]*/,'').replace(/\(\s*\d+\s*分\s*\)/g,'').trim();
    }

    function getCurrentQuestionNumber() {
        try{const raw=getRawTitleText(); if(!raw)return null; const m=raw.match(/^[（(]?(\d+)[）).、\s]/); if(m)return parseInt(m[1],10);}catch(e){}
        return null;
    }

    function autoScanLoop() {
        if(isCaptchaPresent()){if(resultsList)resultsList.innerHTML='<div class="ea-warn-card"><div class="ea-warn-header">🛡️ 滑动验证已触发</div><div class="ea-warn-body">请手动完成验证，助手将自动恢复。</div></div>';return;}
        const now=Date.now(); if(now-lastAutoProcessTime<600)return;
        const title=autoExtractTitle();
        if(title&&title.length>=4&&title!==currentTitleHash){
            currentTitleHash=title; lastAutoProcessTime=now;
            if(inputQ)inputQ.value=title;
            setDebug('题干已更新，云端搜题中...');
            sendSearchQuery(title);
        }
    }

    function getPageOptionsMap() {
        const map={};
        const ALL=['A','B','C','D','E','F','G'];
        ALL.forEach(letter=>{
            const others=ALL.filter(l=>l!==letter);
            const pfx=[`${letter}.`,`${letter}、`,`${letter}:`,`${letter} `,`(${letter})`,`（${letter}）`];
            const cands=Array.from(document.querySelectorAll('body *')).filter(el=>{
                if(container&&container.contains(el))return false;
                const text=(el.innerText||el.textContent||'').trim();
                if(!text||text.length>300)return false;
                if(others.some(ol=>text.includes(`${ol}.`)||text.includes(`${ol}、`)||text.includes(`${ol}:`)))return false;
                return pfx.some(p=>text.startsWith(p));
            });
            if(cands.length>0){
                cands.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
                let raw=(cands[0].innerText||cands[0].textContent||'').trim();
                raw=raw.replace(/^[A-G][.、:\s（(]*/i,'').trim();
                if(raw)map[letter]=raw;
            }
        });
        return map;
    }

    function collectOptions() {
        const map=getPageOptionsMap();
        const list=Object.entries(map).map(([k,v])=>`${k}. ${v}`);
        return list.length>0?list:[];
    }

    function checkAndSearchSelection() {
        try{const sel=window.getSelection(); if(!sel)return; const t=sel.toString().trim(); if(container&&container.contains(document.activeElement))return; if(t&&t.length>=2&&t!==lastSelectedText){lastSelectedText=t; if(inputQ)inputQ.value=t; sendSearchQuery(t);}}catch(e){}
    }

    function isOptionCheckedDeep(optionBox) {
        if(!optionBox)return false;
        const input=optionBox.querySelector('input[type="checkbox"],input[type="radio"]')||(optionBox.tagName==='INPUT'?optionBox:null);
        if(input&&(input.checked||input.getAttribute('aria-checked')==='true'))return true;
        const allNodes=[optionBox,...Array.from(optionBox.querySelectorAll('*'))];
        for(const node of allNodes){
            const cls=(node.className||'').toString();
            if(/(z-checked|z-sel|is-checked|checked|selected|active|\bon\b|cur|current)/i.test(cls))return true;
            if(node.getAttribute('aria-checked')==='true')return true;
        }
        return false;
    }

    function cleanText(s){return(s||'').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g,'');}

    function textSimilarity(a,b){
        const ca=cleanText(a),cb=cleanText(b);
        if(!ca||!cb)return 0; if(ca===cb)return 1;
        const shorter=ca.length<cb.length?ca:cb, longer=ca.length<cb.length?cb:ca;
        if(longer.includes(shorter))return shorter.length/longer.length;
        let overlap=0; for(const ch of shorter){if(longer.includes(ch))overlap++;}
        return overlap/longer.length;
    }

    function calcOverallOptionsSimilarity(dbOpts,webOpts){
        const dbVals=Object.values(dbOpts).filter(Boolean), webVals=Object.values(webOpts).filter(Boolean);
        if(dbVals.length===0||webVals.length===0)return 0;
        let total=0;
        dbVals.forEach(dbText=>{ let best=0; webVals.forEach(webText=>{const s=textSimilarity(dbText,webText); if(s>best)best=s;}); total+=best; });
        return total/dbVals.length;
    }

    function remapLettersByContent(origLetters,dbOpts,webOpts){
        if(!origLetters||origLetters.length===0)return{letters:[],isRemapped:false};
        const finalLetters=[]; let isRemapped=false;
        origLetters.forEach(origLetter=>{
            const dbText=dbOpts[origLetter];
            if(!dbText){finalLetters.push(origLetter);return;}
            let bestLetter=origLetter,bestSim=0;
            for(const[webLetter,webText]of Object.entries(webOpts)){const sim=textSimilarity(dbText,webText); if(sim>bestSim){bestSim=sim;bestLetter=webLetter;}}
            finalLetters.push(bestLetter);
            if(bestLetter!==origLetter)isRemapped=true;
        });
        return{letters:[...new Set(finalLetters)],isRemapped};
    }

    function autoClickAnswerOption(targetLetters){
        if(!autoCheckEnabled||!targetLetters||targetLetters.length===0)return;
        const ALL=['A','B','C','D','E','F','G'];
        const targetSet=new Set(targetLetters);
        ALL.forEach((letter,index)=>{
            setTimeout(()=>{
                const pfx=[`${letter}.`,`${letter}、`,`${letter}:`,`${letter} `,`${letter} .`,`${letter} 、`,`(${letter})`,`（${letter}）`];
                const others=ALL.filter(l=>l!==letter);
                const cands=Array.from(document.querySelectorAll('body *')).filter(el=>{
                    if(container&&container.contains(el))return false;
                    const text=(el.innerText||el.textContent||'').trim();
                    if(!text||text.length>300)return false;
                    if(others.some(ol=>text.includes(`${ol}.`)||text.includes(`${ol}、`)||text.includes(`${ol}:`)))return false;
                    return pfx.some(p=>text.startsWith(p))||text===letter;
                });
                if(cands.length===0)return;
                cands.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
                const targetNode=cands[0];
                let optionBox=targetNode;
                while(optionBox&&optionBox.parentElement&&optionBox.parentElement.tagName!=='BODY'){
                    if(optionBox.tagName==='LABEL'||optionBox.classList.contains('el-checkbox')||optionBox.classList.contains('el-radio')||(optionBox.offsetWidth>100&&optionBox.children.length>1))break;
                    optionBox=optionBox.parentElement;
                }
                const isChecked=isOptionCheckedDeep(optionBox);
                const shouldCheck=targetSet.has(letter);
                const clickTarget=(optionBox&&optionBox.querySelector)?(optionBox.querySelector('input,.el-checkbox__inner,.el-radio__inner,i')||optionBox):targetNode;
                if(shouldCheck&&!isChecked){setDebug(`⚡ 补勾选漏选选项 ${letter}`);singleClick(clickTarget);}
                else if(!shouldCheck&&isChecked){setDebug(`🧹 撤销误勾选选项 ${letter}`);singleClick(clickTarget);}
                else if(shouldCheck&&isChecked){setDebug(`🔒 选项 ${letter} 已正确勾选，保护不动`);}
            },index*140);
        });
    }

    function autoConnectBackend(){if(isConnected&&!fallbackMode)return;tryCloudWs();}

    function tryCloudWs(){
        try{
            socket=new WebSocket(`ws://${CLOUD_DOMAIN}/ws/search`);
            socket.onopen=()=>{isConnected=true;fallbackMode=false;activeType='wss_cloud';markOnline('云端WSS');};
            socket.onmessage=e=>{try{handleResponseData(JSON.parse(e.data));}catch(err){}};
            socket.onerror=()=>startCloudHttp(); socket.onclose=()=>startCloudHttp();
        }catch(e){startCloudHttp();}
    }

    function startCloudHttp(){
        if(typeof GM_xmlhttpRequest==='undefined'){renderErrorUI();return;}
        GM_xmlhttpRequest({method:'GET',url:`${TOKEN_INFO_URL}?token=${encodeURIComponent(USER_TOKEN)}&device_id=${encodeURIComponent(DEVICE_ID)}`,timeout:2500,onload:()=>{isConnected=true;fallbackMode=true;activeType='cloud_http';markOnline('云端HTTP');},onerror:renderErrorUI,ontimeout:renderErrorUI});
    }

    function sendSearchQuery(query){
        if(!query||query.trim().length<2)return;
        if(resultsList)resultsList.innerHTML='<div style="color:rgba(148,163,184,0.5);text-align:center;padding:14px;font-size:11px;">⚡ 云端检索中...</div>';
        const cleanQuery=query.replace(/^\d+[\s\S]*?(单选题|多选题|判断题|填空题)[：:\s]*/i,'').replace(/^\d+[.、．\s]+/,'').trim();
        const options=collectOptions();
        if(socket&&socket.readyState===WebSocket.OPEN&&!fallbackMode){socket.send(JSON.stringify({query:cleanQuery,options,token:USER_TOKEN}));return;}
        if(typeof GM_xmlhttpRequest==='undefined'){renderErrorUI();return;}
        GM_xmlhttpRequest({
            method:'GET',
            url:`${HTTP_URL}?q=${encodeURIComponent(cleanQuery)}&token=${encodeURIComponent(USER_TOKEN)}&device_id=${encodeURIComponent(DEVICE_ID)}&options=${encodeURIComponent(JSON.stringify(options))}`,
            headers:{'Content-Type':'application/json'},timeout:8000,
            onload:r=>{if(r.status===200){markOnline(activeType||'云端在线');try{handleResponseData(JSON.parse(r.responseText));}catch(e){}}else renderErrorUI();},
            onerror:renderErrorUI
        });
    }

    function handleResponseData(data){renderSingleResult(data);}

    function renderErrorUI(){
        markOffline();
        if(!resultsList)return;
        resultsList.innerHTML=`<div class="ea-notfound-card"><strong>⚠️ 未能连接到云端</strong><br>服务器: ${CLOUD_DOMAIN}</div>`;
    }

    function renderSingleResult(data){
        if(!resultsList)return;
        if(!data||(!data.found&&!data.success)){
            const s=(data&&data.highest_score)?` — 最高相似度 ${data.highest_score}%`:'';
            resultsList.innerHTML=`<div class="ea-notfound-card"><strong>⚠️ 题库未匹配</strong>${s}</div>`;
            return;
        }
        const match=data.match||data;
        let rawAns=(data.answer||match.display_answer||match.answer_letter||'未知').toString().trim();
        const dbOpts=data.options||match.options||{};
        const webOpts=getPageOptionsMap();
        let isTF=false;
        if(/^(correct|true|正确|对|√|yes|right)$/i.test(rawAns)){rawAns='A';isTF=true;}
        else if(/^(wrong|false|错误|错|×|no)$/i.test(rawAns)){rawAns='B';isTF=true;}
        const origLetters=[...new Set(rawAns.replace(/[^A-Za-z]/g,'').toUpperCase().split(''))].filter(Boolean);

        const overallSim=(Object.keys(dbOpts).length>0&&Object.keys(webOpts).length>0)?calcOverallOptionsSimilarity(dbOpts,webOpts):1.0;
        let finalLetters=origLetters,isRemapped=false,statusType='exact';
        if(overallSim>=0.55){const r=remapLettersByContent(origLetters,dbOpts,webOpts);finalLetters=r.letters;isRemapped=r.isRemapped;statusType=isRemapped?'remapped':'exact';}
        else if(Object.keys(dbOpts).length>0&&Object.keys(webOpts).length>0){statusType='mismatch';}

        let displayAns='';
        if(isTF){displayAns=finalLetters.includes('A')?'A. 正确':'B. 错误';}
        else{displayAns=finalLetters.join(', ');}

        if(statusType!=='mismatch')autoClickAnswerOption(finalLetters);
        else setDebug('⚠️ 选项不匹配，停止自动勾选');

        if(statusType==='mismatch'){
            resultsList.innerHTML=`
            <div class="ea-warn-card">
                <div class="ea-warn-header">⚠️ 疑似题目不匹配 <span class="ea-badge-mismatch">选项相似度 ${Math.round(overallSim*100)}%</span></div>
                <div class="ea-warn-body">云端返回题目选项内容与当前页面选项差异过大，可能是同题干但不同内容的题目。<br><br>DB原始答案字母：<strong>${origLetters.join(', ')}</strong><br>已停止自动勾选，请人工核对。</div>
            </div>`;
            return;
        }

        // 🌟 仅构建正确选项的详细文本展示
        let optHtml='';
        if (finalLetters.length > 0) {
            const rows = finalLetters.map(l => {
                const text = webOpts[l] || dbOpts[l] || '';
                if (!text) return '';
                return `<div class="ea-opt-row correct">
                    <span class="ea-opt-letter">${l}.</span>
                    <span class="ea-opt-text">${esc(text)}</span>
                    <span class="ea-opt-check">✓</span>
                </div>`;
            }).filter(Boolean).join('');
            
            if (rows) {
                optHtml = `<div class="ea-options-list">${rows}</div>`;
            }
        }

        const badge=isRemapped?`<span class="ea-badge-remap">已重映射</span>`:`<span style="color:rgba(148,163,184,0.5);font-size:9px;">验证${Math.round(overallSim*100)}%</span>`;

        resultsList.innerHTML=`
        <div class="ea-result-card">
            <div class="ea-result-card-header">
                <span class="ea-match-label">✓ 匹配成功 ${badge}</span>
                <span class="ea-auto-label">⚡ 3s切题</span>
            </div>
            <div class="ea-question-text">${esc((match.title||match.q_title||'').slice(0,80))}${(match.title||match.q_title||'').length>80?'...':''}</div>
            <div class="ea-answer-block">
                <div class="ea-answer-letter">${esc(displayAns)}</div>
                <div class="ea-answer-right">
                    <button class="ea-copy-btn" id="ea-copy-btn">复制答案</button>
                </div>
            </div>
            ${optHtml}
        </div>`;

        const btn=document.getElementById('ea-copy-btn');
        if(btn)btn.addEventListener('click',function(){navigator.clipboard.writeText(displayAns).then(()=>{this.innerText='已复制✓';setTimeout(()=>this.innerText='复制答案',1500);});});
    }

    function esc(t){return(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

    function startRun(){forceEnableSelection();createFloatingUI();autoConnectBackend();}
    if(document.readyState==='complete'||document.readyState==='interactive')startRun();
    else{window.addEventListener('DOMContentLoaded',startRun);window.addEventListener('load',startRun);}
    setInterval(startRun,1000);
    setInterval(autoScanLoop,350);
    setInterval(hostingDaemon,300);

})();
