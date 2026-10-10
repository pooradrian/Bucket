import { useState } from 'react';
import {
  TextInput,
  TextInputContentSizeChangeEvent,
  TextInputProps,
} from 'react-native';

export default function AutoGrowTextInput({
  style,
  minHeight = 120,
  ...rest
}: TextInputProps & { minHeight?: number }) {
  const [height, setHeight] = useState(minHeight);
  return (
    <TextInput
      {...rest}
      multiline
      textAlignVertical="top"
      style={[style, { height }]}
      onContentSizeChange={(e: TextInputContentSizeChangeEvent) =>
        setHeight(Math.max(minHeight, e.nativeEvent.contentSize.height))
      }
    />
  );
}
