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

    public AiRideCallModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "AiRideCallModule";
    }

    @ReactMethod
    public void makeCall(String phoneNumber) {
        // Basic permission check just in case, though it should be handled from JS
        if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            // Permission not granted. Ideally, request it from JS.
            return;
        }

        try {
            String uri = "tel:" + phoneNumber.trim();
            Intent intent = new Intent(Intent.ACTION_CALL);
            intent.setData(Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void answerCall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            TelecomManager telecomManager = (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager != null) {
                if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
                     // Permission should be requested from JS before calling this
                    return;
                }
                try {
                    telecomManager.acceptRingingCall();
                } catch (Exception e) {
                   e.printStackTrace();
                }
            }
        }
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
