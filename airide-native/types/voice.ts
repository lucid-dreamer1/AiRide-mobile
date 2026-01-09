// types/voice.ts - Type definitions for Voice Assistant

export enum VoicePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface TTSOptions {
  language?: string;
  pitch?: number;
  rate?: number;
  volume?: number;
}

export type VoiceFrequency = 'minimal' | 'standard' | 'verbose';

export interface VoiceSettings {
  enabled: boolean;
  language: string; // 'it', 'en', 'fr', 'de', 'es'
  frequency: VoiceFrequency;
  speed: number; // 0.8 - 1.2
  volume: number; // 0.5 - 1.0
}

export interface VoiceMessage {
  text: string;
  priority: VoicePriority;
  timestamp: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  language: 'it',
  frequency: 'standard',
  speed: 1.0,
  volume: 0.9,
};

export const SUPPORTED_LANGUAGES = [
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
];
