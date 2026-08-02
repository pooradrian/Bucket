import React from 'react';
import {Text} from 'react-native';

export function renderFormattedText(text: string, baseStyle: object, forceItalic: boolean = false) {
  const parts: {text: string; italic: boolean}[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({text: text.slice(lastIndex, match.index), italic: false});
    }
    parts.push({text: match[1], italic: true});
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({text: text.slice(lastIndex), italic: false});
  }
  if (parts.length === 0) {
    parts.push({text, italic: false});
  }
  return parts.map((p, i) => (
    <Text
      key={i}
      style={[
        baseStyle,
        p.italic &&
          (forceItalic
            ? {transform: [{skewX: '-10deg'}]}
            : {fontStyle: 'italic' as const}),
      ]}>
      {p.text}
    </Text>
  ));
}
