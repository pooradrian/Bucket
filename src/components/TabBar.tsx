import React, {useCallback, useRef, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import {useTheme} from '../ThemeContext';

interface TabBarProps {
  hasChat: boolean;
  isChat: boolean;
  onSettingsPress: () => void;
  onNewPress: () => void;
  onMenuPress: () => void;
  onChatPress: () => void;
  onCloseChat: () => void;
}

export default function TabBar({
  hasChat,
  isChat,
  onSettingsPress,
  onNewPress,
  onMenuPress,
  onChatPress,
  onCloseChat,
}: TabBarProps) {
  const st = useTheme();

  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const pillOpacity = useSharedValue(0);
  const chatTextOpacity = useSharedValue(0);
  const lastChatTapRef = useRef(0);
  const [chatTabWidth, setChatTabWidth] = useState(0);
  const [menuTabWidth, setMenuTabWidth] = useState(0);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: indicatorW.value,
    transform: [{translateX: indicatorX.value}],
    opacity: pillOpacity.value,
  }));

  const chatTextStyle = useAnimatedStyle(() => ({
    opacity: chatTextOpacity.value,
  }));

  React.useEffect(() => {
    if (!hasChat) {
      pillOpacity.value = withTiming(0, {duration: 300});
      indicatorW.value = withTiming(0, {duration: 300});
      chatTextOpacity.value = withTiming(0, {duration: 200});
      return;
    }

    pillOpacity.value = withTiming(1, {duration: 250});
    indicatorW.value = withTiming(isChat ? chatTabWidth : menuTabWidth, {
      duration: 300,
    });
    indicatorX.value = withTiming(isChat ? 0 : chatTabWidth + 4, {
      duration: 300,
    });
    chatTextOpacity.value = withTiming(1, {duration: 200});
  }, [
    hasChat,
    isChat,
    chatTabWidth,
    menuTabWidth,
    pillOpacity,
    indicatorW,
    indicatorX,
    chatTextOpacity,
  ]);

  const handleChatTabPress = useCallback(() => {
    const now = Date.now();
    const isDoubleTap = now - lastChatTapRef.current < 300;
    lastChatTapRef.current = now;

    if (isDoubleTap && hasChat) {
      pillOpacity.value = withTiming(0, {duration: 350});
      chatTextOpacity.value = withTiming(0, {duration: 200}, () => {
        'worklet';
        runOnJS(onCloseChat)();
      });
    } else {
      onChatPress();
    }
  }, [hasChat, onCloseChat, onChatPress, chatTextOpacity, pillOpacity]);

  return (
    <>
      <TouchableOpacity
        style={st.sideButton}
        onPress={onSettingsPress}>
        <Text style={st.sideButtonText}>☰</Text>
      </TouchableOpacity>

      {hasChat && (
        <View style={st.pillContainer}>
          <Animated.View style={[st.pillIndicator, indicatorStyle]} />
          <TouchableOpacity
            style={st.tabButton}
            onPress={handleChatTabPress}
            onLayout={e => setChatTabWidth(e.nativeEvent.layout.width)}>
            <Animated.Text
              style={[
                isChat ? st.tabTextActive : st.tabTextInactive,
                chatTextStyle,
              ]}>
              Chat
            </Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.tabButton}
            onPress={onMenuPress}
            onLayout={e => setMenuTabWidth(e.nativeEvent.layout.width)}>
            <Text style={!isChat ? st.tabTextActive : st.tabTextInactive}>
              Menu
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={st.sideButton} onPress={onNewPress}>
        <Text style={st.sideButtonText}>+</Text>
      </TouchableOpacity>
    </>
  );
}
