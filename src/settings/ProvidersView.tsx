import {useEffect, useState} from 'react';

import ProvidersHandler from '../ProvidersHandler';
import {PromptConfig, DEFAULT_PROMPT_CONFIG} from '../PromptHandler';
import {getActiveProviderId} from '../SecureStore';
import {useAppStore} from '../store';
import {TextField} from './ui';

interface ProvidersViewProps {
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
}

export default function ProvidersView({
  promptValues,
  setPromptValues,
}: ProvidersViewProps) {
  const promptConfigVersion = useAppStore(s => s.promptConfigVersion);
  const [activeProviderId, setActiveProviderId] = useState('');

  useEffect(() => {
    setActiveProviderId(getActiveProviderId() || '');
  }, [promptConfigVersion]);

  return (
    <>
      <ProvidersHandler
        activeProviderId={activeProviderId}
        onSelect={id => {
          setActiveProviderId(id);
          setPromptValues(prev => ({...prev, providerId: id}));
        }}
      />

      <TextField
        label="Model"
        value={promptValues.model}
        onChangeText={text => setPromptValues(prev => ({...prev, model: text}))}
        placeholder={DEFAULT_PROMPT_CONFIG.model}
      />

      <TextField
        label="Temperature"
        value={promptValues.temperature}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, temperature: text}))
        }
        placeholder={DEFAULT_PROMPT_CONFIG.temperature}
        keyboardType="decimal-pad"
      />
    </>
  );
}
