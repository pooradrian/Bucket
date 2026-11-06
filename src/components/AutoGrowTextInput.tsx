import { useState } from 'react';
import {
  TextInput,
  TextInputContentSizeChangeEvent,
  TextInputProps,
} from 'react-native';
import { useAppStore } from '../store';

export const SCROLL_MAX_HEIGHT = 220;

type Props = TextInputProps & {
  minHeight?: number;
  /** Height cap in "scrolling" mode; the box scrolls internally past it. */
  maxHeight?: number;
  /** Optional height cap in "stretching" mode (e.g. for the chat composer). */
  stretchMaxHeight?: number;
};

/**
 * The one multiline text box used across the app. Behaviour follows the
 * "Text boxes" setting: stretching boxes grow with their content, scrolling
 * boxes stop at a fixed height and scroll inside themselves.
 */
export default function AutoGrowTextInput({
  style,
  minHeight = 120,
  maxHeight = SCROLL_MAX_HEIGHT,
  stretchMaxHeight,
  ...rest
}: Props) {
  const scrolling = useAppStore(s => s.appSettings.textBoxMode) === 'scroll';
  const [contentHeight, setContentHeight] = useState(minHeight);
  const cap = scrolling ? maxHeight : stretchMaxHeight;
  const capped = cap === undefined ? contentHeight : Math.min(contentHeight, cap);
  const height = Math.max(minHeight, capped);
  const isCapped = cap !== undefined && contentHeight > cap;
  return (
    <TextInput
      {...rest}
      multiline
      textAlignVertical="top"
      scrollEnabled={isCapped}
      style={[style, { height }]}
      onContentSizeChange={(e: TextInputContentSizeChangeEvent) => {
        setContentHeight(e.nativeEvent.contentSize.height);
        rest.onContentSizeChange?.(e);
      }}
    />
  );
}
