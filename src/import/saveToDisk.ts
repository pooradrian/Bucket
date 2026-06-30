export async function saveToDisk(filePath: string, mimeType: string, fileName?: string): Promise<void> {
  const {saveDocuments} = await import('@react-native-documents/picker');
  const sourceUri = `file://${filePath}`;
  const result = await saveDocuments({
    sourceUris: [sourceUri],
    mimeType,
    fileName: fileName || filePath.split('/').pop(),
  });
  if (result[0]?.error) {
    throw new Error(result[0].error);
  }
}
