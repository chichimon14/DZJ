// ===== DOM 诊断脚本 v1 =====
// 粘贴到 ks.kyexam.com 考试页面的 F12 控制台里运行！
(function probe() {
    const out = [];

    // 1. 题干节点
    const titleSelectors = [
        '.ques-title', '.question-title', '.question-item-title',
        '.question-content', '.ques-name', '.question_title',
        '[class*="ques-title"]', '[class*="question-title"]', '[class*="ques-name"]'
    ];
    out.push('=== 【题干节点】===');
    titleSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) out.push(`  ${sel} => "${(el.innerText||'').trim().slice(0,80)}"`);
    });

    // 2. 选项节点
    out.push('\n=== 【选项区域节点】===');
    const optSels = [
        '.choose-list-item', '.opt-item', '.singleChoose', '.ques-answers',
        '.select-item', '.checkbox', '.radio', '.el-checkbox', '.el-radio',
        '[class*="option"]', '[class*="choice"]', 'label'
    ];
    optSels.forEach(sel => {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
            out.push(`  ${sel} (${els.length}个): 第1个文本="${(els[0].innerText||'').trim().slice(0,40)}"`);
        }
    });

    // 3. 下一题按钮
    out.push('\n=== 【下一题按钮候选】===');
    const allEls = Array.from(document.querySelectorAll('button, a, div, span, input'));
    const nextCandidates = allEls.filter(el => {
        const text = (el.innerText || el.textContent || '').trim();
        return text.includes('下一题') && el.offsetWidth > 0;
    });
    nextCandidates.forEach(el => {
        out.push(`  <${el.tagName}> class="${el.className}" text="${(el.innerText||'').trim().slice(0,40)}" w=${el.offsetWidth} h=${el.offsetHeight} parent="${el.parentElement ? el.parentElement.tagName + '.' + el.parentElement.className.slice(0,30) : 'null'}"`);
    });

    // 4. 答题卡数字格子
    out.push('\n=== 【答题卡数字格子】===');
    const cardNums = Array.from(document.querySelectorAll('button, div, span, a, li')).filter(el => {
        const text = (el.innerText || el.textContent || '').trim();
        return /^\d+$/.test(text) && el.offsetWidth > 0 && el.offsetWidth < 80 && el.offsetHeight < 80;
    });
    if (cardNums.length > 0) {
        const sample = cardNums.slice(0, 5);
        sample.forEach(el => {
            out.push(`  <${el.tagName}> class="${el.className.slice(0,50)}" text="${(el.innerText||'').trim()}" w=${el.offsetWidth}`);
        });
        out.push(`  ...共 ${cardNums.length} 个数字格`);
        
        // 找当前激活的格子
        const active = cardNums.filter(el => {
            const cls = (el.className + ' ' + (el.parentElement ? el.parentElement.className : '')).toLowerCase();
            return cls.includes('active') || cls.includes('current') || cls.includes('select') || cls.includes('cur') || cls.includes('on');
        });
        out.push(`  激活格子(${active.length}个): ${active.map(el => `"${(el.innerText||'').trim()}" class="${el.className.slice(0,30)}"`).join(', ')}`);
    }

    // 5. 主体布局
    out.push('\n=== 【页面主要结构 ID/class】===');
    const mainEls = document.querySelectorAll('[id], .container, .main, .content, .exam, .paper, .question');
    Array.from(mainEls).slice(0, 20).forEach(el => {
        if (el.id || el.className) {
            out.push(`  <${el.tagName}> id="${el.id}" class="${el.className.slice(0,50)}"`);
        }
    });

    console.log(out.join('\n'));
    alert('诊断完毕，请查看 F12 控制台 Console 标签页中的输出！');
})();
