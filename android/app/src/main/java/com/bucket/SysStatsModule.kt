package com.bucket

import android.os.Debug
import android.os.Process
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.RandomAccessFile

class SysStatsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SysStats"

    @ReactMethod
    fun getMemoryInfo(promise: Promise) {
        try {
            val runtime = Runtime.getRuntime()
            val maxMemory = runtime.maxMemory()
            val totalMemory = runtime.totalMemory()
            val freeMemory = runtime.freeMemory()
            val usedMemory = totalMemory - freeMemory

            val nativeHeapAllocated = Debug.getNativeHeapAllocatedSize()
            val nativeHeapSize = Debug.getNativeHeapSize()

            val result = Arguments.createMap()
            result.putDouble("jsHeapUsed", usedMemory.toDouble() / 1024 / 1024)
            result.putDouble("jsHeapTotal", totalMemory.toDouble() / 1024 / 1024)
            result.putDouble("jsHeapMax", maxMemory.toDouble() / 1024 / 1024)
            result.putDouble("nativeHeapAllocated", nativeHeapAllocated.toDouble() / 1024 / 1024)
            result.putDouble("nativeHeapTotal", nativeHeapSize.toDouble() / 1024 / 1024)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("MEMORY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getCpuTime(promise: Promise) {
        try {
            val file = File("/proc/self/stat")
            if (!file.exists()) {
                promise.reject("CPU_ERROR", "/proc/self/stat not available")
                return
            }
            val reader = RandomAccessFile(file, "r")
            val line = reader.readLine()
            reader.close()

            val parts = line.split(" ")
            // utime (index 13) and stime (index 14) in clock ticks
            val utime = parts[13].toLong()
            val stime = parts[14].toLong()
            val totalCpuTime = utime + stime

            val numProcessors = Runtime.getRuntime().availableProcessors()
            val clockTicks = try {
                val clkTckFile = File("/proc/sys/kernel/clk_tck")
                if (clkTckFile.exists()) {
                    val clkReader = RandomAccessFile(clkTckFile, "r")
                    val clkVal = clkReader.readLine().trim().toLong()
                    clkReader.close()
                    clkVal
                } else {
                    100L
                }
            } catch (_: Exception) {
                100L
            }

            val result = Arguments.createMap()
            result.putDouble("cpuTimeMs", totalCpuTime * (1000.0 / clockTicks))
            result.putInt("numProcessors", numProcessors)
            result.putDouble("clockTicks", clockTicks.toDouble())
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CPU_ERROR", e.message)
        }
    }
}
