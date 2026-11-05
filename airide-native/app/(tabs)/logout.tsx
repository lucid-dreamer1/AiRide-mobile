import { useEffect } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import auth from "@react-native-firebase/auth";
import { BackgroundNavigation } from "../../services/BackgroundNavigation";
import { intercomService } from "../../services/IntercomService";
import { radioService } from "../../services/RadioService";

export default function LogoutScreen() {
  const router = useRouter();

  useEffect(() => {
    Alert.alert(
      "Logout",
      "Vuoi davvero disconnetterti?",
      [
        { text: "Annulla", onPress: () => router.back(), style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            try {
              await intercomService.turnOff().catch(() => {});
              await radioService.stop().catch(() => {});
              await BackgroundNavigation.stop().catch(() => {});
              await auth().signOut();
              router.replace("/login");
            } catch (err) {
              console.log("Errore logout", err);
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, []);

  return null; // 👈 nessuna pagina nera!
}
