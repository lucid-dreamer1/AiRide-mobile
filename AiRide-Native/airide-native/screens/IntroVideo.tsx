import React, { useRef, useState, useEffect } from "react";
import { View, StyleSheet, Animated, Dimensions } from "react-native";
import { Video, ResizeMode } from "expo-av";

interface IntroVideoProps {
  onFinish: () => void;
}

export default function IntroVideo({ onFinish }: IntroVideoProps) {
  const videoRef = useRef<Video>(null);
  const fade = useRef(new Animated.Value(1)).current; // 1 = visibile
  const [finished, setFinished] = useState(false);

  const handleEnd = () => {
    if (finished) return;
    setFinished(true);

    // ⭐ Animazione fade-out finale
    Animated.timing(fade, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(() => {
      onFinish(); // passa all'app dopo fade
    });
  };

  return (
    <Animated.View style={[styles.container, { opacity: fade }]}>
      <Video
        ref={videoRef}
        source={require("../assets/logoAnimato1.mp4")}
        style={styles.video}
        resizeMode={ResizeMode.COVER}   // 📌 riempie tutto senza bande
        shouldPlay
        isLooping={false}
        onPlaybackStatusUpdate={(status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) handleEnd();
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },

  video: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
});
