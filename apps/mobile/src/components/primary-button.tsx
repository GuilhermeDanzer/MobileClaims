import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

/** Shared action styles with distinct enabled and disabled states. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const backgrounds = { primary: theme.primary, secondary: theme.secondary, destructive: theme.destructive };
  const foregrounds = { primary: theme.onPrimary, secondary: theme.onSecondary, destructive: theme.onDestructive };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        style,
        { backgroundColor: disabled ? theme.disabled : backgrounds[variant] },
        pressed && !disabled && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={{ color: disabled ? theme.onDisabled : foregrounds[variant] }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  pressed: { opacity: 0.6 },
});
