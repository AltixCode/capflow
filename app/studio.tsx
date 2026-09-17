import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
// The root export deprecated saveToLibraryAsync in SDK 57 and now throws a
// migration error instead of saving; the legacy entry point still works.
import * as MediaLibrary from 'expo-media-library/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Crown, Download, Type } from 'lucide-react-native';
import { useCaptionStore } from '../src/store/useCaptionStore';
import { CAPTION_STYLES } from '../src/presets/captionStyles';
import { cueAt } from '../src/engine/captionGrouper';
import { useTheme } from '../src/theme/useTheme';
import { useTabletColumn } from '../src/theme/useTabletColumn';
import { t } from '../src/i18n';
import { burner, encodePlan, onBurnProgress } from '../modules/caption-burner';
import { showInterstitial } from '../src/services/ads';
import { shouldShowInterstitial } from '../src/services/adPolicy';
import { useAdsStore } from '../src/store/adsStore';
import { CaptionOverlay } from '../src/components/CaptionOverlay';

export default function StudioScreen() {
  const theme = useTheme();
  const tabletColumn = useTabletColumn();
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { source, cues, styleId, progress, isPro, setStyle, setStage, setProgress } = useCaptionStore();

  // Built here rather than read through a store selector. The store's plan() is
  // a getter that returns a fresh object each call, so selecting it hands the
  // component a new reference on every render -- which re-renders, which
  // selects again. In release that is not a slow screen, it is a hard crash
  // ("Maximum update depth exceeded") the moment the studio opens.
  const plan = useMemo(() => useCaptionStore.getState().plan(), [source, cues, styleId]);

  const [time, setTime] = useState(0);
  const [exporting, setExporting] = useState(false);

  const player = useVideoPlayer(source?.uri ?? null, (instance) => {
    instance.loop = true;
    // The default interval is a quarter of a second, which on word-timed
    // captions is long enough to show the wrong one.
    instance.timeUpdateEventInterval = 0.05;
    instance.play();
  });

  useEffect(() => {
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      setTime(currentTime);
    });
    return () => subscription.remove();
  }, [player]);

  // The preview is the export, scaled. Laying the captions out a second time
  // for the screen is how a preview stops matching the file.
  //
  // Height is capped as well as width. A 9:16 clip fitted to the width alone
  // runs about 640pt tall, which pushes the style row and the export button off
  // the bottom of a phone screen -- the export button has to be reachable
  // without scrolling past the thing it exports.
  const { previewWidth, previewHeight, scale } = useMemo(() => {
    if (!source) return { previewWidth: 0, previewHeight: 0, scale: 1 };
    const maxWidth = Math.min(screenWidth - 40, 420);
    const maxHeight = screenHeight * 0.46;
    const fit = Math.min(maxWidth / source.size.width, maxHeight / source.size.height);
    return {
      previewWidth: source.size.width * fit,
      previewHeight: source.size.height * fit,
      scale: fit,
    };
  }, [source, screenWidth, screenHeight]);

  const activeIndex = useMemo(() => cueAt(cues, time), [cues, time]);
  const activeBox = plan && activeIndex >= 0 ? plan.boxes[activeIndex] : null;

  const maybeShowInterstitial = useCallback(async () => {
    const { completions, lastInterstitialAt, markInterstitialShown } = useAdsStore.getState();
    const decision = shouldShowInterstitial({
      completions,
      lastInterstitialAt,
      now: Date.now(),
      // Read at call time rather than captured: the user may have bought the upgrade from the
      // paywall between opening this screen and finishing the export.
      isPro: useCaptionStore.getState().isPro,
    });
    if (!decision) return;
    // Only a shown-and-dismissed ad resets the clock. Counting an unfilled request would
    // suppress the next several exports' ads for nothing.
    if (await showInterstitial()) await markInterstitialShown();
  }, []);

  const handleExport = useCallback(async () => {
    if (!source || !plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      Alert.alert(t('saveDenied'), t('saveDeniedDesc'));
      return;
    }

    // The preview holds a video decoder and redraws every frame while it
    // plays. The burn needs a decoder and an encoder of its own, and devices
    // cap how many codec instances exist at once -- so leaving playback running
    // is not merely wasteful, it is a burn that never receives a frame.
    player.pause();

    setExporting(true);
    setStage('burning', 0);
    const subscription = onBurnProgress(setProgress);
    try {
      const result = await burner.burn(source.uri, encodePlan(plan));
      await MediaLibrary.saveToLibraryAsync(result.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await useAdsStore.getState().recordCompletion();
      // The ad waits behind the confirmation. Interrupting the moment the export lands -- or
      // worse, while it runs -- is the version of this that gets one-star reviews; once the
      // user has read "saved" and tapped through, the work is done and the interruption costs
      // them nothing they were in the middle of.
      Alert.alert(t('exported'), t('exportedDesc'), [
        { text: t('ok'), onPress: () => void maybeShowInterstitial() },
      ]);
    } catch (error) {
      Alert.alert(t('exportFailed'), error instanceof Error ? error.message : String(error));
    } finally {
      subscription.remove();
      setExporting(false);
      setStage('ready');
      player.play();
    }
  }, [plan, source, setStage, setProgress, player, maybeShowInterstitial]);

  if (!source || !plan) {
    return (
      <SafeAreaView edges={['bottom']} className="flex-1 px-5 justify-center" style={{ backgroundColor: theme.background }}>
        <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('noVideoDesc')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 px-5" style={{ backgroundColor: theme.background }}>
      {/* `flex: 1`, or this scroll view and the element pinned below it fight
          for the bottom of the screen. A React Native flex child that sets no
          flex takes its CONTENT height, so once the content is taller than the
          room left it overflows into its sibling. Photographed on a 13" iPad
          listing frame as a page indicator cut in half by the button beneath
          it. Same defect as the ad-banner overlap fixed across the portfolio;
          these screens were missed because what sits below them is a button or
          a footer rather than a banner. */}
      <ScrollView
        style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, ...tabletColumn }}
      >
        <View className="items-center mt-4">
          <View
            style={{ width: previewWidth, height: previewHeight, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}
          >
            <VideoView
              player={player}
              style={{ width: previewWidth, height: previewHeight }}
              nativeControls
              contentFit="contain"
            />
            {activeBox ? (
              <CaptionOverlay box={activeBox} style={plan.style} scale={scale} />
            ) : null}
          </View>
        </View>

        <Text className="text-xs mt-3 mb-4 text-center" style={{ color: theme.textMuted }}>
          {t('previewHint')}
        </Text>

        <View className="flex-row items-center mb-2">
          <Type size={14} color={theme.textMuted} />
          <Text className="text-xs font-semibold tracking-widest ml-1.5" style={{ color: theme.textMuted }}>
            {t('styleTitle')}
          </Text>
          <Text className="text-[11px] ml-auto" style={{ color: theme.textMuted }}>
            {t('captionCount', { count: cues.length })}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5">
          {CAPTION_STYLES.map((item) => {
            const locked = item.pro && !isPro;
            const selected = item.id === styleId;
            return (
              <TouchableOpacity
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected, disabled: locked }}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (locked) router.push('/paywall');
                  else setStyle(item.id);
                }}
                className="mr-2 px-4 py-3 rounded-2xl border flex-row items-center"
                style={{
                  minHeight: 44,
                  backgroundColor: selected ? theme.primaryLight : theme.card,
                  borderColor: selected ? theme.primary : theme.cardBorder,
                }}
              >
                <Text className="text-sm font-bold" style={{ color: selected ? theme.primary : theme.text }}>
                  {item.label}
                </Text>
                {locked ? <Crown size={13} color={theme.warning} style={{ marginLeft: 6 }} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          onPress={handleExport}
          disabled={exporting}
          accessibilityRole="button"
          className="p-4 rounded-2xl flex-row items-center justify-center"
          style={{ backgroundColor: exporting ? theme.controlSurface : theme.primary }}
        >
          {exporting ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <Download size={18} color={theme.onPrimary} />
          )}
          <Text
            className="font-bold text-base ml-2"
            style={{ color: exporting ? theme.textSecondary : theme.onPrimary }}
          >
            {exporting ? t('exporting', { percent: Math.round(progress * 100) }) : t('export')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
