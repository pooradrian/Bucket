import { ChatMessage, ChatSession } from './useChat';
import { digestMessages, runWithMedia } from './Attachments';
import {
  PromptConfig,
  ChatMessageObject,
  estimateTokens,
} from './PromptHandler';
import { getAIResponse } from './Endpoint';
import { deleteMessage, addMessage, generateId } from './Database';

interface SummarizationConfig {
  enabled: boolean;
  tokenThreshold: number;
  maxSummaries: number;
  model: string;
}

export function getSummarizationConfig(
  config: PromptConfig,
): SummarizationConfig {
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
  const digest = await digestMessages(messages);
  const conversationText = digest.messages
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

  const result = await runWithMedia(digest.media, media =>
    getAIResponse(
      media.length
        ? [summaryPrompt[0], { ...summaryPrompt[1], attachments: media }]
        : summaryPrompt,
      { ...promptConfig, model: config.model },
      undefined,
      false,
      new AbortController(),
    ),
  );

  return result.content.trim();
}

function isSummaryMessage(msg: ChatMessage): boolean {
  return msg.role === 'assistant' && msg.content.startsWith('[Summary]');
}

// Summaries always sit at the start of the session, oldest first, ahead of
// the remaining conversation. Database.addMessage can only append or
// prepend, so the summary block is rewritten as a whole: every summary in
// the final list is inserted as a fresh row (prepended newest-first, so it
// ends up oldest-first), and only once every insert has succeeded are the
// old summary rows and the summarized messages deleted. If any insert fails
// the rows written so far are removed again and the session is untouched.
async function persistSummaryBlock(
  sessionId: string,
  summaries: ChatMessage[],
  toDelete: ChatMessage[],
): Promise<boolean> {
  const inserted: string[] = [];
  try {
    for (let i = summaries.length - 1; i >= 0; i--) {
      await addMessage(sessionId, summaries[i], true);
      inserted.push(summaries[i].id);
    }
  } catch (e) {
    console.warn('Failed to store summary, leaving session untouched:', e);
    for (const id of inserted) {
      try {
        deleteMessage(id);
      } catch (rollbackError) {
        console.warn('Failed to roll back summary insert:', rollbackError);
      }
    }
    return false;
  }

  for (const msg of toDelete) {
    try {
      deleteMessage(msg.id);
    } catch (e) {
      console.warn('Failed to delete summarized message:', e);
    }
  }
  return true;
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
  const totalTokens = estimateMessageTokens(messages);

  if (totalTokens <= config.tokenThreshold) {
    return session;
  }

  // Existing summaries are kept as-is (never re-summarized) and ordered
  // chronologically by their timestamp, which also repairs sessions stored
  // newest-summary-first by older versions.
  const oldSummaries = messages
    .filter(isSummaryMessage)
    .sort((a, b) => a.timestamp - b.timestamp);
  const conversation = messages.filter(m => !isSummaryMessage(m));

  let splitIndex = -1;
  let tokenCount = 0;
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(conversation[i].content);
    if (tokenCount + msgTokens > config.tokenThreshold) {
      splitIndex = i;
      break;
    }
    tokenCount += msgTokens;
  }

  if (splitIndex <= 0) {
    return session;
  }

  const messagesToSummarize = conversation.slice(0, splitIndex + 1);
  const remaining = conversation.slice(splitIndex + 1);
  const summaryText = await summarizeMessages(
    messagesToSummarize,
    config,
    promptConfig,
  );
  if (!summaryText) {
    console.warn('Summarizer returned an empty summary, skipping.');
    return session;
  }

  const lastOldTimestamp = oldSummaries.length
    ? oldSummaries[oldSummaries.length - 1].timestamp
    : 0;
  let summaries: ChatMessage[] = [
    ...oldSummaries,
    {
      id: generateId(),
      role: 'assistant',
      content: `[Summary] ${summaryText}`,
      timestamp: Math.max(Date.now(), lastOldTimestamp + 1),
    },
  ];

  const maxSummaries = Math.max(1, config.maxSummaries);
  while (summaries.length > maxSummaries) {
    const mergeCount = summaries.length - maxSummaries + 1;
    const summariesToMerge = summaries.slice(0, mergeCount);
    let mergedText: string;
    try {
      mergedText = await summarizeMessages(
        summariesToMerge,
        config,
        promptConfig,
      );
    } catch (e) {
      console.warn('Failed to merge summaries:', e);
      break;
    }
    if (!mergedText) {
      console.warn('Summary merge returned an empty summary, skipping.');
      break;
    }
    summaries = [
      {
        id: generateId(),
        role: 'assistant',
        content: `[Summary] ${mergedText}`,
        // The merged summary stands in for the oldest ones, so it must sort
        // before every summary that was not merged.
        timestamp: summariesToMerge[summariesToMerge.length - 1].timestamp,
      },
      ...summaries.slice(mergeCount),
    ];
  }

  // Fresh ids for every summary row, since the whole block is rewritten.
  const finalSummaries = summaries.map(s => ({ ...s, id: generateId() }));
  const ok = await persistSummaryBlock(session.id, finalSummaries, [
    ...oldSummaries,
    ...messagesToSummarize,
  ]);
  if (!ok) {
    return session;
  }

  return {
    ...session,
    messages: [...finalSummaries, ...remaining],
    updatedAt: Date.now(),
  };
}
