import { firebaseFirestore } from "@/services/firebaseConfig";
import auth from "@react-native-firebase/auth";

export type RideData = {
  destination: string;
  startCoords: { lat: number; lon: number };
  polyline: { lat: number; lon: number }[];
  distanceKm: number;
  durationMin: number;
  createdAt: number;
};

export async function saveRide(data: RideData) {
  try {
    const user = auth().currentUser;
    if (!user) throw new Error("Nessun utente loggato");

    await firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .collection("rides")
      .add(data);

    return true;
  } catch (err) {
    console.error("Errore salvataggio tratta:", err);
    throw err;
  }
}
