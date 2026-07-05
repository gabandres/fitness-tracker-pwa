import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rescaleScannedItem, sumScannedMacros, type ScannedFoodItem } from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { useToday } from '@/hooks/useToday';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { analyzeMealPhoto, captureMealPhoto, type ScanSource } from '@/lib/mealScan';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

type Phase = 'intro' | 'analyzing' | 'review';
const PORTION_STEPS = [0.5, 1, 1.5, 2] as const;

export default function Scan() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { addEntry } = useToday();

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<ScannedFoodItem | null>(null);
  const [lowConf, setLowConf] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onCapture(source: ScanSource) {
    haptics.tap();
    setError(null);
    const base64 = await captureMealPhoto(source);
    if (!base64) return; // cancelled or permission denied (no error banner on cancel)
    setPhase('analyzing');
    try {
      const scan = await analyzeMealPhoto(base64, locale);
      const first = scan.items[0];
      if (!first) throw new Error('empty');
      setItem(first);
      setLowConf(scan.confidence === 'low');
      setPhase('review');
      haptics.success();
    } catch {
      setError(t('scan.failed'));
      setPhase('intro');
      haptics.warning();
    }
  }

  /** Portion chips rescale from the current item (macros are linear in grams;
   *  for a whole-meal total with grams=0 we scale the macros directly). */
  function applyPortion(mult: number) {
    if (!item) return;
    haptics.tap();
    setItem((prev) => (prev ? scalePortion(prev, mult) : prev));
  }

  function editMacro(key: 'calories' | 'protein' | 'carbs' | 'fat', raw: string) {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    setItem((prev) => (prev ? { ...prev, [key]: Number.isFinite(n) ? n : 0 } : prev));
  }

  async function onAdd() {
    if (!item || saving) return;
    setSaving(true);
    try {
      await addEntry({
        calories: Math.round(item.calories),
        protein: Math.round(item.protein),
        carbs: Math.round(item.carbs),
        fat: Math.round(item.fat),
        mealLabel: item.name.trim() || t('scan.mealName'),
      });
      haptics.success();
      router.replace('/(app)'); // back to Today — rings re-sweep to the new total
    } finally {
      setSaving(false);
    }
  }

  const total = item ? sumScannedMacros([item]) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <PressScale style={styles.back} onPress={() => router.back()} scaleTo={0.9} testID="scan-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </PressScale>
        <Text style={styles.title}>{t('scan.title')}</Text>
        <HeaderAvatar />
      </View>

      {phase === 'analyzing' ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.analyzing}>{t('scan.analyzing')}</Text>
        </View>
      ) : phase === 'review' && item && total ? (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            {lowConf ? (
              <Animated.View style={styles.lowConf} entering={enterUp(0)}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.ink} />
                <Text style={styles.lowConfText}>{t('scan.lowConf')}</Text>
              </Animated.View>
            ) : null}

            {/* Hero total (the reward moment), on the shared dark panel. */}
            <Animated.View style={styles.heroPanel} entering={enterUp(lowConf ? 1 : 0)}>
              <View style={styles.hero}>
                <CountUpText value={Math.round(total.calories)} style={styles.heroValue} testID="scan-calories" />
                <Text style={styles.heroUnit}>kcal</Text>
              </View>
              <TextInput
                style={styles.nameInput}
                value={item.name}
                onChangeText={(v) => setItem((prev) => (prev ? { ...prev, name: v } : prev))}
                placeholder={t('scan.mealName')}
                placeholderTextColor={colors.heroMuted}
                testID="scan-name"
              />
            </Animated.View>

            {/* Portion */}
            <Animated.View entering={enterUp(2)}>
              <Text style={styles.section}>{t('scan.portion')}</Text>
              <View style={styles.portionRow}>
                {PORTION_STEPS.map((p) => (
                  <PressScale key={p} style={styles.portionChip} scaleTo={0.92} onPress={() => applyPortion(p)} testID={`portion-${p}`}>
                    <Text style={styles.portionText}>{p === 1 ? '1×' : `${p}×`}</Text>
                  </PressScale>
                ))}
              </View>
            </Animated.View>

            {/* Editable macros */}
            <Animated.View style={styles.macroGrid} entering={enterUp(3)}>
              <MacroField label={t('history.protein')} value={item.protein} onChange={(v) => editMacro('protein', v)} testID="scan-protein" styles={styles} />
              <MacroField label={t('today.carbs')} value={item.carbs} onChange={(v) => editMacro('carbs', v)} testID="scan-carbs" styles={styles} />
              <MacroField label={t('today.fat')} value={item.fat} onChange={(v) => editMacro('fat', v)} testID="scan-fat" styles={styles} />
              <MacroField label={t('today.calories')} value={item.calories} onChange={(v) => editMacro('calories', v)} testID="scan-cal" styles={styles} />
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <PressScale style={styles.retake} scaleTo={0.96} onPress={() => { haptics.tap(); setPhase('intro'); setItem(null); }} testID="scan-retake">
              <Text style={styles.retakeText}>{t('scan.retake')}</Text>
            </PressScale>
            <PressScale style={[styles.add, saving && styles.addDisabled]} scaleTo={0.97} onPress={onAdd} disabled={saving} testID="scan-add">
              <Text style={styles.addText}>{saving ? t('common.saving') : t('scan.addToday')}</Text>
            </PressScale>
          </View>
        </>
      ) : (
        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Animated.View style={styles.introCard} entering={enterUp(0)}>
            <View style={styles.cameraCircle}>
              <Ionicons name="camera" size={40} color={colors.onInk} />
            </View>
            <Text style={styles.introHint}>{t('scan.hint')}</Text>
          </Animated.View>
          <Animated.View entering={enterUp(1)}>
            <PressScale style={styles.primary} scaleTo={0.97} onPress={() => onCapture('camera')} testID="scan-take">
              <Ionicons name="camera-outline" size={20} color={colors.onInk} />
              <Text style={styles.primaryText}>{t('scan.take')}</Text>
            </PressScale>
          </Animated.View>
          <Animated.View entering={enterUp(2)}>
            <PressScale style={styles.secondary} scaleTo={0.97} onPress={() => onCapture('library')} testID="scan-choose">
              <Ionicons name="images-outline" size={20} color={colors.ink} />
              <Text style={styles.secondaryText}>{t('scan.choose')}</Text>
            </PressScale>
          </Animated.View>
          {/* Manual/text entry stays free forever (ADR-0015) — one tap away via
              Today's existing add sheet (openAdd nonce). */}
          <Animated.View entering={enterUp(3)}>
            <PressScale
              style={styles.manual}
              scaleTo={0.97}
              onPress={() => {
                haptics.tap();
                router.replace({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
              }}
              testID="scan-manual"
            >
              <Ionicons name="create-outline" size={18} color={colors.muted} />
              <Text style={styles.manualText}>{t('scan.manual')}</Text>
            </PressScale>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function MacroField({
  label,
  value,
  onChange,
  testID,
  styles,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  testID: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.macroField}>
      <Text style={styles.macroLabel}>{label}</Text>
      <TextInput
        style={styles.macroInput}
        value={String(Math.round(value))}
        onChangeText={onChange}
        keyboardType="numeric"
        selectTextOnFocus
        testID={testID}
      />
    </View>
  );
}

/** Scale a whole-meal item's macros by a portion factor from its current
 *  values (grams=0 case); rescaleScannedItem handles the grams-based path. */
function scalePortion(item: ScannedFoodItem, mult: number): ScannedFoodItem {
  if (item.grams > 0) return rescaleScannedItem(item, item.grams * mult);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...item,
    calories: Math.round(item.calories * mult),
    protein: round(item.protein * mult),
    carbs: round(item.carbs * mult),
    fat: round(item.fat * mult),
  };
}

function createStyles({ colors, shadow }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
    back: { padding: 2 },
    title: { flex: 1, fontFamily: type.display, fontSize: font.h2, color: colors.ink },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
    analyzing: { fontSize: font.body, color: colors.muted },
    body: { padding: space.xl, gap: space.md, flexGrow: 1 },
    error: { color: colors.danger, fontSize: font.small, textAlign: 'center' },
    // intro
    introCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
    cameraCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', ...shadow.e2 },
    introHint: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.lg, lineHeight: font.body * 1.4 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg },
    primaryText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.lg },
    secondaryText: { color: colors.ink, fontSize: font.h3, fontWeight: '700' },
    manual: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.md },
    manualText: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
    // review
    lowConf: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
    lowConfText: { flex: 1, fontSize: font.small, color: colors.ink },
    heroPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm, ...shadow.e2 },
    hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs },
    heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
    heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
    nameInput: { minWidth: 160, textAlign: 'center', color: colors.heroText, fontFamily: type.heading, fontSize: font.h3, paddingVertical: space.xs },
    section: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs },
    portionRow: { flexDirection: 'row', gap: space.sm },
    portionChip: { flex: 1, alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.md },
    portionText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    macroField: { width: '47%', gap: space.xs },
    macroLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    macroInput: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: font.h3, color: colors.ink },
    footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
    retake: { paddingHorizontal: space.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
    retakeText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    add: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    addDisabled: { opacity: 0.5 },
    addText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  });
}
