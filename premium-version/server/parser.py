"""
标准 Excel 题库解析引擎 - 网页考试助手 Premium Version
标准列格式: 1.序号 | 2.题干 | 3.答案 | 4.详细答案
"""
import re
import pandas as pd
from typing import List, Dict, Any


def clean_text(text: str) -> str:
    """清洗题目文本，用于模糊匹配索引"""
    if not isinstance(text, str):
        text = str(text) if text else ""
    text = re.sub(r'<[^>]+>', '', text)                          # 去 HTML 标签
    text = re.sub(r'^[（(]?\d+[）).、\s]*', '', text)            # 去题号前缀
    text = re.sub(r'[\s\n\r]', '', text)                         # 去空白
    text = re.sub(r'[，。！？,!?（）()\u3002\uff01\uff1f]', '', text)  # 去标点
    return text.strip().lower()


# ── 选项文字抽取正则 ─────────────────────────────────────────────────────────
# 匹配格式: A. xxx  A、xxx  A.xxx  A：xxx  （A）xxx  A xxx
OPT_PATTERN = re.compile(
    r'(?:^|[\n；;])?\s*[（(]?([A-Da-d])[)）.、：:\s]\s*(.+?)(?=\s*[（(]?[A-Da-d][)）.、：:\s]|$)',
    re.DOTALL | re.MULTILINE
)

# 判断题答案映射
JUDGE_TRUE  = {'正确', '对', '是', 'true',  '√', 'a', 'A', '对的', '正'}
JUDGE_FALSE = {'错误', '错', '否', 'false', '×', 'b', 'B', '错的', '误'}


def detect_question_type(answer: str, detail: str) -> str:
    """根据答案内容自动判断题目类型"""
    ans = answer.strip().upper()
    # 判断题: 答案为 正确/错误/A/B 且详细答案中不含 ABCD 选项格式
    if ans in {'A', 'B', '正确', '错误', '对', '错', 'TRUE', 'FALSE'}:
        opts = OPT_PATTERN.findall(detail or "")
        if not opts:
            return 'judge'
    return 'choice'


def normalize_answer(answer: str, q_type: str) -> str:
    """标准化答案：统一大写字母，判断题统一为 correct/wrong"""
    ans = answer.strip()
    if q_type == 'judge':
        if ans in JUDGE_TRUE:
            return 'correct'
        if ans in JUDGE_FALSE:
            return 'wrong'
        return 'correct'  # 默认
    # 选择题: 过滤非字母，转大写
    return re.sub(r'[^A-Da-d]', '', ans).upper()


def extract_options(detail: str) -> Dict[str, str]:
    """从"详细答案"文本中抽取 ABCD 选项内容"""
    opts = {'A': '', 'B': '', 'C': '', 'D': ''}
    if not detail:
        return opts
    matches = OPT_PATTERN.findall(detail)
    for letter, content in matches:
        letter = letter.upper()
        if letter in opts:
            opts[letter] = content.strip()
    # 如果正则未能匹配，尝试按换行简单分割
    if not any(opts.values()):
        lines = [l.strip() for l in re.split(r'[\n；;]', detail) if l.strip()]
        for line in lines:
            m = re.match(r'^[（(]?([A-Da-d])[)）.、：:\s]\s*(.+)', line)
            if m:
                opts[m.group(1).upper()] = m.group(2).strip()
    return opts


def parse_excel(file_path: str, token: str = None) -> List[Dict[str, Any]]:
    """
    解析标准格式 Excel/CSV 题库文件。

    标准列名（允许有前缀数字/空格）：
      序号 | 题干 | 答案 | 详细答案

    Returns:
        List of dicts, each representing one question row ready for DB insertion.
    """
    try:
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path, dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
    except Exception as e:
        raise ValueError(f"无法读取文件: {e}")

    df = df.fillna('')
    columns = [str(c).strip() for c in df.columns]

    # ── 列名自动映射 ─────────────────────────────────────────────────────────
    def find_col(keywords: List[str]) -> str | None:
        for kw in keywords:
            for col in columns:
                if kw in col:
                    return col
        return None

    col_id     = find_col(['序号', '编号', 'id', 'ID'])
    col_title  = find_col(['题干', '试题内容', '题目', '问题'])
    col_answer = find_col(['答案'])
    col_detail = find_col(['详细答案', '选项', '解析'])

    if not col_title:
        # 按位置兜底：第 2 列为题干
        col_title = columns[1] if len(columns) > 1 else columns[0]
    if not col_answer:
        col_answer = columns[2] if len(columns) > 2 else None
    if not col_detail:
        col_detail = columns[3] if len(columns) > 3 else None

    results = []
    for _, row in df.iterrows():
        raw_title  = str(row[col_title]).strip() if col_title else ''
        raw_answer = str(row[col_answer]).strip() if col_answer else ''
        raw_detail = str(row[col_detail]).strip() if col_detail else ''

        if not raw_title or raw_title == 'nan':
            continue

        title_clean = clean_text(raw_title)
        q_type      = detect_question_type(raw_answer, raw_detail)
        norm_answer = normalize_answer(raw_answer, q_type)
        opts        = extract_options(raw_detail) if q_type == 'choice' else {'A': '', 'B': '', 'C': '', 'D': ''}

        row_data = {
            'title':       raw_title,
            'title_clean': title_clean,
            'answer':      norm_answer,
            'opt_a':       opts.get('A', ''),
            'opt_b':       opts.get('B', ''),
            'opt_c':       opts.get('C', ''),
            'opt_d':       opts.get('D', ''),
            'q_type':      q_type,
        }
        if token:
            row_data['token'] = token
        results.append(row_data)

    return results


def import_to_db(conn, rows: List[Dict[str, Any]], is_private: bool = False, source: str = 'upload'):
    """将解析结果批量写入数据库"""
    table = 'private_bank' if is_private else 'public_bank'
    inserted = 0
    for row in rows:
        try:
            if is_private:
                conn.execute("""
                    INSERT INTO private_bank (token, title, title_clean, answer, opt_a, opt_b, opt_c, opt_d, q_type)
                    VALUES (:token, :title, :title_clean, :answer, :opt_a, :opt_b, :opt_c, :opt_d, :q_type)
                """, row)
            else:
                conn.execute("""
                    INSERT INTO public_bank (title, title_clean, answer, opt_a, opt_b, opt_c, opt_d, q_type, source)
                    VALUES (:title, :title_clean, :answer, :opt_a, :opt_b, :opt_c, :opt_d, :q_type, :source)
                """, {**row, 'source': source})
            inserted += 1
        except Exception as e:
            print(f"[跳过] 插入失败: {e} | 题干: {row.get('title', '')[:30]}")
    conn.commit()
    return inserted
