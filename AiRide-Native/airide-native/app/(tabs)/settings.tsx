import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";

import { firebaseFirestore } from "@/services/firebaseConfig";
import firestore from "@react-native-firebase/firestore";
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";
import { REWARDS } from "@/constants/achievements";

// Abilita animazioni su Android
if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

export default function SettingsScreen() {
  const { user } = useAuth();

  const [settings, setSettings] = useState<any>({
    theme: "default",
    hudPlus: false,
    proMode: false,
    introAnim: false,
  });

  const [availableRewards, setAvailableRewards] = useState<string[]>([]);

  const [openSections, setOpenSections] = useState({
    theme: true,
    special: true,
    personalization: false,
  });

  // Fetch settings + unlocked rewards
  useEffect(() => {
    if (!user) return;

    const unsub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot((doc) => {
        const data = doc.data() || {};

        setAvailableRewards(data.unlockedRewards || []);

        setSettings({
          theme: data.settings?.theme ?? "default",
          hudPlus: data.settings?.hudPlus ?? false,
          proMode: data.settings?.proMode ?? false,
          introAnim: data.settings?.introAnim ?? false,
        });
      });

    return unsub;
  }, [user]);

  const updateSetting = (key: string, value: any) => {
    if (!user) return;

    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    firebaseFirestore.collection("users").doc(user.uid).update({
      settings: newSettings,
    });
  };

  const toggleSection = (key: keyof typeof openSections) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasReward = (reward: string) => availableRewards.includes(reward);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Impostazioni</Text>

      {/* -------------------------- */}
      {/* SEZIONE TEMA */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("theme")}
      >
        <Text style={styles.sectionTitle}>Tema applicazione</Text>
        <Feather
          name={openSections.theme ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {openSections.theme && (
        <View style={styles.sectionContent}>

          {/* ⭐ TEMA PREVIEW */}
          <ThemePreview theme={settings.theme} />

          {/* Default */}
          <SettingOption
            label="Default"
            selected={settings.theme === "default"}
            onPress={() => updateSetting("theme", "default")}
          />

          {/* Asphalt Grey */}
          {hasReward("theme-grey") && (
            <SettingOption
              label={REWARDS["theme-grey"].label}
              selected={settings.theme === "grey"}
              onPress={() => updateSetting("theme", "grey")}
            />
          )}

          {/* Premium Theme */}
          {hasReward("theme-premium") && (
            <SettingOption
              label={REWARDS["theme-premium"].label}
              selected={settings.theme === "premium"}
              onPress={() => updateSetting("theme", "premium")}
            />
          )}
        </View>
      )}

      {/* -------------------------- */}
      {/* FUNZIONI SPECIALI */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("special")}
      >
        <Text style={styles.sectionTitle}>Funzionalità speciali</Text>
        <Feather
          name={openSections.special ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {openSections.special && (
        <View style={styles.sectionContent}>

          {/* HUD Plus */}
          {hasReward("hud-plus") && (
            <SettingSwitch
              label={REWARDS["hud-plus"].label}
              desc={REWARDS["hud-plus"].description}
              value={settings.hudPlus}
              onChange={(v: boolean) => updateSetting("hudPlus", v)}
            />
          )}

          {/* Pro Mode */}
          {hasReward("pro-mode") && (
            <SettingSwitch
              label={REWARDS["pro-mode"].label}
              desc={REWARDS["pro-mode"].description}
              value={settings.proMode}
              onChange={(v: boolean) => updateSetting("proMode", v)}
            />
          )}

          {/* Intro Animation */}
          {hasReward("intro-animation") && (
            <SettingSwitch
              label={REWARDS["intro-animation"].label}
              desc={REWARDS["intro-animation"].description}
              value={settings.introAnim}
              onChange={(v: boolean) => updateSetting("introAnim", v)}
            />
          )}

        </View>
      )}

      {/* -------------------------- */}
      {/* PERSONALIZZAZIONE */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("personalization")}
      >
        <Text style={styles.sectionTitle}>Personalizzazione</Text>
        <Feather
          name={openSections.personalization ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {openSections.personalization && (
        <View style={styles.sectionContent}>
          <Text style={styles.infoText}>
            Qui potrai personalizzare HUD, stile strada, elementi premium
            visivi e molto altro.
          </Text>
        </View>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

/* -------------------------------------------------------- */
/* COMPONENTI INTERNI TIPIZZATI */
/* -------------------------------------------------------- */

type SettingOptionProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

const SettingOption = ({ label, selected, onPress }: SettingOptionProps) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.optionRow, selected && styles.optionSelected]}
  >
    <Feather name="circle" size={18} color="#E85A2A" />
    <Text style={styles.optionLabel}>{label}</Text>
  </TouchableOpacity>
);

type SettingSwitchProps = {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
};

const SettingSwitch = ({
  label,
  desc,
  value,
  onChange,
}: SettingSwitchProps) => (
  <View style={styles.switchContainer}>
    <View style={{ flex: 1 }}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Text style={styles.switchDesc}>{desc}</Text>
    </View>
    <Switch value={value} onValueChange={onChange} />
  </View>
);

/* -------------------------------------------------------- */
/* THEME PREVIEW */
/* -------------------------------------------------------- */

type ThemeKey = "default" | "grey" | "premium";

const ThemePreview = ({ theme }: { theme: ThemeKey }) => {
  const palettes: Record<ThemeKey, { bg: string; accent: string; text: string }> = {
    default: { bg: "#1a1a1a", accent: "#E85A2A", text: "#fff" },
    grey: { bg: "#2a2a2a", accent: "#888", text: "#eee" },
    premium: { bg: "#0f0f0f", accent: "#9b59ff", text: "#fff" },
  };

  const palette = palettes[theme];

  return (
    <View
      style={[
        styles.previewCard,
        { backgroundColor: palette.bg, borderColor: palette.accent },
      ]}
    >
      <Text style={[styles.previewTitle, { color: palette.text }]}>
        Anteprima Tema
      </Text>

      <View style={styles.previewColorsRow}>
        <View style={[styles.colorDot, { backgroundColor: palette.bg }]} />
        <View style={[styles.colorDot, { backgroundColor: palette.accent }]} />
        <View style={[styles.colorDot, { backgroundColor: palette.text }]} />
      </View>

      <Text style={[styles.previewLabel, { color: palette.text }]}>
        Visualizza i colori chiave del tema selezionato.
      </Text>
    </View>
  );
};


/* -------------------------------------------------------- */
/* STYLES */
/* -------------------------------------------------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#000",
  },

  title: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 20,
    color: "#fff",
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 6,
    marginTop: 12,
    backgroundColor: "#111",
    borderRadius: 12,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },

  sectionContent: {
    backgroundColor: "#111",
    padding: 12,
    borderRadius: 12,
    marginTop: 6,
    marginBottom: 10,
  },

  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#181818",
    marginBottom: 8,
  },

  optionSelected: {
    borderWidth: 2,
    borderColor: "#E85A2A",
    backgroundColor: "#2A1A14",
  },

  optionLabel: {
    fontSize: 16,
    color: "#fff",
  },

  switchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 6,
    backgroundColor: "#181818",
    borderRadius: 12,
    marginBottom: 10,
  },

  switchLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },

  switchDesc: {
    color: "#bbb",
    fontSize: 13,
    marginTop: 2,
  },

  infoText: {
    color: "#aaa",
    fontSize: 14,
  },

  previewCard: {
    borderWidth: 2,
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
  },

  previewTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },

  previewColorsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },

  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },

  previewLabel: {
    fontSize: 13,
    opacity: 0.8,
  },
});
