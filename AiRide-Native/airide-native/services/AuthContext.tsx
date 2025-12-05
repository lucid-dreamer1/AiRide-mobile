// services/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from "react";
import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";

type UserData = {
  email: string;
  username: string;
  settings: any;
  stats: any;
  helmet: any;
  lastLocation: any;
};

type AuthContextType = {
  user: any | null;
  userData: UserData | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  userData: null,
  loading: true,
  logout: async () => {},
});

export const AuthProvider = ({ children }: any) => {
  const [user, setUser] = useState<any | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // 🔥 Carica i dati utente da Firestore (RNFirebase)
        const snap = await firestore()
          .collection("users")
          .doc(currentUser.uid)
          .get();

        if (snap.exists()) {
          setUserData(snap.data() as UserData);
        }
      } else {
        setUserData(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    await auth().signOut();
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => useContext(AuthContext);
