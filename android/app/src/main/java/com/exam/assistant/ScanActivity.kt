package com.exam.assistant

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView

class ScanActivity : AppCompatActivity() {

    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var etUrl: EditText
    private lateinit var btnOpenUrl: Button

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scan)

        etUrl = findViewById(R.id.etUrl)
        btnOpenUrl = findViewById(R.id.btnOpenUrl)

        // 按钮监听：手动输入 URL 进入
        btnOpenUrl.setOnClickListener {
            val url = etUrl.text.toString().trim()
            if (url.isNotEmpty()) {
                openWebExam(url)
            } else {
                Toast.makeText(this, "请输入或粘贴有效考试网址", Toast.LENGTH_SHORT).show()
            }
        }

        checkCameraPermission()
    }

    private fun checkCameraPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_REQUEST
            )
        } else {
            initScanner()
        }
    }

    private fun initScanner() {
        try {
            barcodeView = findViewById(R.id.previewView)
            barcodeView.decodeContinuous(object : BarcodeCallback {
                override fun barcodeResult(result: BarcodeResult?) {
                    result?.text?.let { url ->
                        barcodeView.pause()
                        vibrateFeedback()
                        Toast.makeText(this@ScanActivity, "解析成功，跳转答题中...", Toast.LENGTH_SHORT).show()
                        openWebExam(url)
                    }
                }

                override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>?) {}
            })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun vibrateFeedback() {
        try {
            val vibrator = getSystemService(VIBRATOR_SERVICE) as? android.os.Vibrator
            if (vibrator != null && vibrator.hasVibrator()) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    vibrator.vibrate(android.os.VibrationEffect.createOneShot(100, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(100)
                }
            }
        } catch (e: Exception) {}
    }

    private fun openWebExam(rawUrl: String) {
        var finalUrl = rawUrl
        if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
            finalUrl = "http://$finalUrl"
        }
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("EXTRA_URL", finalUrl)
        }
        startActivity(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::barcodeView.isInitialized) {
            barcodeView.resume()
        }
    }

    override fun onPause() {
        super.onPause()
        if (::barcodeView.isInitialized) {
            barcodeView.pause()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                initScanner()
            } else {
                Toast.makeText(this, "需要相机权限方可进行扫码", Toast.LENGTH_LONG).show()
            }
        }
    }
}
