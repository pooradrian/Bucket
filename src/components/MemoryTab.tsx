import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  deleteMemoryFromDB,
  generateId,
  getAllMemoryListingsFromDB,
  getSessionById,
  saveMemoryToDB,
  updateMemoryInDB,
} from '../Database';
import type { SessionSummary } from '../Database';
import {
  DEFAULT_MEMORY_SETTINGS,
  loadMemorySettings,
  memoryScopeId,
  MemorySettings,
  saveAndIndexMemory,
  saveMemorySettings,
  StoredMemory,
} from '../Memory';
import { loadPromptConfig } from '../PromptHandler';
import type { PromptConfig } from '../PromptHandler';
import type { ChatMessage } from '../useChat';
import { useTheme } from '../ThemeContext';
import type { Character } from '../CharacterEditor';
import MemoryBackfillModal from './MemoryBackfillModal';
import { BoolToggle, MutedNote, OptionRow, SectionHeader, TextField } from '../settings/ui';

interface MemoryTabProps {
  character: Character;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  accent: string;
}

interface BackfillTarget {
  sessionId: string;
  scopeId: string;
  messages: ChatMessage[];
}

type MemoryListing = StoredMemory & { scopeLabel: string };

export default function MemoryTab({
  character,
  sessions,
  activeSessionId,
  accent,
}: MemoryTabProps) {
  const st = useTheme();
  const [settings, setSettings] = useState<MemorySettings>(() =>
    loadMemorySettings(character.id),
  );
  const [config, setConfig] = useState<PromptConfig | null>(null);
  const [memories, setMemories] = useState<MemoryListing[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [backfill, setBackfill] = useState<BackfillTarget | null>(null);
  const [backfillKey, setBackfillKey] = useState(0);
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettings = useRef<MemorySettings | null>(null);

  useEffect(() => {
    setSettings(loadMemorySettings(character.id));
  }, [character.id]);

  useEffect(() => {
    loadPromptConfig()
      .then(setConfig)
      .catch(e => console.warn('Failed to load prompt config:', e));
  }, []);

  const refresh = useCallback(async () => {
    const sessionIds = new Set(sessions.map(session => session.id));
    try {
      const rows = await getAllMemoryListingsFromDB();
      setMemories(
        rows.filter(row => {
          if (row.scopeId === `character:${character.id}`) return true;
          if (row.scopeId.startsWith('session:')) {
            return sessionIds.has(row.scopeId.slice('session:'.length));
          }
          return false;
        }),
      );
    } catch (e) {
      console.warn('Failed to load memories:', e);
    }
  }, [character.id, sessions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSettings.current = settings;
    saveTimer.current = setTimeout(() => {
      pendingSettings.current = null;
      saveMemorySettings(character.id, settings);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [settings, character.id]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingSettings.current;
      if (pending) {
        saveMemorySettings(character.id, pending);
      }
    },
    [character.id],
  );

  const update = <K extends keyof MemorySettings>(
    key: K,
    value: MemorySettings[K],
  ) => setSettings(prev => ({ ...prev, [key]: value }));

  const activeScopeId = memoryScopeId(
    settings.scope === 'session' ? 'session' : 'character',
    character.id,
    activeSessionId ?? '',
  );

  const scopeLabel = (scopeId: string) => {
    if (scopeId === `character:${character.id}`) return 'Character';
    const id = scopeId.slice('session:'.length);
    const session = sessions.find(item => item.id === id);
    return session?.name || 'Chat';
  };

  const startBackfill = async (sessionId: string, scopeId: string) => {
    setPickerOpen(false);
    setLoadingTarget(sessionId);
    try {
      const session = await getSessionById(sessionId);
      if (!session || session.messages.length === 0) {
        Alert.alert('Nothing to backfill', 'This chat has no messages yet.');
        return;
      }
      setBackfill({ sessionId, scopeId, messages: session.messages });
      setBackfillKey(key => key + 1);
    } catch (e) {
      console.warn('Failed to load chat for backfill:', e);
      Alert.alert('Backfill failed', 'Could not load the chat.');
    } finally {
      setLoadingTarget(null);
    }
  };

  const handleBackfillPress = () => {
    if (settings.scope === 'session') {
      if (!activeSessionId) {
        Alert.alert('No chat open', 'Open a chat before backfilling.');
        return;
      }
      startBackfill(activeSessionId, activeScopeId);
      return;
    }
    setPickerOpen(open => !open);
  };

  const addMemory = async () => {
    const text = newMemory.trim();
    if (!text) return;
    const scopeId =
      settings.scope === 'session'
        ? activeScopeId
        : `character:${character.id}`;
    try {
      if (config) {
        const stored = await saveAndIndexMemory(
          scopeId,
          text,
          config,
          activeSessionId ?? '',
        );
        if (!stored) {
          Alert.alert('Duplicate', 'This memory already exists.');
          return;
        }
      } else {
        const now = Date.now();
        await saveMemoryToDB({
          id: generateId(),
          scopeId,
          text,
          vector: [],
          vectorKey: '',
          sourceSessionId: activeSessionId ?? '',
          createdAt: now,
          updatedAt: now,
          lastUsedAt: 0,
          pinned: false,
        });
      }
      setNewMemory('');
      await refresh();
    } catch (e) {
      console.warn('Failed to add memory:', e);
      Alert.alert('Failed', 'Could not save the memory.');
    }
  };

  const saveEdit = async () => {
    const text = draft.trim();
    if (!editingId || !text) return;
    await updateMemoryInDB(editingId, { text });
    setEditingId(null);
    setDraft('');
    await refresh();
  };

  const remove = async (id: string) => {
    deleteMemoryFromDB(id);
    await refresh();
  };

  const togglePin = async (memory: StoredMemory) => {
    await updateMemoryInDB(memory.id, { pinned: !memory.pinned });
    await refresh();
  };

  const placeholderMissing =
    !config?.prefix.includes('$MEMORY$') && !config?.suffix.includes('$MEMORY$');

  return (
    <>
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <SectionHeader
          title={`Long-term memory · ${character.name}`}
        />
        <BoolToggle
          label="Enable long-term memory"
          note="After each reply a small model call extracts durable facts and caches retrieval queries for the next turn. On send, the cached queries and your message are embedded and matched against the stored facts. Settings apply to this character only."
          value={settings.enabled}
          accent={accent}
          onChange={value => update('enabled', value)}
        />
        <OptionRow
          label="Memory scope"
          note="Character shares memories across every chat with the same character. Chat keeps each conversation separate."
          options={[
            { value: 'character', label: 'Character' },
            { value: 'session', label: 'Chat' },
          ]}
          value={settings.scope}
          accent={accent}
          onChange={value => update('scope', value)}
        />
        <TextField
          label="Memory model"
          note="Used for the background extraction and query calls. Leave blank to use the main model."
          value={settings.model}
          onChangeText={text => update('model', text)}
          placeholder="Uses main model"
        />

        <SectionHeader title="Retrieval" />
        <TextField
          label="Max memories injected"
          value={settings.maxResults}
          onChangeText={text => update('maxResults', text)}
          keyboardType="number-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.maxResults}
        />
        <TextField
          label="Minimum similarity"
          note="Lower keeps more distant memories, higher only strong matches."
          value={settings.minSimilarity}
          onChangeText={text => update('minSimilarity', text)}
          keyboardType="decimal-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.minSimilarity}
        />
        <TextField
          label="Queries per turn"
          value={settings.maxQueries}
          onChangeText={text => update('maxQueries', text)}
          keyboardType="number-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.maxQueries}
        />

        <SectionHeader title="Extraction" />
        <TextField
          label="Extract every N messages"
          note="How many new messages accumulate before another memory extraction call."
          value={settings.everyNMessages}
          onChangeText={text => update('everyNMessages', text)}
          keyboardType="number-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.everyNMessages}
        />
        <TextField
          label="Max stored memories"
          note="Pinned memories are never pruned."
          value={settings.maxStored}
          onChangeText={text => update('maxStored', text)}
          keyboardType="number-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.maxStored}
        />
        <TextField
          label="Messages per backfill call"
          value={settings.backfillChunk}
          onChangeText={text => update('backfillChunk', text)}
          keyboardType="number-pad"
          resetTo={DEFAULT_MEMORY_SETTINGS.backfillChunk}
        />
        {config && placeholderMissing && (
          <MutedNote>
            Your system prompt does not contain $MEMORY$, so retrieved memories
            will not reach the model. Add it in Prompt & Context → System
            Prompt.
          </MutedNote>
        )}

        <SectionHeader title="Backfill" />
        <MutedNote>
          Reads existing messages and stores facts from them, useful before
          memory was enabled.{' '}
          {settings.scope === 'session'
            ? 'Backfills the open chat.'
            : 'Pick which chat to process.'}
        </MutedNote>
        <TouchableOpacity
          onPress={handleBackfillPress}
          style={[
            st.cardActionBtn,
            { alignSelf: 'flex-start', marginBottom: 8 },
          ]}
        >
          <Text style={st.cardActionBtnText}>
            {loadingTarget
              ? 'Loading…'
              : settings.scope === 'session'
                ? 'Backfill this chat'
                : pickerOpen
                  ? 'Hide chats'
                  : 'Backfill a chat'}
          </Text>
        </TouchableOpacity>
        {pickerOpen && settings.scope === 'character' && (
          <>
            {sessions.length === 0 && (
              <Text style={st.lorebookEmptyText}>No chats yet</Text>
            )}
            {sessions.map(session => (
              <TouchableOpacity
                key={session.id}
                onPress={() =>
                  startBackfill(session.id, `character:${character.id}`)
                }
                disabled={!!loadingTarget}
                style={[st.sessionRow, session.id === activeSessionId && st.sessionRowActive]}
              >
                <View style={st.sessionInfo}>
                  <Text numberOfLines={1} style={st.sessionDate}>
                    {session.name || new Date(session.updatedAt).toLocaleString()}
                  </Text>
                  <Text style={st.sessionMeta}>
                    {session.messageCount} message
                    {session.messageCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        <SectionHeader title={`Stored memories (${memories.length})`} />
        <MutedNote>
          Memories are encrypted with the same key as chat messages. Editing
          text re-embeds it on the next reply.
        </MutedNote>
        <TextInput
          style={st.settingsInput}
          value={newMemory}
          onChangeText={setNewMemory}
          placeholder="Add a memory…"
          placeholderTextColor={st.textMuted.color}
          multiline
        />
        <TouchableOpacity
          onPress={addMemory}
          disabled={!newMemory.trim()}
          style={[
            st.cardActionBtn,
            { alignSelf: 'flex-start', marginTop: 8, marginBottom: 12 },
            !newMemory.trim() && { opacity: 0.4 },
          ]}
        >
          <Text style={st.cardActionBtnText}>+ Add memory</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={refresh} style={{ marginBottom: 8 }}>
          <Text style={st.settingsDefaultText}>refresh</Text>
        </TouchableOpacity>
        {memories.length === 0 && (
          <Text style={st.lorebookEmptyText}>
            No memories yet. They appear after a chat has run for a while, or
            after you backfill a chat.
          </Text>
        )}
        {memories.map(memory => (
          <View key={memory.id} style={st.settingsLorebookItem}>
            <View style={st.settingsLorebookItemInfo}>
              {editingId === memory.id ? (
                <TextInput
                  style={st.settingsInput}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                />
              ) : (
                <Text style={st.settingsLorebookItemName}>{memory.text}</Text>
              )}
              <Text style={st.settingsLorebookItemCount}>
                {scopeLabel(memory.scopeId)} ·{' '}
                {new Date(memory.createdAt).toLocaleDateString()}
                {memory.pinned ? ' · pinned' : ''}
                {memory.vector.length === 0 ? ' · not indexed' : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
                {editingId === memory.id ? (
                  <>
                    <TouchableOpacity onPress={saveEdit}>
                      <Text style={{ color: accent, fontSize: 12 }}>save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingId(null);
                        setDraft('');
                      }}
                    >
                      <Text style={st.settingsDefaultText}>cancel</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingId(memory.id);
                        setDraft(memory.text);
                      }}
                    >
                      <Text style={{ color: accent, fontSize: 12 }}>edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => togglePin(memory)}>
                      <Text style={st.settingsDefaultText}>
                        {memory.pinned ? 'unpin' : 'pin'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            <TouchableOpacity
              onPress={() => remove(memory.id)}
              style={st.settingsLorebookRemoveBtn}
            >
              <Text style={st.settingsLorebookRemoveBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {backfill && config && (
        <MemoryBackfillModal
          key={backfillKey}
          visible
          sessionId={backfill.sessionId}
          characterName={character.name}
          scopeId={backfill.scopeId}
          messages={backfill.messages}
          settings={settings}
          config={config}
          accent={accent}
          onClose={() => {
            setBackfill(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
