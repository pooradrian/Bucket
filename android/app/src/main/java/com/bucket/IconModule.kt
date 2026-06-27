package com.bucket

import android.content.ComponentName
import android.content.pm.PackageManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class IconModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "IconModule"

    @ReactMethod
    fun setIcon(mode: String) {
        val ctx = reactApplicationContext
        val pm = ctx.packageManager
        val pkg = ctx.packageName

        val dark = ComponentName(pkg, "$pkg.MainActivityDark")
        val light = ComponentName(pkg, "$pkg.MainActivityLight")

        if (mode == "dark") {
            pm.setComponentEnabledSetting(dark, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            pm.setComponentEnabledSetting(light, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        } else {
            pm.setComponentEnabledSetting(dark, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
            pm.setComponentEnabledSetting(light, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        }
    }
}
