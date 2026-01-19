# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- REGOLE SPECIFICHE PER PORCUPINE ---
-keep class ai.picovoice.porcupine.** { *; }
-keep class ai.picovoice.common.** { *; }
-keep class ai.picovoice.** { *; }
-keep interface ai.picovoice.** { *; }
-keepclasseswithmembernames class ai.picovoice.porcupine.** {
    native <methods>;
}

# --- REGOLE SPECIFICHE PER VOSK ---
-keep class org.vosk.** { *; }
-keep class com.anonymous.airidenative.vosk.** { *; }
-keepclasseswithmembernames class org.vosk.** {
    native <methods>;
}

# --- REGOLE GENERALI JNI ---
-keepclasseswithmembernames class * {
    native <methods>;
}

-keep class * implements ai.picovoice.porcupine.Porcupine { *; }
