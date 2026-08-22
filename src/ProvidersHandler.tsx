import {useEffect, useState, useCallback} from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {
  Provider,
  getProviders,
  setActiveProviderId,
  saveProviders,
  setProviderKey,
  getProviderKey,
  deleteProvider,
  maskKey,
} from './SecureStore';
import {useTheme} from './ThemeContext';

interface ProvidersHandlerProps {
  activeProviderId: string;
  onSelect: (providerId: string) => void;
}

export default function ProvidersHandler({activeProviderId, onSelect}: ProvidersHandlerProps) {
  const st = useTheme();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [editUrlText, setEditUrlText] = useState('');
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});

  const refreshProviders = useCallback(async () => {
    const list = getProviders();
    setProviders(list);
    const keys: Record<string, string> = {};
    for (const p of list) {
      const key = await getProviderKey(p.id);
      if (key) {keys[p.id] = maskKey(key);}
    }
    setProviderKeys(keys);
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const handleSelect = useCallback(async (id: string) => {
    setActiveProviderId(id);
    onSelect(id);
  }, [onSelect]);

  const handleRemove = useCallback((provider: Provider) => {
    Alert.alert(
      'Remove Provider',
      `Remove "${provider.name}"? This cannot be undone.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteProvider(provider.id);
            refreshProviders();
          },
        },
      ],
    );
  }, [refreshProviders]);

  const handleSaveUrl = useCallback(async (id: string) => {
    const trimmed = editUrlText.trim();
    if (!trimmed) {return;}
    const list = getProviders();
    const updated = list.map(p => p.id === id ? {...p, url: trimmed} : p);
    saveProviders(updated);
    setEditingUrlId(null);
    refreshProviders();
  }, [editUrlText, refreshProviders]);

  const renderProvider = ({item}: {item: Provider}) => {
    const isActive = item.id === activeProviderId;
    const isEditing = editingUrlId === item.id;
    return (
      <TouchableOpacity
        onPress={() => handleSelect(item.id)}
        activeOpacity={0.7}
        style={[st.settingsLorebookItem, isActive && {backgroundColor: st.bgSecondary.backgroundColor}]}>
        <View style={st.settingsLorebookItemInfo}>
          <Text style={st.settingsLorebookItemName}>
            {item.name}
          </Text>
          {isEditing ? (
            <View style={st.providerUrlRow}>
              <TextInput
                style={[st.settingsInput, st.providerUrlInput]}
                value={editUrlText}
                onChangeText={setEditUrlText}
                onSubmitEditing={() => handleSaveUrl(item.id)}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              <TouchableOpacity
                onPress={() => handleSaveUrl(item.id)}
                style={[st.cardButton, st.providerUrlOkBtn]}>
                <Text style={st.cardButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text
              style={st.settingsLorebookItemCount}
              numberOfLines={1}>
              {item.url}
            </Text>
          )}
          <Text style={st.settingsLorebookItemCount}>
            {providerKeys[item.id] ? `Key: ${providerKeys[item.id]}` : 'No API key (local)'}
          </Text>
        </View>
        <View style={st.providerActionsRow}>
          {!isEditing && (
            <TouchableOpacity
              onPress={() => {
                setEditingUrlId(item.id);
                setEditUrlText(item.url);
              }}
              style={[st.cardActionBtn, st.providerActionBtn]}>
              <Text style={st.cardActionBtnText}>URL</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => handleRemove(item)}
            style={st.settingsLorebookRemoveBtn}>
            <Text style={st.settingsLorebookRemoveBtnText}>×</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <FlatList
        data={providers}
        keyExtractor={item => item.id}
        renderItem={renderProvider}
        scrollEnabled={false}
        ListEmptyComponent={
          <Text style={st.settingsLorebookEmptyText}>
            No providers configured
          </Text>
        }
      />
      <TouchableOpacity
        onPress={() => setShowAddModal(true)}
        style={[st.card, st.providerAddCard]}>
        <Text style={st.cardTitle}>+ Add Provider</Text>
        <Text style={st.cardDescription}>
          Add an API endpoint (key optional for local servers)
        </Text>
      </TouchableOpacity>

      <AddProviderModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={async (id) => {
          setShowAddModal(false);
          await refreshProviders();
          handleSelect(id);
        }}
      />
    </View>
  );
}

interface AddProviderModalProps {
  visible: boolean;
  onClose: () => void;
  onAdded: (id: string) => void;
}

function AddProviderModal({visible, onClose, onAdded}: AddProviderModalProps) {
  const st = useTheme();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const slide = useSharedValue(300);
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: slide.value}],
  }));

  useEffect(() => {
    if (visible) {
      slide.value = withTiming(0, {duration: 250});
    } else {
      slide.value = 300;
    }
  }, [visible, slide]);

  const handleAdd = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedName || !trimmedUrl) {
      Alert.alert('Missing fields', 'Name and URL are required.');
      return;
    }
    const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8);
    const providers = getProviders();
    providers.push({id, name: trimmedName, url: trimmedUrl});
    saveProviders(providers);
    if (trimmedKey) {
      await setProviderKey(id, trimmedKey);
    }
    setName('');
    setUrl('');
    setApiKey('');
    onAdded(id);
  }, [name, url, apiKey, onAdded]);

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <View style={st.groupEditorOverlay}>
        <Animated.View style={[st.groupEditorContent, contentStyle]}>
          <View style={st.groupEditorHeader}>
            <Text style={st.groupEditorTitle}>Add Provider</Text>
            <TouchableOpacity onPress={onClose} style={st.groupEditorCloseBtn}>
              <Text style={st.groupEditorCloseBtnText}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={[st.groupEditorBody, {paddingBottom: 24}]}>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Name</Text>
              <TextInput
                style={st.settingsInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. OpenAI, Claude, Local"
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Base URL</Text>
              <TextInput
                style={st.settingsInput}
                value={url}
                onChangeText={setUrl}
                placeholder="https://api.openai.com/v1"
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>API Key (optional for local servers)</Text>
              <TextInput
                style={st.settingsInput}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk-... (leave empty for local)"
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={st.settingsDefaultText}>
                Stored securely in device keychain
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleAdd}
              disabled={!name.trim() || !url.trim()}
              style={[st.groupEditorSaveBtn, (!name.trim() || !url.trim()) && {opacity: 0.4}]}>
              <Text style={st.groupEditorSaveBtnText}>Add Provider</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
