import React, {useCallback} from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Character} from './CharacterEditor';
import {useAppStore, GroupChat} from './store';
import {useTheme} from './ThemeContext';
import {useChat, ChatMessage} from './useChat';

interface ChatHandlerProps {
  character?: Character | null;
  groupChat?: GroupChat | null;
  activeSessionId: string | null;
  onHistoryPress: () => void;
  onSessionCreated: (sessionId: string) => void;
  bottomInset: number;
}

interface MessageBubbleProps {
  item: ChatMessage;
  isSelected: boolean;
  isLastAssistant: boolean;
  sending: boolean;
  st: ReturnType<typeof useTheme>;
  onSelect: (id: string | null) => void;
  onEdit: (msg: ChatMessage) => void;
  onEditSave: (msg: ChatMessage, newText: string) => void;
  onEditCancel: () => void;
  editingMessageId: string | null;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onCopy: (msg: ChatMessage) => void;
  onDelete: (msg: ChatMessage) => void;
  onRegenerate: () => void;
  onRetry: () => void;
}

function TypingIndicator({st}: {st: ReturnType<typeof useTheme>}) {
  return (
    <View style={[st.messageContainer, st.messageContainerAssistant]}>
      <View style={[st.bubble, st.bubbleAssistant, st.typingBubble]}>
        <View style={st.typingDots}>
          <View style={[st.typingDot, st.typingDot1]} />
          <View style={[st.typingDot, st.typingDot2]} />
          <View style={[st.typingDot, st.typingDot3]} />
        </View>
      </View>
    </View>
  );
}

const MessageBubble = React.memo(function MessageBubble({
  item, isSelected, isLastAssistant, sending, st,
  onSelect, onEdit, onEditSave, onEditCancel, editingMessageId, editingText, onEditingTextChange,
  onCopy, onDelete, onRegenerate, onRetry,
}: MessageBubbleProps) {
  const isUser = item.role === 'user';
  const isStreamingMsg = item.id === '__streaming__';
  const isError = item.id === '__error__';
  const isEditing = editingMessageId === item.id;

  if (isError) {
    return (
      <View style={[st.messageContainer, st.messageContainerAssistant]}>
        <View style={[st.bubble, st.bubbleAssistant, st.errorBubble]}>
          <Text style={st.errorText}>{item.content}</Text>
          <TouchableOpacity
            onPress={onRetry}
            style={st.retryBtn}>
            <Text style={st.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[
      st.messageContainer,
      isUser ? st.messageContainerUser : st.messageContainerAssistant,
    ]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          if (!isStreamingMsg && !isEditing) {
            onSelect(isSelected ? null : item.id);
          }
        }}
        style={[
          st.bubble,
          isUser ? st.bubbleUser : st.bubbleAssistant,
        ]}>
        {isEditing ? (
          <>
            <TextInput
              style={[st.bubbleText, isUser && st.bubbleTextUser]}
              value={editingText}
              onChangeText={onEditingTextChange}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={[st.actionRow, isUser ? st.actionRowUser : st.actionRowAssistant]}>
              <TouchableOpacity
                onPress={() => onEditSave(item, editingText)}
                style={st.actionBtn}>
                <Text style={st.actionBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onEditCancel}
                style={st.actionBtn}>
                <Text style={st.actionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text
              style={[st.bubbleText, isUser && st.bubbleTextUser]}>
              {item.content}
            </Text>
            {!isStreamingMsg && (
              <Text style={[st.timestampText, isUser ? st.timestampUser : st.timestampAssistant]}>
                {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
              </Text>
            )}
            {isSelected && !isStreamingMsg && (
              <View style={[st.actionRow, isUser ? st.actionRowUser : st.actionRowAssistant]}>
                <TouchableOpacity
                  onPress={() => onEdit(item)}
                  style={st.actionBtn}>
                  <Text style={st.actionBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onCopy(item)}
                  style={st.actionBtn}>
                  <Text style={st.actionBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(item)}
                  style={st.actionBtn}>
                  <Text style={[st.actionBtnText, st.actionBtnTextDelete]}>Delete</Text>
                </TouchableOpacity>
                {isLastAssistant && (
                  <TouchableOpacity
                    onPress={onRegenerate}
                    disabled={sending}
                    style={[st.actionBtn, sending && st.actionBtnDisabled]}>
                    <Text style={st.actionBtnText}>Regen</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </TouchableOpacity>
    </View>
  );
});

export default function ChatHandler({character, groupChat, activeSessionId, onHistoryPress, onSessionCreated, bottomInset}: ChatHandlerProps) {
  const st = useTheme();
  const showCharacterIcons = useAppStore(s => s.appSettings.showCharacterIcons);
  const accentColor = useAppStore(s => s.appSettings.accentColor);
  const bgSecondary = useAppStore(s => s.appSettings.bgSecondary);


  const {
    session,
    inputText,
    setInputText,
    sending,
    isStreaming,
    selectedMessageId,
    setSelectedMessageId,
    editingMessageId,
    editingText,
    setEditingText,
    selectedReplyCharacter,
    setSelectedReplyCharacter,
    groupMembers,
    flatListRef,
    messagesData,
    handleSend,
    handleEditMessage,
    handleEditSave,
    handleEditCancel,
    handleCopyMessage,
    handleDeleteMessage,
    handleRegenerate,
    handleRetryError,
    handleStop,
  } = useChat({character, groupChat, activeSessionId, onSessionCreated});

  const isGroupChat = !!groupChat;
  const activeCharacter = character || (groupMembers.length > 0 ? groupMembers[0] : null);

  const renderMessage = useCallback(({item}: {item: ChatMessage}) => {
    const isUser = item.role === 'user';
    const isLastAssistant = !isUser && session && session.messages.length > 0 &&
      session.messages[session.messages.length - 1].id === item.id && item.role === 'assistant';

    return (
      <MessageBubble
        item={item}
        isSelected={selectedMessageId === item.id}
        isLastAssistant={!!isLastAssistant}
        sending={sending}
        st={st}
        onSelect={setSelectedMessageId}
        onEdit={handleEditMessage}
        onEditSave={handleEditSave}
        onEditCancel={handleEditCancel}
        editingMessageId={editingMessageId}
        editingText={editingText}
        onEditingTextChange={setEditingText}
        onCopy={handleCopyMessage}
        onDelete={handleDeleteMessage}
        onRegenerate={handleRegenerate}
        onRetry={handleRetryError}
      />
    );
  }, [session, selectedMessageId, sending, st, handleEditMessage, handleEditSave, handleEditCancel, editingMessageId, editingText, setEditingText, setSelectedMessageId, handleCopyMessage, handleDeleteMessage, handleRegenerate, handleRetryError]);

  return (
    <KeyboardAvoidingView
      style={st.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={st.chatHeader}>
        {isGroupChat ? (
          <>
            <View style={[st.chatHeaderAvatar, {justifyContent: 'center', alignItems: 'center'}]}>
              <Text style={{color: st.textMuted.color, fontSize: 14}}>{groupMembers.length}</Text>
            </View>
            <Text style={st.chatHeaderName} numberOfLines={1}>
              {groupChat.name}
            </Text>
          </>
        ) : (
          <>
            {showCharacterIcons && activeCharacter?.icon ? (
              <Image
                source={{uri: activeCharacter.icon}}
                style={st.chatHeaderAvatar}
              />
            ) : null}
            <Text style={st.chatHeaderName} numberOfLines={1}>
              {activeCharacter?.name}
            </Text>
          </>
        )}
        <TouchableOpacity
          onPress={onHistoryPress}
          style={st.historyBtn}>
          <Text style={st.historyBtnIcon}>≡</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messagesData}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        inverted
        maintainVisibleContentPosition={{minIndexForVisible: 0}}
        style={{flex: 1}}
        contentContainerStyle={st.chatContent}
        onScrollBeginDrag={() => {
          if (selectedMessageId) {setSelectedMessageId(null);}
        }}
        ListHeaderComponent={sending && !isStreaming ? <TypingIndicator st={st} /> : null}
        ListEmptyComponent={
          <View style={st.emptyStateContainer}>
            <View style={st.emptyStateBubble}>
              <Text style={st.emptyStateBubbleDots}>{'···'}</Text>
            </View>
            <Text style={st.emptyStateTitle}>
              {isGroupChat ? 'Start a group conversation' : 'Start a conversation'}
            </Text>
            <Text style={st.emptyStateSubtitle}>
              {isGroupChat
                ? `Say something to ${groupChat.name}...`
                : `Say something to ${activeCharacter?.name}...`}
            </Text>
          </View>
        }
      />

      {/* Character Selector for Group Chats */}
      {isGroupChat && (
        <View style={st.characterSelector}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={st.characterSelectorScroll}>
            {groupMembers.map(char => {
              const isSelected = selectedReplyCharacter?.id === char.id;
              return (
                <TouchableOpacity
                  key={char.id}
                  onPress={() => setSelectedReplyCharacter(char)}
                  style={[st.characterSelectorItem, isSelected && st.characterSelectorItemActive]}>
                  {showCharacterIcons && char.icon ? (
                    <Image
                      source={{uri: char.icon}}
                      style={[st.characterSelectorAvatar, isSelected && st.characterSelectorAvatarActive]}
                    />
                  ) : (
                    <View style={[st.characterSelectorAvatar, isSelected && st.characterSelectorAvatarActive, {justifyContent: 'center', alignItems: 'center'}]}>
                      <Text style={{color: isSelected ? accentColor : st.textMuted.color, fontSize: 14}}>
                        {char.name[0]}
                      </Text>
                    </View>
                  )}
                  <Text style={[st.characterSelectorName, isSelected && st.characterSelectorNameActive]} numberOfLines={1}>
                    {char.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Input bar */}
      {/* TODO: proper keyboard-aware padding solution */}
      <View style={[st.inputBar, {paddingBottom: bottomInset + 30}]}>
        {isGroupChat && selectedReplyCharacter && (
          <View style={{marginRight: 8}}>
            {showCharacterIcons && selectedReplyCharacter.icon ? (
              <Image
                source={{uri: selectedReplyCharacter.icon}}
                style={{width: 28, height: 28, borderRadius: 14}}
              />
            ) : (
              <View style={{width: 28, height: 28, borderRadius: 14, backgroundColor: bgSecondary, justifyContent: 'center', alignItems: 'center'}}>
                <Text style={{color: st.textMuted.color, fontSize: 12}}>{selectedReplyCharacter.name[0]}</Text>
              </View>
            )}
          </View>
        )}
        <TextInput
          style={st.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={isGroupChat ? (selectedReplyCharacter ? `Message as ${selectedReplyCharacter.name}...` : 'Select a character to reply') : 'Type a message...'}
          placeholderTextColor="#666"
          editable={!sending && (!isGroupChat || !!selectedReplyCharacter)}
          multiline
          textAlignVertical="center"
        />
        {isStreaming ? (
          <TouchableOpacity
            style={st.stopBtn}
            onPress={handleStop}>
            <View style={st.stopSquare} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[st.sendBtn, (sending || (isGroupChat && !selectedReplyCharacter)) && st.sendBtnDisabled]}
            onPress={() => handleSend(inputText)}
            disabled={sending || (isGroupChat && !selectedReplyCharacter)}>
            <Text style={st.sendBtnText}>{'›'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}