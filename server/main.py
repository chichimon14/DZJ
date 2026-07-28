import os
import re
import glob
import json
import traceback
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from rapidfuzz import process, fuzz

QUESTION_BANK: List[Dict[str, Any]] = []
CLEAN_TITLES: List[str] = []
EXCEL_PATH_USED: str = ""

def clean_text(text: str) -> str:
    """去除空格标点题号，利于高精度匹配"""
    try:
        if not isinstance(text, str):
            text = str(text) if pd.notna(text) else ""
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'^[（(]?\d+[）).、\s]*', '', text)
        text = re.sub(r'\s+', '', text)
        text = re.sub(r'[，。！？,!?（）()\s\n\r]', '', text)
        return text.strip().lower()
    except Exception:
        return ""

def locate_excel_file() -> str:
    downloads_path = Path.home() / "Downloads" / "final.xlsx"
    if downloads_path.exists():
        return str(downloads_path)
    
    local_path = Path(__file__).parent.parent / "final.xlsx"
    if local_path.exists():
        return str(local_path)
    
    matching_files = glob.glob(str(Path.home() / "Downloads" / "*final*.xlsx")) + \
                     glob.glob(str(Path.home() / "Downloads" / "*题库*.xlsx"))
    if matching_files:
        return matching_files[0]
        
    return str(downloads_path)

def load_excel_bank():
    global QUESTION_BANK, CLEAN_TITLES, EXCEL_PATH_USED
    excel_path = locate_excel_file()
    EXCEL_PATH_USED = excel_path

    if not os.path.exists(excel_path):
        print(f"[警告] 未找到题库文件: {excel_path}")
        return

    print(f"[信息] 正在解析题库文件: {excel_path}")
    try:
        if excel_path.endswith('.csv'):
            df = pd.read_csv(excel_path)
        else:
            df = pd.read_excel(excel_path)
            
        df = df.fillna("")
        columns = [str(col) for col in df.columns]
        
        title_col = None
        ans_col = None
        opt_cols = {}

        for col in columns:
            col_strip = col.strip()
            if col_strip == "试题内容" or "试题内容" in col_strip:
                title_col = col
            elif col_strip == "答案" or "答案" in col_strip:
                ans_col = col
            elif "选项A" in col_strip:
                opt_cols["A"] = col
            elif "选项B" in col_strip:
                opt_cols["B"] = col
            elif "选项C" in col_strip:
                opt_cols["C"] = col
            elif "选项D" in col_strip:
                opt_cols["D"] = col

        if not title_col and len(columns) > 1:
            title_col = columns[1]
        if not ans_col and len(columns) > 2:
            ans_col = columns[2]

        print(f"[成功] 使用题目列: '{title_col}', 答案列: '{ans_col}', 选项列: {list(opt_cols.keys())}")

        QUESTION_BANK.clear()
        CLEAN_TITLES.clear()

        for idx, row in df.iterrows():
            try:
                raw_title = str(row[title_col]).strip()
                raw_answer = str(row[ans_col]).strip()
                
                if not raw_title:
                    continue

                options_dict = {}
                for key in ["A", "B", "C", "D"]:
                    if key in opt_cols:
                        opt_val = str(row[opt_cols[key]]).strip()
                        options_dict[key] = opt_val

                clean_t = clean_text(raw_title)

                QUESTION_BANK.append({
                    "id": idx + 1,
                    "title": raw_title,
                    "clean_title": clean_t,
                    "answer_letter": raw_answer,
                    "options": options_dict
                })
                CLEAN_TITLES.append(clean_t)
            except Exception:
                continue

        print(f"[成功] 题库加载完成！共加载 {len(QUESTION_BANK)} 道试题。")
    except Exception as e:
        print(f"[错误] 读取 Excel 失败: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_excel_bank()
    yield

app = FastAPI(title="Exam Assistant Backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 1

@app.get("/")
def index():
    return {
        "status": "online",
        "total_questions": len(QUESTION_BANK),
        "excel_file": EXCEL_PATH_USED
    }

def do_search(query_str: str, limit: int = 1):
    try:
        if not QUESTION_BANK:
            return {"found": False, "msg": "题库为空或未成功加载 Excel", "file": EXCEL_PATH_USED}

        clean_q = clean_text(query_str)
        if not clean_q:
            return {"found": False, "msg": "查询文本为空"}

        exact_match_item = None
        for item in QUESTION_BANK:
            if clean_q in item["clean_title"] or item["clean_title"] in clean_q:
                exact_match_item = item
                break

        best_item = exact_match_item
        best_score = 100.0 if exact_match_item else 0.0

        if not best_item:
            matches = process.extract(
                clean_q,
                CLEAN_TITLES,
                scorer=fuzz.WRatio,
                limit=1
            )
            if matches:
                clean_t, score, index = matches[0]
                best_score = float(score)
                best_item = QUESTION_BANK[index]

        if best_item and best_score >= 60.0:
            ans_letter = best_item["answer_letter"]
            options = best_item["options"]
            
            opt_text = options.get(ans_letter, "")
            if opt_text:
                display_answer = f"{ans_letter}. {opt_text}"
            else:
                display_answer = ans_letter

            return {
                "found": True,
                "query": query_str,
                "score": round(best_score, 1),
                "match": {
                    "title": best_item["title"],
                    "answer_letter": ans_letter,
                    "option_text": opt_text,
                    "display_answer": display_answer,
                    "options_all": options
                }
            }
        else:
            return {
                "found": False,
                "query": query_str,
                "highest_score": round(best_score, 1) if best_item else 0.0,
                "msg": "未在题库中找到确切匹配的题目"
            }
    except Exception as err:
        return {"found": False, "msg": f"搜索过程发生异常: {str(err)}"}

@app.get("/api/search")
def search_get(q: str = Query(..., description="题目查询文本"), limit: int = 1):
    return do_search(q, limit)

@app.post("/api/search")
def search_post(req: SearchRequest):
    return do_search(req.query, req.limit)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                query_text = payload.get("query", "")
            except Exception:
                query_text = data
                
            res = do_search(query_text)
            await websocket.send_text(json.dumps(res, ensure_ascii=False))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

if __name__ == "__main__":
    import uvicorn
    cert_path = Path(__file__).parent / "cert.pem"
    key_path = Path(__file__).parent / "key.pem"
    
    if cert_path.exists() and key_path.exists():
        print("[HTTPS/WSS] 正在以 SSL 加密模式（同时支持 HTTPS 和 WSS）启动后端...")
        uvicorn.run("main:app", host="127.0.0.1", port=8000, ssl_keyfile=str(key_path), ssl_certfile=str(cert_path), reload=False)
    else:
        print("[HTTP/WS] 以普通模式启动后端...")
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
