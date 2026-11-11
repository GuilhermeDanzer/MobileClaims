import { useTheme } from '@/hooks/use-theme';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Lightweight in-app header used on screens where the native stack header is disabled. */
export function ScreenHeader({ title }: { title: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ThemedText type="smallBold" style={styles.backLabel}>
          ‹
        </ThemedText>
      </Pressable>
      <ThemedText type="subtitle" numberOfLines={2} style={styles.title}>
        {title}
      </ThemedText>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  back: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.one,
    paddingRight: Spacing.two,
  },
  pressed: { opacity: 0.6 },
  backLabel: { color: theme.primary, fontSize: 28, lineHeight: 32 },
  title: { flex: 1, flexShrink: 1 },
});
