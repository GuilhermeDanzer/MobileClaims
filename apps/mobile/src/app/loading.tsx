import { ActivityIndicator, StyleSheet, View } from 'react-native';

/** Shown only while the session is restored from SecureStore on cold start. */
export default function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
