# 网页考试助手 (Web Exam Assistant)

自动识别网页考试题目，并在 Excel (`final.xlsx`) 2000+ 题库中毫秒级检索答案，实时在网页右上角优雅悬浮显示。

---

## 🛠️ 项目结构

```
DZZ/
├── start.sh                      # 一键启动 Python 后端的 Shell 脚本
├── server/
│   ├── main.py                   # FastAPI 本地搜索后端 (包含 RapidFuzz 模糊匹配)
│   └── requirements.txt          # Python 依赖包
└── userscript/
    └── exam_assistant.user.js    # Tampermonkey (油猴) 网页前端助手脚本
```

---

## 🚀 极简使用指南（共 2 步）

### 第一步：启动本地 Python 后端

打开终端 (Terminal)，运行以下命令：

```bash
cd /Users/julian/antigravity/DZZ
./start.sh
```

> **说明**：
> - 后端会自动从 `~/Downloads/final.xlsx` (下载文件夹中的 `final.xlsx`) 读取题库。
> - 启动成功后会自动提示 `成功加载 XXXX 道试题`，并且后端地址为 `http://127.0.0.1:8000`。

---

### 第二步：安装油猴脚本 (Tampermonkey)

1. 确保浏览器已安装 **Tampermonkey (油猴)** 扩展插件。
2. 打开油猴扩展管理面板，点击 **添加新脚本**。
3. 将本项目中的 [exam_assistant.user.js](file:///Users/julian/antigravity/DZZ/userscript/exam_assistant.user.js) 文本内容**全选复制**粘贴进去。
4. 按 `Ctrl+S` (或 `Cmd+S`) 保存脚本。

---

## ✨ 核心特性与使用技巧

1. **右上角高颜值悬浮窗**：
   - 网页右上角自动显示毛玻璃风格搜题框。
   - **支持拖拽**：按住标题栏可拖动到任意位置。
   - **收起/展开**：点击右上角 `─` / `□` 按钮随时隐藏悬浮窗。
2. **滑动划词自动搜题**：
   - 在考试页面上用鼠标**划词选中文本**，助手会自动抓取选中文本并在 50ms 内给出匹配度最高的 3 个答案！
3. **模糊容错匹配**：
   - 网页题目带有题号（如 `1.` `一、`）、额外空格或少许标点差异时，智能匹配依然能准确寻找正确答案。
4. **一键复制答案**：
   - 点击答案右侧的“复制”按钮即可直接复制到剪贴板。

---

## ❓ 常见问题排查

- **提示“未连接到本地后端”？**
  - 请确认是否在终端中运行了 `./start.sh`，并且终端窗口没有关闭。
  - 打开 `http://127.0.0.1:8000` 检查是否显示 `{"status":"online", ...}`。

- **更换或更新了 Excel 题库？**
  - 修改 `~/Downloads/final.xlsx` 后，在浏览器中访问 `http://127.0.0.1:8000/api/reload` 或重启 `./start.sh` 即可重新加载最新题库。
