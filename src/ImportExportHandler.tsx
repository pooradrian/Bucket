import {useState, useCallback} from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {pick, types} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {useAppStore} from './store';
import {useTheme} from './ThemeContext';
import {
  detectImportFormat,
  importCharacter,
  importBuk,
  exportCCV1,
  exportCCV2,
  exportBuk,
  saveToDisk,
  ExportFormat,
  ExportOptions,
} from './ImportExport';
import {getAllCharactersFromDB} from './Database';

interface ImportExportHandlerProps {
  bottomInset: number;
}

export default function ImportExportHandler({bottomInset}: ImportExportHandlerProps) {
  const st = useTheme();
  const {loadCharacters, loadLorebooks, loadSettings, appSettings} = useAppStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeLorebooks, setIncludeLorebooks] = useState(true);
  const [includeChats, setIncludeChats] = useState(true);
  const [chars, setChars] = useState<Array<{id: string; name: string}>>([]);

  const handleImport = useCallback(async () => {
    try {
      const result = await pick({
        type: [types.allFiles],
      });

      if (!result || result.length === 0) return;

      setImporting(true);
      const file = result[0];
      const format = await detectImportFormat(file.uri, file.name || '');

      if (format === 'buk') {
        const imported = await importBuk(file.uri);
        let message = `Imported ${imported.characters.length} characters`;
        if (imported.lorebooks.length > 0) {
          message += `, ${imported.lorebooks.length} lorebooks`;
        }
        if (imported.sessions.length > 0) {
          message += `, ${imported.sessions.length} chat sessions`;
        }
        if (imported.settings) {
          message += ', and settings';
        }
        if (imported.skippedCharacters.length > 0) {
          message += `\n\nSkipped ${imported.skippedCharacters.length} duplicate(s): ${imported.skippedCharacters.join(', ')}`;
        }

        await loadCharacters();
        await loadLorebooks();
        await loadSettings();

        Alert.alert('Import Complete', message);
      } else {
        const imported = await importCharacter(file.uri);
        await loadCharacters();

        const formatName = format === 'ccv1' ? 'Character Card V1' : 'Character Card V2';
        Alert.alert('Import Complete', `Imported "${imported.character.name}" as ${formatName}`);
      }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as {code: string}).code === 'OPERATION_CANCELED') return;
      Alert.alert('Import Failed', e instanceof Error ? e.message : 'Could not import file');
    } finally {
      setImporting(false);
    }
  }, [loadCharacters, loadLorebooks, loadSettings]);

  const handleShowExport = useCallback(async () => {
    const allChars = await getAllCharactersFromDB();
    setChars(allChars.map(c => ({id: c.id, name: c.name})));
    setSelectedChars(allChars.map(c => c.id));
    setSelectedFormat(null);
    setIncludeSettings(true);
    setIncludeLorebooks(true);
    setIncludeChats(true);
    setExportModalVisible(true);
  }, []);

  const handleExport = useCallback(async () => {
    if (!selectedFormat) return;

    setExporting(true);
    try {
      if (selectedFormat === 'ccv1') {
        const exportedChars = (await getAllCharactersFromDB())
          .filter(c => selectedChars.includes(c.id))
          .map(c => ({
            id: c.id, name: c.name, description: c.description,
            initialMessage: c.initial_message, writingStyle: c.writing_style,
            personality: c.personality, scenario: c.scenario,
            exampleMessages: c.example_messages || undefined,
            lorebookIds: c.lorebook_id ? c.lorebook_id.split(',').filter(Boolean) : [], icon: c.icon || undefined,
          }));
        const path = await exportCCV1(exportedChars);
        await saveToDisk(path, 'application/json', 'characters.json');
      } else if (selectedFormat === 'ccv2') {
        const exportedChars = (await getAllCharactersFromDB())
          .filter(c => selectedChars.includes(c.id))
          .map(c => ({
            id: c.id, name: c.name, description: c.description,
            initialMessage: c.initial_message, writingStyle: c.writing_style,
            personality: c.personality, scenario: c.scenario,
            exampleMessages: c.example_messages || undefined,
            lorebookIds: c.lorebook_id ? c.lorebook_id.split(',').filter(Boolean) : [], icon: c.icon || undefined,
          }));
        const paths = await exportCCV2(exportedChars);
        if (paths.length === 1) {
          const fileName = paths[0].split('/').pop() || 'character.png';
          await saveToDisk(paths[0], 'image/png', fileName);
        } else {
          const zip = new JSZip();
          for (const p of paths) {
            const fileName = p.split('/').pop() || 'character.png';
            const base64 = await RNFS.readFile(p, 'base64');
            zip.file(fileName, base64, {base64: true});
          }
          const zipBase64 = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
          const zipPath = `${RNFS.CachesDirectoryPath}/characters.zip`;
          await RNFS.writeFile(zipPath, zipBase64, 'base64');
          await saveToDisk(zipPath, 'application/zip', 'characters.zip');
        }
      } else {
        const options: ExportOptions = {
          format: 'buk',
          characterIds: selectedChars,
          includeSettings,
          includeLorebooks,
          includeChats,
        };
        const path = await exportBuk(options);
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        await saveToDisk(path, 'application/octet-stream', `${dateStr}@${timeStr}.buk`);
      }

      setExportModalVisible(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'User did not share') {
        Alert.alert('Export Failed', msg || 'Could not export');
      }
    } finally {
      setExporting(false);
    }
  }, [selectedFormat, selectedChars, includeSettings, includeLorebooks, includeChats]);

  const toggleChar = useCallback((id: string) => {
    setSelectedChars(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  }, []);

  const ac = appSettings.accentColor;
  const bg = appSettings.bgPrimary;

  const formatBtnStyle = (fmt: ExportFormat) => [
    st.settingsToggleButton,
    {marginBottom: 8, backgroundColor: selectedFormat === fmt ? ac : 'transparent'},
  ];

  const formatTextStyle = (fmt: ExportFormat) => [
    st.settingsToggleText,
    {color: selectedFormat === fmt ? bg : ac},
  ];

  const charBtnStyle = (id: string) => [
    st.settingsToggleButton,
    {marginBottom: 6, backgroundColor: selectedChars.includes(id) ? ac : 'transparent'},
  ];

  const charTextStyle = (id: string) => [
    st.settingsToggleText,
    {color: selectedChars.includes(id) ? bg : ac},
  ];

  return (
    <>
      <TouchableOpacity
        style={st.card}
        onPress={handleImport}
        disabled={importing}>
        <Text style={st.cardTitle}>
          {importing ? 'Importing...' : 'Import'}
        </Text>
        <Text style={st.cardDescription}>
          Supports Character Card V1, V2, and .buk files
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={st.card}
        onPress={handleShowExport}
        disabled={exporting}>
        <Text style={st.cardTitle}>
          {exporting ? 'Exporting...' : 'Export'}
        </Text>
        <Text style={st.cardDescription}>
          Export as CC V1, CC V2, or .buk bundle
        </Text>
      </TouchableOpacity>

      <Modal
        visible={exportModalVisible}
        animationType="slide"
        transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.7)',
          justifyContent: 'flex-end',
        }}>
          <View style={{
            backgroundColor: bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '80%',
            paddingBottom: bottomInset + 20,
          }}>
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: appSettings.borderPrimary,
            }}>
              <Text style={{color: appSettings.textPrimary, fontSize: 17, fontWeight: '600'}}>
                Export
              </Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Text style={{color: ac, fontSize: 16}}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{padding: 16}} contentContainerStyle={{paddingBottom: 20}}>
              <Text style={{color: ac, fontSize: 14, fontWeight: '600', marginBottom: 10}}>
                Format
              </Text>

              {(['ccv1', 'ccv2', 'buk'] as ExportFormat[]).map(fmt => (
                <TouchableOpacity
                  key={fmt}
                  style={formatBtnStyle(fmt)}
                  onPress={() => setSelectedFormat(fmt)}>
                  <Text style={formatTextStyle(fmt)}>
                    {fmt === 'ccv1' ? 'Character Card V1' : fmt === 'ccv2' ? 'Character Card V2' : 'Bucket (.buk)'}
                  </Text>
                </TouchableOpacity>
              ))}

              {selectedFormat === 'buk' && (
                <>
                  <Text style={{color: ac, fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 10}}>
                    Include
                  </Text>

                  {[
                    {key: 'settings', label: 'Settings', value: includeSettings, setter: setIncludeSettings},
                    {key: 'lorebooks', label: 'Lorebooks', value: includeLorebooks, setter: setIncludeLorebooks},
                    {key: 'chats', label: 'Chat History', value: includeChats, setter: setIncludeChats},
                  ].map(item => (
                    <TouchableOpacity
                      key={item.key}
                      style={[st.settingsToggleButton, {
                        marginBottom: 8,
                        backgroundColor: item.value ? ac : 'transparent',
                      }]}
                      onPress={() => item.setter(!item.value)}>
                      <Text style={[st.settingsToggleText, {
                        color: item.value ? bg : ac,
                      }]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {selectedFormat && (
                <>
                  <Text style={{color: ac, fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 10}}>
                    Characters ({selectedChars.length}/{chars.length})
                  </Text>

                  <TouchableOpacity
                    style={st.settingsToggleButton}
                    onPress={() => setSelectedChars(
                      selectedChars.length === chars.length ? [] : chars.map(c => c.id)
                    )}>
                    <Text style={st.settingsToggleText}>
                      {selectedChars.length === chars.length ? 'Deselect All' : 'Select All'}
                    </Text>
                  </TouchableOpacity>

                  <View style={{marginTop: 10}}>
                    {chars.map(char => (
                      <TouchableOpacity
                        key={char.id}
                        style={charBtnStyle(char.id)}
                        onPress={() => toggleChar(char.id)}>
                        <Text style={charTextStyle(char.id)}>
                          {char.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {selectedFormat && selectedChars.length > 0 && (
                <TouchableOpacity
                  style={[st.card, {marginTop: 16, backgroundColor: ac, alignItems: 'center'}]}
                  onPress={handleExport}
                  disabled={exporting}>
                  <Text style={[st.cardTitle, {color: bg}]}>
                    {exporting ? 'Exporting...' : 'Export Now'}
                  </Text>
                </TouchableOpacity>
              )}

              {selectedFormat && selectedChars.length === 0 && (
                <Text style={{color: appSettings.textMuted, fontSize: 14, textAlign: 'center', marginTop: 20}}>
                  Select at least one character to export
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
