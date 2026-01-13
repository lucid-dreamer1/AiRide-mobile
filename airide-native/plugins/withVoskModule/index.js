const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin per VoskModule
 * Aggiunge automaticamente il modulo nativo VoskModule dopo ogni prebuild
 */

const VOSK_MODULE_CODE = `package com.anonymous.airidenative.vosk

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
`;

const VOSK_PACKAGE_CODE = `package com.anonymous.airidenative.vosk

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class VoskPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(VoskModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;

function withVoskModule(config) {
  // Step 1: Add VoskModule files and copy assets
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const voskDir = path.join(
        projectRoot,
        'android/app/src/main/java/com/anonymous/airidenative/vosk'
      );

      // Create vosk directory
      if (!fs.existsSync(voskDir)) {
        fs.mkdirSync(voskDir, { recursive: true });
      }

      // Write VoskModule.kt
      fs.writeFileSync(
        path.join(voskDir, 'VoskModule.kt'),
        VOSK_MODULE_CODE
      );

      // Write VoskPackage.kt
      fs.writeFileSync(
        path.join(voskDir, 'VoskPackage.kt'),
        VOSK_PACKAGE_CODE
      );

      console.log('[withVoskModule] ✓ VoskModule files created');

      // Copy Porcupine assets
      const assetsDir = path.join(projectRoot, 'android/app/src/main/assets');
      const porcupineAssetsDir = path.join(projectRoot, 'assets/porcupine');

      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      // Copy porcupine_params_it.pv if exists
      const porcupineModel = path.join(porcupineAssetsDir, 'porcupine_params_it.pv');
      if (fs.existsSync(porcupineModel)) {
        fs.copyFileSync(porcupineModel, path.join(assetsDir, 'porcupine_params_it.pv'));
        console.log('[withVoskModule] ✓ porcupine_params_it.pv copied');
      }

      // Copy Hey-Casco keyword file if exists
      const keywordFile = path.join(porcupineAssetsDir, 'Hey-Casco_it_android_v4_0_0.ppn');
      if (fs.existsSync(keywordFile)) {
        fs.copyFileSync(keywordFile, path.join(assetsDir, 'Hey-Casco_it_android_v4_0_0.ppn'));
        console.log('[withVoskModule] ✓ Hey-Casco keyword file copied');
      }

      return config;
    },
  ]);

  // Step 2: Modify MainApplication.kt to include VoskPackage
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if VoskPackage is already added
    if (!contents.includes('VoskPackage')) {
      // Find the packages apply block and add VoskPackage
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{([^}]*)\}/,
        `PackageList(this).packages.apply {$1
              add(com.anonymous.airidenative.vosk.VoskPackage())
            }`
      );
      config.modResults.contents = contents;
      console.log('[withVoskModule] ✓ VoskPackage added to MainApplication');
    }

    return config;
  });

  return config;
}

module.exports = withVoskModule;
