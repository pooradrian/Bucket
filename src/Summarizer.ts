import {ChatMessage, ChatSession} from './useChat';
import {PromptConfig, ChatMessageObject, estimateTokens} from './PromptHandler';
import {getAIResponse} from './Endpoint';
import {deleteMessage, addMessage, generateId} from './Database';

interface SummarizationConfig {
  enabled: boolean;
  tokenThreshold: number;
  maxSummaries: number;
  model: string;
}

export function getSummarizationConfig(config: PromptConfig): SummarizationConfig {
  return {
    enabled: config.summarizationEnabled,
    tokenThreshold: Number(config.summarizationTokenThreshold) || 4000,
    maxSummaries: Number(config.summarizationMaxSummaries) || 3,
    model: config.summarizationModel || config.model,
  };
}

function estimateMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
  }
  return total;
}

async function summarizeMessages(
  messages: ChatMessage[],
  config: SummarizationConfig,
  promptConfig: PromptConfig,
): Promise<string> {
  const conversationText = messages
    .map(m => {
      if (m.content.startsWith('[Summary]')) {
        return m.content.replace(/^\[Summary\]\s*/, '');
      }
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
    })
    .join('\n\n');

  const summaryPrompt: ChatMessageObject[] = [
    {
      role: 'system',
      content: `You are a conversation summarizer. Summarize the following roleplay conversation into a concise paragraph that captures:
- Key events and plot points
- Character interactions and relationships
- Important decisions or changes
- Current situation/state

Keep the summary under 200 words. Be factual and neutral. Do not add commentary.`,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ];

  const ctrl = new AbortController();
  const result = await getAIResponse(summaryPrompt, {...promptConfig, model: config.model}, undefined, false, ctrl);

  return result.content.trim();
}

function isSummaryMessage(msg: ChatMessage): boolean {
  return msg.content.startsWith('[Summary]');
}

export async function checkAndSummarize(
  session: ChatSession,
  config: SummarizationConfig,
  promptConfig: PromptConfig,
): Promise<ChatSession> {
  if (!config.enabled || session.messages.length < 4) {
    return session;
  }

  const messages = [...session.messages];
  let totalTokens = estimateMessageTokens(messages);

  if (totalTokens <= config.tokenThreshold) {
    return session;
  }

  let processedMessages = [...messages];

  let splitIndex = -1;
  let tokenCount = 0;
  for (let i = processedMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(processedMessages[i].content);
    if (tokenCount + msgTokens > config.tokenThreshold) {
      splitIndex = i;
      break;
    }
    tokenCount += msgTokens;
  }

  if (splitIndex <= 0) {
    return session;
  }

  const messagesToSummarize = processedMessages.slice(0, splitIndex + 1);
  const summaryText = await summarizeMessages(messagesToSummarize, config, promptConfig);

  const newSummary: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: `[Summary] ${summaryText}`,
    timestamp: Date.now(),
  };

  for (const msg of messagesToSummarize) {
    if (!isSummaryMessage(msg)) {
      try {
        await deleteMessage(msg.id);
      } catch (e) { console.warn('Failed to delete old message:', e); }
    }
  }

  processedMessages = [newSummary, ...processedMessages.slice(splitIndex + 1)];

  let existingSummaries = processedMessages.filter(m => isSummaryMessage(m));

  while (existingSummaries.length > config.maxSummaries) {
    const summariesToMerge = existingSummaries.slice(0, existingSummaries.length - config.maxSummaries + 1);

    const mergedText = await summarizeMessages(summariesToMerge, config, promptConfig);

    const mergedSummary: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: `[Summary] ${mergedText}`,
      timestamp: Date.now(),
    };

    for (const msg of summariesToMerge) {
      try {
        await deleteMessage(msg.id);
      } catch (e) { console.warn('Failed to delete old summary:', e); }
      const idx = processedMessages.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        processedMessages.splice(idx, 1);
      }
    }

    processedMessages.unshift(mergedSummary);

    try {
      await addMessage(session.id, mergedSummary);
    } catch (e) { console.warn('Failed to add merged summary:', e); }

    existingSummaries = processedMessages.filter(m => isSummaryMessage(m));
  }

  try {
    await addMessage(session.id, newSummary);
  } catch (e) { console.warn('Failed to add summary:', e); }

  return {
    ...session,
    messages: processedMessages,
    updatedAt: Date.now(),
  };
}
