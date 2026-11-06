import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { formatBytes } from '../Attachments';
import {
  CrashBackup,
  deleteCrashBackup,
  exportCrashBackup,
  listCrashBackups,
  totalBackupSize,
} from '../CrashBackups';
import { useTheme } from '../ThemeContext';
import { MutedNote } from './ui';

export default function CrashBackupsView() {
  const st = useTheme();
  const [backups, setBackups] = useState<CrashBackup[] | null>(null);

  const refresh = useCallback(async () => {
    setBackups(await listCrashBackups());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleExport = async (backup: CrashBackup) => {
    try {
      await exportCrashBackup(backup);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'User did not share') {
        Alert.alert('Export failed', 'Could not export this backup.');
      }
    }
  };

  const handleDelete = (backup: CrashBackup) => {
    Alert.alert('Delete backup?', `${backup.name} will be removed for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCrashBackup(backup.path);
          refresh();
        },
      },
    ]);
  };

  const handleWipe = () => {
    if (!backups?.length) return;
    Alert.alert(
      'Delete all crash backups?',
      `This removes ${backups.length} backup${backups.length === 1 ? '' : 's'} (${formatBytes(totalBackupSize(backups))}) for good.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: async () => {
            await Promise.all(backups.map(b => deleteCrashBackup(b.path)));
            refresh();
          },
        },
      ],
    );
  };

  if (backups === null) return null;

  return (
    <>
      <View style={st.card}>
        <Text style={st.cardTitle}>
          {formatBytes(totalBackupSize(backups))} used
        </Text>
        <Text style={st.cardDescription}>
          {backups.length} backup{backups.length === 1 ? '' : 's'}
        </Text>
        {backups.length > 0 ? (
          <TouchableOpacity
            style={[st.cardButton, { marginTop: 12, alignSelf: 'flex-start' }]}
            onPress={handleWipe}
          >
            <Text style={st.cardButtonText}>Delete all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <MutedNote>
        Bucket saves a full backup automatically after a crash. They are stored
        unencrypted on this device, so export what you need and delete the rest.
      </MutedNote>
      {backups.map(b => (
        <View key={b.path} style={[st.card, { marginBottom: 10 }]}>
          <Text style={st.cardTitle}>{b.name}</Text>
          <Text style={st.cardDescription}>
            {formatBytes(b.size)}
            {b.time ? ` · ${new Date(b.time).toLocaleString()}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity
              style={st.cardButton}
              onPress={() => handleExport(b)}
            >
              <Text style={st.cardButtonText}>Export</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.cardButton}
              onPress={() => handleDelete(b)}
            >
              <Text style={st.cardButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </>
  );
}
