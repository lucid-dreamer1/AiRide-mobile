import { Redirect } from "expo-router";
import { View, ActivityIndicator, Text } from "react-native";
import { useAuth } from "../services/useAuth";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#E85A2A" />
        <Text style={{ marginTop: 10, color: "#333" }}>Caricamento...</Text>
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/(tabs)" />;
}
