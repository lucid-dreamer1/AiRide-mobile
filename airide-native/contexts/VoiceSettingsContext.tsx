// contexts/VoiceSettingsContext.tsx
// Gestione persistente delle impostazioni vocali utente

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VoiceSettings, DEFAULT_VOICE_SETTINGS } from '@/types/voice';

const STORAGE_KEY = '@airide_voice_settings';

type VoiceSettingsContextType = {
  settings: VoiceSettings;
  updateSettings: (newSettings: Partial<VoiceSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  loading: boolean;
};

const VoiceSettingsContext = createContext<VoiceSettingsContextType>({
  settings: DEFAULT_VOICE_SETTINGS,
  updateSettings: async () => {},
  resetSettings: async () => {},
  loading: true,
});

export const useVoiceSettings = () => useContext(VoiceSettingsContext);

export function VoiceSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Carica le impostazioni salvate all'avvio
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings({ ...DEFAULT_VOICE_SETTINGS, ...parsed });
        console.log('[VoiceSettings] Impostazioni caricate:', parsed);
      }
    } catch (error) {
      console.error('[VoiceSettings] Errore caricamento:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<VoiceSettings>) => {
    try {
      const updated = { ...settings, ...newSettings };
      setSettings(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      console.log('[VoiceSettings] Impostazioni aggiornate:', updated);
    } catch (error) {
      console.error('[VoiceSettings] Errore salvataggio:', error);
    }
  };

  const resetSettings = async () => {
    try {
      setSettings(DEFAULT_VOICE_SETTINGS);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_VOICE_SETTINGS));
      console.log('[VoiceSettings] Impostazioni resettate');
    } catch (error) {
      console.error('[VoiceSettings] Errore reset:', error);
    }
  };

  return (
    <VoiceSettingsContext.Provider
      value={{
        settings,
        updateSettings,
        resetSettings,
        loading,
      }}
    >
      {children}
    </VoiceSettingsContext.Provider>
  );
}
