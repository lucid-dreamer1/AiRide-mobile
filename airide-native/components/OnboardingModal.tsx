import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  FlatList,
  StatusBar,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

const { width, height } = Dimensions.get('window');

interface OnboardingModalProps {
  visible: boolean;
  onDone: () => void;
}

const SLIDES = [
  {
    id: '1',
    title: 'Benvenuto in AiRide',
    description: 'La tua esperienza di guida intelligente inizia qui. Per funzionare al meglio, l\'app ha bisogno di alcuni permessi:\n\n📍 Posizione (Navigazione)\n🎙️ Microfono (Comandi Vocali)\n📡 Bluetooth (Casco Smart)',
    icon: 'map-pin',
    color: '#4A90E2',
  },
  {
    id: '2',
    title: 'Connetti il Casco',
    description: 'Accendi il tuo casco smart e connettilo tramite l\'icona Bluetooth nella home. Il casco vibrerà per indicarti la direzione e mostrerà le istruzioni turn-by-turn.',
    icon: 'bluetooth',
    color: '#1DB954',
  },
  {
    id: '3',
    title: 'Voce Smart & Casco',
    description: 'Per usare i comandi vocali ("Hey Casco") e sentire le indicazioni, è necessario un interfono o auricolare Bluetooth collegato al telefono e inserito nel casco.',
    icon: 'mic',
    color: '#E85A2A', 
  },
  {
    id: '4',
    title: 'Ride & Earn',
    description: 'Ogni chilometro conta! Più guidi, più punti guadagni. Sali di livello, sblocca badge e scala la classifica dei rider.',
    icon: 'award',
    color: '#F1C40F',
  },
  {
    id: '5',
    title: 'Sei pronto!',
    description: 'Indossa il casco, connetti l\'audio e goditi il viaggio in sicurezza. \n\nBuona strada rider! 🏍️💨',
    icon: 'check-circle',
    color: '#9B59B6',
  },
];

export default function OnboardingModal({ visible, onDone }: OnboardingModalProps) {
  const { themeColors } = useTheme();
  // Usa colori fissi scuri per l'onboarding per impatto visivo, o usa il tema
  const styles = createStyles(themeColors);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    setCurrentIndex(index);
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      onDone();
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <StatusBar barStyle="light-content" backgroundColor="black" />
      <View style={styles.container}>
        
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <View style={styles.slide}>
              <View style={[styles.iconContainer, { backgroundColor: item.color + '33' }]}>
                <Feather name={item.icon as any} size={80} color={item.color} />
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          )}
        />

        {/* Footer: Pagination & Button */}
        <View style={styles.footer}>
          
          {/* Pagination Dots */}
          <View style={styles.pagination}>
            {SLIDES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  currentIndex === index && styles.activeDot,
                  { backgroundColor: currentIndex === index ? themeColors.accent : '#555' }
                ]}
              />
            ))}
          </View>

          {/* Button */}
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: themeColors.accent }]} 
            onPress={handleNext}
          >
            <Text style={styles.buttonText}>
              {currentIndex === SLIDES.length - 1 ? "Inizia" : "Avanti"}
            </Text>
            {currentIndex !== SLIDES.length - 1 && (
                <Feather name="chevron-right" size={20} color="white" />
            )}
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212', // Force dark background for immersive feel
    justifyContent: 'center',
    alignItems: 'center',
  },
  slide: {
    width: width,
    height: height,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 2,
    borderColor: '#333',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#CCC',
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    position: 'absolute',
    bottom: 50,
    width: '100%',
    paddingHorizontal: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  activeDot: {
    width: 20, // Stretch effect
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
