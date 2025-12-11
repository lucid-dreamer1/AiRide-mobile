import { firebaseFirestore } from "@/services/firebaseConfig";
import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";

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

    const userRef = firebaseFirestore.collection("users").doc(user.uid);

    // 1️⃣ Salva la corsa
    await userRef.collection("rides").add(data);

    // 2️⃣ Incrementa i km totali
    await userRef.update({
      totalKm: firestore.FieldValue.increment(data.distanceKm),
    });

    return true;
  } catch (err) {
    console.error("Errore salvataggio tratta:", err);
    throw err;
  }
}
