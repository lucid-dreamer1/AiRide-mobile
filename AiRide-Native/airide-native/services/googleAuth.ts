import * as Google from "expo-auth-session/providers/google";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { auth } from "./firebaseConfig";

export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: "<TUO CLIENT ID iOS>",
    androidClientId: "<TUO CLIENT ID ANDROID>",
    webClientId: "415820909922-79rc86k01qbq1197j4uprggtkfaoco6i.apps.googleusercontent.com",
  });

  const loginWithGoogle = async () => {
    const result = await promptAsync();

    if (result?.type === "success") {
      const { id_token } = result.authentication!;
      const credential = GoogleAuthProvider.credential(id_token);
      await signInWithCredential(auth, credential);
    }
  };

  return { loginWithGoogle, request };
}
