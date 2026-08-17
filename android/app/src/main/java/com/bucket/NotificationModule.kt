package com.bucket

import android.content.Context
import android.media.RingtoneManager
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NotificationModule"

    @ReactMethod
    fun playNotificationSound(uri: String?) {
        val ctx = reactApplicationContext
        try {
            val ringtoneUri = if (uri.isNullOrEmpty()) {
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            } else {
                Uri.parse(uri)
            }
            val ringtone = RingtoneManager.getRingtone(ctx, ringtoneUri)
            ringtone?.play()
        } catch (e: Exception) {
            // Silently fail if sound can't be played
        }
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
}
