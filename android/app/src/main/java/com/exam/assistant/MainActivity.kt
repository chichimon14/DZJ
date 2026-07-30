package com.exam.assistant

import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var btnReinject: Button
    private lateinit var btnRefresh: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        btnReinject = findViewById(R.id.btnReinject)
        btnRefresh = findViewById(R.id.btnRefresh)

        setupWebView()

        btnReinject.setOnClickListener {
            injectUserscript()
            Toast.makeText(this, "⚡ 正在重新注入考试助手脚本...", Toast.LENGTH_SHORT).show()
        }

        btnRefresh.setOnClickListener {
            webView.reload()
        }

        val targetUrl = intent.getStringExtra("EXTRA_URL") ?: "http://ks.kyexam.com"
        webView.loadUrl(targetUrl)
    }

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // 1. 微信 User-Agent 伪装
        val defaultUa = settings.userAgentString
        settings.userAgentString = "$defaultUa MicroMessenger/8.0.38(0x28002637) NetType/WIFI Language/zh_CN"

        // 2. 启用 Cookie
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                // 页面加载完成后注入考试助手 Userscript
                injectUserscript()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress == 100) {
                    progressBar.visibility = View.GONE
                }
            }
        }
    }

    private fun injectUserscript() {
        try {
            val inputStream = assets.open("exam_assistant.user.js")
            val jsContent = inputStream.bufferedReader().use { it.readText() }
            webView.evaluateJavascript(jsContent, null)
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "注入脚本失败: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
