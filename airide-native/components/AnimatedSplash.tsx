import React, { useRef, useEffect } from "react";
import { StyleSheet, View, Dimensions } from "react-native";
import LottieView from "lottie-react-native";

interface AnimatedSplashProps {
  onAnimationFinish: () => void;
}

const { width, height } = Dimensions.get("window");

export default function AnimatedSplash({ onAnimationFinish }: AnimatedSplashProps) {
  const animation = useRef<LottieView>(null);

  useEffect(() => {
    // Play the animation on mount
    animation.current?.play();
  }, []);

  return (
    <View style={styles.container}>
      <LottieView
        ref={animation}
        source={require("@/assets/images/splashscreen.json")}
        autoPlay={false} 
        loop={false}
        resizeMode="cover"
        style={styles.lottie}
        onAnimationFinish={(isCancelled) => {
          if (!isCancelled) {
            onAnimationFinish();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff", // Match native splash background if possible, or black/theme color
    alignItems: "center",
    justifyContent: "center",
  },
  lottie: {
    width: width,
    height: height,
  },
});
