/** Shared semantic colors, typography, and spacing for light and dark mode. */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    primary: '#1565C0',
    onPrimary: '#FFFFFF',
    secondary: '#E3EFFF',
    onSecondary: '#174A8B',
    disabled: '#E0E1E6',
    onDisabled: '#60646C',
    error: '#C62828',
    destructive: '#C62828',
    onDestructive: '#FFFFFF',
    warning: '#7A5C00',
    warningBackground: '#FFF3CD',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: '#90CAF9',
    onPrimary: '#102A43',
    secondary: '#17385C',
    onSecondary: '#BBDFFF',
    disabled: '#2E3135',
    onDisabled: '#B0B4BA',
    error: '#FF8A80',
    destructive: '#FF8A80',
    onDestructive: '#4A1010',
    warning: '#FFE08A',
    warningBackground: '#3D310D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
