package com.anonymous.airidenative;

import android.telephony.SmsManager;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class DirectSmsModule extends ReactContextBaseJavaModule {

    public DirectSmsModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "DirectSms";
    }

    @ReactMethod
    public void sendDirectSms(String phoneNumber, String message, Promise promise) {
        try {
            SmsManager smsManager;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                smsManager = getReactApplicationContext().getSystemService(SmsManager.class);
            } else {
                smsManager = SmsManager.getDefault();
            }
            
            if (smsManager == null) {
                promise.reject("SMS_ERROR", "SmsManager not available");
                return;
            }

            smsManager.sendTextMessage(phoneNumber, null, message, null, null);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SMS_ERROR", e.getMessage());
        }
    }
}
