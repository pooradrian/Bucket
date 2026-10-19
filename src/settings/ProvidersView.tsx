import { useEffect, useState } from 'react';

import ProvidersHandler from '../ProvidersHandler';
import {
  PromptConfig,
  DEFAULT_PROMPT_CONFIG,
  applyModelField,
  detachModelPreset,
} from '../PromptHandler';
import { getActiveProviderId } from '../SecureStore';
import { useAppStore } from '../store';
import { TextField } from './ui';

export type ProvidersSection = 'providers' | 'model';

interface ProvidersViewProps {
  section: ProvidersSection;
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
}

export default function ProvidersView({
  section,
  promptValues,
  setPromptValues,
}: ProvidersViewProps) {
  const promptConfigVersion = useAppStore(s => s.promptConfigVersion);
  const [activeProviderId, setActiveProviderId] = useState('');

  useEffect(() => {
    setActiveProviderId(getActiveProviderId() || '');
  }, [promptConfigVersion]);

  if (section === 'providers') {
    return (
      <ProvidersHandler
        activeProviderId={activeProviderId}
        onSelect={id => {
          setActiveProviderId(id);
          setPromptValues(prev => ({ ...prev, providerId: id }));
        }}
      />
    );
  }

  return (
    <>
      <TextField
        label="Model"
        value={promptValues.model}
        onChangeText={text =>
          setPromptValues(prev => applyModelField(prev, text))
        }
        placeholder={DEFAULT_PROMPT_CONFIG.model}
      />

      <TextField
        label="Temperature"
        value={promptValues.temperature}
        onChangeText={text =>
          setPromptValues(prev =>
            detachModelPreset(prev, { temperature: text }),
          )
        }
        placeholder={DEFAULT_PROMPT_CONFIG.temperature}
        keyboardType="decimal-pad"
      />

      <TextField
        label="Top P"
        value={promptValues.topP}
        onChangeText={text =>
          setPromptValues(prev => detachModelPreset(prev, { topP: text }))
        }
        placeholder="1"
        keyboardType="decimal-pad"
      />

      <TextField
        label="Extra body"
        note={
          'Merged into every request body (your keys win). JSON object only, e.g. {"reasoning_effort": "high"}'
        }
        value={promptValues.extraBody}
        onChangeText={text =>
          setPromptValues(prev => ({ ...prev, extraBody: text }))
        }
        placeholder="{}"
      />
    </>
  );
}
