import {DimensionValue, Platform, StyleSheet} from 'react-native';
import {AppSettings} from './store';

export function createStyles(s: AppSettings) {
  const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  return StyleSheet.create({
    // =========================================================================
    // Theme primitives
    // =========================================================================
    bgPrimary: {backgroundColor: s.bgPrimary},
    bgSecondary: {backgroundColor: s.bgSecondary},
    textPrimary: {color: s.textPrimary},
    textSecondary: {color: s.textSecondary},
    textMuted: {color: s.textMuted},

    // =========================================================================
    // Card design system
    // =========================================================================
    card: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 16,
      marginBottom: 18,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: s.accentColor,
      marginBottom: 4,
    },
    cardDescription: {
      fontSize: 13,
      color: s.textMuted,
    },
    cardButton: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.inputRadius,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    cardButtonText: {
      fontSize: 13,
      fontWeight: '500',
      color: s.accentColor,
    },
    cardInput: {
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
    },
    cardInputMultiline: {
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
      minHeight: 80,
      textAlignVertical: 'top',
    },

    // =========================================================================
    // App.tsx — screen / safe area
    // =========================================================================
    screen: {
      flex: 1,
      backgroundColor: s.bgPrimary,
    },
    safeArea: {
      flex: 1,
      backgroundColor: s.bgPrimary,
    },

    // =========================================================================
    // App.tsx — character card (menu)
    // =========================================================================
    characterCard: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    characterAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: s.bgSecondary,
      marginRight: 12,
    },
    characterInfo: {
      flex: 1,
    },
    characterName: {
      color: s.textPrimary,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    characterDesc: {
      color: s.textSecondary,
      fontSize: 14,
    },
    cardActionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 10,
      borderTopWidth: 1,
      borderTopColor: s.borderPrimary,
      paddingTop: 10,
    },
    cardActionBtn: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.inputRadius,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginRight: 8,
    },
    cardActionBtnLast: {
      marginRight: 0,
    },
    cardActionBtnText: {
      color: s.accentColor,
      fontSize: 13,
      fontWeight: '500',
    },
    cardActionBtnTextDanger: {
      color: '#cc3333',
      fontSize: 13,
      fontWeight: '500',
    },
    confirmBtn: {
      backgroundColor: '#cc3333',
      borderRadius: s.inputRadius,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginRight: 8,
    },
    confirmBtnText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },

    // =========================================================================
    // App.tsx — FlatList / empty state
    // =========================================================================
    flatListContainer: {
      flex: 1,
    },
    flatListContent: {
      padding: 16,
      flexGrow: 1,
    },
    emptyText: {
      color: '#333333',
      fontSize: 16,
      textAlign: 'center',
    },

    // =========================================================================
    // App.tsx — bottom bar
    // =========================================================================
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
      backgroundColor: s.bgPrimary,
    },
    sideButton: {
      width: s.sideBtnSize,
      height: s.sideBtnSize,
      borderRadius: s.sideBtnSize / 2,
      backgroundColor: s.bgPrimary,
      borderWidth: 1,
      borderColor: s.borderPrimary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sideButtonText: {
      color: s.textPrimary,
      fontSize: 20,
      fontWeight: '600',
    },
    pillContainer: {
      flexDirection: 'row',
      backgroundColor: s.bgPrimary,
      borderRadius: s.pillRadius,
      borderWidth: 1,
      borderColor: s.borderPrimary,
      paddingHorizontal: 4,
      position: 'relative',
    },
    pillIndicator: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 4,
      backgroundColor: s.bgPill,
      borderRadius: s.pillRadius,
    },
    tabButton: {
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: s.pillRadius,
      zIndex: 1,
    },
    tabTextActive: {
      color: s.textPrimary,
      fontSize: s.fontSizeTab,
      fontWeight: '600',
    },
    tabTextInactive: {
      color: s.textMuted,
      fontSize: s.fontSizeTab,
      fontWeight: '500',
    },

    // =========================================================================
    // App.tsx — history modal
    // =========================================================================
    historyModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    historyModalContent: {
      backgroundColor: s.bgPrimary,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
      paddingBottom: 30,
    },
    historyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    historyHeaderText: {
      color: s.textPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    historyCloseBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: s.bgSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    historyCloseBtnText: {
      color: s.textSecondary,
      fontSize: 16,
    },
    newChatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    newChatBtnText: {
      color: s.accentColor,
      fontSize: 15,
      fontWeight: '500',
    },
    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    sessionRowActive: {
      backgroundColor: s.bgSecondary,
    },
    sessionInfo: {
      flex: 1,
    },
    sessionDate: {
      color: s.textSecondary,
      fontSize: 15,
      fontWeight: '400',
    },
    sessionDateActive: {
      color: s.textPrimary,
      fontWeight: '600',
    },
    sessionCount: {
      color: s.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    sessionDeleteBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sessionDeleteBtnText: {
      color: '#cc3333',
      fontSize: 18,
    },
    emptyHistoryText: {
      color: s.textMuted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 40,
    },

    // =========================================================================
    // ChatHandler — header
    // =========================================================================
    chatContainer: {
      flex: 1,
      backgroundColor: s.bgPrimary,
    },
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    chatHeaderName: {
      color: s.textPrimary,
      fontSize: s.fontSizeHeader,
      fontWeight: '600',
      marginLeft: 4,
      flex: 1,
    },
    chatHeaderAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    historyBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: s.bgSecondary,
      borderWidth: 1,
      borderColor: s.accentColor,
      justifyContent: 'center',
      alignItems: 'center',
    },
    historyBtnIcon: {
      color: s.accentColor,
      fontSize: 16,
    },

    // =========================================================================
    // ChatHandler — messages
    // =========================================================================
    messageContainer: {
      marginBottom: 8,
      maxWidth: `${s.chatMaxWidth}%` as DimensionValue,
    },
    messageContainerUser: {
      alignSelf: 'flex-end',
    },
    messageContainerAssistant: {
      alignSelf: 'flex-start',
    },
    bubble: {
      borderRadius: s.bubbleRadius,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: s.bgSecondary,
      borderWidth: 1,
      borderColor: s.borderPrimary,
    },
    bubbleUser: {
      backgroundColor: s.userBubbleBg,
      borderWidth: 0,
      borderBottomRightRadius: 4,
    },
    bubbleAssistant: {
      borderBottomLeftRadius: 4,
    },
    bubbleText: {
      fontSize: s.fontSizeBody,
      lineHeight: 20,
      color: s.textSecondary,
    },
    bubbleTextUser: {
      color: s.textPrimary,
    },
    timestampText: {
      fontSize: 11,
      color: s.textMuted,
      marginTop: 2,
    },
    timestampUser: {
      textAlign: 'right',
    },
    timestampAssistant: {
      textAlign: 'left',
    },
    actionRow: {
      flexDirection: 'row',
      marginTop: 4,
      gap: 4,
    },
    actionRowUser: {
      alignSelf: 'flex-end',
    },
    actionRowAssistant: {
      alignSelf: 'flex-start',
    },
    actionBtn: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: s.inputRadius,
      borderWidth: 1,
      borderColor: s.accentColor,
    },
    actionBtnText: {
      color: s.accentColor,
      fontSize: 12,
      fontWeight: '500',
    },
    actionBtnTextDelete: {
      color: '#cc3333',
    },
    actionBtnDisabled: {
      opacity: 0.4,
    },

    // =========================================================================
    // ChatHandler — input bar
    // =========================================================================
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: s.bottomBarPad,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: s.borderPrimary,
    },
    textInput: {
      flex: 1,
      backgroundColor: s.bgSecondary,
      borderWidth: 1,
      borderColor: s.borderPrimary,
      borderRadius: s.inputRadius,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
      marginRight: 8,
    },
    sendBtn: {
      width: s.sendBtnSize,
      height: s.sendBtnSize,
      borderRadius: s.sendBtnSize / 2,
      backgroundColor: s.accentColor,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.4,
    },
    sendBtnText: {
      color: s.bgPrimary,
      fontSize: 24,
      fontWeight: '600',
      lineHeight: 26,
    },
    stopBtn: {
      width: s.sendBtnSize,
      height: s.sendBtnSize,
      borderRadius: s.sendBtnSize / 2,
      backgroundColor: '#cc3333',
      justifyContent: 'center',
      alignItems: 'center',
    },
    stopSquare: {
      width: 12,
      height: 12,
      borderRadius: 2,
      backgroundColor: '#fff',
    },
    typingBubble: {
      paddingVertical: 14,
      paddingHorizontal: 18,
    },
    typingDots: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    typingDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: s.textMuted,
      opacity: 0.4,
    },
    typingDot1: {opacity: 0.3},
    typingDot2: {opacity: 0.6},
    typingDot3: {opacity: 0.9},
    errorBubble: {
      backgroundColor: 'rgba(204, 51, 51, 0.12)',
      borderColor: '#cc3333',
    },
    errorText: {
      fontSize: s.fontSizeBody,
      lineHeight: 20,
      color: '#ff6b6b',
    },
    retryBtn: {
      marginTop: 8,
      alignSelf: 'flex-start',
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderRadius: s.inputRadius,
      borderWidth: 1,
      borderColor: '#cc3333',
    },
    retryBtnText: {
      color: '#cc3333',
      fontSize: 13,
      fontWeight: '600',
    },
    chatHidden: {
      flex: 1,
      display: 'none' as const,
    },
    chatVisible: {
      flex: 1,
    },
    emptyChat: {
      color: '#444',
      fontSize: 14,
      textAlign: 'center',
      marginTop: 40,
    },
    emptyStateContainer: {
      alignItems: 'center',
      marginTop: 80,
      paddingHorizontal: 40,
    },
    emptyStateBubble: {
      width: 60,
      height: 60,
      borderRadius: 30,
      borderWidth: 1,
      borderColor: s.borderPrimary,
      backgroundColor: s.bgSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    emptyStateBubbleDots: {
      color: s.textMuted,
      fontSize: 22,
      fontWeight: '600',
      letterSpacing: 2,
    },
    emptyStateTitle: {
      color: s.textPrimary,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 6,
    },
    emptyStateSubtitle: {
      color: s.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    chatContent: {
      padding: 16,
      flexGrow: 1,
      justifyContent: 'flex-end' as const,
    },

    // =========================================================================
    // CharacterEditor — header
    // =========================================================================
    editorScreen: {
      flex: 1,
      backgroundColor: s.bgPrimary,
    },
    editorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    editorCancelBtn: {
      marginRight: 12,
    },
    editorCancelText: {
      color: s.accentColor,
      fontSize: 16,
      fontWeight: '500',
    },
    editorTitle: {
      color: s.textPrimary,
      fontSize: s.fontSizeHeader,
      fontWeight: '600',
      flex: 1,
    },
    editorSave: {
      color: s.accentColor,
      fontSize: 16,
      fontWeight: '600',
    },
    editorScroll: {
      padding: 16,
      paddingBottom: 80,
    },
    editorKeyboardAvoid: {
      flex: 1,
    },
    cardInputMultilineLarge: {
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
      minHeight: 100,
      textAlignVertical: 'top',
    },

    // =========================================================================
    // CharacterEditor — icon
    // =========================================================================
    iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: s.bgSecondary,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: s.borderPrimary,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    iconImage: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    iconPlaceholder: {
      color: s.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },

    // =========================================================================
    // CharacterEditor — lorebook
    // =========================================================================
    removeAssignment: {
      marginTop: 4,
    },
    removeAssignmentText: {
      color: s.textMuted,
      fontSize: 12,
      marginLeft: 4,
    },

    // =========================================================================
    // CharacterEditor — lorebook picker modal
    // =========================================================================
    lorebookModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    lorebookModalContent: {
      backgroundColor: s.bgPrimary,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '70%',
      paddingBottom: 30,
    },
    lorebookModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    lorebookModalTitle: {
      color: s.textPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    lorebookCloseBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: s.bgSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    lorebookCloseBtnText: {
      color: s.textSecondary,
      fontSize: 16,
    },
    lorebookOption: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    lorebookOptionActive: {
      backgroundColor: s.bgSecondary,
    },
    lorebookOptionText: {
      color: s.textSecondary,
      fontSize: 15,
    },
    lorebookOptionTextActive: {
      color: s.textPrimary,
      fontWeight: '600',
    },
    lorebookEntryCount: {
      color: s.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    lorebookEmptyText: {
      color: s.textMuted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 40,
      marginBottom: 20,
    },

    // =========================================================================
    // CharacterEditor — token counter
    // =========================================================================
    tokenCounter: {
      marginTop: 20,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: s.bgSecondary,
      borderRadius: s.cardRadius,
      borderWidth: 1,
      borderColor: s.borderPrimary,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    tokenCounterLabel: {
      color: s.textSecondary,
      fontSize: 14,
    },
    tokenCounterValue: {
      color: s.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },

    // =========================================================================
    // Debugger
    // =========================================================================
    debugScreen: {
      flex: 1,
      backgroundColor: '#0a0a0a',
    },
    debugHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: '#222',
    },
    debugClose: {
      marginRight: 12,
    },
    debugCloseText: {
      color: s.accentColor,
      fontSize: 16,
      fontWeight: '500',
    },
    debugTitle: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '600',
      flex: 1,
    },
    debugOutput: {
      padding: 12,
      paddingBottom: 8,
    },
    debugFlatList: {
      flex: 1,
    },
    debugLogEntry: {
      marginBottom: 8,
    },
    debugLogInput: {
      color: '#6ea8fe',
      fontSize: 13,
      fontFamily: monospace,
    },
    debugLogOutput: {
      color: '#ccc',
      fontSize: 13,
      fontFamily: monospace,
      lineHeight: 18,
    },
    debugLogError: {
      color: '#ff6b6b',
      fontSize: 13,
      fontFamily: monospace,
      lineHeight: 18,
    },
    debugLogInfo: {
      color: '#666',
      fontSize: 13,
      fontFamily: monospace,
      lineHeight: 18,
    },
    debugInputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingBottom: 30,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: '#222',
    },
    debugTextInput: {
      flex: 1,
      backgroundColor: '#111',
      borderWidth: 1,
      borderColor: '#333',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: monospace,
      color: '#fff',
      marginRight: 8,
    },
    debugSendBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: s.accentColor,
      justifyContent: 'center',
      alignItems: 'center',
    },
    debugSendBtnText: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '600',
    },

    // =========================================================================
    // SettingsHandler
    // =========================================================================
    settingsContainer: {
      flex: 1,
      backgroundColor: s.bgPrimary,
    },
    settingsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    settingsHeaderName: {
      color: s.textPrimary,
      fontSize: s.fontSizeHeader,
      fontWeight: '600',
      marginLeft: 4,
      flex: 1,
    },
    settingsHeaderSaveBtn: {
      borderRadius: s.inputRadius,
      paddingVertical: 7,
      paddingHorizontal: 14,
    },
    settingsHeaderSaveBtnDisabled: {
      backgroundColor: s.bgSecondary,
    },
    settingsHeaderSaveBtnText: {
      color: s.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    settingsHeaderSaveBtnTextDisabled: {
      color: s.textMuted,
    },
    settingsContent: {
      padding: 16,
      paddingBottom: 60,
    },
    settingsField: {
      marginBottom: 18,
    },
    settingsLabel: {
      color: s.accentColor,
      fontSize: 14,
      marginBottom: 6,
      marginLeft: 4,
    },
    settingsInput: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 14,
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
    },
    settingsInputMultiline: {
      minHeight: 120,
      textAlignVertical: 'top',
    },
    settingsDefaultText: {
      color: s.textMuted,
      fontSize: 12,
      marginTop: 4,
      marginLeft: 4,
    },
    settingsSectionHeader: {
      marginTop: 24,
      marginBottom: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: s.accentColor,
    },
    settingsSectionHeaderText: {
      color: s.accentColor,
      fontSize: 16,
      fontWeight: '600',
    },
    settingsPlaceholderList: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 12,
    },
    settingsPlaceholderRow: {
      flexDirection: 'row',
      marginBottom: 8,
    },
    settingsPlaceholderKey: {
      color: '#6ea8fe',
      fontSize: 13,
      fontFamily: monospace,
      marginRight: 10,
      minWidth: 120,
    },
    settingsPlaceholderDesc: {
      color: s.textMuted,
      fontSize: 13,
      flex: 1,
    },
    settingsBackBtn: {
      marginRight: 8,
    },
    settingsBackBtnText: {
      color: s.accentColor,
      fontSize: 17,
      fontWeight: '500',
    },
    settingsToggleRow: {
      flexDirection: 'row',
      gap: 8,
    },
    settingsToggleButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.inputRadius,
      paddingVertical: 10,
      alignItems: 'center',
    },
    settingsToggleText: {
      color: s.accentColor,
      fontSize: 14,
      fontWeight: '500',
    },
    settingsToggleTextActive: {
      color: s.bgPrimary,
    },
    settingsLorebookItem: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 14,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingsLorebookItemInfo: {
      flex: 1,
    },
    settingsLorebookItemName: {
      color: s.textPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    settingsLorebookItemCount: {
      color: s.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    settingsLorebookRemoveBtn: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: s.inputRadius,
      borderWidth: 1,
      borderColor: '#cc3333',
    },
    settingsLorebookRemoveBtnText: {
      color: '#cc3333',
      fontSize: 12,
      fontWeight: '500',
    },
    settingsLorebookEmptyText: {
      color: s.textMuted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 20,
      marginBottom: 20,
    },

    // =========================================================================
    // ProvidersHandler
    // =========================================================================
    providerUrlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    providerUrlInput: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 10,
      fontSize: 13,
    },
    providerUrlOkBtn: {
      marginLeft: 6,
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    providerActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    providerActionBtn: {
      marginRight: 6,
    },
    providerAddCard: {
      marginTop: 8,
    },
    providerAddCardContent: {
      alignItems: 'center',
    },
    providerModalContent: {
      padding: 16,
    },

    // =========================================================================
    // Group Chat
    // =========================================================================
    groupBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: s.accentColor,
      justifyContent: 'center',
      alignItems: 'center',
    },
    groupBadgeText: {
      color: s.bgPrimary,
      fontSize: 10,
      fontWeight: '700',
    },
    characterSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: s.borderPrimary,
    },
    characterSelectorScroll: {
      flex: 1,
    },
    characterSelectorItem: {
      alignItems: 'center',
      marginRight: 12,
      opacity: 0.5,
    },
    characterSelectorItemActive: {
      opacity: 1,
    },
    characterSelectorAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: s.bgSecondary,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    characterSelectorAvatarActive: {
      borderColor: s.accentColor,
    },
    characterSelectorName: {
      color: s.textMuted,
      fontSize: 10,
      marginTop: 2,
      maxWidth: 50,
    },
    characterSelectorNameActive: {
      color: s.accentColor,
      fontWeight: '600',
    },
    groupEditorOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    groupEditorContent: {
      backgroundColor: s.bgPrimary,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '85%',
      paddingBottom: 30,
    },
    groupEditorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    groupEditorTitle: {
      color: s.textPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    groupEditorCloseBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: s.bgSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    groupEditorCloseBtnText: {
      color: s.textSecondary,
      fontSize: 16,
    },
    groupEditorBody: {
      padding: 16,
    },
    groupEditorField: {
      marginBottom: 16,
    },
    groupEditorLabel: {
      color: s.accentColor,
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 6,
    },
    groupEditorInput: {
      borderWidth: 1,
      borderColor: s.accentColor,
      borderRadius: s.cardRadius,
      padding: 12,
      fontSize: s.fontSizeBody,
      color: s.textPrimary,
    },
    groupEditorMemberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: s.borderPrimary,
    },
    groupEditorMemberAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: s.bgSecondary,
      marginRight: 12,
    },
    groupEditorMemberInfo: {
      flex: 1,
    },
    groupEditorMemberName: {
      color: s.textPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    groupEditorMemberDesc: {
      color: s.textMuted,
      fontSize: 13,
    },
    groupEditorMemberCheck: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: s.borderPrimary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    groupEditorMemberCheckActive: {
      backgroundColor: s.accentColor,
      borderColor: s.accentColor,
    },
    groupEditorMemberCheckText: {
      color: s.bgPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    groupEditorSaveBtn: {
      backgroundColor: s.accentColor,
      borderRadius: s.cardRadius,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    groupEditorSaveBtnText: {
      color: s.bgPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    makeGroupBtn: {
      marginRight: 12,
    },
    makeGroupBtnText: {
      color: s.accentColor,
      fontSize: 14,
      fontWeight: '500',
    },

    // =========================================================================
    // Welcome guide overlay
    // =========================================================================
    welcomeContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: 32,
      paddingBottom: 12,
    },
    welcomeCenter: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    welcomeTitle: {
      fontSize: s.fontSizeHeader + 6,
      fontWeight: '700',
      color: s.textPrimary,
      textAlign: 'center',
      marginBottom: 12,
    },
    welcomeSubtitle: {
      fontSize: 13,
      color: s.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
      marginBottom: 64,
      paddingHorizontal: 8,
    },
    welcomeArrowGroup: {
      width: '100%',
      paddingHorizontal: 16,
      height: 80,
    },
    welcomeItemLeft: {
      alignItems: 'center',
      position: 'absolute',
      left: -30,
      bottom: 0,
    },
    welcomeItemCenter: {
      alignItems: 'center',
      position: 'absolute',
      alignSelf: 'center',
      bottom: 0,
    },
    welcomeItemRight: {
      alignItems: 'center',
      position: 'absolute',
      right: -30,
      bottom: 0,
    },
    welcomeArrow: {
      fontSize: 28,
      color: s.accentColor,
      marginTop: 4,
    },
    welcomeLabel: {
      fontSize: 13,
      color: s.textSecondary,
      textAlign: 'center',
    },
  });
}
