"""
支付网关与自动发卡模块 - 网页考试助手 Premium Version
支持: 易支付(EPay) / 微信官方 / 支付宝官方
"""
import hashlib
import hmac
import time
import uuid
import httpx
from typing import Optional, Dict, Any
from models import get_db, get_setting, upsert_setting
from auth import create_token


# ──────────────────────────────────────────────────────────────────────────────
# 产品套餐定义（管理员可在后台修改价格）
# ──────────────────────────────────────────────────────────────────────────────
PRODUCTS = {
    "week":     {"name": "周卡",  "days": 7,   "card_type": "TIME",     "price": 9.9},
    "month":    {"name": "月卡",  "days": 30,  "card_type": "TIME",     "price": 29.9},
    "year":     {"name": "年卡",  "days": 365, "card_type": "TIME",     "price": 199.0},
    "lifetime": {"name": "买断卡","days": 0,   "card_type": "LIFETIME", "price": 399.0},
}


def get_product(product_key: str) -> Optional[Dict]:
    return PRODUCTS.get(product_key)


def generate_order_id() -> str:
    """生成本系统唯一订单号"""
    return f"EA{int(time.time())}{uuid.uuid4().hex[:6].upper()}"


# ──────────────────────────────────────────────────────────────────────────────
# 易支付 (EPay) 适配器
# ──────────────────────────────────────────────────────────────────────────────

class EPay:
    """易支付通用接口，兼容大部分国内易支付系统"""

    @staticmethod
    def _sign(params: Dict, key: str) -> str:
        """生成易支付签名（MD5）"""
        filtered = {k: v for k, v in sorted(params.items())
                    if k not in ('sign', 'sign_type') and v != ''}
        raw = '&'.join(f"{k}={v}" for k, v in filtered.items()) + key
        return hashlib.md5(raw.encode()).hexdigest()

    @staticmethod
    def create_pay_url(order_id: str, product_key: str, pay_type: str = "alipay") -> str:
        """
        生成支付跳转 URL（引导用户扫码支付）
        pay_type: alipay / wxpay / qqpay
        """
        product = get_product(product_key)
        if not product:
            raise ValueError("无效套餐")

        pid   = get_setting("epay_pid", "")
        key   = get_setting("epay_key", "")
        api   = get_setting("epay_api", "https://pay.example.com")
        notify_url = get_setting("notify_url", "")
        return_url = get_setting("return_url", "")

        params = {
            "pid":        pid,
            "type":       pay_type,
            "out_trade_no": order_id,
            "notify_url": notify_url,
            "return_url": return_url,
            "name":       product["name"],
            "money":      str(product["price"]),
            "sign_type":  "MD5",
        }
        params["sign"] = EPay._sign(params, key)
        query = '&'.join(f"{k}={v}" for k, v in params.items())
        return f"{api}/submit.php?{query}"

    @staticmethod
    def verify_notify(params: Dict) -> bool:
        """校验异步回调签名合法性"""
        key = get_setting("epay_key", "")
        received_sign = params.get("sign", "")
        expected_sign = EPay._sign(params, key)
        return received_sign == expected_sign


# ──────────────────────────────────────────────────────────────────────────────
# 订单管理
# ──────────────────────────────────────────────────────────────────────────────

def create_order(product_key: str, pay_type: str, buyer_ip: str = "") -> Dict[str, Any]:
    """创建新订单，存入数据库，返回订单信息与支付 URL"""
    product = get_product(product_key)
    if not product:
        raise ValueError("无效套餐")

    order_id = generate_order_id()
    conn = get_db()
    conn.execute("""
        INSERT INTO orders (order_id, product, price, pay_type, status, buyer_ip)
        VALUES (?, ?, ?, ?, 'pending', ?)
    """, (order_id, product_key, product["price"], pay_type, buyer_ip))
    conn.commit()
    conn.close()

    pay_url = EPay.create_pay_url(order_id, product_key, pay_type)

    return {
        "order_id": order_id,
        "product":  product["name"],
        "price":    product["price"],
        "pay_url":  pay_url,
    }


def process_payment_notify(params: Dict) -> Dict[str, Any]:
    """
    处理支付成功异步回调。
    1. 校验签名。
    2. 标记订单已支付。
    3. 自动生成用户 Token 并写入数据库。
    4. 返回 Token 给调用者（显示给用户）。
    """
    if not EPay.verify_notify(params):
        return {"status": "error", "msg": "签名校验失败"}

    order_id = params.get("out_trade_no", "")
    trade_no = params.get("trade_no", "")

    conn = get_db()
    order = conn.execute("SELECT * FROM orders WHERE order_id=?", (order_id,)).fetchone()

    if not order:
        conn.close()
        return {"status": "error", "msg": "订单不存在"}

    order = dict(order)
    if order["status"] == "paid":
        # 已处理过，直接返回已生成的 Token
        conn.close()
        return {"status": "ok", "token": order["token"], "msg": "订单已处理"}

    # 生成 Token
    product = get_product(order["product"])
    token = create_token(
        card_type=product["card_type"],
        days=product["days"],
        note=f"自动发卡-{order['product']}",
        order_id=order_id,
    )

    from datetime import datetime
    paid_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn.execute("""
        UPDATE orders SET status='paid', token=?, out_trade_no=?, paid_at=?
        WHERE order_id=?
    """, (token, trade_no, paid_at, order_id))
    conn.commit()
    conn.close()

    return {"status": "ok", "token": token, "product": product["name"]}


def query_order_status(order_id: str) -> Dict[str, Any]:
    """前端轮询查询订单状态（用于自动发卡页显示 Token）"""
    conn = get_db()
    row = conn.execute(
        "SELECT status, token, product FROM orders WHERE order_id=?", (order_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {"status": "not_found"}
    return {"status": row["status"], "token": row["token"], "product": row["product"]}
