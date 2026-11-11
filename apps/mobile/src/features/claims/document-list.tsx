import type { ClaimDocument } from '@northwind/contracts';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { documentStatusCopy, scanStatusCopy } from './status-copy';

/** The documents submitted with a claim, with upload and scan state. */
export function DocumentList({ documents }: { documents: ClaimDocument[] }) {
  if (documents.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No documents.
      </ThemedText>
    );
  }

  return (
    <View style={styles.container}>
      {documents.map((document) => (
        <View key={document.documentId} style={styles.row}>
          <ThemedText type="small">{document.fileName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {documentStatusCopy(document.status)} · {scanStatusCopy(document.scanStatus)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { paddingVertical: Spacing.one },
});
