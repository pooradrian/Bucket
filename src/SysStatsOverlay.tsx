import {useEffect, useRef, useState, useCallback} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, NativeModules} from 'react-native';

const {SysStats} = NativeModules;

interface Stats {
  fps: number;
  jsHeapUsed: number;
  jsHeapTotal: number;
  jsHeapMax: number;
  nativeHeapAllocated: number;
  nativeHeapTotal: number;
  cpuTimeMs: number;
  numProcessors: number;
}

interface SysStatsOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function SysStatsOverlay({visible, onClose}: SysStatsOverlayProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const lastCpuTimeRef = useRef(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const measureFps = useCallback(() => {
    frameCountRef.current++;
    const now = performance.now();
    const elapsed = now - lastTimeRef.current;
    if (elapsed >= 1000) {
      const fps = Math.round((frameCountRef.current * 1000) / elapsed);
      frameCountRef.current = 0;
      lastTimeRef.current = now;
      setStats(prev => (prev ? {...prev, fps} : null));
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      if (fpsIntervalRef.current) {
        cancelAnimationFrame(fpsIntervalRef.current as any);
        fpsIntervalRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      setStats(null);
      return;
    }

    let animFrameId: number;
    const tick = () => {
      measureFps();
      animFrameId = requestAnimationFrame(tick);
    };
    animFrameId = requestAnimationFrame(tick);

    statsIntervalRef.current = setInterval(async () => {
      try {
        const [memInfo, cpuInfo] = await Promise.all([
          SysStats.getMemoryInfo(),
          SysStats.getCpuTime(),
        ]);

        lastCpuTimeRef.current = cpuInfo.cpuTimeMs;

        setStats(prev => ({
          ...prev,
          fps: prev?.fps ?? 0,
          jsHeapUsed: memInfo.jsHeapUsed,
          jsHeapTotal: memInfo.jsHeapTotal,
          jsHeapMax: memInfo.jsHeapMax,
          nativeHeapAllocated: memInfo.nativeHeapAllocated,
          nativeHeapTotal: memInfo.nativeHeapTotal,
          cpuTimeMs: cpuInfo.cpuTimeMs,
          numProcessors: cpuInfo.numProcessors,
        }));
      } catch {}
    }, 500);

    return () => {
      cancelAnimationFrame(animFrameId);
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [visible, measureFps]);

  if (!visible || !stats) return null;

  const formatMB = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  const jsPercent = stats.jsHeapTotal > 0
    ? ((stats.jsHeapUsed / stats.jsHeapTotal) * 100).toFixed(1)
    : '0';

  const nativePercent = stats.nativeHeapTotal > 0
    ? ((stats.nativeHeapAllocated / stats.nativeHeapTotal) * 100).toFixed(1)
    : '0';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>SYSSTATS</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>X</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.content}>
        <View style={styles.row}>
          <Text style={styles.label}>FPS</Text>
          <Text style={[styles.value, stats.fps < 30 && styles.warning]}>
            {stats.fps}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>JS Heap</Text>
          <Text style={styles.value}>
            {formatMB(stats.jsHeapUsed)} / {formatMB(stats.jsHeapTotal)}
          </Text>
        </View>
        <Text style={styles.subValue}>{jsPercent}% of {formatMB(stats.jsHeapMax)} max</Text>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Native Heap</Text>
          <Text style={styles.value}>
            {formatMB(stats.nativeHeapAllocated)} / {formatMB(stats.nativeHeapTotal)}
          </Text>
        </View>
        <Text style={styles.subValue}>{nativePercent}% allocated</Text>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>CPU</Text>
          <Text style={styles.value}>
            {stats.numProcessors} cores
          </Text>
        </View>
        <Text style={styles.subValue}>
          Process time: {(stats.cpuTimeMs / 1000).toFixed(1)}s
        </Text>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>GPU</Text>
          <Text style={styles.value}>N/A</Text>
        </View>
        <Text style={styles.subValue}>Requires native module</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    minWidth: 220,
    zIndex: 99999,
    elevation: 99999,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerText: {
    color: '#00ff88',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  closeBtn: {
    padding: 2,
  },
  closeBtnText: {
    color: '#ff4444',
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
  },
  value: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  subValue: {
    color: '#666',
    fontSize: 10,
    textAlign: 'right',
    marginTop: -2,
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  warning: {
    color: '#ff4444',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 2,
  },
});
