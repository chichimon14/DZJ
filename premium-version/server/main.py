"""
FastAPI 核心服务 - 网页考试助手 Premium Version
包含: WebSocket/HTTP 双层搜题 + Token 鉴权 + 题库管理 + 支付回调 + 管理员 API
"""
import io
import os
import re
import json
import time
import secrets
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import (
    FastAPI, Query, WebSocket, WebSocketDisconnect,
    HTTPException, Request, Depends, File, UploadFile, Form
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rapidfuzz import process as rf_process, fuzz

import models
import auth
import pay
import parser as exam_parser


# ──────────────────────────────────────────────────────────────────────────────
# 生命周期：启动时初始化 DB，加载公共题库索引到内存
# ──────────────────────────────────────────────────────────────────────────────

PUBLIC_BANK_CACHE: List[Dict[str, Any]] = []   # 内存缓存公共题库，加速匹配
PUBLIC_TITLES_CLEAN: List[str] = []            # 清洗后的标题，用于 RapidFuzz 索引


def reload_public_cache():
    """从 DB 重新加载公共题库到内存"""
    global PUBLIC_BANK_CACHE, PUBLIC_TITLES_CLEAN
    conn = models.get_db()
    rows = conn.execute("SELECT * FROM public_bank").fetchall()
    conn.close()
    PUBLIC_BANK_CACHE = [dict(r) for r in rows]
    PUBLIC_TITLES_CLEAN = [r['title_clean'] for r in PUBLIC_BANK_CACHE]
    print(f"[INFO] 公共题库内存索引已刷新，共 {len(PUBLIC_BANK_CACHE)} 题")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化
    models.init_db()
    # 若无 admin_key，自动生成一个并打印
    if not models.get_setting("admin_key"):
        new_key = secrets.token_urlsafe(32)
        models.upsert_setting("admin_key", new_key)
        print(f"\n{'='*60}")
        print(f"  ⚠️  首次启动！超级管理员密钥 (ADMIN_KEY):")
        print(f"  {new_key}")
        print(f"  请妥善保管，用于登录 /admin 后台")
        print(f"{'='*60}\n")
    reload_public_cache()
    yield


app = FastAPI(title="考试助手 Premium API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件（管理后台、购买页面）
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────────────────────────────────────

def fuzzy_search(query: str, token: str = None, threshold: int = 72) -> Optional[Dict]:
    """
    双层模糊匹配搜题：
    1. 优先在用户私有题库中搜索
    2. 未命中则在公共题库中搜索
    """
    clean_q = exam_parser.clean_text(query)
    if not clean_q:
        return None

    # ── 第一层：私有题库 ──────────────────────────────────────────────────────
    if token:
        conn = models.get_db()
        private_rows = conn.execute(
            "SELECT * FROM private_bank WHERE token=?", (token,)
        ).fetchall()
        conn.close()

        if private_rows:
            private_titles = [r['title_clean'] for r in private_rows]
            result = rf_process.extractOne(clean_q, private_titles, scorer=fuzz.ratio)
            if result and result[1] >= threshold:
                best = dict(private_rows[result[2]])
                best['_source'] = 'private'
                best['_score'] = result[1]
                return best

    # ── 第二层：公共题库（内存缓存）────────────────────────────────────────────
    if not PUBLIC_TITLES_CLEAN:
        return None

    result = rf_process.extractOne(clean_q, PUBLIC_TITLES_CLEAN, scorer=fuzz.ratio)
    if result and result[1] >= threshold:
        best = dict(PUBLIC_BANK_CACHE[result[2]])
        best['_source'] = 'public'
        best['_score'] = result[1]
        return best

    return None


def format_answer(row: Dict) -> Dict:
    """将数据库行格式化为客户端需要的答案结构"""
    return {
        "found":   True,
        "title":   row.get("title", ""),
        "answer":  row.get("answer", ""),
        "q_type":  row.get("q_type", "choice"),
        "options": {
            "A": row.get("opt_a", ""),
            "B": row.get("opt_b", ""),
            "C": row.get("opt_c", ""),
            "D": row.get("opt_d", ""),
        },
        "source":  row.get("_source", ""),
        "score":   row.get("_score", 0),
    }


def log_search(token: str, device_id: str, query: str, found: bool, source: str):
    """记录搜题日志（异步写入，不影响响应速度）"""
    try:
        conn = models.get_db()
        conn.execute("""
            INSERT INTO search_logs (token, device_id, query, found, source)
            VALUES (?, ?, ?, ?, ?)
        """, (token, device_id, query[:80], 1 if found else 0, source))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────────────
# 路由：管理员权限依赖
# ──────────────────────────────────────────────────────────────────────────────

async def require_admin(request: Request):
    admin_key = (
        request.headers.get("X-Admin-Key")
        or request.query_params.get("admin_key")
    )
    if not auth.verify_admin(admin_key):
        raise HTTPException(status_code=403, detail="管理员权限不足")
    return True


# ──────────────────────────────────────────────────────────────────────────────
# 路由：WebSocket 极速搜题（主通道）
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/search")
async def ws_search(websocket: WebSocket):
    token     = websocket.query_params.get("token", "")
    device_id = websocket.query_params.get("device_id", "")

    await websocket.accept()

    try:
        token_row = auth.verify_token(token, device_id)
    except auth.TokenError as e:
        await websocket.send_json({"error": e.msg, "code": e.code})
        await websocket.close()
        return

    await websocket.send_json({"status": "connected", "msg": "🟢 连接成功，卡密有效！"})

    try:
        while True:
            data = await websocket.receive_text()
            query = data.strip()
            if not query:
                continue

            result = fuzzy_search(query, token)
            if result:
                resp = format_answer(result)
                log_search(token, device_id, query, True, result.get('_source', ''))
            else:
                resp = {"found": False, "msg": "未找到匹配题目"}
                log_search(token, device_id, query, False, 'miss')

            await websocket.send_json(resp)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────────
# 路由：HTTP 搜题（备用通道）
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/search")
async def http_search(
    q: str = Query(..., description="题干文本"),
    token: str = Query(...),
    device_id: str = Query(...),
):
    try:
        auth.verify_token(token, device_id)
    except auth.TokenError as e:
        return JSONResponse({"error": e.msg, "code": e.code}, status_code=401)

    result = fuzzy_search(q, token)
    if result:
        log_search(token, device_id, q, True, result.get('_source', ''))
        return format_answer(result)
    return {"found": False, "msg": "未找到匹配题目"}


# ──────────────────────────────────────────────────────────────────────────────
# 路由：Token 激活状态查询
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/token/info")
async def token_info(token: str = Query(...), device_id: str = Query(...)):
    try:
        row = auth.verify_token(token, device_id)
        return {
            "valid":      True,
            "card_type":  row["card_type"],
            "expires_at": row["expires_at"],
            "device_id":  row["device_id"],
        }
    except auth.TokenError as e:
        return {"valid": False, "code": e.code, "msg": e.msg}


# ──────────────────────────────────────────────────────────────────────────────
# 路由：题库管理（用户私有题库）
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/bank/upload")
async def upload_bank(
    file: UploadFile = File(...),
    token: str = Form(""),
    device_id: str = Form(""),
    target: str = Form("private"),  # private | public (public 需要管理员权限)
    admin_key: str = Form(""),
):
    # 鉴权
    if target == "public":
        if not auth.verify_admin(admin_key):
            raise HTTPException(403, "上传公共题库需要管理员权限")
    else:
        try:
            auth.verify_token(token, device_id)
        except auth.TokenError as e:
            raise HTTPException(401, e.msg)

    # 读取文件
    content = await file.read()
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ('.xlsx', '.xls', '.csv'):
        raise HTTPException(400, "仅支持 .xlsx / .xls / .csv 格式")

    # 写入临时文件后解析（pandas 需要文件路径或 BytesIO）
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        rows = exam_parser.parse_excel(tmp_path, token=(token if target == "private" else None))
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(400, f"题库解析失败: {e}")
    finally:
        os.unlink(tmp_path)

    conn = models.get_db()
    is_private = (target == "private")
    count = exam_parser.import_to_db(conn, rows, is_private=is_private, source=token if is_private else "admin")
    conn.close()

    if not is_private:
        reload_public_cache()

    return {"success": True, "imported": count, "target": target}


@app.delete("/api/bank/clear")
async def clear_bank(
    target: str = Query("private", description="private | public"),
    token: str = Query(""),
    device_id: str = Query(""),
    admin_key: str = Query(""),
):
    if target == "public":
        if not auth.verify_admin(admin_key):
            raise HTTPException(403, "清空公共题库需要管理员权限")
        conn = models.get_db()
        conn.execute("DELETE FROM public_bank")
        conn.commit()
        conn.close()
        reload_public_cache()
        return {"success": True, "cleared": "public"}
    else:
        try:
            auth.verify_token(token, device_id)
        except auth.TokenError as e:
            raise HTTPException(401, e.msg)
        conn = models.get_db()
        conn.execute("DELETE FROM private_bank WHERE token=?", (token,))
        conn.commit()
        conn.close()
        return {"success": True, "cleared": "private"}


@app.get("/api/bank/info")
async def bank_info(token: str = Query(""), admin_key: str = Query("")):
    conn = models.get_db()
    public_count  = conn.execute("SELECT COUNT(*) FROM public_bank").fetchone()[0]
    private_count = 0
    if token:
        private_count = conn.execute(
            "SELECT COUNT(*) FROM private_bank WHERE token=?", (token,)
        ).fetchone()[0]
    conn.close()
    return {"public": public_count, "private": private_count}


# ──────────────────────────────────────────────────────────────────────────────
# 路由：支付与自动发卡
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/pay/create")
async def api_create_order(request: Request):
    body = await request.json()
    product_key = body.get("product", "month")
    pay_type    = body.get("pay_type", "alipay")
    buyer_ip    = request.client.host if request.client else ""
    try:
        order = pay.create_order(product_key, pay_type, buyer_ip)
        return order
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/pay/notify")
async def pay_notify(request: Request):
    """支付平台异步回调（易支付标准格式）"""
    form = await request.form()
    params = dict(form)
    result = pay.process_payment_notify(params)
    if result["status"] == "ok":
        return "success"   # 易支付要求返回纯文本 "success"
    return "fail"


@app.get("/api/pay/query")
async def pay_query(order_id: str = Query(...)):
    """前端轮询支付状态"""
    return pay.query_order_status(order_id)


# ──────────────────────────────────────────────────────────────────────────────
# 路由：超级管理员 API
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/admin/tokens/generate")
async def admin_gen_tokens(request: Request, _=Depends(require_admin)):
    body = await request.json()
    card_type = body.get("card_type", "TIME").upper()
    days      = int(body.get("days", 30))
    count     = min(int(body.get("count", 1)), 200)
    note      = body.get("note", "")
    tokens = auth.batch_create_tokens(card_type, days, count, note)
    return {"success": True, "tokens": tokens, "count": len(tokens)}


@app.get("/api/admin/tokens")
async def admin_list_tokens(
    page: int = Query(1),
    per_page: int = Query(50),
    _=Depends(require_admin)
):
    return auth.get_all_tokens(page, per_page)


@app.post("/api/admin/tokens/unbind")
async def admin_unbind(request: Request, _=Depends(require_admin)):
    body = await request.json()
    token = body.get("token", "")
    ok = auth.unbind_device(token)
    return {"success": ok}


@app.post("/api/admin/tokens/revoke")
async def admin_revoke(request: Request, _=Depends(require_admin)):
    body = await request.json()
    token = body.get("token", "")
    ok = auth.revoke_token(token)
    return {"success": ok}


@app.post("/api/admin/tokens/extend")
async def admin_extend(request: Request, _=Depends(require_admin)):
    body = await request.json()
    token     = body.get("token", "")
    extra_days = int(body.get("days", 30))
    ok = auth.extend_token(token, extra_days)
    return {"success": ok}


@app.get("/api/admin/stats")
async def admin_stats(_=Depends(require_admin)):
    conn = models.get_db()
    total_tokens   = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
    active_tokens  = conn.execute("SELECT COUNT(*) FROM tokens WHERE is_active=1").fetchone()[0]
    today_searches = conn.execute(
        "SELECT COUNT(*) FROM search_logs WHERE ts >= date('now','localtime')"
    ).fetchone()[0]
    total_orders   = conn.execute("SELECT COUNT(*) FROM orders WHERE status='paid'").fetchone()[0]
    revenue        = conn.execute(
        "SELECT COALESCE(SUM(price),0) FROM orders WHERE status='paid'"
    ).fetchone()[0]
    public_count   = conn.execute("SELECT COUNT(*) FROM public_bank").fetchone()[0]
    conn.close()
    return {
        "total_tokens":   total_tokens,
        "active_tokens":  active_tokens,
        "today_searches": today_searches,
        "total_orders":   total_orders,
        "revenue":        revenue,
        "public_bank":    public_count,
    }


@app.get("/api/admin/settings")
async def admin_get_settings(_=Depends(require_admin)):
    conn = models.get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


@app.post("/api/admin/settings")
async def admin_save_settings(request: Request, _=Depends(require_admin)):
    body = await request.json()
    for k, v in body.items():
        if k != "admin_key":  # admin_key 不允许通过此接口修改
            models.upsert_setting(k, str(v))
    return {"success": True}


# ──────────────────────────────────────────────────────────────────────────────
# 路由：前端页面
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(str(static_dir / "buy.html"))


@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return FileResponse(str(static_dir / "admin.html"))


@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


# ──────────────────────────────────────────────────────────────────────────────
# 启动入口
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
