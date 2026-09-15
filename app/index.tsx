import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Captions, Film, ShieldCheck, Sparkles, Download, Clock } from 'lucide-react-native';
import { useCaptionStore, FREE_SECONDS } from '../src/store/useCaptionStore';
import { useTheme } from '../src/theme/useTheme';
import { t } from '../src/i18n';
import { ForwardArrow } from '../src/components/DirectionalIcons';
import { AdBanner } from '../src/components/AdBanner';
import { useAdsStore } from '../src/store/adsStore';
import { showPrivacyOptionsForm } from '../src/services/ads';
import { burner } from '../modules/caption-burner';
import { downloadModel, getModelStatus } from '../src/services/modelManager';
import { transcribeVideo } from '../src/services/transcriber';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { source, stage, progress, isPro, setSource, setWords, setStage, setProgress, overFreeLimit } =
    useCaptionStore();

  // Google requires a persistent entry back into the consent form wherever UMP reports that
  // privacy options are available, which in practice means the EEA and the regulated US
  // states. It is absent everywhere else rather than shown as a dead control.
  const offerPrivacyOptions = useAdsStore((state) => state.consent.offerPrivacyOptions);

  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    getModelStatus().then((status) => setModelReady(status.ready));
  }, []);

  const handleDownload = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDownloading(true);
    setDownloadPercent(0);
    try {
      await downloadModel(({ fraction }) => {
        if (fraction !== null) setDownloadPercent(Math.round(fraction * 100));
      });
      setModelReady(true);
    } catch (error) {
      Alert.alert(t('modelFailed'), error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  };

  const handlePick = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('libraryDenied'), t('libraryDeniedDesc'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    try {
      // The picker's own width/height ignore the camera's rotation, so a
      // portrait clip reports as landscape and every caption lands off-screen.
      // The native side applies the transform.
      const info = await burner.getInfo(asset.uri);
      setSource({
        uri: asset.uri,
        size: { width: info.width, height: info.height },
        duration: info.duration,
      });
    } catch {
      Alert.alert(t('videoUnreadable'), t('videoUnreadableDesc'));
    }
  };

  const handleTranscribe = async () => {
    if (!source) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStage('transcribing', 0);
    try {
      const words = await transcribeVideo(source.uri, setProgress);
      if (!words.length) {
        setStage('idle');
        Alert.alert(t('noSpeechTitle'), t('noSpeechDesc'));
        return;
      }
      setWords(words);
      setStage('ready');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/studio');
    } catch (error) {
      setStage('idle');
      Alert.alert(t('transcribeFailed'), error instanceof Error ? error.message : String(error));
    }
  };

  const busy = stage === 'transcribing';
  const canTranscribe = !!source && modelReady === true && !busy;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 px-5" style={{ backgroundColor: theme.background }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="mt-4 mb-5">
          <View
            className="self-start border px-3 py-1 rounded-full mb-3 flex-row items-center"
            style={{ backgroundColor: theme.primaryLight, borderColor: theme.primaryBorder }}
          >
            <Sparkles size={12} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
              {t('heroBadge')}
            </Text>
          </View>
          <Text className="text-3xl font-extrabold tracking-tight" style={{ color: theme.text }}>
            {t('heroTitle')}
          </Text>
          <Text className="text-sm mt-1.5 leading-relaxed" style={{ color: theme.textSecondary }}>
            {t('heroSubtitle')}
          </Text>
        </View>

        {/* Source clip */}
        <View
          className="border rounded-3xl p-4 mb-4"
          style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
        >
          <View className="flex-row items-center mb-3">
            <View className="p-2 rounded-xl mr-3" style={{ backgroundColor: theme.primaryLight }}>
              <Film size={18} color={theme.primary} />
            </View>
            <View className="flex-1">
              <Text className="font-bold text-base" style={{ color: theme.text }}>
                {source ? t('videoReady', {
                  width: source.size.width,
                  height: source.size.height,
                  duration: t('secondsShort', { seconds: Math.round(source.duration) }),
                }) : t('noVideoTitle')}
              </Text>
              {!source ? (
                <Text className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>
                  {t('noVideoDesc')}
                </Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity
            onPress={handlePick}
            disabled={busy}
            accessibilityRole="button"
            className="px-4 py-3 rounded-2xl flex-row items-center justify-center"
            style={{ backgroundColor: theme.controlSurface, opacity: busy ? 0.5 : 1 }}
          >
            <Film size={16} color={theme.textSecondary} />
            <Text className="text-sm font-bold ml-2" style={{ color: theme.textSecondary }}>
              {source ? t('replaceVideo') : t('chooseVideo')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Model */}
        {modelReady === false ? (
          <View
            className="border rounded-3xl p-4 mb-4"
            style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
          >
            <Text className="font-bold text-base mb-1" style={{ color: theme.text }}>
              {t('modelTitle')}
            </Text>
            <Text className="text-xs leading-relaxed mb-3" style={{ color: theme.textSecondary }}>
              {t('modelDesc')}
            </Text>
            <TouchableOpacity
              onPress={handleDownload}
              disabled={downloading}
              accessibilityRole="button"
              className="px-4 py-3 rounded-2xl flex-row items-center justify-center"
              style={{ backgroundColor: theme.primary, opacity: downloading ? 0.6 : 1 }}
            >
              {downloading ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <Download size={16} color={theme.onPrimary} />
              )}
              <Text className="text-sm font-bold ml-2" style={{ color: theme.onPrimary }}>
                {downloading ? t('modelDownloading', { percent: downloadPercent }) : t('modelDownload')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {source && !isPro && overFreeLimit() ? (
          <View
            className="border rounded-2xl p-3 mb-4 flex-row items-start"
            style={{ backgroundColor: theme.primaryLight, borderColor: theme.primaryBorder }}
          >
            <Clock size={14} color={theme.primary} />
            <Text className="text-xs leading-relaxed ml-2 flex-1" style={{ color: theme.primary }}>
              {t('freeLimitNotice', { seconds: FREE_SECONDS })}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={handleTranscribe}
          disabled={!canTranscribe}
          accessibilityRole="button"
          className="p-4 rounded-2xl flex-row items-center justify-center mb-6"
          style={{ backgroundColor: canTranscribe ? theme.primary : theme.controlSurface }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.onPrimary} />
          ) : (
            <Captions size={18} color={canTranscribe ? theme.onPrimary : theme.textMuted} />
          )}
          <Text
            className="font-bold text-base ml-2 mr-2"
            style={{ color: canTranscribe || busy ? theme.onPrimary : theme.textMuted }}
          >
            {busy ? t('transcribing', { percent: Math.round(progress * 100) }) : t('transcribe')}
          </Text>
          {!busy ? <ForwardArrow size={18} color={canTranscribe ? theme.onPrimary : theme.textMuted} /> : null}
        </TouchableOpacity>

        <Text className="text-xs font-semibold tracking-widest mb-3" style={{ color: theme.textMuted }}>
          {t('archGuarantees')}
        </Text>
        {[
          { icon: <Captions size={18} color={theme.primary} />, bg: theme.primaryLight, title: t('wordTimedTitle'), desc: t('wordTimedDesc') },
          { icon: <Film size={18} color={theme.accent} />, bg: theme.accentLight, title: t('safeAreaTitle'), desc: t('safeAreaDesc') },
          { icon: <ShieldCheck size={18} color={theme.success} />, bg: theme.successLight, title: t('onDeviceTitle'), desc: t('onDeviceDesc') },
        ].map((item) => (
          <View
            key={item.title}
            className="border p-4 rounded-2xl flex-row items-start mb-3"
            style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
          >
            <View className="p-2 rounded-xl mr-3" style={{ backgroundColor: item.bg }}>
              {item.icon}
            </View>
            <View className="flex-1">
              <Text className="font-bold text-sm mb-1" style={{ color: theme.text }}>{item.title}</Text>
              <Text className="text-xs leading-relaxed" style={{ color: theme.textSecondary }}>{item.desc}</Text>
            </View>
          </View>
        ))}

        {offerPrivacyOptions ? (
          <TouchableOpacity
            onPress={() => {
              void showPrivacyOptionsForm();
            }}
            accessibilityRole="button"
            className="mt-2 py-3 items-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-xs font-semibold underline" style={{ color: theme.textSecondary }}>
              {t('adPrivacySettings')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      {/* Anchored below the scroll area rather than inside it: a banner that scrolls with the
          content can sit under a finger reaching for the transcribe button. */}
      <AdBanner />
    </SafeAreaView>
  );
}
