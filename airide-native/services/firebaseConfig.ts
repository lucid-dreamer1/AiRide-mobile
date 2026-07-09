import { firebase } from "@react-native-firebase/app";
import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import appCheck from "@react-native-firebase/app-check";

// Inizializza Firebase App Check (Enforce) prima di istanziare i servizi
const rnfbProvider = appCheck().newReactNativeFirebaseAppCheckProvider();
rnfbProvider.configure({
  android: {
    provider: __DEV__ ? 'debug' : 'playIntegrity',
    debugToken: 'some-token' // Da configurare sulla Firebase Console per l'emulatore
  },
  apple: {
    provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
  },
  web: {
    provider: 'reCaptchaV3',
    siteKey: 'unknown' // Da configurare se mai ci sarà una versione web
  }
});

appCheck().initializeAppCheck({ provider: rnfbProvider, isTokenAutoRefreshEnabled: true });

export const firebaseAuth = auth();
export const firebaseFirestore = firestore();
