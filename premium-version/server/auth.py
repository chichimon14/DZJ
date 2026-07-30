"""
卡密鉴权与超级管理员权限模块 - 网页考试助手 Premium Version
"""
import hashlib
import os
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from models import get_db, get_setting


# ── 超级管理员密钥（首次运行自动生成并写入 DB，之后从 DB 读取）────────────────


def get_admin_key() -> str:
    """获取超级管理员 API 密钥（从 DB 配置表读取）"""
    return get_setting("admin_key", "")


def verify_admin(key: str) -> bool:
    """校验超级管理员密钥"""
    admin_key = get_admin_key()
    return bool(admin_key and key == admin_key)


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


# ── Token 生成与管理 ─────────────────────────────────────────────────────────

ALPHABET = string.ascii_uppercase + string.digits   # 大写字母+数字，去掉易混淆字符
ALPHABET = ALPHABET.translate(str.maketrans('', '', 'O0I1'))  # 去掉 O 0 I 1


def generate_token(length: int = 20) -> str:
    """生成随机卡密，格式: XXXX-XXXX-XXXX-XXXX-XXXX（每4位一组）"""
    raw = ''.join(secrets.choice(ALPHABET) for _ in range(length))
    return '-'.join(raw[i:i+4] for i in range(0, length, 4))


def create_token(card_type: str, days: int = 30, note: str = '', order_id: str = '') -> str:
    """在数据库中创建新卡密，返回卡密字符串"""
    token = generate_token()
    conn = get_db()
    conn.execute("""
        INSERT INTO tokens (token, card_type, days, is_active, note, order_id)
        VALUES (?, ?, ?, 1, ?, ?)
    """, (token, card_type.upper(), days, note, order_id))
    conn.commit()
    conn.close()
    return token


def batch_create_tokens(card_type: str, days: int, count: int, note: str = '') -> list:
    """批量生成卡密"""
    tokens = []
    conn = get_db()
    for _ in range(count):
        token = generate_token()
        conn.execute("""
            INSERT INTO tokens (token, card_type, days, is_active, note)
            VALUES (?, ?, ?, 1, ?)
        """, (token, card_type.upper(), days, note))
        tokens.append(token)
    conn.commit()
    conn.close()
    return tokens


# ── Token 校验与设备绑定 ─────────────────────────────────────────────────────

class TokenError(Exception):
    """Token 校验异常，附带错误码"""
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code
        self.msg  = msg


def verify_token(token: str, device_id: str) -> Dict[str, Any]:
    """
    校验 Token 合法性并处理设备绑定。
    返回 token 数据库行（dict），或抛出 TokenError。

    错误码：
      4001 - Token 不存在
      4002 - Token 已被禁用/吊销
      4003 - Token 已过期
      4004 - Token 已绑定其他设备
    """
    conn = get_db()
    row = conn.execute("SELECT * FROM tokens WHERE token=?", (token,)).fetchone()
    if not row:
        conn.close()
        raise TokenError(4001, "Token 不存在，请确认卡密是否正确")

    row = dict(row)

    if not row['is_active']:
        conn.close()
        raise TokenError(4002, "Token 已被禁用或吊销，请联系管理员")

    now = datetime.now()

    # 设备绑定逻辑：首次激活时绑定设备
    if not row['device_id']:
        # 首次使用：绑定设备并记录激活时间
        expires_at = None
        if row['card_type'] == 'TIME' and row['days'] > 0:
            expires_at = (now + timedelta(days=row['days'])).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("""
            UPDATE tokens SET device_id=?, activated_at=?, expires_at=?
            WHERE token=?
        """, (device_id, now.strftime('%Y-%m-%d %H:%M:%S'), expires_at, token))
        conn.commit()
        row['device_id'] = device_id
        row['expires_at'] = expires_at
    elif row['device_id'] != device_id:
        conn.close()
        raise TokenError(4004, "该 Token 已绑定其他设备，如需换绑请联系管理员")

    # 检查是否过期（买断卡不检查）
    if row['card_type'] == 'TIME' and row['expires_at']:
        expires_dt = datetime.strptime(row['expires_at'], '%Y-%m-%d %H:%M:%S')
        if now > expires_dt:
            conn.close()
            raise TokenError(4003, f"Token 已于 {row['expires_at']} 过期，请续费")

    conn.close()
    return row


def unbind_device(token: str) -> bool:
    """管理员解绑卡密设备（允许换机）"""
    conn = get_db()
    cur = conn.execute("UPDATE tokens SET device_id=NULL WHERE token=?", (token,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def revoke_token(token: str) -> bool:
    """管理员吊销/禁用卡密"""
    conn = get_db()
    cur = conn.execute("UPDATE tokens SET is_active=0 WHERE token=?", (token,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def extend_token(token: str, extra_days: int) -> bool:
    """管理员延长卡密有效期"""
    conn = get_db()
    row = conn.execute("SELECT expires_at, card_type FROM tokens WHERE token=?", (token,)).fetchone()
    if not row or row['card_type'] == 'LIFETIME':
        conn.close()
        return False
    base = datetime.strptime(row['expires_at'], '%Y-%m-%d %H:%M:%S') if row['expires_at'] else datetime.now()
    new_exp = (base + timedelta(days=extra_days)).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute("UPDATE tokens SET expires_at=?, days=days+? WHERE token=?", (new_exp, extra_days, token))
    conn.commit()
    conn.close()
    return True


def get_all_tokens(page: int = 1, per_page: int = 50) -> Dict[str, Any]:
    """分页获取所有卡密（管理员使用）"""
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
    rows = conn.execute("""
        SELECT token, card_type, days, device_id, is_active,
               activated_at, expires_at, note, order_id, created_at
        FROM tokens ORDER BY created_at DESC LIMIT ? OFFSET ?
    """, (per_page, (page - 1) * per_page)).fetchall()
    conn.close()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [dict(r) for r in rows]
    }
