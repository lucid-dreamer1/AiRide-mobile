import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Link, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../services/firebaseConfig";
import { doc, setDoc } from "firebase/firestore";

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const handleRegister = async () => {
    if (password !== confirm) {
      alert("Le password non coincidono");
      return;
    }

    try {
      // 1️⃣ CREA L'UTENTE IN AUTH
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // 2️⃣ CREA IL DOCUMENTO IN FIRESTORE
      await setDoc(doc(db, "users", uid), {
        email,
        username: email.split("@")[0],
        createdAt: new Date(),

        settings: {
          hudBrightness: 100,
          units: "km",
          demoMode: true,
          helmetAutoConnect: true,
        },

        stats: {
          totalKm: 0,
          totalRides: 0,
          avgSpeed: 0,
          lastRideAt: null,
        },

        lastLocation: null,

        helmet: {
          id: "",
          battery: 0,
          lastConnection: null,
          version: "",
        }
      });

      alert("Registrazione completata!");
      router.push("/login");

    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea account</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder="Inserisci email"
        placeholderTextColor="#888"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
        placeholder="Crea password"
        placeholderTextColor="#888"
      />

      <Text style={styles.label}>Conferma password</Text>
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        style={styles.input}
        placeholder="Ripeti password"
        placeholderTextColor="#888"
      />

      <TouchableOpacity onPress={handleRegister} style={styles.button}>
        <Feather name="user-plus" size={20} color="white" />
        <Text style={styles.buttonText}>Registrati</Text>
      </TouchableOpacity>

      <Text style={styles.bottomText}>
        Hai già un account?
        <Link href="/login" style={styles.link}> Accedi</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 40,
    color: "#222",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 16,
    color: "#111",
  },
  button: {
    backgroundColor: "#E85A2A",
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  buttonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 8,
  },
  bottomText: {
    textAlign: "center",
    color: "#666",
  },
  link: {
    color: "#E85A2A",
    fontWeight: "700",
  },
});
