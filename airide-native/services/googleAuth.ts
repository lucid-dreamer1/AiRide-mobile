import {
  GoogleSignin,
} from "@react-native-google-signin/google-signin";

import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import { useRouter } from "expo-router";

GoogleSignin.configure({
  webClientId:
    "415820909922-79rc86k01qbq1197j4uprggtkfaoco6i.apps.googleusercontent.com",
});

export function useGoogleAuth() {
  const router = useRouter();

  const loginWithGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });

      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;

      if (!idToken) {
        console.error("Google non ha restituito idToken");
        return;
      }

      // Credenziali Google Firebase
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);

      // Login Firebase
      const result = await auth().signInWithCredential(googleCredential);
      const user = result.user;

      console.log("🔥 Logged in as:", user.uid);

      // Salva/aggiorna dati utente in Firestore
      await firestore()
        .collection("users")
        .doc(user.uid)
        .set(
          {
            email: user.email,
            username: user.displayName ?? "",
            settings: { hudBrightness: 1, hudMode: "auto" },
            stats: { totalKm: 0, totalRides: 0, avgSpeed: 0 },
            helmet: { firmware: null, battery: null },
            lastLocation: null,
          },
          { merge: true }
        );

      console.log("🔥 Utente salvato in Firestore!");

      router.push("./(tabs)");
    } catch (error: any) {
      console.log("Google error:", error);
    }
  };

  return { loginWithGoogle };
}
