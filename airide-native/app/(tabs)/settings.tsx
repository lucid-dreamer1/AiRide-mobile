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
  Alert,
  TextInput,
  PermissionsAndroid,
  FlatList,
  Modal,
  ActivityIndicator,
} from "react-native";

import * as Contacts from "expo-contacts";

import { firebaseFirestore } from "@/services/firebaseConfig";
import firestore from "@react-native-firebase/firestore";
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";
import { REWARDS } from "@/constants/achievements";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import Toast from "react-native-toast-message";
import { NavigationStore } from "@/services/NavigationStore";
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { useOta } from "@/contexts/OtaContext";
import OtaUpdateModal from "@/components/OtaUpdateModal";

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
    riskSongUri: null,
    riskSongStartTime: 0,
    aiRescueEnabled: false,
    emergencyContact: "",
  });

  const [localStartTime, setLocalStartTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(300); // default in sec
  
  const [availableRewards, setAvailableRewards] = useState<string[]>([]);

  const [openSections, setOpenSections] = useState({
    theme: true,
    voice: true, // Voice Assistant section
    special: true,
    airescue: true,
    firmware: true,
  });

  const [contactsModalVisible, setContactsModalVisible] = useState(false);
  const [contactsList, setContactsList] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOtaModal, setShowOtaModal] = useState(false);

  const { otaState, firmwareInfo, progress } = useOta();

  const loadContacts = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
        });
        if (data && data.length > 0) {
          const validContacts = data.filter(c => c.phoneNumbers && c.phoneNumbers.length > 0);
          setContactsList(validContacts);
          setContactsModalVisible(true);
        } else {
          Alert.alert("Attenzione", "Nessun contatto trovato nella rubrica.");
        }
      } else {
        Alert.alert("Permesso negato", "Devi concedere il permesso per leggere la rubrica.");
      }
    } catch (e) {
      console.warn("Errore caricamento contatti:", e);
    }
  };

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
          riskSongUri: data.settings?.riskSongUri ?? null,
          riskSongStartTime: data.settings?.riskSongStartTime ?? 0,
          aiRescueEnabled: data.settings?.aiRescueEnabled ?? false,
          emergencyContact: data.settings?.emergencyContact ?? "",
        });

        // Sincronizziamo subito la canzone con il Background Store così se la cambi funziona al volo
        if (data.settings?.riskSongUri) {
          NavigationStore.set({ 
             riskSongUri: data.settings.riskSongUri,
             riskSongStartTime: data.settings.riskSongStartTime ?? 0,
          });
        }
      });

    return unsub;
  }, [user]);

  // Sync state per slider
  useEffect(() => {
    setLocalStartTime(settings.riskSongStartTime || 0);
  }, [settings.riskSongStartTime]);

  // Carica durata audio per lo slider
  useEffect(() => {
    if (settings.riskSongUri) {
       Audio.Sound.createAsync({ uri: settings.riskSongUri }).then(({ sound, status }) => {
           if (status.isLoaded && status.durationMillis) {
               setAudioDuration(status.durationMillis / 1000);
           }
           sound.unloadAsync();
       }).catch(() => {});
    }
  }, [settings.riskSongUri]);

  const playPreview = async (startTimeSec: number) => {
     try {
         const { sound } = await Audio.Sound.createAsync({ uri: settings.riskSongUri });
         await sound.playFromPositionAsync(startTimeSec * 1000);
         setTimeout(() => {
             sound.stopAsync().then(() => sound.unloadAsync());
         }, 4000); // 4 secondi per capire il ritornello
     } catch(e) {}
  };

  const handleSlidingComplete = (val: number) => {
      const intVal = Math.floor(val);
      updateSetting("riskSongStartTime", intVal);
      playPreview(intVal);
  };

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

  const handlePickRiskSong = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const cacheUri = result.assets[0].uri;
        // Crea un nome file sicuro per la memoria persistente
        const safeName = result.assets[0].name ? result.assets[0].name.replace(/[^a-zA-Z0-9.\-_]/g, '') : `audio_${Date.now()}.m4a`;
        // @ts-ignore
        const permanentUri = `${FileSystem.documentDirectory}${safeName}`;

        // @ts-ignore
        await FileSystem.copyAsync({
          from: cacheUri,
          to: permanentUri,
        });

        // Salva la URI permanente, che non verrà cancellata dalla cache
        updateSetting("riskSongUri", permanentUri);
        
        Toast.show({
          type: "success",
          text1: "Risk Song Impostata",
          text2: "Il tuo audio per i sorpassi è pronto!",
        });
      }
    } catch (err: any) {
      console.log("❌ Errore caricamento audio Risk Song:", err?.message || err);
      Alert.alert("Errore Salvataggio Audio", String(err?.message || err));
      Toast.show({
        type: "error",
        text1: "Errore file",
        text2: "Impossibile caricare l'audio",
      });
    }
  };

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
      {/* ASSISTENTE VOCALE */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("voice")}
      >
        <Text style={styles.sectionTitle}>Assistente Vocale</Text>
        <Feather
          name={openSections.voice ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {openSections.voice && <VoiceSettingsSection />}

      {/* -------------------------- */}
      {/* RISK SONG PREMIUM */}
      {/* -------------------------- */}

      {hasReward("risk-song") && (
        <View style={[styles.sectionContent, { borderColor: '#E85A2A', borderWidth: 2, backgroundColor: '#1a0d08', marginTop: 24 }]}>
          {/* Header Speciale Risk Song */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Feather name="award" size={24} color="#E85A2A" style={{ marginRight: 10 }} />
            <View>
              <Text style={{ color: '#E85A2A', fontSize: 18, fontWeight: '800' }}>Risk Song Premium</Text>
              <Text style={{ color: '#E85A2A', opacity: 0.8, fontSize: 12, fontWeight: '600' }}>Sbloccata con i tuoi Km</Text>
            </View>
          </View>

          <View style={[styles.switchContainer, { flexDirection: "column", alignItems: "stretch", borderBottomWidth: 0 }]}>
            {/* Riga principale: Testo e Pulsante Carica */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchLabel, { color: '#fff' }]}>{REWARDS["risk-song"].label}</Text>
                <Text style={[styles.switchDesc, { color: '#ccc' }]}>
                  {settings.riskSongUri 
                    ? "Hai già impostato l'audio epico per i sorpassi. Premi qui per cambiarlo." 
                    : REWARDS["risk-song"].description}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handlePickRiskSong}
                style={[styles.testButton, { marginTop: 0, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#E85A2A' }]}
              >
                <Feather name="music" size={18} color="white" />
                <Text style={styles.testButtonText}>
                  {settings.riskSongUri ? "Modifica" : "Carica Audio"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Controlli aggiuntivi se l'audio è caricato */}
            {settings.riskSongUri && (
              <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: "rgba(232, 90, 42, 0.3)" }}>
                <Text style={[styles.switchLabel, { fontSize: 15, color: '#E85A2A' }]}>Scegli il momento del drop</Text>
                <Text style={[styles.switchDesc, { marginBottom: 16, color: '#aaa' }]}>Sposta il cursore per ascoltare l'anteprima e impostare da che secondo partirà l'audio quando superi i limiti.</Text>
                
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ color: "white", width: 45, textAlign: "left", fontSize: 13 }}>
                    {Math.floor(localStartTime / 60)}:{(localStartTime % 60).toString().padStart(2, "0")}
                  </Text>
                  
                  <Slider
                    style={{ flex: 1, height: 40 }}
                    minimumValue={0}
                    maximumValue={audioDuration}
                    step={1}
                    value={localStartTime}
                    onValueChange={(val) => setLocalStartTime(val)}
                    onSlidingComplete={handleSlidingComplete}
                    minimumTrackTintColor="#E85A2A"
                    maximumTrackTintColor="#555"
                    thumbTintColor="#E85A2A"
                  />
                  
                  <Text style={{ color: "#aaa", width: 45, textAlign: "right", fontSize: 13 }}>
                    {Math.floor(audioDuration / 60)}:{(Math.floor(audioDuration) % 60).toString().padStart(2, "0")}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* -------------------------- */}
      {/* AI RESCUE */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("airescue")}
      >
        <Text style={styles.sectionTitle}>AiRescue</Text>
        <Feather
          name={openSections.airescue ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {openSections.airescue && (
        <View style={styles.sectionContent}>
          <SettingSwitch
            label="Attiva AiRescue"
            desc="Rileva cadute/urti e invia richieste di emergenza."
            value={settings.aiRescueEnabled}
            onChange={async (v: boolean) => {
              if (v && Platform.OS === 'android') {
                try {
                  await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.SEND_SMS,
                    {
                      title: 'Permesso SMS Emergenza',
                      message: 'AiRide userà il permesso per inviare un SMS di emergenza (gratuito) in caso di incidente. Se rifiuti, verrà utilizzato il cloud.',
                      buttonNeutral: 'Chiedi dopo',
                      buttonNegative: 'Annulla',
                      buttonPositive: 'OK',
                    },
                  );
                } catch (err) {
                  console.warn("Errore richiesta permessi SMS:", err);
                }
              }
              updateSetting("aiRescueEnabled", v);
            }}
          />

          <View style={styles.inputContainer}>
            <Text style={styles.switchLabel}>Contatto di emergenza</Text>
            <Text style={styles.switchDesc}>
              Numero di telefono da contattare in caso di mancata risposta.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
              <TextInput
                style={[styles.textInput, { flex: 1, marginTop: 0 }]}
                placeholder="+39 333 1234567"
                placeholderTextColor="#555"
                keyboardType="phone-pad"
                value={settings.emergencyContact}
                onChangeText={(text) => setSettings({ ...settings, emergencyContact: text })}
                onEndEditing={() => updateSetting("emergencyContact", settings.emergencyContact)}
              />
              <TouchableOpacity style={{ marginLeft: 10, padding: 14, backgroundColor: '#E85A2A', borderRadius: 12 }} onPress={loadContacts}>
                <Feather name="users" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={{ marginTop: 6, padding: 12, backgroundColor: 'rgba(232, 90, 42, 0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(232, 90, 42, 0.2)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Feather name="info" size={16} color="#E85A2A" style={{ marginRight: 6 }} />
              <Text style={{ color: '#E85A2A', fontWeight: 'bold', fontSize: 14 }}>Disclaimer Responsabilità</Text>
            </View>
            <Text style={{ color: '#888', fontSize: 12, lineHeight: 18 }}>
              AiRide non garantisce l'invio infallibile del messaggio in ogni condizione (es. assenza di campo o crash critico del dispositivo). Il sistema va inteso come ausilio aggiuntivo e non sostituisce il buon senso e la prudenza alla guida.
            </Text>
          </View>
        </View>
      )}


      
      {/* -------------------------- */}
      {/* FIRMWARE OTA */}
      {/* -------------------------- */}

      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection("firmware" as any)}
      >
        <Text style={styles.sectionTitle}>Firmware</Text>
        <Feather
          name={(openSections as any).firmware ? "chevron-up" : "chevron-down"}
          size={22}
          color="#E85A2A"
        />
      </TouchableOpacity>

      {(openSections as any).firmware && (
        <View style={styles.sectionContent}>
          {/* Info firmware corrente */}
          <View style={[styles.switchContainer, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Versione firmware</Text>
              <Text style={styles.switchDesc}>
                Aggiorna il firmware del casco via Bluetooth.
              </Text>
            </View>
            <View style={{ backgroundColor: 'rgba(232,90,42,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#E85A2A' }}>
              <Text style={{ color: '#E85A2A', fontSize: 12, fontWeight: '700' }}>OTA</Text>
            </View>
          </View>

          {/* Stato OTA breve (se in corso) */}
          {(otaState === 'UPLOADING' || otaState === 'PREPARING' || otaState === 'VERIFYING') && (
            <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(232,90,42,0.06)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(232,90,42,0.2)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Feather name="upload-cloud" size={14} color="#E85A2A" />
                <Text style={{ color: '#E85A2A', fontWeight: '600', fontSize: 13 }}>Aggiornamento in corso... {progress}%</Text>
              </View>
              <View style={{ height: 4, backgroundColor: '#222', borderRadius: 2 }}>
                <View style={{ width: `${progress}%` as any, height: 4, backgroundColor: '#E85A2A', borderRadius: 2 }} />
              </View>
            </View>
          )}

          {otaState === 'SUCCESS' && (
            <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(29,185,84,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(29,185,84,0.3)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="check-circle" size={14} color="#1DB954" />
                <Text style={{ color: '#1DB954', fontWeight: '600', fontSize: 13 }}>Firmware aggiornato con successo!</Text>
              </View>
            </View>
          )}

          {/* Bottone apri modal OTA */}
          <TouchableOpacity
            style={[styles.testButton, { marginTop: 12 }]}
            onPress={() => setShowOtaModal(true)}
            disabled={otaState === 'UPLOADING' || otaState === 'PREPARING' || otaState === 'VERIFYING'}
          >
            <Feather name="upload-cloud" size={18} color="white" />
            <Text style={styles.testButtonText}>
              {otaState === 'UPLOADING' || otaState === 'PREPARING' || otaState === 'VERIFYING'
                ? 'Aggiornamento in corso...'
                : 'Aggiorna Firmware'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* MODAL OTA */}
      <OtaUpdateModal visible={showOtaModal} onClose={() => setShowOtaModal(false)} />

      {/* MODAL CONTATTI */}
      <Modal visible={contactsModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setContactsModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingTop: Platform.OS === 'ios' ? 20 : 50 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 }}>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>Rubrica</Text>
            <TouchableOpacity onPress={() => setContactsModalVisible(false)} style={{ padding: 8, backgroundColor: '#1f1f1f', borderRadius: 20 }}>
              <Feather name="x" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c1c', borderRadius: 12, paddingHorizontal: 12 }}>
              <Feather name="search" size={18} color="#777" />
              <TextInput
                style={{ flex: 1, color: '#fff', paddingVertical: 12, paddingHorizontal: 10, fontSize: 16 }}
                placeholder="Cerca contatto..."
                placeholderTextColor="#777"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")} style={{ padding: 4 }}>
                  <Feather name="x-circle" size={18} color="#777" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          
          <FlatList
             contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
             data={contactsList.filter(c => (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()))}
             keyExtractor={item => item.id}
             renderItem={({ item }) => (
               <TouchableOpacity 
                  style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    backgroundColor: '#151515', 
                    paddingVertical: 14, 
                    paddingHorizontal: 16,
                    borderRadius: 16,
                    marginBottom: 10
                  }}
                  onPress={() => {
                     const phone = item.phoneNumbers[0].number;
                     setSettings({ ...settings, emergencyContact: phone });
                     updateSetting("emergencyContact", phone);
                     setContactsModalVisible(false);
                     setSearchQuery("");
                  }}
               >
                 <View style={{ 
                    width: 48, height: 48, borderRadius: 24, 
                    backgroundColor: '#2a1a14', 
                    borderWidth: 1, borderColor: '#E85A2A',
                    justifyContent: 'center', alignItems: 'center', 
                    marginRight: 14 
                 }}>
                   <Text style={{ color: '#E85A2A', fontSize: 20, fontWeight: '700' }}>
                     {(item.name ? item.name.charAt(0) : '?').toUpperCase()}
                   </Text>
                 </View>
                 
                 <View style={{ flex: 1 }}>
                   <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{item.name || 'Senza Nome'}</Text>
                   <Text style={{ color: '#888', fontSize: 14, marginTop: 4 }}>{item.phoneNumbers[0].number}</Text>
                 </View>
                 
                 <Feather name="chevron-right" size={20} color="#444" />
               </TouchableOpacity>
             )}
          />
        </View>
      </Modal>

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
  <View style= {styles.switchContainer}>
    <View style={{ flex: 1 }}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Text style={styles.switchDesc}>{desc}</Text>
    </View>
    <Switch value={value} onValueChange={onChange} />
  </View>
);

/* -------------------------------------------------------- */
/* VOICE SETTINGS SECTION */
/* -------------------------------------------------------- */

import { useVoiceSettings } from "@/contexts/VoiceSettingsContext";
import { SUPPORTED_LANGUAGES } from "@/types/voice";
import { ttsService, getLanguageCode } from "@/services/TTSService";
import { VoskModelManager, DownloadProgress } from "@/services/VoskModelManager";

type ModelState = 'checking' | 'bundled' | 'downloaded' | 'not_downloaded' | 'downloading';

const VoiceSettingsSection = () => {
  const { settings, updateSettings } = useVoiceSettings();
  const [modelStates, setModelStates] = React.useState<Record<string, ModelState>>({});
  const [downloadProgress, setDownloadProgress] = React.useState<Record<string, number>>({});

  // Controlla stato modelli all'avvio
  React.useEffect(() => {
    const checkModels = async () => {
      const states: Record<string, ModelState> = {};
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang.code === 'it') { states[lang.code] = 'bundled'; continue; }
        states[lang.code] = 'checking';
        setModelStates({ ...states });
        const downloaded = await VoskModelManager.isDownloaded(lang.code);
        states[lang.code] = downloaded ? 'downloaded' : 'not_downloaded';
        setModelStates({ ...states });
      }
    };
    checkModels();
  }, []);

  const handleDownload = async (langCode: string) => {
    setModelStates(prev => ({ ...prev, [langCode]: 'downloading' }));
    setDownloadProgress(prev => ({ ...prev, [langCode]: 0 }));
    try {
      await VoskModelManager.downloadModel(langCode, (p: DownloadProgress) => {
        setDownloadProgress(prev => ({ ...prev, [langCode]: p.progress }));
      });
      setModelStates(prev => ({ ...prev, [langCode]: 'downloaded' }));
      Toast.show({ type: 'success', text1: 'Modello scaricato!', text2: `Il riconoscimento vocale in ${langCode.toUpperCase()} è ora disponibile offline.` });
    } catch (e) {
      setModelStates(prev => ({ ...prev, [langCode]: 'not_downloaded' }));
      Toast.show({ type: 'error', text1: 'Errore download', text2: 'Controlla la connessione internet.' });
    }
  };

  const handleDelete = async (langCode: string) => {
    await VoskModelManager.deleteModel(langCode);
    setModelStates(prev => ({ ...prev, [langCode]: 'not_downloaded' }));
  };

  const handleTestVoice = () => {
    const testText: Record<string, string> = {
      it: "Svolta a destra tra 100 metri",
      en: "Turn right in 100 meters",
      fr: "Tournez à droite dans 100 mètres",
      de: "Rechts abbiegen in 100 Meter",
      es: "Gire a la derecha en 100 metros",
    };
    ttsService.speak(testText[settings.language] || "Test voce", 2, {
      language: getLanguageCode(settings.language),
      rate: settings.speed,
      volume: settings.volume,
    });
  };

  return (
    <View style={styles.sectionContent}>
      {/* Abilita/Disabilita */}
      <SettingSwitch
        label="Abilita Assistente Vocale"
        desc="Attiva le istruzioni vocali durante la navigazione"
        value={settings.enabled}
        onChange={(v) => updateSettings({ enabled: v })}
      />

      {/* Lingua + Download Modello */}
      <Text style={styles.subSectionTitle}>Lingua & Modello Vocale</Text>
      <View style={{ gap: 10 }}>
        {SUPPORTED_LANGUAGES.map((lang) => {
          const state = modelStates[lang.code] ?? 'checking';
          const progress = downloadProgress[lang.code] ?? 0;
          const isSelected = settings.language === lang.code;
          const isAvailable = state === 'bundled' || state === 'downloaded';

          return (
            <View
              key={lang.code}
              style={{
                backgroundColor: isSelected ? 'rgba(232, 90, 42, 0.08)' : '#151515',
                borderRadius: 14,
                borderWidth: isSelected ? 1.5 : 1,
                borderColor: isSelected ? '#E85A2A' : '#222',
                padding: 14,
              }}
            >
              {/* Riga principale */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, marginRight: 10 }}>{lang.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{lang.name}</Text>
                  <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                    {state === 'checking' ? 'Verifica...'
                      : state === 'bundled' ? 'Incluso nell\'app'
                      : state === 'downloaded' ? `Scaricato · ${VoskModelManager.getSizeMB(lang.code)} MB`
                      : state === 'downloading' ? `Scaricamento ${Math.round(progress * 100)}%...`
                      : `Non scaricato · ~${VoskModelManager.getSizeMB(lang.code)} MB`}
                  </Text>
                </View>

                {/* Azioni a destra */}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {/* Bottone seleziona (solo se modello disponibile) */}
                  {isAvailable && (
                    <TouchableOpacity
                      onPress={() => updateSettings({ language: lang.code })}
                      style={{
                        backgroundColor: isSelected ? '#E85A2A' : '#2a2a2a',
                        borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                      }}
                    >
                      <Text style={{ color: isSelected ? '#fff' : '#aaa', fontSize: 12, fontWeight: '700' }}>
                        {isSelected ? '✓ Attiva' : 'Usa'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Bottone download */}
                  {state === 'not_downloaded' && (
                    <TouchableOpacity
                      onPress={() => handleDownload(lang.code)}
                      style={{ backgroundColor: '#1a1a2e', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#E85A2A' }}
                    >
                      <Feather name="download" size={16} color="#E85A2A" />
                    </TouchableOpacity>
                  )}

                  {/* Bottone elimina */}
                  {state === 'downloaded' && (
                    <TouchableOpacity
                      onPress={() => handleDelete(lang.code)}
                      style={{ backgroundColor: '#1a1a1a', borderRadius: 8, padding: 8 }}
                    >
                      <Feather name="trash-2" size={16} color="#555" />
                    </TouchableOpacity>
                  )}

                  {/* Spinner download */}
                  {state === 'downloading' && (
                    <ActivityIndicator size="small" color="#E85A2A" />
                  )}
                </View>
              </View>

              {/* Progress bar durante il download */}
              {state === 'downloading' && (
                <View style={{ marginTop: 10, height: 4, backgroundColor: '#222', borderRadius: 2 }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: 4, backgroundColor: '#E85A2A', borderRadius: 2 }} />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Test Button */}
      <TouchableOpacity onPress={handleTestVoice} style={[styles.testButton, { marginTop: 16 }]}>
        <Feather name="volume-2" size={18} color="white" />
        <Text style={styles.testButtonText}>Prova Voce</Text>
      </TouchableOpacity>
    </View>
  );
};


/* -------------------------------------------------------- */
/* THEME PREVIEW */
/* -------------------------------------------------------- */

import { THEMES, ThemeName } from "@/contexts/ThemeContext";

const ThemePreview = ({ theme }: { theme: ThemeName }) => {
  const palette = THEMES[theme] || THEMES.default;

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
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    marginTop: 16,
    borderRadius: 12,
  },

  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
  },

  sectionContent: {
    backgroundColor: "#121212",
    padding: 16,
    borderRadius: 20,
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e1e1e",
  },

  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    marginBottom: 10,
  },

  optionSelected: {
    borderWidth: 1,
    borderColor: "#E85A2A",
    backgroundColor: "rgba(232, 90, 42, 0.1)",
  },

  optionLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#fff",
  },

  switchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e1e",
    marginBottom: 4,
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

  inputContainer: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "transparent",
    marginBottom: 4,
  },
  
  textInput: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#222",
    fontSize: 16,
    fontWeight: "500",
  },

  previewCard: {
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#1a1a1a",
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
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

  // Voice Settings Styles
  subSectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
    marginTop: 16,
    marginBottom: 10,
  },

  languageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },

  languageButton: {
    flex: 1,
    minWidth: "30%",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
  },

  languageButtonActive: {
    borderColor: "#E85A2A",
    backgroundColor: "rgba(232, 90, 42, 0.1)",
  },

  languageFlag: {
    fontSize: 28,
    marginBottom: 6,
  },

  languageName: {
    fontSize: 13,
    fontWeight: "500",
    color: "#ccc",
  },

  frequencyButtons: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },

  frequencyButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
  },

  frequencyButtonActive: {
    borderColor: "#E85A2A",
    backgroundColor: "rgba(232, 90, 42, 0.1)",
  },

  frequencyText: {
    fontSize: 13,
    color: "#bbb",
  },

  frequencyTextActive: {
    color: "#E85A2A",
    fontWeight: "600",
  },

  testButton: {
    marginTop: 20,
    backgroundColor: "#E85A2A",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#E85A2A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },

  testButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
