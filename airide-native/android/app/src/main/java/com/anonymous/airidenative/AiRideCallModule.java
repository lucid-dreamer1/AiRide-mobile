package com.anonymous.airidenative;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.telecom.TelecomManager;
import androidx.core.app.ActivityCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class AiRideCallModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;
    private android.telephony.TelephonyManager telephonyManager;
    private android.telephony.PhoneStateListener phoneStateListener;
    private boolean isListenerRegistered = false;
    private int previousCallState = android.telephony.TelephonyManager.CALL_STATE_IDLE;
    private String lastKnownCallerName = "";
    private boolean wasRejectedOrHungUp = false;

    // Watchdog per rilevare con certezza assoluta la fine delle chiamate in uscita/entrata
    // anche quando il Dialer nativo è in primo piano o su Android 12+
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean watchdogActive = false;
    private long callInitiatedTimestamp = 0;
    private boolean callReachedActiveState = false;

    public AiRideCallModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        
        // Initialize Telephony Manager
        telephonyManager = (android.telephony.TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);

        // Run on Main Thread to avoid Looper errors with PhoneStateListener
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                ensurePhoneStateListener();
            }
        });
    }

    private void ensurePhoneStateListener() {
        try {
            if (phoneStateListener == null) {
                phoneStateListener = new android.telephony.PhoneStateListener() {
                    @Override
                    public void onCallStateChanged(int state, String incomingNumber) {
                        super.onCallStateChanged(state, incomingNumber);
                        handleHardwareCallStateChange(state, incomingNumber);
                    }
                };
            }
            if (telephonyManager != null && !isListenerRegistered) {
                if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                    telephonyManager.listen(phoneStateListener, android.telephony.PhoneStateListener.LISTEN_CALL_STATE);
                    isListenerRegistered = true;
                    android.util.Log.d("AiRideCallModule", "PhoneStateListener registered successfully");
                }
            }
        } catch (Exception e) {
            android.util.Log.e("AiRideCallModule", "Failed to register PhoneStateListener", e);
        }
    }

    private void handleHardwareCallStateChange(int state, String incomingNumber) {
        String stateStr = "UNKNOWN";
        int status = 0; // 0=Idle, 1=Ringing, 2=Active, 3=Ended/Rejected, 4=Outgoing, 5=Missed

        if (incomingNumber != null && !incomingNumber.trim().isEmpty()) {
            String resolved = resolveContactName(incomingNumber.trim());
            if (resolved != null && !resolved.isEmpty()) {
                lastKnownCallerName = resolved;
            } else if (lastKnownCallerName.isEmpty()) {
                lastKnownCallerName = incomingNumber.trim();
            }
        }

        // Ignora l'evento IDLE iniziale emesso da Android subito dopo la registrazione del listener
        if (state == android.telephony.TelephonyManager.CALL_STATE_IDLE &&
            previousCallState == android.telephony.TelephonyManager.CALL_STATE_IDLE &&
            !watchdogActive) {
            return;
        }

        switch (state) {
            case android.telephony.TelephonyManager.CALL_STATE_RINGING:
                stateStr = "RINGING";
                status = 1; // Chiamata in arrivo
                wasRejectedOrHungUp = false;
                if (lastKnownCallerName.isEmpty()) {
                    lastKnownCallerName = "Chiamata";
                }
                startCallWatchdog();
                break;

            case android.telephony.TelephonyManager.CALL_STATE_OFFHOOK:
                stateStr = "OFFHOOK";
                status = 2; // Chiamata attiva / in corso
                callReachedActiveState = true;
                if (lastKnownCallerName.isEmpty()) {
                    lastKnownCallerName = "In corso";
                }
                startCallWatchdog();
                break;

            case android.telephony.TelephonyManager.CALL_STATE_IDLE:
                stateStr = "IDLE";
                stopCallWatchdog();
                if (previousCallState == android.telephony.TelephonyManager.CALL_STATE_RINGING) {
                    // Se squillava ed è tornato IDLE senza risposta: Rifiutata (3) o Persa (5)
                    status = wasRejectedOrHungUp ? 3 : 5;
                } else if (previousCallState == android.telephony.TelephonyManager.CALL_STATE_OFFHOOK || callReachedActiveState) {
                    // Era attiva o in composizione ed è terminata
                    status = 3;
                } else {
                    status = 0;
                }
                break;
        }

        previousCallState = state;
        final String callerSnapshot = lastKnownCallerName;
        android.util.Log.d("AiRideCallModule", "State: " + stateStr + " (status=" + status + ", caller=" + callerSnapshot + ")");

        emitCallStatus(status, incomingNumber != null ? incomingNumber : "", callerSnapshot);

        if (state == android.telephony.TelephonyManager.CALL_STATE_IDLE) {
            lastKnownCallerName = "";
            wasRejectedOrHungUp = false;
            callReachedActiveState = false;
            if (status == 3 || status == 5) {
                final int clearDelay = (status == 5) ? 4000 : 3000;
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (previousCallState == android.telephony.TelephonyManager.CALL_STATE_IDLE && !watchdogActive) {
                            emitCallStatus(0, "", "");
                        }
                    }
                }, clearDelay);
            }
        }
    }

    private final Runnable callWatchdogRunnable = new Runnable() {
        @Override
        public void run() {
            if (!watchdogActive) return;
            try {
                ensurePhoneStateListener();

                android.media.AudioManager audioManager = (android.media.AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
                int audioMode = (audioManager != null) ? audioManager.getMode() : android.media.AudioManager.MODE_NORMAL;
                boolean audioInCall = (audioMode == android.media.AudioManager.MODE_IN_CALL ||
                                       audioMode == android.media.AudioManager.MODE_IN_COMMUNICATION ||
                                       audioMode == android.media.AudioManager.MODE_RINGTONE);

                int tmState = android.telephony.TelephonyManager.CALL_STATE_IDLE;
                if (telephonyManager != null &&
                    ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                    tmState = telephonyManager.getCallState();
                }

                boolean telecomInCall = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                    ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                    TelecomManager tm = (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
                    if (tm != null) {
                        telecomInCall = tm.isInCall();
                    }
                }

                boolean anyCallActive = audioInCall || telecomInCall || (tmState != android.telephony.TelephonyManager.CALL_STATE_IDLE);
                long elapsedSinceStart = System.currentTimeMillis() - callInitiatedTimestamp;

                if (anyCallActive) {
                    if (!callReachedActiveState && (tmState == android.telephony.TelephonyManager.CALL_STATE_OFFHOOK ||
                        audioMode == android.media.AudioManager.MODE_IN_CALL ||
                        audioMode == android.media.AudioManager.MODE_IN_COMMUNICATION ||
                        telecomInCall)) {
                        callReachedActiveState = true;
                        previousCallState = android.telephony.TelephonyManager.CALL_STATE_OFFHOOK;
                        emitCallStatus(2, "", lastKnownCallerName.isEmpty() ? "In corso" : lastKnownCallerName);
                    }
                } else {
                    // Nessuna chiamata rilevata: se avevamo già agganciato la chiamata o sono passati > 4.5s dall'avvio composizione, la chiamata è stata chiusa!
                    if (callReachedActiveState || elapsedSinceStart > 4500) {
                        android.util.Log.d("AiRideCallModule", "Watchdog detected call ended (elapsed=" + elapsedSinceStart + "ms)");
                        previousCallState = android.telephony.TelephonyManager.CALL_STATE_OFFHOOK;
                        handleHardwareCallStateChange(android.telephony.TelephonyManager.CALL_STATE_IDLE, "");
                        return;
                    }
                }
            } catch (Exception e) {
                android.util.Log.w("AiRideCallModule", "Watchdog error: " + e.getMessage());
            }

            if (watchdogActive) {
                mainHandler.postDelayed(this, 1000);
            }
        }
    };

    private void startCallWatchdog() {
        callInitiatedTimestamp = System.currentTimeMillis();
        if (!watchdogActive) {
            watchdogActive = true;
            mainHandler.removeCallbacks(callWatchdogRunnable);
            mainHandler.postDelayed(callWatchdogRunnable, 1000);
        }
    }

    private void stopCallWatchdog() {
        watchdogActive = false;
        mainHandler.removeCallbacks(callWatchdogRunnable);
    }

    private void emitCallStatus(int status, String rawNumber, String callerName) {
        try {
            if (reactContext.hasActiveCatalystInstance()) {
                com.facebook.react.bridge.WritableMap params = com.facebook.react.bridge.Arguments.createMap();
                params.putInt("status", status);
                params.putString("data", rawNumber != null ? rawNumber : "");
                params.putString("callerName", callerName != null ? callerName : "");

                reactContext
                    .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("CallStatusChanged", params);
            }
        } catch (Exception e) {
            android.util.Log.e("AiRideCallModule", "Error sending event", e);
        }
    }

    /**
     * Risolve il nome del contatto in rubrica a partire dal numero di telefono
     */
    private String resolveContactName(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) return "";
        if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return phoneNumber;
        }
        Cursor cursor = null;
        try {
            Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phoneNumber));
            String[] projection = new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME};
            cursor = reactContext.getContentResolver().query(uri, projection, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) {
                    return name.trim();
                }
            }
        } catch (Exception e) {
            android.util.Log.w("AiRideCallModule", "Contact lookup failed: " + e.getMessage());
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return phoneNumber;
    }

    @Override
    public String getName() {
        return "AiRideCallModule";
    }

    @ReactMethod
    public void makeCall(String phoneNumber) {
        android.util.Log.d("AiRideCallModule", "makeCall called with: " + phoneNumber);
        try {
            ensurePhoneStateListener();
            String cleanNum = phoneNumber.trim();
            lastKnownCallerName = resolveContactName(cleanNum);
            callReachedActiveState = false;
            previousCallState = android.telephony.TelephonyManager.CALL_STATE_OFFHOOK;
            emitCallStatus(4, cleanNum, lastKnownCallerName); // 4 = Chiamata in uscita
            startCallWatchdog();

            String uri = "tel:" + cleanNum;
            Intent intent = new Intent(Intent.ACTION_CALL);
            intent.setData(Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);

            // 🕒 Wait for Dialer to open, then steal focus back
            bringAppToFront(5000); 

        } catch (SecurityException e) {
            android.util.Log.e("AiRideCallModule", "Permission denied for makeCall", e);
        } catch (Exception e) {
             android.util.Log.e("AiRideCallModule", "Error in makeCall", e);
        }
    }

    @ReactMethod
    public void answerCall() {
        android.util.Log.d("AiRideCallModule", "answerCall called");
        ensurePhoneStateListener();
        startCallWatchdog();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            TelecomManager tm = (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
            try {
                if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED) {
                    if (tm != null) {
                        tm.acceptRingingCall();
                        android.util.Log.d("AiRideCallModule", "Call accepted. Bringing app to front...");

                        // 🕒 Bring back app faster for answer
                        bringAppToFront(800);
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    private void bringAppToFront(int delayMs) {
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    android.widget.Toast.makeText(reactContext, "AiRide riprende il controllo...", android.widget.Toast.LENGTH_SHORT).show();

                    Context context = reactContext.getApplicationContext();
                    Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                    
                    if (intent != null) {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        // intent.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED); // Optional

                        context.startActivity(intent);
                        
                        // Close system dialogs (notification shade, etc)
                        Intent closeIntent = new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS);
                        context.sendBroadcast(closeIntent);
                    }
                    
                } catch (Exception e) {
                    e.printStackTrace();
                    android.util.Log.e("AiRideCallModule", "Failed to bring app to front", e);
                }
            }
        }, delayMs); 
    }

    @ReactMethod
    public void hangUp() {
        wasRejectedOrHungUp = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) { // Android 9.0 (API 28) +
            TelecomManager telecomManager = (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager != null) {
                if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED) {
                    try {
                        telecomManager.endCall();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }
        }
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (previousCallState != android.telephony.TelephonyManager.CALL_STATE_IDLE || watchdogActive) {
                    handleHardwareCallStateChange(android.telephony.TelephonyManager.CALL_STATE_IDLE, "");
                }
            }
        }, 500);
    }

    @ReactMethod
    public void startBluetoothSco() {
        android.util.Log.d("AiRideCallModule", "startBluetoothSco called");
        try {
            android.media.AudioManager audioManager = (android.media.AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) return;

            android.bluetooth.BluetoothAdapter btAdapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter();
            if (btAdapter == null || !btAdapter.isEnabled()) {
                android.util.Log.d("AiRideCallModule", "Bluetooth disabled, keeping SCO off for device speakers");
                audioManager.setBluetoothScoOn(false);
                audioManager.stopBluetoothSco();
                return;
            }

            boolean hasBtAudioDevice = false;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                android.media.AudioDeviceInfo[] devices = audioManager.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS);
                if (devices != null) {
                    for (android.media.AudioDeviceInfo dev : devices) {
                        int type = dev.getType();
                        if (type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                            type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                            type == 26 /* TYPE_BLE_HEADSET */ ||
                            type == 27 /* TYPE_BLE_SPEAKER */) {
                            hasBtAudioDevice = true;
                            break;
                        }
                    }
                }
            }

            if (!hasBtAudioDevice) {
                android.util.Log.d("AiRideCallModule", "No Bluetooth headset connected, keeping SCO off so built-in speakers work");
                audioManager.setBluetoothScoOn(false);
                audioManager.stopBluetoothSco();
                return;
            }

            if (audioManager.isBluetoothScoAvailableOffCall()) {
                audioManager.startBluetoothSco();
                audioManager.setBluetoothScoOn(true);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void stopBluetoothSco() {
        android.util.Log.d("AiRideCallModule", "stopBluetoothSco called");
        try {
            android.media.AudioManager audioManager = (android.media.AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setBluetoothScoOn(false);
                audioManager.stopBluetoothSco();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void isBluetoothHeadsetConnected(com.facebook.react.bridge.Promise promise) {
        try {
            android.media.AudioManager audioManager = (android.media.AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            android.bluetooth.BluetoothAdapter btAdapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter();
            if (audioManager == null || btAdapter == null || !btAdapter.isEnabled()) {
                promise.resolve(false);
                return;
            }
            boolean connected = false;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                android.media.AudioDeviceInfo[] devices = audioManager.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS);
                if (devices != null) {
                    for (android.media.AudioDeviceInfo dev : devices) {
                        int type = dev.getType();
                        if (type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                            type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                            type == 26 || type == 27) {
                            connected = true;
                            break;
                        }
                    }
                }
            }
            promise.resolve(connected);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }
}
