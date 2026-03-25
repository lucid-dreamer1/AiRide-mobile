import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';

const { AiRideCallModule } = NativeModules;
const callEventEmitter = new NativeEventEmitter(AiRideCallModule); // Actually listeners are often on the module itself or shared emitter

// Since we send the event from the BroadcastReceiver to the React Context's JS Module (DeviceEventManagerModule.RCTDeviceEventEmitter),
// the event is emitted globally to the DeviceEventEmitter, not necessarily the specific NativeModule emitter if not subclassed that way.
// However, standard practice often uses DeviceEventEmitter for general events or a specific emitter if the module implements RCTEventEmitter.
// In our Java code, we used: reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(...)
// So we should listen using DeviceEventEmitter or the NativeEventEmitter wrapping a module if it proxies it.
// Actually, generic events sent via RCTDeviceEventEmitter are often picked up by DeviceEventEmitter in JS.

import { DeviceEventEmitter } from 'react-native';

const CallModule = {
  requestPermissions: async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        ]);

        const allGranted =
          granted[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;

        if (!allGranted) {
            console.warn('Some permissions were denied');
        }
        return allGranted;
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  },

  makeCall: async (phoneNumber) => {
    if (Platform.OS === 'android') {
        // Request permissions but don't block if something fails silently in JS check
        await CallModule.requestPermissions();
        console.log("[CallModule] Calling Native makeCall...");
        AiRideCallModule.makeCall(phoneNumber);
    }
  },

  answerCall: async () => {
    if (Platform.OS === 'android') {
        await CallModule.requestPermissions();
        console.log("[CallModule] Calling Native answerCall...");
        AiRideCallModule.answerCall();
    }
  },

  hangUp: async () => {
    if (Platform.OS === 'android') {
        await CallModule.requestPermissions();
        console.log("[CallModule] Calling Native hangUp...");
        AiRideCallModule.hangUp();
    }
  },

  startBluetoothSco: () => {
    if (Platform.OS === 'android') {
        console.log("[CallModule] Enabling Bluetooth SCO for microphone...");
        AiRideCallModule.startBluetoothSco();
    }
  },

  stopBluetoothSco: () => {
    if (Platform.OS === 'android') {
        console.log("[CallModule] Disabling Bluetooth SCO...");
        AiRideCallModule.stopBluetoothSco();
    }
  },

  addCallListener: (callback) => {
    if (Platform.OS === 'android') {
        return DeviceEventEmitter.addListener('CallRinging', callback);
    }
    return { remove: () => {} };
  },

  addStatusListener: (callback) => {
    if (Platform.OS === 'android') {
        return DeviceEventEmitter.addListener('CallStatusChanged', callback);
    }
    return { remove: () => {} };
  }
};

export default CallModule;
