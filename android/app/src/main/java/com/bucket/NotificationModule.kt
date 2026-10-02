package com.bucket

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private val stopPlayer = Runnable { releasePlayer() }

    override fun getName(): String = "NotificationModule"

    @ReactMethod
    fun playNotificationSound(uri: String?) {
        val ctx = reactApplicationContext
        try {
            releasePlayer()
            val source = if (uri.isNullOrEmpty()) {
                val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_NOTIFICATION)
                } else {
                    null
                }
                resolved ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            } else {
                Uri.parse(uri)
            } ?: return
            val next = MediaPlayer()
            player = next
            next.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            next.setOnCompletionListener { releasePlayer() }
            next.setDataSource(ctx, source)
            next.prepare()
            next.start()
            mainHandler.postDelayed(stopPlayer, MAX_PLAYBACK_MS)
        } catch (e: Exception) {
            releasePlayer()
        }
    }

    override fun invalidate() {
        releasePlayer()
        super.invalidate()
    }

    private fun releasePlayer() {
        mainHandler.removeCallbacks(stopPlayer)
        val current = player ?: return
        player = null
        runCatching { current.stop() }
        runCatching { current.release() }
    }

    @ReactMethod
    fun vibrate() {
        val ctx = reactApplicationContext
        val vibrator = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        try {
            vibrator.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (e: Exception) {
            // Silently fail
        }
    }

    companion object {
        private const val MAX_PLAYBACK_MS = 30_000L
    }
}
