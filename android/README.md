# 📱 网页考试助手 Android 原生 App

> **包名**：`com.exam.assistant`  
> **版本**：v95.0.0 (引擎同步更新至 Userscript v95)  
> **定位**：专为微信扫码登录/移动端网页考试打造的 Android 自动化答题原生应用。

---

## 🌟 核心特性

1. **📷 CameraX 扫码极速登录**：
   打开 App 即开启极速相机扫描，识别微信登录二维码 / 考试网页二维码后秒级跳转至答题浏览器。
2. **🌐 微信 User-Agent 伪装**：
   自带 `MicroMessenger/8.0.38` User-Agent 伪装，完美绕过绝大多数考试平台“必须在微信内置浏览器内打开”的限制。
3. **⚡ 原生嵌入 v95 搜题引擎**：
   页面加载完毕后自动注入最稳的 `exam_assistant.user.js` 引擎，直连云端 `175.178.78.88` 服务器，在手机端实现**闪电搜题 + 智能勾选 + 3s切题**。
4. **🔒 智能答案保护与错选撤销**：
   继承桌面版所有的深层选框校验 (`z-checked` / `z-sel`)、重映射校验与误勾选撤销逻辑。

---

## 📁 目录结构

```text
android/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── assets/
│   │   │   │   └── exam_assistant.user.js   # 打包内置的 v95 油猴脚本
│   │   │   ├── java/com/exam/assistant/
│   │   │   │   ├── MainActivity.kt          # WebView 答题与脚本注入 Activity
│   │   │   │   └── ScanActivity.kt          # CameraX 扫码入口 Activity
│   │   │   ├── res/                         # 布局、图标与样式
│   │   │   └── AndroidManifest.xml          # 权限与配置
│   └── build.gradle                         # 模块构建脚本
├── build.gradle                             # 全局构建脚本
└── settings.gradle                          # 项目设置
```

---

## 🛠️ 如何编译打包 APK

1. 用 **Android Studio (Hedgehog 或更高版本)** 打开 `dzz/android` 目录。
2. 首次打开会自动 Sync 下载 Gradle 依赖。
3. 连接安卓手机或选择模拟器，点击 `Run 'app'` 即可直接运行在手机上。
4. 打包 APK：在菜单栏选择 `Build -> Build Bundle(s) / APK(s) -> Build APK(s)` 即可在 `app/build/outputs/apk/debug/` 目录下生成 APK 安装包。

---

## 🚀 使用流程

1. **扫码**：打开 App，对准考试二维码或微信网页登录二维码；或者在下方输入框中直接粘贴考试网址。
2. **登录**：在 App 内置浏览器中完成登录并进入考试答题界面。
3. **搜题答题**：脚本会自动注入，页面右上角将浮现控制面板，自动完成题目辨识与打钩勾选！
