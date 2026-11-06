package com.bucket

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Records 16 kHz mono 16-bit PCM straight into a WAV file. WAV is the one
 * container (besides mp3) OpenAI-style `input_audio` parts accept, and it needs
 * no encoder.
 */
class AudioRecorderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val sampleRate = 16000
    private val maxMs = 5 * 60 * 1000L

    private var record: AudioRecord? = null
    private var thread: Thread? = null
    private var file: File? = null
    private var startedAt = 0L
    @Volatile private var running = false

    override fun getName(): String = "AudioRecorderModule"

    @ReactMethod
    @Synchronized
    fun start(promise: Promise) {
        val ctx = reactApplicationContext
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("E_PERMISSION", "Microphone permission is not granted")
            return
        }
        if (running) {
            promise.reject("E_BUSY", "Already recording")
            return
        }
        try {
            val minBuf = AudioRecord.getMinBufferSize(
                sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            val bufSize = maxOf(minBuf, sampleRate)
            val rec = AudioRecord(
                MediaRecorder.AudioSource.MIC, sampleRate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                promise.reject("E_INIT", "Could not open the microphone")
                return
            }
            val out = File.createTempFile("voice", ".wav", ctx.cacheDir)
            val raf = RandomAccessFile(out, "rw")
            raf.setLength(0)
            raf.write(ByteArray(44))
            record = rec
            file = out
            running = true
            startedAt = System.currentTimeMillis()
            rec.startRecording()
            thread = Thread {
                val buf = ByteArray(bufSize)
                try {
                    while (running && System.currentTimeMillis() - startedAt < maxMs) {
                        val n = rec.read(buf, 0, buf.size)
                        if (n > 0) raf.write(buf, 0, n) else if (n < 0) break
                    }
                } catch (_: Exception) {
                } finally {
                    try {
                        val dataLen = (raf.length() - 44).toInt()
                        raf.seek(0)
                        raf.write(wavHeader(dataLen))
                        raf.close()
                    } catch (_: Exception) {
                    }
                }
            }.also { it.start() }
            promise.resolve(null)
        } catch (e: Exception) {
            teardown(delete = true)
            promise.reject("E_START", e.message, e)
        }
    }

    @ReactMethod
    @Synchronized
    fun stop(promise: Promise) {
        val out = file
        if (!running || out == null) {
            promise.reject("E_IDLE", "Not recording")
            return
        }
        val duration = System.currentTimeMillis() - startedAt
        teardown(delete = false)
        val map = Arguments.createMap()
        map.putString("path", out.absolutePath)
        map.putDouble("durationMs", minOf(duration, maxMs).toDouble())
        promise.resolve(map)
    }

    @ReactMethod
    @Synchronized
    fun cancel(promise: Promise) {
        teardown(delete = true)
        promise.resolve(null)
    }

    override fun invalidate() {
        teardown(delete = true)
        super.invalidate()
    }

    private fun teardown(delete: Boolean) {
        running = false
        try {
            record?.stop()
        } catch (_: Exception) {
        }
        // Wait for the writer so the WAV header is patched before JS reads it.
        try {
            thread?.join(2000)
        } catch (_: InterruptedException) {
        }
        record?.release()
        record = null
        thread = null
        if (delete) file?.delete()
        file = if (delete) null else file
    }

    private fun wavHeader(dataLen: Int): ByteArray {
        val byteRate = sampleRate * 2
        return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray())
            putInt(36 + dataLen)
            put("WAVE".toByteArray())
            put("fmt ".toByteArray())
            putInt(16)
            putShort(1)
            putShort(1)
            putInt(sampleRate)
            putInt(byteRate)
            putShort(2)
            putShort(16)
            put("data".toByteArray())
            putInt(dataLen)
        }.array()
    }
}
