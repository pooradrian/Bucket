package com.bucket

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Debug-only bridge that runs in-app debugger commands sent over USB:
 *
 *   adb shell am broadcast -a com.bucket.DEBUG -p com.bucket --es cmd 'settings'
 *
 * The command output comes back as the broadcast result data (printed by
 * `am broadcast`) and is also written to logcat under the BucketUsb tag.
 * Senders must hold android.permission.DUMP, which `adb shell` has and normal
 * apps cannot get. This file only exists in the debug source set.
 */
class UsbDebugModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pending = HashMap<Int, BroadcastReceiver.PendingResult>()
    private var nextId = 1
    private var registered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val cmd = intent.getStringExtra("cmd")
            if (cmd.isNullOrBlank()) {
                resultCode = Activity.RESULT_CANCELED
                resultData = "usage: am broadcast -a $ACTION -p ${context.packageName} --es cmd '<debugger command>'"
                return
            }
            val result = goAsync()
            val id: Int
            synchronized(pending) {
                id = nextId++
                pending[id] = result
            }
            mainHandler.postDelayed({
                finish(id, Activity.RESULT_CANCELED,
                    "timed out after ${TIMEOUT_MS / 1000}s; the command may still be running " +
                        "(its output will appear in: adb logcat -s $TAG)")
            }, TIMEOUT_MS)
            val params = Arguments.createMap().apply {
                putInt("id", id)
                putString("cmd", cmd)
            }
            Log.i(TAG, "#$id $ $cmd")
            reactApplicationContext.emitDeviceEvent(EVENT, params)
        }
    }

    override fun getName(): String = "UsbDebugModule"

    @ReactMethod
    fun start() {
        if (registered) return
        ContextCompat.registerReceiver(
            reactApplicationContext,
            receiver,
            IntentFilter(ACTION),
            android.Manifest.permission.DUMP,
            null,
            ContextCompat.RECEIVER_EXPORTED,
        )
        registered = true
        Log.i(TAG, "listening for $ACTION")
    }

    @ReactMethod
    fun reply(id: Int, ok: Boolean, text: String) {
        text.chunked(LOG_CHUNK).forEach { Log.i(TAG, "#$id $it") }
        finish(id, if (ok) Activity.RESULT_OK else Activity.RESULT_FIRST_USER, text)
    }

    private fun finish(id: Int, code: Int, text: String) {
        val result = synchronized(pending) { pending.remove(id) } ?: return
        result.resultCode = code
        result.resultData =
            if (text.length > MAX_RESULT) text.take(MAX_RESULT) + "\n… truncated, full output: adb logcat -s $TAG" else text
        result.finish()
    }

    override fun invalidate() {
        if (registered) {
            try {
                reactApplicationContext.unregisterReceiver(receiver)
            } catch (_: IllegalArgumentException) {}
            registered = false
        }
        synchronized(pending) {
            pending.values.forEach { it.finish() }
            pending.clear()
        }
        super.invalidate()
    }

    companion object {
        const val ACTION = "com.bucket.DEBUG"
        const val EVENT = "UsbDebugCommand"
        const val TAG = "BucketUsb"
        private const val TIMEOUT_MS = 45_000L
        private const val MAX_RESULT = 60_000
        private const val LOG_CHUNK = 3_000
    }
}
