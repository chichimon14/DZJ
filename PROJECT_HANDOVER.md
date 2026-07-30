# 网页考试助手 (Exam Assistant) - 无缝衔接开发与项目全景文档

> **新对话提示**：本文档记录了网页考试助手的完整架构、核心变动履历、关键避坑经验、代码索引以及下一步计划。只需阅读本文档，即可无缝接续整个项目的开发与维护。

---

## 目录
1. [项目简介与定位](#1-项目简介与定位)
2. [系统整体架构](#2-系统整体架构)
3. [核心文件结构与路径清单](#3-核心文件结构与路径清单)
4. [核心功能与演进履历 (v1.0 -> v51.0)](#4-核心功能与演进履历)
5. [关键踩坑经验与解决方案 (必读)](#5-关键踩坑经验与解决方案-必读)
6. [运行与部署指南](#6-运行与部署指南)
7. [Android 移动端扩展方案规划](#7-android-移动端扩展方案规划)

---

## 1. 项目简介与定位

**网页考试助手** 是一款专为各类网页考试平台（如 `ks.kyexam.com` 等）设计的全自动搜题、自动勾选答案及 3 秒无人托管切题系统。

### 核心亮点：
- **闪电搜题**：支持 WebSocket 双向长连接（优先）+ HTTPS/HTTP 双重降级备用通道，0.1s 极速响应。
- **高精匹配**：基于 Python FastAPI + RapidFuzz 模糊匹配 + 选项共现校验，精准应对重名/变体题目。
- **稳定勾选**：兼容 Regular.js、Vue、Element-UI、React 及传统 HTML 的单选/多选/判断题自动打钩。
- **全场景 3s 托管切题**：具有 300ms 心跳守护与三重降级策略（答题卡 N+1 精确跳转 -> 独立“下一题”按钮点击 -> 全局叶子节点兜底），绝不卡死、绝不跳题。
- **macOS 桌面控制面板**：带有动态变色图标（🟢 ON / 🔴 OFF）的桌面一键控制脚本，防止多进程导致电脑发热耗电。

---

## 2. 系统整体架构

```mermaid
graph TD
    A[网页考试平台 (如 ks.kyexam.com)] <-->|DOM 扫描 / 事件派发| B[Userscript 油猴脚本 v51]
    B <-->|WebSocket / HTTPS / HTTP| C[Python FastAPI 后端 (8000端口)]
    C <-->|模糊匹配 / 选项校验| D[(Excel 题库 final.xlsx / SQLite)]
    E[桌面: 开关考试助手.command] <-->|进程管理 & 端口释放| C
    E <-->|Swift API 动态更换图标| F[Mac 桌面图标 (🟢 ON / 🔴 OFF)]
```

---

## 3. 核心文件结构与路径清单

所有核心代码均存放在工作区 `/Users/julian/antigravity/DZZ/` 下：

| 文件 / 路径 | 说明 | 核心职责 |
| :--- | :--- | :--- |
| [userscript/exam_assistant.user.js](file:///Users/julian/antigravity/DZZ/userscript/exam_assistant.user.js) | 油猴用户脚本 (v51) | 题干/选项自动提取、WebSocket/HTTP 搜索通信、DOM 自动勾选、3s 托管切题、科技感浮窗 UI |
| [server/main.py](file:///Users/julian/antigravity/DZZ/server/main.py) | Python 后端主程序 | 基于 FastAPI & RapidFuzz 构建，读取 `~/Downloads/final.xlsx` 题库，提供 WSS/HTTP 搜索接口 |
| [start.sh](file:///Users/julian/antigravity/DZZ/start.sh) | 后端守护启动脚本 | 负责激活虚拟环境 `venv`，清理 8000 端口，并以守护模式启动 `main.py` |
| [set_icon.swift](file:///Users/julian/antigravity/DZZ/set_icon.swift) | macOS 动态图标切换工具 | 基于 Cocoa AppKit 原生 `NSWorkspace` API，瞬间更换桌面文件的显示图标 |
| [generate_icons.py](file:///Users/julian/antigravity/DZZ/generate_icons.py) | 图标生成脚本 | 使用 Pillow 库绘制高清发光 `on.png` (绿) 与 `off.png` (红) |
| [/Users/julian/Desktop/开关考试助手.command](file:///Users/julian/Desktop/开关考试助手.command) | macOS 桌面控制脚本 | **双击一键启停**。带彩色终端高亮输出、Mac 系统 Notification 弹窗及桌面图标颜色实时切换 |

---

## 4. 核心功能与演进履历

### v51.0 (最新稳定版 - 已推送到 GitHub `main` 分支)
1. **恢复最稳自动打钩引擎**：基于 v24 经典 `body *` 全局提取算法，解除宽泛标签限制，完美兼容所有自定义样式 Radio/Checkbox 节点。
2. **剥离前导图标与字符**：自动剔除选项前面的 `○` `●` 等图标符号及全角句号 `．`，解决 `○ A. 冲洗法` 匹配失败的问题。
3. **单次派发防双跳 (`singleClick`)**：解耦 jQuery `.trigger('click')`、原生 `.click()` 及 `MouseEvent` 的三重叠加派发，彻底解决“点击一次切 2 题”的历史痛点。
4. **炫酷 UI 开关**：油猴面板开关支持 ON (绿/蓝光) 与 OFF (暗红) 动态样式。

---

## 5. 关键踩坑经验与解决方案 (必读)

新对话在续写或修改代码时，请务必注意以下已踩过的坑：

### ❌ 坑 1：进程重复启动导致 CPU 发热耗电
- **现象**：`start.sh` 被多次调用，后台出现多个死循环重试绑定 8000 端口的 `start.sh` 进程，CPU 飙升，笔记本发热严重。
- **解法**：始终使用 `manage_task` 管理后台任务，或双击桌面 [开关考试助手.command](file:///Users/julian/Desktop/开关考试助手.command) 彻底清理 PID (`pkill -9 -f main.py` 和 `kill -9 $(lsof -ti:8000)`)。

### ❌ 坑 2：一次切题跳 2 道题
- **现象**：点击“下一题”时，页面瞬间连跳 2 题。
- **解法**：不能在同一个节点上同时调用 `jQuery.trigger('click')` + `element.click()` + `dispatchEvent(MouseEvent)`。现由 `singleClick()` 函数控制：优先触发 jQuery，若成功即 return，严禁多重触发。

### ❌ 坑 3：题号识别被左侧答题卡干扰
- **现象**：`getCurrentQuestionNumber()` 把左侧答题卡的数字 1 误认为是当前题号，导致一直在重复点第 2 题格子。
- **解法**：题干提取必须排除侧边栏区域（通过 `rect.left > 160` 或选择器限定中央题目框 `.question-item`）。

### ❌ 坑 4：选项带有 `○` 符号导致匹配失败
- **现象**：网页选项文本为 `○ A. 冲洗法`，导致 `text.startsWith("A.")` 校验为 false。
- **解法**：正则剥离前导非字母字符：`text.replace(/^[^A-Za-z（(对错正确√×\d]+/, '')`。

---

## 6. 运行与部署指南

### 1) 启动与关闭后端
直接双击 macOS 桌面上的快捷文件：
👉 [/Users/julian/Desktop/开关考试助手.command](file:///Users/julian/Desktop/开关考试助手.command)

- **启动**：桌面图标自动变为 **🟢 ON** 亮绿光圈，终端高亮显示 `🟢【启动状态】`。
- **关闭**：桌面图标自动变为 **🔴 OFF** 暗红警告圈，终端高亮显示 `🔴【关闭状态】`，释放 8000 端口与 CPU 资源。

### 2) 前端油猴脚本安装
1. 打开 Chrome 扩展 **Tampermonkey**。
2. 将 [exam_assistant.user.js](file:///Users/julian/antigravity/DZZ/userscript/exam_assistant.user.js) 的全部内容复制粘贴到脚本编辑器中保存。
3. 刷新 `ks.kyexam.com` 考试页面即可自动浮现控制面板。

---

## 7. Android 移动端扩展方案规划

若后续需将项目移植到 Android 手机端，推荐方案如下：

1. **网页端考试**：
   - **浏览器**：Kiwi Browser (支持 Tampermonkey 插件)。
   - **前端脚本**：直接加载当前 `exam_assistant.user.js`。
   - **手机后端**：在 Android 上安装 **Termux**，运行 Python FastAPI 本地监听 `127.0.0.1:8000`；或部署在云服务器开启 HTTPS。
2. **原生 App 考试**：
   - 使用 **Auto.js / AutoX.js** 基于 Android 无障碍服务 (`AccessibilityService`) 读取界面节点树，结合手机端搜题 API 实现自动点击。

### v89.0 (最新稳定版 - 已推送到 GitHub `premium-version` 分支)
1. **彻底解决 47 题与多选题勾选失灵**：单次派发 (`singleClick`) 结合已勾选识别，完美防 Toggle 连击取消。
2. **kyexam 专属 `z-checked` 深层识别**：递归扫描选项节点及其所有子节点的 `z-checked` / `z-sel` / `is-checked` / `selected` 类名，实现已做题目的正确答案**绝对锁死保护**（绝不二次点击取消）。
3. **判断题 `correct` / `wrong` 自动映射**：自动解包云端返回的 `correct` 锁定 A (对)，`wrong` 锁定 B (错)。
4. **云端在线 175.178.78.88 直连 + 详细选项内容展开**：直连公网在线服务器，渲染展示每一项选项的完整文字内容。

---

*文档更新时间：2026-07-30*
*Git 最新 Commit: 74c6515 (Branch: premium-version)*

