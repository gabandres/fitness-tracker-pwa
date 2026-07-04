import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/**
 * A deliberately small Markdown renderer for the coach's streamed answer. The
 * coach emits headings, bold, and bullet / numbered lists — not tables, links,
 * or code — so a full Markdown engine (and its dep weight) isn't worth it in
 * Expo Go. Anything unrecognised renders as plain text, so a stray token never
 * breaks the reply. Kept UI-only; the streaming/parsing lives in lib/coach.ts.
 */

/** Render `**bold**` spans inline; everything else is plain text. */
function inline(text: string, styles: ReturnType<typeof createStyles>): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <Text key={i} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function CoachMarkdown({ text }: { text: string }): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const lines = text.split('\n');
  return (
    <View>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (line.trim() === '') return <View key={i} style={styles.gap} />;

        // Headings (#, ##, ###) → one styled size; the coach nests shallowly.
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Text key={i} style={styles.heading}>
              {inline(heading[2], styles)}
            </Text>
          );
        }

        // Bullets (-, *, •).
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={styles.listText}>{inline(bullet[1], styles)}</Text>
            </View>
          );
        }

        // Numbered lists (1. …).
        const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
        if (numbered) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={styles.bulletMark}>{numbered[1]}.</Text>
              <Text style={styles.listText}>{inline(numbered[2], styles)}</Text>
            </View>
          );
        }

        return (
          <Text key={i} style={styles.paragraph}>
            {inline(line, styles)}
          </Text>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  gap: { height: space.sm },
  heading: {
    fontSize: font.h3,
    fontWeight: '700',
    color: colors.ink,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  paragraph: {
    fontSize: font.body,
    lineHeight: 22,
    color: colors.ink,
    marginBottom: space.xs,
  },
  bold: { fontWeight: '700' },
  listRow: { flexDirection: 'row', marginBottom: space.xs, paddingLeft: space.xs },
  bulletMark: {
    fontSize: font.body,
    lineHeight: 22,
    color: colors.accent,
    marginRight: space.sm,
    minWidth: 16,
  },
  listText: { flex: 1, fontSize: font.body, lineHeight: 22, color: colors.ink },
});
