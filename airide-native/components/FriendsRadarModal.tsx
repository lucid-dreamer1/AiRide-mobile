// components/FriendsRadarModal.tsx
// Modal per la gestione degli Amici, Radar Mappa, Privacy e Interfono Hands-Free

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { friendsService, FriendProfile } from '@/services/FriendsService';
import { intercomService, IntercomState } from '@/services/IntercomService';
import Toast from 'react-native-toast-message';

interface FriendsRadarModalProps {
  visible: boolean;
  onClose: () => void;
  accentColor?: string;
  myPosition?: { latitude: number; longitude: number } | null;
  onNavigateToFriend?: (friend: FriendProfile) => void;
}

export const FriendsRadarModal: React.FC<FriendsRadarModalProps> = ({
  visible,
  onClose,
  accentColor = '#00D2FF',
  myPosition,
  onNavigateToFriend,
}) => {
  const [friends, setFriends] = useState<FriendProfile[]>(friendsService.getFriends());
  const [isLocationShared, setIsLocationShared] = useState<boolean>(friendsService.getIsLocationShared());
  const [intercomState, setIntercomState] = useState<IntercomState>(intercomService.getState());
  const [activeTab, setActiveTab] = useState<'friends' | 'add'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const subFriends = friendsService.getFriends();
    setFriends([...subFriends]);

    const listener = () => {
      setFriends([...friendsService.getFriends()]);
      setIsLocationShared(friendsService.getIsLocationShared());
    };

    // DeviceEventEmitter listener
    const sub = require('react-native').DeviceEventEmitter.addListener('Friends_Updated', listener);
    const subIntercom = require('react-native').DeviceEventEmitter.addListener('Intercom_StateChanged', (st: IntercomState) => {
      setIntercomState({ ...st });
    });

    return () => {
      sub.remove();
      subIntercom.remove();
    };
  }, []);

  // Calcola distanza in km tra me e l'amico
  const calculateDistanceKm = (friendLoc?: { latitude: number; longitude: number }): string | null => {
    if (!myPosition || !friendLoc) return null;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(friendLoc.latitude - myPosition.latitude);
    const dLon = toRad(friendLoc.longitude - myPosition.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(myPosition.latitude)) *
        Math.cos(toRad(friendLoc.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    if (d < 1) {
      return `${Math.round(d * 1000)} m`;
    }
    return `${d.toFixed(1)} km`;
  };

  const handleTogglePrivacy = async (value: boolean) => {
    setIsLocationShared(value);
    await friendsService.setLocationSharing(value);
    Toast.show({
      type: 'info',
      text1: value ? '📍 Posizione Condivisa' : '🔒 Posizione Nascosta',
      text2: value ? 'I tuoi amici possono vederti sulla mappa' : 'Sei invisibile sulla mappa degli amici',
    });
  };

  const handleToggleIntercom = async () => {
    const newState = await intercomService.toggle();
    Toast.show({
      type: newState ? 'success' : 'info',
      text1: newState ? '🎙️ Interfono Acceso' : '🔇 Interfono Spento',
      text2: newState ? 'Sei in linea hands-free con i tuoi compagni' : 'Microfono chiuso',
    });
  };

  const handleAddFriend = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const res = await friendsService.addFriend(searchQuery.trim());
    setIsSearching(false);

    if (res.success) {
      Toast.show({
        type: 'success',
        text1: 'Amico Aggiunto!',
        text2: res.message,
      });
      setSearchQuery('');
      setActiveTab('friends');
    } else {
      Alert.alert('Attenzione', res.message);
    }
  };

  const handleRemoveFriend = (friend: FriendProfile) => {
    Alert.alert(
      'Rimuovi amico',
      `Sei sicuro di voler rimuovere ${friend.displayName} dagli amici?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Rimuovi',
          style: 'destructive',
          onPress: async () => {
            await friendsService.removeFriend(friend.uid);
            Toast.show({ type: 'info', text1: 'Amico rimosso' });
          },
        },
      ]
    );
  };

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
              <View style={[styles.headerIconWrapper, { backgroundColor: `${accentColor}25` }]}>
                <Feather name="users" size={20} color={accentColor} />
              </View>
              <View>
                <Text style={styles.title}>Compagni di Moto</Text>
                <Text style={styles.subtitle}>Radar mappa & Interfono Hands-Free</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* BANNER INTERFONO HANDS-FREE */}
          <View
            style={[
              styles.intercomBanner,
              intercomState.isOn && styles.intercomBannerActive,
            ]}
          >
            <View style={styles.intercomBannerLeft}>
              <View
                style={[
                  styles.intercomIndicator,
                  { backgroundColor: intercomState.isOn ? '#10B981' : '#64748B' },
                ]}
              >
                <Feather
                  name={intercomState.isOn ? 'mic' : 'mic-off'}
                  size={16}
                  color="white"
                />
              </View>
              <View>
                <Text style={styles.intercomBannerTitle}>
                  {intercomState.isOn
                    ? intercomState.targetFriendName
                      ? `In linea con ${intercomState.targetFriendName}`
                      : 'Interfono Gruppo (Hands-Free)'
                    : 'Interfono Spento'}
                </Text>
                <Text style={styles.intercomBannerDesc}>
                  {intercomState.isOn
                    ? intercomState.currentSpeakerName
                      ? `Parla ${intercomState.currentSpeakerName}...`
                      : intercomState.targetFriendName
                        ? 'Canale privato 1-a-1 attivo'
                        : `${intercomState.activeMembersCount} pilota/i connessi`
                    : 'Dì "Ciao casco, accendi interfono" per attivarlo'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.intercomToggleBtn,
                { backgroundColor: intercomState.isOn ? '#EF4444' : '#10B981' },
              ]}
              onPress={handleToggleIntercom}
            >
              <Text style={styles.intercomToggleBtnText}>
                {intercomState.isOn ? 'Spegni' : 'Gruppo'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* SWITCH PRIVACY POSIZIONE GPS */}
          <View style={styles.privacyCard}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.privacyTitle}>Condividi posizione con gli amici</Text>
              <Text style={styles.privacyDesc}>
                Permetti agli amici di vederti sul radar mappa e raggiungerti a voce.
              </Text>
            </View>
            <Switch
              value={isLocationShared}
              onValueChange={handleTogglePrivacy}
              trackColor={{ false: '#334155', true: accentColor }}
              thumbColor={isLocationShared ? '#FFFFFF' : '#94A3B8'}
            />
          </View>

          {/* TAB SWITCHER */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'friends' && styles.tabBtnActive]}
              onPress={() => setActiveTab('friends')}
            >
              <Feather
                name="users"
                size={16}
                color={activeTab === 'friends' ? '#F8FAFC' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'friends' && styles.tabTextActive,
                ]}
              >
                Amici ({friends.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'add' && styles.tabBtnActive]}
              onPress={() => setActiveTab('add')}
            >
              <Feather
                name="user-plus"
                size={16}
                color={activeTab === 'add' ? '#F8FAFC' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'add' && styles.tabTextActive,
                ]}
              >
                Aggiungi Amico
              </Text>
            </TouchableOpacity>
          </View>

          {/* LISTA AMICI */}
          {activeTab === 'friends' ? (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {friends.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Feather name="user-check" size={32} color="#64748B" />
                  <Text style={styles.emptyTitle}>Nessun compagno salvato</Text>
                  <Text style={styles.emptyDesc}>
                    Aggiungi i tuoi amici motociclisti per vederli sulla mappa e parlare con l'interfono.
                  </Text>
                  <TouchableOpacity
                    style={[styles.addFirstBtn, { backgroundColor: accentColor }]}
                    onPress={() => setActiveTab('add')}
                  >
                    <Feather name="plus" size={16} color="#0B101B" />
                    <Text style={styles.addFirstBtnText}>Aggiungi il primo amico</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                friends.map((friend) => {
                  const dist = calculateDistanceKm(friend.location);
                  const isVisibleOnMap = friend.isLocationShared && friend.location;

                  return (
                    <View key={friend.uid} style={styles.friendCard}>
                      <View style={styles.friendAvatarWrapper}>
                        <View style={[styles.friendAvatar, { backgroundColor: `${accentColor}33` }]}>
                          <Text style={[styles.friendAvatarText, { color: accentColor }]}>
                            {friend.displayName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        {friend.isOnline && <View style={styles.onlineDot} />}
                      </View>

                      <View style={styles.friendInfo}>
                        <View style={styles.friendNameRow}>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {friend.displayName}
                          </Text>
                          {friend.intercomActive && (
                            <View style={styles.intercomTag}>
                              <Feather name="radio" size={10} color="#10B981" />
                              <Text style={styles.intercomTagText}>IN LINEA</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.friendDetails} numberOfLines={1}>
                          {isVisibleOnMap
                            ? dist
                              ? `📍 A ${dist}${friend.location?.speedKmh ? ` · ${Math.round(friend.location.speedKmh)} km/h` : ''}`
                              : '📍 Posizione disponibile'
                            : '🔒 Posizione non condivisa'}
                        </Text>
                      </View>

                      {/* AZIONI RAPIDE */}
                      <View style={styles.actionsRow}>
                        {/* Interfono 1-a-1 con questo amico */}
                        <TouchableOpacity
                          style={[
                            styles.actionBtn,
                            intercomState.isOn && intercomState.targetFriendUid === friend.uid
                              ? { backgroundColor: '#10B981' }
                              : { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
                          ]}
                          onPress={async () => {
                            if (intercomState.isOn && intercomState.targetFriendUid === friend.uid) {
                              await intercomService.turnOff();
                              Toast.show({ type: 'info', text1: '🔇 Interfono Spento' });
                            } else {
                              await intercomService.turnOnWithFriend(friend);
                              Toast.show({
                                type: 'success',
                                text1: `🎙️ In linea con ${friend.displayName}`,
                                text2: 'Canale 1-a-1 hands-free attivo',
                              });
                            }
                          }}
                        >
                          <Feather
                            name={
                              intercomState.isOn && intercomState.targetFriendUid === friend.uid
                                ? 'mic'
                                : 'mic-off'
                            }
                            size={16}
                            color={
                              intercomState.isOn && intercomState.targetFriendUid === friend.uid
                                ? '#FFFFFF'
                                : '#94A3B8'
                            }
                          />
                        </TouchableOpacity>

                        {/* Raggiungi compagno */}
                        {isVisibleOnMap && onNavigateToFriend && (
                          <TouchableOpacity
                            style={[styles.actionBtn, { backgroundColor: `${accentColor}25` }]}
                            onPress={() => {
                              onClose();
                              onNavigateToFriend(friend);
                            }}
                          >
                            <Feather name="navigation" size={16} color={accentColor} />
                          </TouchableOpacity>
                        )}

                        {/* Rimuovi amico */}
                        <TouchableOpacity
                          style={styles.actionBtnRemove}
                          onPress={() => handleRemoveFriend(friend)}
                        >
                          <Feather name="trash-2" size={15} color="#64748B" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}

              {/* VOICE HINT CARD */}
              <View style={styles.hintCard}>
                <Feather name="mic" size={16} color={accentColor} />
                <Text style={styles.hintText}>
                  Comandi vocali supportati:{'\n'}
                  • <Text style={{ color: '#F1F5F9', fontWeight: 'bold' }}>"Ciao casco, interfono con [Nome]"</Text> (1-a-1){'\n'}
                  • <Text style={{ color: '#F1F5F9', fontWeight: 'bold' }}>"Ciao casco, accendi interfono"</Text> (Gruppo){'\n'}
                  • <Text style={{ color: '#F1F5F9', fontWeight: 'bold' }}>"Ciao casco, raggiungi [Nome]"</Text>
                </Text>
              </View>
            </ScrollView>
          ) : (
            /* TAB AGGIUNGI AMICO */
            <View style={styles.addSection}>
              <Text style={styles.addLabel}>Cerca per Email o Nickname</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Es. pilota@airide.com o Mario"
                  placeholderTextColor="#64748B"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={handleAddFriend}
                />
                <TouchableOpacity
                  style={[styles.searchBtn, { backgroundColor: accentColor }]}
                  onPress={handleAddFriend}
                  disabled={isSearching}
                >
                  {isSearching ? (
                    <ActivityIndicator size="small" color="#0B101B" />
                  ) : (
                    <Feather name="user-plus" size={18} color="#0B101B" />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.addHint}>
                Inserisci l'indirizzo email con cui il tuo compagno ha registrato il suo account AiRide per connettervi immediatamente.
              </Text>
            </View>
          )}
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
    paddingBottom: 32,
    maxHeight: '85%',
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
  intercomBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  intercomBannerActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: '#10B981',
  },
  intercomBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  intercomIndicator: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intercomBannerTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  intercomBannerDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  intercomToggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  intercomToggleBtnText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  privacyTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  privacyDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  list: {
    maxHeight: 320,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyDesc: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  addFirstBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 16,
  },
  addFirstBtnText: {
    color: '#0B101B',
    fontSize: 13,
    fontWeight: '700',
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  friendAvatarWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    borderWidth: 1.5,
    borderColor: '#0F172A',
  },
  friendInfo: {
    flex: 1,
  },
  friendNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    maxWidth: 140,
  },
  intercomTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  intercomTagText: {
    color: '#10B981',
    fontSize: 8,
    fontWeight: '800',
  },
  friendDetails: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnRemove: {
    padding: 6,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(0, 210, 255, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    marginBottom: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 255, 0.2)',
  },
  hintText: {
    color: '#94A3B8',
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
  addSection: {
    paddingTop: 8,
  },
  addLabel: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addHint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
});
