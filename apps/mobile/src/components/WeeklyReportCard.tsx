import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { ProUpsell } from '@/components/ProUpsell';
import { useWeeklyReport } from '@/hooks/useWeeklyReport';
import { useSubscription } from '@/lib/subscription';
import { ReportErrorCode } from '@/lib/weeklyReport';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

function errorKey(code: string | null): I18nKey | null {
  switch (code) {
    case ReportErrorCode.TOO_SOON:
      return 'report.errTooSoon';
    case ReportErrorCode.NOT_ENTITLED:
      return 'report.errNotEntitled';
    case null:
      return null;
    default:
      return 'report.errGeneric';
  }
}

/**
 * The Pro AI weekly report on Trends: shows the latest cached report and a
 * generate/regenerate button. Non-Pro users see the upsell. Generation is
 * user-initiated only (server rate-limits to one per 6 days).
 */
export function WeeklyReportCard(): React.ReactElement {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { isPro } = useSubscription();
  const { report, generating, errorCode, generate } = useWeeklyReport();

  const errKey = errorKey(errorCode);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.section}>{t('report.title')}</Text>
        <View style={styles.proTag}>
          <Ionicons name="sparkles" size={11} color={colors.white} />
          <Text style={styles.proText}>{t('report.pro')}</Text>
        </View>
      </View>

      {!isPro ? (
        <ProUpsell feature={t('report.title')} />
      ) : (
        <View style={styles.card}>
          {report ? (
            <>
              <CoachMarkdown text={report.markdown} />
              <Text style={styles.stamp}>
                {t('report.generatedOn', { date: report.generatedAt.toLocaleDateString() })}
              </Text>
            </>
          ) : (
            <Text style={styles.empty}>{t('report.empty')}</Text>
          )}

          {errKey ? <Text style={styles.error}>{t(errKey)}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, generating && styles.btnOff]}
            disabled={generating}
            onPress={() => { haptics.tap(); void generate(); }}
            testID="report-generate"
          >
            {generating ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.btnText}>{t(report ? 'report.regenerate' : 'report.generate')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { marginTop: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  section: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
  proTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  proText: { color: colors.white, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  empty: { fontSize: font.body, color: colors.muted, lineHeight: 21 },
  stamp: { fontSize: font.tiny, color: colors.faint },
  error: { fontSize: font.small, color: colors.accent },
  btn: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  btnOff: { opacity: 0.5 },
  btnText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
});
