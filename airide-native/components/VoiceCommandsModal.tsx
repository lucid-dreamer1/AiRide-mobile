// components/VoiceCommandsModal.tsx
// Modal guida completa per tutti i comandi vocali disponibili in AiRide

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

interface VoiceCommandsModalProps {
  visible: boolean;
  onClose: () => void;
  accentColor?: string;
}

interface CommandItem {
  command: string;
  description: string;
  example?: string;
}

interface CommandCategory {
  id: string;
  title: string;
  icon: any;
  color: string;
  items: CommandItem[];
}

const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    id: 'intercom',
    title: 'Interfono & Amici',
    icon: 'users',
    color: '#10B981',
    items: [
      {
        command: '"Ciao casco, accendi interfono"',
        description: 'Attiva la linea interfono vocale hands-free con i tuoi compagni di moto.',
        example: '"Hey casco, attiva interfono" o "Ciao casco, apri interfono"',
      },
      {
        command: '"Ciao casco, spegni interfono"',
        description: 'Chiude la trasmissione interfono e disattiva il microfono.',
        example: '"Hey casco, disattiva interfono" o "Ciao casco, chiudi interfono"',
      },
      {
        command: '"Ciao casco, raggiungi [Nome Compagno]"',
        description: 'Recupera la posizione GPS in tempo reale del tuo amico e avvia la navigazione verso di lui.',
        example: '"Ciao casco, raggiungi Marco" o "Hey casco, vai da Luca"',
      },
      {
        command: '"Ciao casco, chi c\'è connesso?"',
        description: 'Elenca a voce i nomi dei compagni di viaggio attivi sull\'interfono.',
        example: '"Hey casco, stato interfono"',
      },
      {
        command: '"Ciao casco, ripeti ultimo messaggio"',
        description: 'Riascolta l\'ultima comunicazione vocale inviata da un amico se persa a causa del vento.',
        example: '"Hey casco, cosa ha detto?"',
      },
    ],
  },
  {
    id: 'radio',
    title: 'Web Radio & Musica',
    icon: 'radio',
    color: '#00D2FF',
    items: [
      {
        command: '"Hey casco, metti la radio"',
        description: 'Avvia la riproduzione streaming dell\'ultima stazione ascoltata.',
      },
      {
        command: '"Hey casco, metti [Nome Stazione]"',
        description: 'Sintonizza direttamente su una stazione (es. Deejay, Ibiza Global, 105, Virgin, RTL, RDS, m2o, Radio 24, Capital, Sonica).',
        example: '"Hey casco, metti Radio Deejay" oppure "Hey casco, metti Ibiza"',
      },
      {
        command: '"Hey casco, spegni la radio"',
        description: 'Ferma immediatamente lo streaming audio.',
        example: '"Hey casco, ferma la musica" oppure "Hey casco, stoppa la radio"',
      },
      {
        command: '"Hey casco, cambia stazione"',
        description: 'Passa alla stazione radio successiva nella lista.',
        example: '"Hey casco, prossima radio"',
      },
      {
        command: '"Hey casco, stazione precedente"',
        description: 'Torna alla stazione radio precedente.',
      },
      {
        command: '"Hey casco, alza / abbassa il volume"',
        description: 'Regola il volume della radio senza toccare il telefono.',
        example: '"Hey casco, alza la radio" oppure "Hey casco, abbassa il volume"',
      },
      {
        command: '"Hey casco, che radio sta suonando?"',
        description: 'Comunica a voce il nome e il genere musicale della stazione in riproduzione.',
      },
    ],
  },
  {
    id: 'nav',
    title: 'Navigazione & Rotte',
    icon: 'navigation',
    color: '#FF6B00',
    items: [
      {
        command: '"Hey casco, portami a [Indirizzo / Città]"',
        description: 'Calcola la rotta ottimale e avvia la navigazione con HUD e voce.',
        example: '"Hey casco, portami a Roma" oppure "Hey casco, vai in Via Garibaldi 10"',
      },
      {
        command: '"Hey casco, vai a casa"',
        description: 'Imposta la rotta verso l\'indirizzo di casa salvato nel profilo.',
      },
      {
        command: '"Hey casco, vai al lavoro"',
        description: 'Naviga verso l\'indirizzo del tuo posto di lavoro.',
      },
      {
        command: '"Hey casco, ripeti indicazione"',
        description: 'Ripete l\'ultima istruzione di svolta e i metri rimanenti.',
        example: '"Hey casco, cosa devo fare?" oppure "Hey casco, ripeti"',
      },
      {
        command: '"Hey casco, cancella navigazione"',
        description: 'Termina il viaggio corrente e resetta la mappa.',
        example: '"Hey casco, annulla percorso"',
      },
      {
        command: '"Hey casco, ricalcola rotta"',
        description: 'Ricalcola un itinerario alternativo fino alla destinazione.',
      },
      {
        command: '"Hey casco, evita autostrade"',
        description: 'Ricalcola la rotta escludendo i tratti autostradali a pedaggio.',
      },
    ],
  },
  {
    id: 'poi',
    title: 'Punti di Interesse (POI)',
    icon: 'map-pin',
    color: '#10B981',
    items: [
      {
        command: '"Hey casco, cerca benzinaio"',
        description: 'Trova il distributore di carburante più vicino sul percorso e chiede conferma.',
        example: '"Hey casco, fai benzina" o "Hey casco, distributore"',
      },
      {
        command: '"Hey casco, cerca ristorante"',
        description: 'Cerca ristoranti, bar o trattorie lungo la strada.',
        example: '"Hey casco, ho fame" o "Hey casco, cerca un bar"',
      },
      {
        command: '"Hey casco, cerca officina"',
        description: 'Individua meccanici moto ed elettrauto nelle vicinanze.',
        example: '"Hey casco, gommista" o "Hey casco, riparazione moto"',
      },
      {
        command: '"Hey casco, prossimo / un altro"',
        description: 'Durante la proposta di un POI, passa all\'opzione successiva se la prima non va bene.',
      },
      {
        command: '"Sì" / "No"',
        description: 'Conferma o rifiuta l\'impostazione della rotta verso il punto trovato.',
      },
    ],
  },
  {
    id: 'telemetry',
    title: 'Telemetria & Info Viaggio',
    icon: 'activity',
    color: '#8B5CF6',
    items: [
      {
        command: '"Hey casco, a che velocità vado?"',
        description: 'Comunica a voce la tua velocità istantanea rilevata dal GPS.',
        example: '"Hey casco, andatura attuale"',
      },
      {
        command: '"Hey casco, quanto manca?"',
        description: 'Ti informa sulla distanza chilometrica e sul tempo stimato all\'arrivo.',
        example: '"Hey casco, chilometri rimanenti"',
      },
      {
        command: '"Hey casco, a che ora arrivo?"',
        description: 'Pronuncia l\'orario stimato di arrivo (ETA) a destinazione.',
      },
      {
        command: '"Hey casco, che ore sono?"',
        description: 'Dice l\'orario corrente dell\'orologio di sistema.',
      },
      {
        command: '"Hey casco, stato del casco"',
        description: 'Verifica se l\'HUD OLED sul casco è connesso via Bluetooth Low Energy.',
      },
    ],
  },
  {
    id: 'calls',
    title: 'Chiamate in Moto',
    icon: 'phone',
    color: '#EC4899',
    items: [
      {
        command: '"Hey casco, chiama [Nome Contatto]"',
        description: 'Cerca il contatto in rubrica ed effettua la chiamata vivavoce.',
        example: '"Hey casco, chiama Marco" oppure "Hey casco, telefona a Casa"',
      },
      {
        command: '"Hey casco, rispondi"',
        description: 'Accetta una chiamata in arrivo senza togliere le mani dal manubrio.',
      },
      {
        command: '"Hey casco, chiudi chiamata"',
        description: 'Termina la chiamata in corso o rifiuta la chiamata in arrivo.',
        example: '"Hey casco, attacca"',
      },
    ],
  },
  {
    id: 'assistant',
    title: 'Controllo Assistente',
    icon: 'volume-x',
    color: '#F59E0B',
    items: [
      {
        command: '"Hey casco, silenzia voce"',
        description: 'Muta temporaneamente la voce guida delle istruzioni di navigazione.',
        example: '"Hey casco, non parlare"',
      },
      {
        command: '"Hey casco, attiva voce"',
        description: 'Riabilita le indicazioni vocali dell\'assistente di guida.',
      },
    ],
  },
];

export const VoiceCommandsModal: React.FC<VoiceCommandsModalProps> = ({
  visible,
  onClose,
  accentColor = '#FF6B00',
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredCategories =
    selectedCategory === 'all'
      ? COMMAND_CATEGORIES
      : COMMAND_CATEGORIES.filter((c) => c.id === selectedCategory);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* HEADER */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.headerIconWrapper, { backgroundColor: `${accentColor}22` }]}>
                <Feather name="mic" size={20} color={accentColor} />
              </View>
              <View>
                <Text style={styles.title}>Comandi Vocali</Text>
                <Text style={styles.subtitle}>Pronuncia "Hey Casco" seguito dal comando</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* CATEGORY FILTER PILLS */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillScroll}
            contentContainerStyle={styles.pillScrollContent}
          >
            <TouchableOpacity
              style={[
                styles.pill,
                selectedCategory === 'all' && [styles.pillActive, { backgroundColor: accentColor }],
              ]}
              onPress={() => setSelectedCategory('all')}
            >
              <Text
                style={[
                  styles.pillText,
                  selectedCategory === 'all' && styles.pillTextActive,
                ]}
              >
                Tutti ({COMMAND_CATEGORIES.reduce((acc, c) => acc + c.items.length, 0)})
              </Text>
            </TouchableOpacity>

            {COMMAND_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.pill,
                    isSelected && [styles.pillActive, { backgroundColor: cat.color }],
                  ]}
                  onPress={() => setSelectedCategory(cat.id)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      isSelected && styles.pillTextActive,
                    ]}
                  >
                    {cat.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* COMMANDS LIST */}
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {filteredCategories.map((cat) => (
              <View key={cat.id} style={styles.categorySection}>
                <View style={styles.categoryHeader}>
                  <View style={[styles.catIconCircle, { backgroundColor: `${cat.color}22` }]}>
                    <Feather name={cat.icon} size={15} color={cat.color} />
                  </View>
                  <Text style={[styles.categoryTitle, { color: cat.color }]}>
                    {cat.title.toUpperCase()}
                  </Text>
                </View>

                {cat.items.map((item, idx) => (
                  <View key={idx} style={styles.commandCard}>
                    <View style={styles.commandPromptRow}>
                      <Ionicons name="mic-outline" size={16} color={cat.color} style={{ marginRight: 6 }} />
                      <Text style={styles.commandText}>{item.command}</Text>
                    </View>
                    <Text style={styles.descriptionText}>{item.description}</Text>
                    {item.example && (
                      <View style={styles.exampleRow}>
                        <Text style={styles.exampleLabel}>Varianti: </Text>
                        <Text style={styles.exampleText}>{item.example}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.footerNote}>
              <Feather name="info" size={14} color="#64748B" />
              <Text style={styles.footerText}>
                Il riconoscimento vocale funziona al 100% offline grazie a Vosk, anche senza connessione internet nei passi di montagna.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
  },
  pillScroll: {
    maxHeight: 40,
    marginBottom: 12,
  },
  pillScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  pillActive: {
    borderColor: 'transparent',
  },
  pillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#0B101B',
    fontWeight: '800',
  },
  list: {
    maxHeight: '80%',
  },
  categorySection: {
    marginBottom: 18,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingLeft: 2,
  },
  catIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  commandCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  commandPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  commandText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  descriptionText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
  },
  exampleRow: {
    flexDirection: 'row',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    flexWrap: 'wrap',
  },
  exampleLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  exampleText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontStyle: 'italic',
    flex: 1,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  footerText: {
    color: '#64748B',
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
