import React from 'react';
import { View } from 'react-native';

const SIZE = 34;
const SEGMENTS = 24;
const TICK_WIDTH = 2;
const TICK_HEIGHT = 4;
const RADIUS = SIZE / 2 - TICK_HEIGHT / 2;

interface ContextRingProps {
  progress: number;
  accent: string;
  track: string;
}

function ContextRing({ progress, accent, track }: ContextRingProps) {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * SEGMENTS);

  return (
    <View style={{ width: SIZE, height: SIZE }}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: SIZE / 2 - TICK_WIDTH / 2,
            top: SIZE / 2 - TICK_HEIGHT / 2,
            width: TICK_WIDTH,
            height: TICK_HEIGHT,
            borderRadius: TICK_WIDTH / 2,
            backgroundColor: i < filled ? accent : track,
            transform: [
              { rotate: `${(i / SEGMENTS) * 360}deg` },
              { translateY: -RADIUS },
            ],
          }}
        />
      ))}
    </View>
  );
}

export default React.memo(ContextRing);
