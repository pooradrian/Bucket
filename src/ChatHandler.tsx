import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import {useChat, ChatMessage, QuickCharacter} from './useChat';
import {renderFormattedText} from './textFormat';
import Carousel from './components/Carousel';

const DOUBLE_TAP_DELAY_MS = 300;

interface ChatHandlerProps {
  character?: Character | null;
  groupChat?: GroupChat | null;
  activeSessionId: string | null;
  quickCharacters: QuickCharacter[];
  onHistoryPress: () => void;
  onSessionCreated: (sessionId: string) => void;
  bottomInset: number;
}

interface MessageBubbleProps {
  item: ChatMessage;
  hidden: boolean;
  isSelected: boolean;
  isLastAssistant: boolean;
  sending: boolean;
  isLiveStreaming: boolean;
  st: ReturnType<typeof useTheme>;
  variantIndexMap: Record<string, number>;
  onSelect: (id: string | null) => void;
  onOpenCarousel: (id: string) => void;
  registerBubble: (id: string, ref: View | null) => void;
  onBubbleLayout: (id: string, width: number, height: number) => void;
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
  const opacities = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;

  useEffect(() => {
    const animations = opacities.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(val, {toValue: 1, duration: 400, useNativeDriver: true}),
          Animated.timing(val, {toValue: 0.3, duration: 400, useNativeDriver: true}),
        ]),
      ),
    );
    const composite = Animated.parallel(animations);
    composite.start();
    return () => composite.stop();
  }, [opacities]);

  return (
    <View style={[st.messageContainer, st.messageContainerAssistant]}>
      <View style={[st.bubble, st.bubbleAssistant, st.typingBubble]}>
        <View style={st.typingDots}>
          {opacities.map((val, i) => (
            <Animated.View key={i} style={[st.typingDot, {opacity: val}]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const MessageBubble = React.memo(function MessageBubble({
  item, hidden, isSelected, isLastAssistant, sending, isLiveStreaming, st, variantIndexMap,
  onSelect, onOpenCarousel, registerBubble, onBubbleLayout, onEdit, onEditSave, onEditCancel, editingMessageId, editingText, onEditingTextChange,
  onCopy, onDelete, onRegenerate, onRetry,
}: MessageBubbleProps) {
  const forceItalic = useAppStore(s => s.appSettings.forceItalic);
  const isUser = item.role === 'user';
  const isStreamingMsg = item.id === '__streaming__' || isLiveStreaming;
  const isError = item.id === '__error__';
  const isTyping = item.id === '__typing__';
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

  if (isTyping) {
    return <TypingIndicator st={st} />;
  }

  return (
    <View style={[
      st.messageContainer,
      isUser ? st.messageContainerUser : st.messageContainerAssistant,
      hidden && {opacity: 0},
    ]}>
      <TouchableOpacity
        activeOpacity={0.8}
        ref={ref => registerBubble(item.id, ref)}
        onLayout={e => onBubbleLayout(item.id, e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
        onPress={() => {
          if (!isStreamingMsg && !isEditing) {
            onOpenCarousel(item.id);
          }
        }}
        onLongPress={() => {
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
              {renderFormattedText(item.content, st.bubbleText, forceItalic)}
            </Text>
            {!isStreamingMsg && (
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4, justifyContent: 'space-between'}}>
                <Text style={[st.timestampText, isUser ? st.timestampUser : st.timestampAssistant, {marginTop: 0, flexShrink: 1}]}>
                  {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                </Text>
                {!isUser && item.variants && item.variants.length > 0 && (
                  <Text style={[st.variantCounter, {marginTop: 0, marginLeft: 8}]}>
                    {(variantIndexMap[item.id] ?? item.variants.length) + 1}/{item.variants.length + 1}
                  </Text>
                )}
              </View>
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

export default function ChatHandler({character, groupChat, activeSessionId, quickCharacters, onHistoryPress, onSessionCreated, bottomInset}: ChatHandlerProps) {
  const st = useTheme();
  const showCharacterIcons = useAppStore(s => s.appSettings.showCharacterIcons);
  const groupCharDisplay = useAppStore(s => s.appSettings.showGroupCharNames);
  const accentColor = useAppStore(s => s.appSettings.accentColor);
  const bgSecondary = useAppStore(s => s.appSettings.bgSecondary);

  const {
    session,
    inputText,
    setInputText,
    sending,
    isStreaming,
    streamingContent,
    selectedMessageId,
    setSelectedMessageId,
    editingMessageId,
    editingText,
    setEditingText,
    selectedReplyCharacter,
    setSelectedReplyCharacter,
    selectedQC,
    setSelectedQC,
    groupMembers,
    flatListRef,
    messagesData,
    replacingMessageId,
    variantIndexMap,
    handleSend,
    handleContinue,
    handleEditMessage,
    handleEditSave,
    handleEditCancel,
    handleCopyMessage,
    handleDeleteMessage,
    handleRegenerate,
    handleSelectVariant,
    handleStudioEditEntry,
    handleStudioFork,
    handleStudioFresh,
    handleStudioDeleteEntry,
    handleRetryError,
    handleStop,
  } = useChat({character, groupChat, activeSessionId, onSessionCreated, quickCharacters});

  const [carouselMessageId, setCarouselMessageIdInner] = useState<string | null>(null);
  const [carouselOrigin, setCarouselOrigin] = useState<{x: number; y: number; width: number; height: number} | null | undefined>(undefined);
  const [carouselReady, setCarouselReady] = useState(false);
  const bubbleRefs = useRef<Record<string, View | null>>({}).current;
  const bubbleLayouts = useRef<Record<string, {width: number; height: number}>>({}).current;

  const lastSendTapRef = useRef(0);
  const sendTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSelectorTapRef = useRef<{id: string; time: number}>({id: '', time: 0});

  const handleSendPress = useCallback(() => {
    const now = Date.now();
    if (now - lastSendTapRef.current < DOUBLE_TAP_DELAY_MS) {
      lastSendTapRef.current = 0;
      if (sendTapTimerRef.current) {
        clearTimeout(sendTapTimerRef.current);
        sendTapTimerRef.current = null;
      }
      handleContinue();
      return;
    }
    lastSendTapRef.current = now;
    if (sendTapTimerRef.current) {
      clearTimeout(sendTapTimerRef.current);
    }
    sendTapTimerRef.current = setTimeout(() => {
      sendTapTimerRef.current = null;
      handleSend(inputText);
    }, DOUBLE_TAP_DELAY_MS);
  }, [handleSend, handleContinue, inputText]);

  useEffect(() => {
    return () => {
      if (sendTapTimerRef.current) {
        clearTimeout(sendTapTimerRef.current);
      }
    };
  }, []);

  const makeSelectorPress = useCallback(
    (
      id: string,
      onSelect: () => void,
      continueTarget: {character?: Character | null; qc?: QuickCharacter | null},
    ) => {
      return () => {
        const now = Date.now();
        if (lastSelectorTapRef.current.id === id && now - lastSelectorTapRef.current.time < DOUBLE_TAP_DELAY_MS) {
          lastSelectorTapRef.current = {id: '', time: 0};
          onSelect();
          handleContinue(continueTarget);
          return;
        }
        lastSelectorTapRef.current = {id, time: now};
        onSelect();
      };
    },
    [handleContinue],
  );

  const handleCarouselReady = useCallback(() => setCarouselReady(true), []);

  const handleCloseCarousel = useCallback(() => {
    setCarouselMessageIdInner(null);
    setCarouselOrigin(null);
    setCarouselReady(false);
  }, []);

  const registerBubble = useCallback((id: string, ref: View | null) => {
    if (ref) {
      bubbleRefs[id] = ref;
    } else {
      delete bubbleRefs[id];
    }
  }, [bubbleRefs]);

  const handleBubbleLayout = useCallback((id: string, width: number, height: number) => {
    bubbleLayouts[id] = {width, height};
  }, [bubbleLayouts]);

  const openCarousel = useCallback((id: string) => {
    setCarouselReady(false);
    setCarouselOrigin(undefined);
    setCarouselMessageIdInner(id);
    const ref = bubbleRefs[id];
    if (!ref) {
      setCarouselOrigin(null);
      return;
    }
    ref.measureInWindow((x, y, width, height) => {
      const layout = bubbleLayouts[id];
      if (layout) {
        width = layout.width;
        height = layout.height;
      }
      if (width > 0 && height > 0 && x >= -100 && x <= 5000 && y >= -100 && y <= 5000) {
        setCarouselOrigin({x, y, width, height});
      } else {
        setCarouselOrigin(null);
      }
    });
  }, [bubbleRefs, bubbleLayouts]);

  const handleCarouselDelete = useCallback((msg: ChatMessage) => {
    handleDeleteMessage(msg);
    handleCloseCarousel();
  }, [handleDeleteMessage, handleCloseCarousel]);

  const carouselMessage = carouselMessageId && session
    ? session.messages.find(m => m.id === carouselMessageId) ?? null
    : null;
  const carouselCanRegen = !!carouselMessage && !!session && session.messages.length > 0 &&
    session.messages[session.messages.length - 1].id === carouselMessage.id &&
    carouselMessage.role === 'assistant';

  const isGroupChat = !!groupChat;
  const activeCharacter = character || (groupMembers.length > 0 ? groupMembers[0] : null);
  const showSelectorLine = isGroupChat || quickCharacters.length > 0;
  const showAvatar = groupCharDisplay === 'avatar' || groupCharDisplay === 'both';
  const showName = groupCharDisplay === 'name' || groupCharDisplay === 'both';

  const scrollOffsetRef = useRef(0);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    if (editingMessageId) {
      const offset = scrollOffsetRef.current;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({offset, animated: false});
      });
    }
  }, [editingMessageId, flatListRef]);

  useEffect(() => {
    if (isStreaming) {
      flatListRef.current?.scrollToOffset({offset: 0, animated: true});
    }
  }, [streamingContent, isStreaming, flatListRef]);

  const renderMessage = useCallback(({item}: {item: ChatMessage}) => {
    const isUser = item.role === 'user';
    const isLastAssistant = !isUser && session && session.messages.length > 0 &&
      session.messages[session.messages.length - 1].id === item.id && item.role === 'assistant';

    return (
      <MessageBubble
        item={item}
        hidden={carouselMessageId === item.id && carouselReady}
        isSelected={selectedMessageId === item.id}
        isLastAssistant={!!isLastAssistant}
        sending={sending}
        isLiveStreaming={item.id === replacingMessageId && isStreaming}
        st={st}
        variantIndexMap={variantIndexMap}
        onSelect={setSelectedMessageId}
        onOpenCarousel={openCarousel}
        registerBubble={registerBubble}
        onBubbleLayout={handleBubbleLayout}
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
  }, [session, selectedMessageId, sending, isStreaming, replacingMessageId, st, variantIndexMap, carouselMessageId, carouselReady, handleEditMessage, handleEditSave, handleEditCancel, editingMessageId, editingText, setEditingText, setSelectedMessageId, openCarousel, registerBubble, handleBubbleLayout, handleCopyMessage, handleDeleteMessage, handleRegenerate, handleRetryError]);

  return (
    <>
    <KeyboardAvoidingView
      style={st.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
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

      <FlatList
        ref={flatListRef}
        data={messagesData}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        inverted
        maintainVisibleContentPosition={{minIndexForVisible: 0}}
        style={{flex: 1}}
        contentContainerStyle={st.chatContent}
        onScroll={handleScroll}
        onScrollBeginDrag={() => {
          if (selectedMessageId) {setSelectedMessageId(null);}
          if (carouselMessageId) {setCarouselMessageIdInner(null);}
        }}
        ListHeaderComponent={null}
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

      {showSelectorLine && (
        <View style={st.characterSelector}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={st.characterSelectorScroll}>
            {isGroupChat ? groupMembers.map(char => {
              const isSelected = selectedReplyCharacter?.id === char.id;
              return (
                <TouchableOpacity
                  key={char.id}
                  onPress={makeSelectorPress(char.id, () => setSelectedReplyCharacter(char), {character: char})}
                  style={[st.characterSelectorItem, isSelected && st.characterSelectorItemActive]}>
                  {showAvatar && showCharacterIcons && char.icon ? (
                    <Image
                      source={{uri: char.icon}}
                      style={[st.characterSelectorAvatar, isSelected && st.characterSelectorAvatarActive]}
                    />
                  ) : showAvatar ? (
                    <View style={[st.characterSelectorAvatar, isSelected && st.characterSelectorAvatarActive, {justifyContent: 'center', alignItems: 'center'}]}>
                      <Text style={{color: isSelected ? accentColor : st.textMuted.color, fontSize: 14}}>
                        {char.name[0]}
                      </Text>
                    </View>
                  ) : null}
                  {showName && (
                    <Text style={[st.characterSelectorName, isSelected && st.characterSelectorNameActive, showAvatar && {marginLeft: 6}]} numberOfLines={1}>
                      {char.name}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }) : (
              <>
                <TouchableOpacity
                  onPress={makeSelectorPress(
                    activeCharacter?.id ?? 'base',
                    () => setSelectedQC(null),
                    {qc: null},
                  )}
                  style={[st.characterSelectorItem, !selectedQC && st.characterSelectorItemActive]}>
                  {showAvatar && showCharacterIcons && activeCharacter?.icon ? (
                    <Image
                      source={{uri: activeCharacter.icon}}
                      style={[st.characterSelectorAvatar, !selectedQC && st.characterSelectorAvatarActive]}
                    />
                  ) : showAvatar ? (
                    <View style={[st.characterSelectorAvatar, !selectedQC && st.characterSelectorAvatarActive, {justifyContent: 'center', alignItems: 'center'}]}>
                      <Text style={{color: !selectedQC ? accentColor : st.textMuted.color, fontSize: 14}}>
                        {activeCharacter?.name?.[0] || '?'}
                      </Text>
                    </View>
                  ) : null}
                  {showName && (
                    <Text style={[st.characterSelectorName, !selectedQC && st.characterSelectorNameActive, showAvatar && {marginLeft: 6}]} numberOfLines={1}>
                      {activeCharacter?.name}
                    </Text>
                  )}
                </TouchableOpacity>
                {quickCharacters.map(qc => {
                  const isSelected = selectedQC?.id === qc.id;
                  return (
                    <TouchableOpacity
                      key={qc.id}
                      onPress={makeSelectorPress(qc.id, () => setSelectedQC(qc), {qc})}
                      style={[st.characterSelectorItem, isSelected && st.characterSelectorItemActive]}>
                      {showAvatar ? (
                        <View style={[st.characterSelectorAvatar, isSelected && st.characterSelectorAvatarActive, {justifyContent: 'center', alignItems: 'center'}]}>
                          <Text style={{color: isSelected ? accentColor : st.textMuted.color, fontSize: 14}}>
                            {qc.name[0]}
                          </Text>
                        </View>
                      ) : null}
                      {showName && (
                        <Text style={[st.characterSelectorName, isSelected && st.characterSelectorNameActive, showAvatar && {marginLeft: 6}]} numberOfLines={1}>
                          {qc.name}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>
        </View>
      )}

      <View style={[st.inputBar, {paddingBottom: bottomInset + 30}]}>
        {(isGroupChat && selectedReplyCharacter) ? (
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
        ) : (selectedQC) ? (
          <View style={{marginRight: 8}}>
            <View style={{width: 28, height: 28, borderRadius: 14, backgroundColor: bgSecondary, justifyContent: 'center', alignItems: 'center'}}>
              <Text style={{color: st.textMuted.color, fontSize: 12}}>{selectedQC.name[0]}</Text>
            </View>
          </View>
        ) : null}
        <TextInput
          style={st.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={isGroupChat ? (selectedReplyCharacter ? `Message as ${selectedReplyCharacter.name}...` : 'Select a character to reply') : (selectedQC ? `Message as ${selectedQC.name}...` : 'Type a message...')}
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
            onPress={handleSendPress}
            disabled={sending || (isGroupChat && !selectedReplyCharacter)}>
            <Text style={st.sendBtnText}>›</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
    {carouselMessage && (
      <Carousel
        message={carouselMessage}
        origin={carouselOrigin}
        onReady={handleCarouselReady}
        onClose={handleCloseCarousel}
        onSelectVariant={handleSelectVariant}
        onEditEntry={handleStudioEditEntry}
        onFork={handleStudioFork}
        onFresh={handleStudioFresh}
        onDeleteEntry={handleStudioDeleteEntry}
        onDeleteMessage={handleCarouselDelete}
        onCopy={handleCopyMessage}
        onRegenerate={handleRegenerate}
        canRegenerate={carouselCanRegen}
        sending={sending}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        replacingMessageId={replacingMessageId}
        onStop={handleStop}
      />
    )}
    </>
  );
}
