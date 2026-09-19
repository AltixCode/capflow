import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Captions,
  BadgeCheck,
  Layers,
  ShoppingBag,
  Tag,
  ShieldCheck,
  X,
} from "lucide-react-native";
import { usePaywall } from "../src/hooks/usePaywall";
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from "../src/config/legal";
import { t } from "../src/i18n";
import { useTheme } from '../src/theme/useTheme';
import { useTabletColumn } from '../src/theme/useTabletColumn';

export default function PaywallScreen() {
  const theme = useTheme();
  const tabletColumn = useTabletColumn(640);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ctaLabel, loading, errorMsg, handlePurchase, handleRestore } =
    usePaywall(() => router.back());

  const entries = [
    { icon: <BadgeCheck size={18} color={theme.primary} />, title: t("featAdsTitle"), desc: t("featAdsDesc") },
    { icon: <Layers size={18} color={theme.accent} />, title: t("feat1Title"), desc: t("feat1Desc") },
    { icon: <ShoppingBag size={18} color={theme.purple} />, title: t("feat2Title"), desc: t("feat2Desc") },
    { icon: <Tag size={18} color={theme.warning} />, title: t("feat3Title"), desc: t("feat3Desc") },
    { icon: <ShieldCheck size={18} color={theme.success} />, title: t("feat4Title"), desc: t("feat4Desc") },
  ];

  return (
    <View className="flex-1 px-6 py-4" style={{ backgroundColor: theme.background }}>
      <View className="mb-1 flex-row items-center justify-between">
        <Captions size={22} color={theme.primary} />
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("cancel")}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="rounded-full p-2" style={{ backgroundColor: theme.card }}
        >
          <X size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ ...tabletColumn }}>
          <Text className="mb-1 text-2xl font-extrabold" style={{ color: theme.text }}>
            {t("paywallTitle")}
          </Text>
          <Text className="mb-6 text-sm italic leading-relaxed" style={{ color: theme.textSecondary }}>
            {t("antiSubDesc")}
          </Text>

          <View>
            {entries.map((e, i) => (
              <View
                key={e.title}
                className="py-3.5"
                style={i > 0 ? { borderTopWidth: 1, borderColor: theme.cardBorder } : undefined}
              >
                <View className="flex-row items-center">
                  {e.icon}
                  <Text className="ml-2 text-sm font-extrabold" style={{ color: theme.text }}>
                    {e.title}
                  </Text>
                </View>
                <Text className="mt-1 text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
                  {e.desc}
                </Text>
              </View>
            ))}
          </View>

          {errorMsg ? (
            <Text
              accessibilityRole="alert"
              className="mt-3 text-center text-xs" style={{ color: theme.danger }}
            >
              {errorMsg}
            </Text>
          ) : null}
        </ScrollView>

        <View
          className="pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <TouchableOpacity
            onPress={handlePurchase}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: loading, busy: loading }}
            className={`min-h-[56px] flex-row items-center justify-center rounded-2xl p-4 ${
              loading ? "bg-blue-900" : "bg-blue-600 active:bg-blue-500"
            }`}
          >
            {loading ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <Text className="text-base font-extrabold" style={{ color: theme.onPrimary }}>
                {ctaLabel}
              </Text>
            )}
          </TouchableOpacity>

          <Text className="mt-3 text-center text-xs" style={{ color: theme.textMuted }}>
            {t("oneTimePayment")}
          </Text>

          <View className="mt-3 flex-row items-center justify-center gap-5">
            <TouchableOpacity
              onPress={handleRestore}
              disabled={loading}
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text className="text-xs underline" style={{ color: theme.textSecondary }}>
                {t("restorePurchases")}
              </Text>
            </TouchableOpacity>
            <Text className="text-xs" style={{ color: theme.textMuted }}>•</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(TERMS_OF_USE_URL)}
              accessibilityRole="link"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text className="text-xs underline" style={{ color: theme.textMuted }}>
                {t("termsOfUse")}
              </Text>
            </TouchableOpacity>
            <Text className="text-xs" style={{ color: theme.textMuted }}>•</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
              accessibilityRole="link"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text className="text-xs underline" style={{ color: theme.textMuted }}>
                {t("privacyPolicy")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
