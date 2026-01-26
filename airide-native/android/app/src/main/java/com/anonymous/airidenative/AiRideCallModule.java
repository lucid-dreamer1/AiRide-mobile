package com.anonymous.airidenative;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.telecom.TelecomManager;
import androidx.core.app.ActivityCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class AiRideCallModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;
    private android.telephony.TelephonyManager telephonyManager;
    private android.telephony.PhoneStateListener phoneStateListener;

    public AiRideCallModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        
        // Initialize Telephony Manager
        telephonyManager = (android.telephony.TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);

        // Run on Main Thread to avoid Looper errors with PhoneStateListener
        new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    phoneStateListener = new android.telephony.PhoneStateListener() {
                        @Override
                        public void onCallStateChanged(int state, String incomingNumber) {
                            super.onCallStateChanged(state, incomingNumber);
                            String stateStr = "UNKNOWN";
                            int status = 0; // Idle

                            switch (state) {
                                case android.telephony.TelephonyManager.CALL_STATE_IDLE:
                                    stateStr = "IDLE";
                                    status = 0;
                                    break;
                                case android.telephony.TelephonyManager.CALL_STATE_OFFHOOK:
                                    stateStr = "OFFHOOK";
                                    status = 2; // Active Call
                                    break;
                                case android.telephony.TelephonyManager.CALL_STATE_RINGING:
                                    stateStr = "RINGING";
                                    status = 1; // Incoming Call
                                    break;
                            }
                            
                            android.util.Log.d("AiRideCallModule", "PhoneStateListener State: " + stateStr);
                            
                            // Emit event to JS
                            try {
                                if (reactContext.hasActiveCatalystInstance()) {
                                     com.facebook.react.bridge.WritableMap params = com.facebook.react.bridge.Arguments.createMap();
                                     params.putInt("status", status);
                                     params.putString("data", incomingNumber != null ? incomingNumber : "");
                                     
                                     reactContext
                                        .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                        .emit("CallStatusChanged", params);
                                }
                            } catch (Exception e) {
                                android.util.Log.e("AiRideCallModule", "Error sending event", e);
                            }
                        }
                    };
                    
                    if (telephonyManager != null) {
                         telephonyManager.listen(phoneStateListener, android.telephony.PhoneStateListener.LISTEN_CALL_STATE);
                         android.util.Log.d("AiRideCallModule", "PhoneStateListener registered successfully on Main Thread");
                    }

                } catch(Exception e) {
                     android.util.Log.e("AiRideCallModule", "Failed to register PhoneStateListener", e);
                     e.printStackTrace();
                }
            }
        });
    }

    @Override
    public String getName() {
        return "AiRideCallModule";
    }

    @ReactMethod
    public void makeCall(String phoneNumber) {
        android.util.Log.d("AiRideCallModule", "makeCall called with: " + phoneNumber);
        try {
            String uri = "tel:" + phoneNumber.trim();
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
                    android.widget.Toast.makeText(reactContext, "AirRide riprende il controllo...", android.widget.Toast.LENGTH_SHORT).show();

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) { // Android 9.0 (API 28) +
            TelecomManager telecomManager = (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager != null) {
                if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
                try {
                    telecomManager.endCall();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
