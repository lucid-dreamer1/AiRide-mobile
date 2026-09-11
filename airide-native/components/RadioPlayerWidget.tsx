// components/RadioPlayerWidget.tsx
// Mini-player Bento Box per Web Radio con controlli play/pause, cambio stazione e visualizzatore onde

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  ScrollView,
  DeviceEventEmitter,
  ActivityIndicator,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { radioService, RadioState, RADIO_STATIONS, RadioStation } from '@/services/RadioService';

interface RadioPlayerWidgetProps {
  accentColor?: string;
}

export const RadioPlayerWidget: React.FC<RadioPlayerWidgetProps> = ({
  accentColor = '#00D2FF',
}) => {
  const [radioState, setRadioState] = useState<RadioState>(radioService.getState());
  const [showStationModal, setShowStationModal] = useState(false);

  // Animazione barre visualizzatore audio quando in riproduzione
  const waveAnim1 = useRef(new Animated.Value(6)).current;
  const waveAnim2 = useRef(new Animated.Value(14)).current;
  const waveAnim3 = useRef(new Animated.Value(10)).current;
  const waveAnim4 = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('Radio_StateChanged', (state: RadioState) => {
      setRadioState({ ...state });
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (radioState.isPlaying && !radioState.isBuffering) {
      const createLoop = (anim: Animated.Value, minVal: number, maxVal: number, dur: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: maxVal,
              duration: dur,
              useNativeDriver: false,
            }),
            Animated.timing(anim, {
              toValue: minVal,
              duration: dur,
              useNativeDriver: false,
            }),
          ])
        );
      };

      const a1 = createLoop(waveAnim1, 4, 18, 300);
      const a2 = createLoop(waveAnim2, 6, 22, 220);
      const a3 = createLoop(waveAnim3, 4, 16, 260);
      const a4 = createLoop(waveAnim4, 6, 20, 340);

      a1.start();
      a2.start();
      a3.start();
      a4.start();

      return () => {
        a1.stop();
        a2.stop();
        a3.stop();
        a4.stop();
      };
    } else {
      waveAnim1.setValue(6);
      waveAnim2.setValue(10);
      waveAnim3.setValue(6);
      waveAnim4.setValue(8);
    }
  }, [radioState.isPlaying, radioState.isBuffering]);

  const currentStation = radioState.currentStation || RADIO_STATIONS[0];

  return (
    <>
      <View style={styles.cardContainer}>
        {/* COLONNA SINISTRA: Equalizzatore + Info Stazione */}
        <TouchableOpacity
          style={styles.infoArea}
          activeOpacity={0.8}
          onPress={() => setShowStationModal(true)}
        >
          <View
            style={[
              styles.stationBadge,
              { backgroundColor: currentStation.color ? `${currentStation.color}22` : 'rgba(0, 210, 255, 0.15)' },
            ]}
          >
            {radioState.isPlaying ? (
              <View style={styles.equalizerContainer}>
                <Animated.View
                  style={[styles.equalizerBar, { height: waveAnim1, backgroundColor: currentStation.color || accentColor }]}
                />
                <Animated.View
                  style={[styles.equalizerBar, { height: waveAnim2, backgroundColor: currentStation.color || accentColor }]}
                />
                <Animated.View
                  style={[styles.equalizerBar, { height: waveAnim3, backgroundColor: currentStation.color || accentColor }]}
                />
                <Animated.View
                  style={[styles.equalizerBar, { height: waveAnim4, backgroundColor: currentStation.color || accentColor }]}
                />
              </View>
            ) : (
              <Feather name="radio" size={18} color={currentStation.color || accentColor} />
            )}
          </View>

          <View style={styles.textContainer}>
            <View style={styles.titleRow}>
              <Text style={styles.stationName} numberOfLines={1}>
                {currentStation.name}
              </Text>
              {radioState.isPlaying && (
                <View style={styles.liveTag}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              )}
            </View>
            <Text style={styles.genreText} numberOfLines={1}>
              {radioState.isBuffering ? 'Connessione streaming...' : currentStation.genre}
            </Text>
          </View>
        </TouchableOpacity>

        {/* COLONNA DESTRA: Controlli multimediali */}
        <View style={styles.controlsRow}>
          {/* Stazione Precedente */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => radioService.prev()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="skip-back" size={18} color="#94A3B8" />
          </TouchableOpacity>

          {/* Play / Pause Toggle */}
          <TouchableOpacity
            style={[
              styles.playButton,
              { backgroundColor: currentStation.color || accentColor },
            ]}
            onPress={() => radioService.togglePlay()}
            disabled={radioState.isLoading}
          >
            {radioState.isLoading || radioState.isBuffering ? (
              <ActivityIndicator size="small" color="#0B101B" />
            ) : (
              <Ionicons
                name={radioState.isPlaying ? 'pause' : 'play'}
                size={20}
                color="#0B101B"
                style={{ marginLeft: radioState.isPlaying ? 0 : 2 }}
              />
            )}
          </TouchableOpacity>

          {/* Stazione Successiva */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => radioService.next()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="skip-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          {/* Selettore Stazioni */}
          <TouchableOpacity
            style={styles.listButton}
            onPress={() => setShowStationModal(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="list" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* MODAL SELEZIONE STAZIONE */}
      <Modal
        visible={showStationModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowStationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Stazioni Web Radio</Text>
                <Text style={styles.modalSubtitle}>Scegli la tua colonna sonora per il viaggio</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowStationModal(false)}
                style={styles.closeButton}
              >
                <Feather name="x" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.stationList} showsVerticalScrollIndicator={false}>
              {RADIO_STATIONS.map((station) => {
                const isCurrent = station.id === currentStation.id;
                return (
                  <TouchableOpacity
                    key={station.id}
                    style={[
                      styles.stationItem,
                      isCurrent && {
                        borderColor: station.color || accentColor,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      },
                    ]}
                    onPress={async () => {
                      setShowStationModal(false);
                      await radioService.play(station);
                    }}
                  >
                    <View
                      style={[
                        styles.stationItemIcon,
                        { backgroundColor: station.color ? `${station.color}25` : 'rgba(0, 210, 255, 0.2)' },
                      ]}
                    >
                      <Feather
                        name="radio"
                        size={18}
                        color={station.color || accentColor}
                      />
                    </View>

                    <View style={styles.stationItemInfo}>
                      <Text style={styles.stationItemName}>{station.name}</Text>
                      <Text style={styles.stationItemGenre}>{station.genre}</Text>
                    </View>

                    {isCurrent && radioState.isPlaying ? (
                      <View style={styles.playingBadge}>
                        <Ionicons name="volume-high" size={18} color={station.color || accentColor} />
                      </View>
                    ) : (
                      <Feather name="play" size={16} color="#64748B" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.voiceHintCard}>
              <Feather name="mic" size={16} color={accentColor} />
              <Text style={styles.voiceHintText}>
                Puoi dire: <Text style={{ color: '#F1F5F9', fontWeight: 'bold' }}>"Hey casco, metti {currentStation.name}"</Text>
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  infoArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  stationBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  equalizerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 22,
    width: 22,
    justifyContent: 'space-between',
  },
  equalizerBar: {
    width: 3,
    borderRadius: 2,
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stationName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    maxWidth: 130,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#EF4444',
  },
  liveText: {
    color: '#EF4444',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  genreText: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlButton: {
    padding: 6,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00D2FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  listButton: {
    padding: 6,
    marginLeft: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
  },
  stationList: {
    maxHeight: 340,
  },
  stationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  stationItemIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  stationItemInfo: {
    flex: 1,
  },
  stationItemName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  stationItemGenre: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  playingBadge: {
    padding: 4,
  },
  voiceHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 210, 255, 0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 255, 0.2)',
  },
  voiceHintText: {
    color: '#94A3B8',
    fontSize: 12,
    flex: 1,
  },
});
