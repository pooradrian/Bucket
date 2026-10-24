package com.bucket

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object NativeCrashHandler {
  private const val DIR = "crash_recovery"
  private const val FILE = "native_crash_marker.txt"

  fun install(context: Context) {
    val appContext = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    if (previous is CrashHandler) return
    Thread.setDefaultUncaughtExceptionHandler(CrashHandler(appContext, previous))
  }

  private class CrashHandler(
    private val context: Context,
    private val previous: Thread.UncaughtExceptionHandler?,
  ) : Thread.UncaughtExceptionHandler {
    override fun uncaughtException(thread: Thread, throwable: Throwable) {
      try {
        write(thread, throwable)
      } catch (_: Throwable) {
      }
      previous?.uncaughtException(thread, throwable)
    }

    private fun write(thread: Thread, throwable: Throwable) {
      val dir = File(context.filesDir, DIR)
      if (!dir.exists()) dir.mkdirs()

      val version = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
      } catch (_: Throwable) {
        ""
      }

      val report = JSONObject()
        .put("timestamp", isoNow())
        .put("kind", "crash")
        .put("context", "Native (${thread.name})")
        .put("errorName", throwable.javaClass.name)
        .put("errorMessage", throwable.message ?: "")
        .put("errorStack", throwable.stackTraceToString())
        .put("appVersion", version)
        .put("platform", "android ${Build.VERSION.SDK_INT}")
        .put("events", JSONArray())

      FileOutputStream(File(dir, FILE)).use {
        it.write(report.toString().toByteArray(Charsets.UTF_8))
      }
    }
  }

  private fun isoNow(): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())
}
