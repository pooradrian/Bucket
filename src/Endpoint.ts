import axios from 'axios';
import {ChatMessageObject, PromptConfig, TimingMetrics} from './PromptHandler';

function streamWithXHR(
  url: string,
  headers: Record<string, string>,
  body: object,
  onToken: (token: string) => void,
  controller: AbortController,
): Promise<{content: string; ttfbMs: number}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let content = '';
    let ttfbMs = 0;
    let firstToken = true;
    let processedLen = 0;
    let lineBuffer = '';
    let settled = false;
    let startTime = 0;

    // Single idempotent settle point — every completion path funnels
    // through here, guaranteeing the promise is settled exactly once
    // and that no callback can re-enter after teardown.
    function settle(mode: 'resolve' | 'reject', value?: unknown) {
      if (settled) return;
      settled = true;
      xhr.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      if (mode === 'resolve') {
        resolve(value as {content: string; ttfbMs: number});
      } else {
        reject(value);
      }
    }

    xhr.open('POST', url, true);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.onprogress = () => {
      if (settled) return;
      const fullText = xhr.responseText || '';
      if (fullText.length <= processedLen) return;

      const newText = fullText.slice(processedLen);
      processedLen = fullText.length;
      lineBuffer += newText;
      const completeLines = lineBuffer.split('\n');
      lineBuffer = completeLines.pop() || '';

      for (const line of completeLines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          // Stream is naturally complete — resolve without aborting.
          // Calling xhr.abort() here risks re-entrant onload/onerror.
          settle('resolve', {content, ttfbMs});
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            if (firstToken) {
              ttfbMs = performance.now() - startTime;
              firstToken = false;
            }
            content += delta;
            onToken(delta);
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    };

    xhr.onload = () => {
      if (settled) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        settle('resolve', {content, ttfbMs});
      } else {
        const errorText = xhr.responseText || '';
        settle('reject', new Error(`API error ${xhr.status}: ${errorText}`));
      }
    };

    xhr.onerror = () => {
      settle('reject', new Error('Network error'));
    };

    // Attach the abort listener BEFORE xhr.send() so an immediate
    // cancel cannot slip through the window between send and
    // addEventListener.  settle() is called first so any re-entrant
    // callback triggered by xhr.abort() is a no-op.
    controller.signal.addEventListener('abort', () => {
      settle('reject', new Error('Request was cancelled'));
      xhr.abort();
    });

    startTime = performance.now();
    xhr.send(JSON.stringify(body));
  });
}

export async function getAIResponse(
  messages: ChatMessageObject[],
  config: PromptConfig,
  onToken?: (token: string) => void,
  streaming: boolean = true,
  controller?: AbortController,
): Promise<{content: string; metrics: TimingMetrics}> {
  const url = config.apiUrl?.trim();
  if (!url) {
    throw new Error('No API URL configured. Set apiUrl in Prompt Settings.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const tempNum = Number(config.temperature);
  const hasTemp =
    config.temperature !== '' &&
    !Number.isNaN(tempNum) &&
    tempNum >= 0 &&
    tempNum <= 2;

  const body: Record<string, unknown> = {
    model: config.model || 'gpt-4o',
    messages,
    stream: streaming,
  };
  if (hasTemp) {
    body.temperature = tempNum;
  }

  const ctrl = controller || new AbortController();
  const t0 = performance.now();

  let content = '';
  let ttfbMs = 0;

  try {
    if (streaming) {
      const result = await streamWithXHR(url, headers, body, onToken ?? (() => {}), ctrl);
      ttfbMs = result.ttfbMs;
      content = result.content;
    } else {
      const response = await axios({
        method: 'POST',
        url,
        headers,
        data: body,
        signal: ctrl.signal,
      });
      ttfbMs = performance.now() - t0;
      content = response.data.choices?.[0]?.message?.content || '';
    }
  } catch (e: unknown) {
    if (e instanceof Error && (e.name === 'AbortError' || e.message === 'Request was cancelled' || axios.isCancel(e))) {
      throw new Error('Request was cancelled');
    }
    if (e instanceof Error && e.message.startsWith('API error ')) throw e;
    const axiosErr = e as {response?: {status?: number; data?: unknown}; message?: string};
    const status = axiosErr.response?.status;
    const errorText = axiosErr.response?.data
      ? (typeof axiosErr.response.data === 'string' ? axiosErr.response.data : JSON.stringify(axiosErr.response.data))
      : (e instanceof Error ? e.message : String(e));
    if (status) {
      throw new Error(`API error ${status}: ${errorText}`);
    }
    throw new Error(`Network error: ${errorText}`);
  }

  const totalMs = performance.now() - t0;
  const bodyReadMs = totalMs - ttfbMs;

  return {
    content,
    metrics: {
      promptBuildMs: 0,
      ttfbMs,
      bodyReadMs,
      totalMs,
    },
  };
}
