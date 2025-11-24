import React from "react";
import { Text, StyleSheet } from "react-native";

function DistanceCounter({
  distance,
  isNear,
}: {
  distance: number;
  isNear: boolean;
}) {
  return (
    <Text style={[styles.distance, isNear && styles.nearDistance]}>
      {distance} m
    </Text>
  );
}

export default React.memo(DistanceCounter);

const styles = StyleSheet.create({
  distance: {
    marginTop: 4,
    fontSize: 14,
    color: "#666",
  },
  nearDistance: {
    color: "#E85A2A",
    fontWeight: "700",
  },
});
