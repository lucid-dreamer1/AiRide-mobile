package com.anonymous.airidenative.vosk

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class VoskModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "VoskModule"
    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false

    override fun getName(): String = "VoskModule"

    private fun sendEvent(eventName: String, params: String) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun initModel(modelPath: String, promise: Promise) {
        Log.d(TAG, "initModel called (using Android SpeechRecognizer, modelPath ignored)")
        
        if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
            promise.reject("SPEECH_NOT_AVAILABLE", "Speech recognition not available on this device")
            return
        }
        
        promise.resolve("Model ready (Android SpeechRecognizer)")
    }

    @ReactMethod
    fun startListening() {
        Log.d(TAG, "startListening called")
        
        if (isListening) {
            Log.d(TAG, "Already listening, ignoring")
            return
        }

        val permission = ContextCompat.checkSelfPermission(
            reactApplicationContext,
            Manifest.permission.RECORD_AUDIO
        )
        
        if (permission != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "RECORD_AUDIO permission not granted")
            sendEvent("onVoskError", "Permesso microfono non concesso")
            return
        }

        try {
            UiThreadUtil.runOnUiThread {
                try {
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext)
                    
                    speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            Log.d(TAG, "onReadyForSpeech")
                            isListening = true
                        }

                        override fun onBeginningOfSpeech() {
                            Log.d(TAG, "onBeginningOfSpeech")
                        }

                        override fun onRmsChanged(rmsdB: Float) {}

                        override fun onBufferReceived(buffer: ByteArray?) {}

                        override fun onEndOfSpeech() {
                            Log.d(TAG, "onEndOfSpeech")
                        }

                        override fun onError(error: Int) {
                            val errorMessage = when (error) {
                                SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                                SpeechRecognizer.ERROR_CLIENT -> "Client side error"
                                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                                SpeechRecognizer.ERROR_NETWORK -> "Network error"
                                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                                SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
                                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                                SpeechRecognizer.ERROR_SERVER -> "Server error"
                                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
                                else -> "Unknown error: $error"
                            }
                            Log.e(TAG, "onError: $errorMessage")
                            isListening = false
                            sendEvent("onVoskError", errorMessage)
                        }

                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = matches?.firstOrNull() ?: ""
                            Log.d(TAG, "onResults: $text")
                            isListening = false
                            
                            val json = JSONObject()
                            json.put("text", text)
                            sendEvent("onVoskResult", json.toString())
                        }

                        override fun onPartialResults(partialResults: Bundle?) {
                            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = matches?.firstOrNull() ?: ""
                            Log.d(TAG, "onPartialResults: $text")
                        }

                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })

                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT")
                        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    }

                    speechRecognizer?.startListening(intent)
                    Log.d(TAG, "Started listening with Android SpeechRecognizer")
                    
                } catch (e: Exception) {
                    Log.e(TAG, "Error starting speech recognizer", e)
                    sendEvent("onVoskError", e.message ?: "Unknown error")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in startListening", e)
            sendEvent("onVoskError", e.message ?: "Unknown error")
        }
    }

    @ReactMethod
    fun stopListening() {
        Log.d(TAG, "stopListening called")
        isListening = false
        
        UiThreadUtil.runOnUiThread {
            try {
                speechRecognizer?.stopListening()
                speechRecognizer?.destroy()
                speechRecognizer = null
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping speech recognizer", e)
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }
}
