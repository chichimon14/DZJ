"""
数据库模型 - 网页考试助手 Premium Version
使用 SQLite + sqlite3 标准库，零额外依赖
"""
import sqlite3
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "exam_assistant.db"


def get_db():
    """获取数据库连接（线程安全模式）"""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化数据库，创建所有表结构"""
    conn = get_db()
    c = conn.cursor()

    # ── 管理员表 ──────────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT NOT NULL UNIQUE,
            password    TEXT NOT NULL,          -- SHA256 哈希存储
            admin_key   TEXT UNIQUE,            -- 管理员 Token（可替代账号密码登录）
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # ── 卡密表 ────────────────────────────────────────────────────────────────
    # card_type: TIME（时间卡）| LIFETIME（买断卡）
    c.execute("""
        CREATE TABLE IF NOT EXISTS tokens (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            token       TEXT NOT NULL UNIQUE,   -- 卡密（随机生成的字符串）
            card_type   TEXT NOT NULL DEFAULT 'TIME',
            days        INTEGER DEFAULT 0,      -- TIME 卡有效天数，LIFETIME 为 0
            device_id   TEXT DEFAULT NULL,      -- 已绑定的设备指纹
            is_active   INTEGER DEFAULT 1,      -- 1=有效，0=禁用/吊销
            activated_at TEXT DEFAULT NULL,     -- 首次激活时间
            expires_at  TEXT DEFAULT NULL,      -- 到期时间（TIME 卡）
            order_id    TEXT DEFAULT NULL,      -- 关联订单号
            note        TEXT DEFAULT '',        -- 管理员备注
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # ── 订单表 ────────────────────────────────────────────────────────────────
    # pay_type: wechat（微信）| alipay（支付宝）| epay（易支付）
    # status: pending（待支付）| paid（已支付）| expired（已过期）
    c.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id    TEXT NOT NULL UNIQUE,   -- 本系统订单号
            out_trade_no TEXT DEFAULT NULL,     -- 支付平台订单号
            product     TEXT NOT NULL,          -- 购买套餐：week/month/year/lifetime
            price       REAL NOT NULL,          -- 支付金额（元）
            pay_type    TEXT DEFAULT 'epay',    -- 支付方式
            status      TEXT DEFAULT 'pending', -- 订单状态
            token       TEXT DEFAULT NULL,      -- 支付成功后生成的 Token
            buyer_ip    TEXT DEFAULT NULL,      -- 买家 IP
            paid_at     TEXT DEFAULT NULL,      -- 支付时间
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # ── 题库上传批次表 ────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS bank_batches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_name  TEXT NOT NULL,
            target      TEXT DEFAULT 'public',
            total_count INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # ── 公共题库表 ────────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS public_bank (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id    INTEGER DEFAULT 0,
            title       TEXT NOT NULL,          -- 题干（原始文本）
            title_clean TEXT NOT NULL,          -- 题干（清洗后，用于模糊匹配）
            answer      TEXT NOT NULL,          -- 答案（如：A 或 AB 或 正确）
            opt_a       TEXT DEFAULT '',
            opt_b       TEXT DEFAULT '',
            opt_c       TEXT DEFAULT '',
            opt_d       TEXT DEFAULT '',
            q_type      TEXT DEFAULT 'choice',  -- choice（选择题）| judge（判断题）
            source      TEXT DEFAULT 'admin',   -- 题库来源（管理员批次标识）
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_public_title ON public_bank(title_clean)")

    # 自动数据库迁移：为旧版数据库自动补全 batch_id 字段
    try:
        c.execute("ALTER TABLE public_bank ADD COLUMN batch_id INTEGER DEFAULT 0")
    except Exception:
        pass

    # ── 私有题库表 ────────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS private_bank (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            token       TEXT NOT NULL,          -- 归属的用户 Token
            title       TEXT NOT NULL,
            title_clean TEXT NOT NULL,
            answer      TEXT NOT NULL,
            opt_a       TEXT DEFAULT '',
            opt_b       TEXT DEFAULT '',
            opt_c       TEXT DEFAULT '',
            opt_d       TEXT DEFAULT '',
            q_type      TEXT DEFAULT 'choice',
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_private_title ON private_bank(title_clean, token)")

    # ── 系统配置表 ────────────────────────────────────────────────────────────
    # 用于存储支付参数、系统设置等 key-value 配置
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # ── 统计日志表 ────────────────────────────────────────────────────────────
    c.execute("""
        CREATE TABLE IF NOT EXISTS search_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            token       TEXT NOT NULL,
            device_id   TEXT DEFAULT NULL,
            query       TEXT DEFAULT '',        -- 搜题关键词（前 50 字）
            found       INTEGER DEFAULT 0,      -- 1=命中，0=未命中
            source      TEXT DEFAULT '',        -- private / public / miss
            ts          TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    conn.commit()
    conn.close()
    print("[DB] 数据库初始化完成 ->", DB_PATH)


def upsert_setting(key: str, value: str):
    """写入或更新系统配置"""
    conn = get_db()
    conn.execute("""
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now','localtime'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    """, (key, value))
    conn.commit()
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    """读取系统配置"""
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


if __name__ == "__main__":
    init_db()
