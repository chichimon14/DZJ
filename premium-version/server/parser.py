"""
标准 Excel 题库解析引擎 - 网页考试助手 Premium Version
标准列格式: 1.序号 | 2.题干 | 3.答案 | 4.详细答案
"""
import re
import pandas as pd
from typing import List, Dict, Any, Optional


def clean_text(text: str) -> str:
    """清洗题目文本，用于模糊匹配索引"""
    if not isinstance(text, str):
        text = str(text) if text else ""
    text = re.sub(r'<[^>]+>', '', text)                                      # 去 HTML 标签
    text = re.sub(r'^\s*\d+[\s.、．：:]*', '', text)                           # 去题号数字
    text = re.sub(r'(单选题|多选题|判断题|填空题)[：:\s]*', '', text)            # 去题型前缀
    text = re.sub(r'根据题干信息.*?选择.*?答案[。！!\s]*', '', text)             # 去试题引导说明
    text = re.sub(r'在选项中.*?选择[。！!\s]*', '', text)                        # 去试题引导说明2
    text = re.sub(r'[（(]\s*\d+\s*分[）)]', '', text)                          # 去(1分)
    text = re.sub(r'[\s\n\r]', '', text)                                     # 去空白
    text = re.sub(r'[，。！？,!?（）()\u3002\uff01\uff1f]', '', text)              # 去标点
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

    # ── 列名自动映射（智能无视空格与大小写）─────────────────────────────────
    def find_col(keywords: List[str], exclude: List[str] = None) -> Optional[str]:
        for col in columns:
            col_str = str(col).strip()
            if exclude and any(ex in col_str for ex in exclude):
                continue
            col_clean = re.sub(r'[\s_]', '', col_str).upper()
            for kw in keywords:
                kw_clean = re.sub(r'[\s_]', '', kw).upper()
                if kw_clean == col_clean or kw_clean in col_clean:
                    return col
        return None

    col_title  = find_col(['题干', '试题内容', '题目', '问题'])
    col_answer = find_col(['答案'], exclude=['详细', '解析'])
    col_opt_a  = find_col(['选项A', '选项 A', 'A选项', '选项_A', 'A'])
    col_opt_b  = find_col(['选项B', '选项 B', 'B选项', '选项_B', 'B'])
    col_opt_c  = find_col(['选项C', '选项 C', 'C选项', '选项_C', 'C'])
    col_opt_d  = find_col(['选项D', '选项 D', 'D选项', '选项_D', 'D'])
    col_detail = find_col(['详细答案', '解析', '选项'])

    # 位置兜底规则
    if not col_title:
        col_title = columns[1] if len(columns) > 1 else columns[0]
    if not col_answer:
        col_answer = columns[2] if len(columns) > 2 else None

    # 如果没有找到独立的选项列，尝试按表格后几列兜底
    if not col_opt_a and len(columns) >= 4 and col_answer != columns[3]:
        col_opt_a = columns[3]
    if not col_opt_b and len(columns) >= 5 and col_answer != columns[4]:
        col_opt_b = columns[4]
    if not col_opt_c and len(columns) >= 6 and col_answer != columns[5]:
        col_opt_c = columns[5]
    if not col_opt_d and len(columns) >= 7 and col_answer != columns[6]:
        col_opt_d = columns[6]

    results = []
    for _, row in df.iterrows():
        raw_title  = str(row[col_title]).strip() if col_title and col_title in row else ''
        raw_answer = str(row[col_answer]).strip() if col_answer and col_answer in row else ''

        if not raw_title or raw_title == 'nan':
            continue

        title_clean = clean_text(raw_title)

        # 提取选项 A/B/C/D
        opts = {'A': '', 'B': '', 'C': '', 'D': ''}
        if col_opt_a and col_opt_a in row and str(row[col_opt_a]).strip() != 'nan':
            opts['A'] = str(row[col_opt_a]).strip()
        if col_opt_b and col_opt_b in row and str(row[col_opt_b]).strip() != 'nan':
            opts['B'] = str(row[col_opt_b]).strip()
        if col_opt_c and col_opt_c in row and str(row[col_opt_c]).strip() != 'nan':
            opts['C'] = str(row[col_opt_c]).strip()
        if col_opt_d and col_opt_d in row and str(row[col_opt_d]).strip() != 'nan':
            opts['D'] = str(row[col_opt_d]).strip()

        # 如果独立选项列全空，退回从"详细答案/解析"中正则提取
        if not any(opts.values()) and col_detail and col_detail in row:
            raw_detail = str(row[col_detail]).strip()
            opts = extract_options(raw_detail)
            q_type = detect_question_type(raw_answer, raw_detail)
        else:
            q_type = 'choice' if any(opts.values()) else detect_question_type(raw_answer, '')

        norm_answer = normalize_answer(raw_answer, q_type)

        results.append({
            'title':       raw_title,
            'title_clean': title_clean,
            'answer':      norm_answer,
            'opt_a':       opts.get('A', ''),
            'opt_b':       opts.get('B', ''),
            'opt_c':       opts.get('C', ''),
            'opt_d':       opts.get('D', ''),
            'q_type':      q_type,
        })

    return results


def import_to_db(conn, rows: List[Dict[str, Any]], is_private: bool = False, source: str = 'upload', batch_id: int = 0) -> int:
    """将解析结果批量写入数据库（使用 executemany 极速事务处理）"""
    if not rows:
        return 0

    if is_private:
        sql = """
            INSERT INTO private_bank (token, title, title_clean, answer, opt_a, opt_b, opt_c, opt_d, q_type)
            VALUES (:token, :title, :title_clean, :answer, :opt_a, :opt_b, :opt_c, :opt_d, :q_type)
        """
        data = rows
    else:
        sql = """
            INSERT INTO public_bank (batch_id, title, title_clean, answer, opt_a, opt_b, opt_c, opt_d, q_type, source)
            VALUES (:batch_id, :title, :title_clean, :answer, :opt_a, :opt_b, :opt_c, :opt_d, :q_type, :source)
        """
        data = [{**r, 'source': source, 'batch_id': batch_id} for r in rows]

    try:
        conn.executemany(sql, data)
        conn.commit()
        return len(data)
    except Exception as e:
        print(f"[错误] 批量插入失败，降级逐条插入: {e}")
        inserted = 0
        for r in data:
            try:
                conn.execute(sql, r)
                inserted += 1
            except Exception:
                pass
        conn.commit()
        return inserted
