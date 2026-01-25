package com.anonymous.airidenative;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

import com.facebook.react.ReactApplication;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class CallStateListener extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent.getAction().equals(TelephonyManager.ACTION_PHONE_STATE_CHANGED)) {
            String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
            
            String eventName = "CallStatusChanged";
            // 0: Idle, 1: Ringing, 2: Offhook (Accepted/Dialing)
            int status = 0; 
            String data = "";

            if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
                status = 1;
                data = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
                // Manteniamo anche l'evento specifico per retro-compatibilità se serve, o usiamo un solo evento.
                // Per ora usiamo CallStatusChanged con payload { status: 1, callerId: ... }
                sendEvent(context, "CallRinging", data); // Legacy support
            } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
                status = 2;
            } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
                status = 0;
                // Nota: L'utente vuole "3: chiamata conclusa".
                // IDLE significa conclusa/nessuna chiamata. 
                // Possiamo gestire il "3" temporaneo lato JS o inviare "3" qui se veniamo da uno stato attivo?
                // È difficile sapere lo stato precedente qui senza static variables.
                // Lato JS è più facile gestire la transizione 2 -> 3 -> 0.
                // Invieremo IDLE (0) e JS gestirà la logica di visualizzazione "conclusa".
            }
            
            sendEvent(context, eventName, String.valueOf(status), data);
        }
    }

    private void sendEvent(Context context, String eventName, String status, String auxData) {
        try {
            ReactApplication reactApplication = (ReactApplication) context.getApplicationContext();
            ReactContext reactContext = reactApplication.getReactNativeHost().getReactInstanceManager().getCurrentReactContext();

            if (reactContext != null) {
                WritableMap params = Arguments.createMap();
                params.putInt("status", Integer.parseInt(status));
                params.putString("data", auxData != null ? auxData : "");
                
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // Overload per compatibilità con il vecchio metodo se usato altrove
    private void sendEvent(Context context, String eventName, String data) {
         sendEvent(context, eventName, "1", data);
    }
}
