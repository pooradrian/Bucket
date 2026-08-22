import {useState, useRef, useCallback, useEffect} from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import axios, {AxiosRequestConfig} from 'axios';
import {LogEntry} from './debuggerUtils';
import {useAppStore} from './store';
import {useTheme} from './ThemeContext';
import {executeDebuggerCommand} from './debugger/commands';

const MAX_LOG_ENTRIES = 500;

function redactHeaders(headers: unknown): string {
  try {
    const copy: Record<string, unknown> = JSON.parse(JSON.stringify(headers || {}));
    for (const key of Object.keys(copy)) {
      if (key.toLowerCase() === 'authorization') {
        const val = String(copy[key]);
        copy[key] = val.length > 12 ? `${val.slice(0, 12)}...` : '...';
      }
    }
    return JSON.stringify(copy);
  } catch {
    return '<unserializable headers>';
  }
}

const reqMetaMap = new WeakMap<AxiosRequestConfig, {reqId: string; t0: number}>();

interface DebuggerProps {
  onClose: () => void;
  bottomInset: number;
}

export default function Debugger({onClose, bottomInset}: DebuggerProps) {
  const characters = useAppStore(st => st.characters);
  const appSettings = useAppStore(st => st.appSettings);
  const toggleSysStats = useAppStore(st => st.toggleSysStats);
  const st = useTheme();
  const [log, setLog] = useState<LogEntry[]>([
    {id: '0', type: 'info', text: 'Debugger ready. Type "help" for available commands.'},
  ]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<LogEntry>>(null);
  const verboseRef = useRef(false);
  const reqInterceptorRef = useRef<number | null>(null);
  const resInterceptorRef = useRef<number | null>(null);

  const appendLog = useCallback((type: LogEntry['type'], text: string) => {
    setLog(prev => {
      const next = [...prev, {id: Date.now().toString() + Math.random(), type, text}];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (reqInterceptorRef.current !== null) {
        axios.interceptors.request.eject(reqInterceptorRef.current);
      }
      if (resInterceptorRef.current !== null) {
        axios.interceptors.response.eject(resInterceptorRef.current);
      }
    };
  }, []);

  const enableVerbose = useCallback(() => {
    if (verboseRef.current) return;
    verboseRef.current = true;

    reqInterceptorRef.current = axios.interceptors.request.use((config) => {
      const reqId = Math.random().toString(36).slice(2, 8);
      reqMetaMap.set(config, {reqId, t0: 0});

      let bodyPreview = '';
      if (config.data && typeof config.data === 'string') {
        try {
          const parsed = JSON.parse(config.data);
          bodyPreview = JSON.stringify(parsed, null, 2);
        } catch {
          bodyPreview = String(config.data).slice(0, 500);
        }
      } else if (config.data && typeof config.data === 'object') {
        bodyPreview = JSON.stringify(config.data, null, 2);
      }

      appendLog('info', `[${reqId}] >>> ${config.method?.toUpperCase() || 'GET'} ${config.url}`);
      if (bodyPreview) {
        appendLog('info', `[${reqId}] >>> Body:\n${bodyPreview}`);
      }
      if (config.headers) {
        appendLog('info', `[${reqId}] >>> Headers: ${redactHeaders(config.headers)}`);
      }

      reqMetaMap.set(config, {reqId, t0: performance.now()});
      return config;
    });

    resInterceptorRef.current = axios.interceptors.response.use(
      (response) => {
        const meta = reqMetaMap.get(response.config) || {reqId: '???', t0: performance.now()};
        const reqId = meta.reqId;
        const t0 = meta.t0;
        const ms = (performance.now() - t0).toFixed(0);
        const resHeaders = response.headers || {};

        appendLog('info', [
          `[${reqId}] <<< ${response.status} ${response.statusText} in ${ms}ms`,
          `  Headers: ${redactHeaders(resHeaders)}`,
        ].join('\n'));

        return response;
      },
      (error) => {
        const config = error.config || {};
        const meta = reqMetaMap.get(config) || {reqId: '???', t0: performance.now()};
        const reqId = meta.reqId;
        const t0 = meta.t0;
        const ms = (performance.now() - t0).toFixed(0);
        const status = error.response?.status;

        let bodyPreview = '';
        const data = error.response?.data;
        if (typeof data === 'string') {
          bodyPreview = data.slice(0, 500);
        } else if (data && typeof data === 'object') {
          try {
            bodyPreview = JSON.stringify(data, null, 2).slice(0, 500);
          } catch {
            bodyPreview = '';
          }
        }

        appendLog('error', [
          `[${reqId}] <<< ${status || 'ERR'} ${error.message}`,
          `  in ${ms}ms`,
          bodyPreview ? `  Body: ${bodyPreview}` : '',
        ].filter(Boolean).join('\n'));

        return Promise.reject(error);
      },
    );

    appendLog('output', 'Verbose axios logging ON');
  }, [appendLog]);

  const disableVerbose = useCallback(() => {
    if (!verboseRef.current) return;
    if (reqInterceptorRef.current !== null) {
      axios.interceptors.request.eject(reqInterceptorRef.current);
      reqInterceptorRef.current = null;
    }
    if (resInterceptorRef.current !== null) {
      axios.interceptors.response.eject(resInterceptorRef.current);
      resInterceptorRef.current = null;
    }
    verboseRef.current = false;
    appendLog('output', 'Verbose axios logging OFF');
  }, [appendLog]);

  const executeCommand = useCallback(
    async (raw: string) => {
      await executeDebuggerCommand(raw, {
        characters,
        appSettings,
        toggleSysStats,
        enableVerbose,
        disableVerbose,
        isVerbose: () => verboseRef.current,
      }, {
        log: appendLog,
        clear: () => setLog([]),
      });
    },
    [characters, appSettings, appendLog, enableVerbose, disableVerbose, toggleSysStats],
  );

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput('');
    executeCommand(text);
  };

  const renderLogEntry = ({item}: {item: LogEntry}) => {
    const textStyle = item.type === 'input'
      ? st.debugLogInput
      : item.type === 'output'
      ? st.debugLogOutput
      : item.type === 'error'
      ? st.debugLogError
      : st.debugLogInfo;

    return (
      <View style={st.debugLogEntry}>
        <Text style={textStyle}>
          {item.text}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={st.debugScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={st.debugHeader}>
        <TouchableOpacity onPress={onClose} style={st.debugClose}>
          <Text style={st.debugCloseText}>Close</Text>
        </TouchableOpacity>
        <Text style={st.debugTitle}>
          Debugger
        </Text>
      </View>

      {/* Output */}
      <FlatList
        ref={flatListRef}
        data={log}
        keyExtractor={item => item.id}
        renderItem={renderLogEntry}
        contentContainerStyle={st.debugOutput}
        style={st.debugFlatList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({animated: false})}
        onLayout={() => flatListRef.current?.scrollToEnd({animated: false})}
      />

      {/* Input */}
      <View style={[st.debugInputBar, {paddingBottom: bottomInset}]}>
        <TextInput
          style={st.debugTextInput}
          value={input}
          onChangeText={setInput}
          placeholder="$ "
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={st.debugSendBtn}
          onPress={handleSubmit}>
          <Text style={st.debugSendBtnText}>{'›'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
