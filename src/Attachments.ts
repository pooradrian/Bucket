import RNFS from 'react-native-fs';
import type { ChatMessage } from './useChat';
import { decrypt, encrypt } from './Crypto';

export type AttachmentKind = 'image' | 'audio' | 'file';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  /** Voice notes only: recording length in milliseconds. */
  durationMs?: number;
}

/** Hard cap per attachment (raw bytes). Base64 inflates this by a third. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Only this many of the newest attachment-bearing messages carry real data. */
export const MAX_ATTACHED_MESSAGES = 4;
const MAX_INLINE_TEXT_CHARS = 200000;

const ATTACHMENT_DIR = `${RNFS.DocumentDirectoryPath}/attachments`;

function attachmentPath(id: string): string {
  return `${ATTACHMENT_DIR}/${id}`;
}

function newAttachmentId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'xml',
  'html',
  'htm',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'sh',
  'sql',
  'css',
  'srt',
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindForMime(mime: string, name = ''): AttachmentKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  const ext = extensionOf(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac', 'opus'].includes(ext)) {
    return 'audio';
  }
  return 'file';
}

export function isTextLike(att: Pick<Attachment, 'mime' | 'name'>): boolean {
  const m = (att.mime || '').toLowerCase();
  return (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m.endsWith('+json') ||
    m.endsWith('+xml') ||
    TEXT_EXTENSIONS.has(extensionOf(att.name))
  );
}

/** Audio container name the OpenAI-style `input_audio` part expects. */
export function audioFormat(att: Pick<Attachment, 'mime' | 'name'>): string {
  const ext = extensionOf(att.name);
  if (ext) return ext === 'mpeg' ? 'mp3' : ext;
  const m = (att.mime || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return m.split('/')[1] || 'wav';
}

export function attachmentLabel(attachments: Attachment[]): string {
  const counts: Record<AttachmentKind, number> = {
    image: 0,
    audio: 0,
    file: 0,
  };
  for (const a of attachments) counts[a.kind]++;
  const parts: string[] = [];
  if (counts.image) {
    parts.push(`${counts.image} image${counts.image > 1 ? 's' : ''}`);
  }
  if (counts.audio) {
    parts.push(
      counts.audio > 1 ? `${counts.audio} voice notes` : 'a voice note',
    );
  }
  if (counts.file) {
    parts.push(`${counts.file} file${counts.file > 1 ? 's' : ''}`);
  }
  return `[Sent ${parts.join(', ')}]`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Encrypts the base64 payload and writes it to app storage. */
export async function saveAttachment(input: {
  kind: AttachmentKind;
  name: string;
  mime: string;
  base64: string;
  durationMs?: number;
}): Promise<Attachment> {
  // base64 length * 3/4 minus padding
  const padding = input.base64.endsWith('==')
    ? 2
    : input.base64.endsWith('=')
      ? 1
      : 0;
  const size = Math.floor((input.base64.length * 3) / 4) - padding;
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${input.name} is ${formatBytes(size)}; the limit is ${formatBytes(
        MAX_ATTACHMENT_BYTES,
      )}.`,
    );
  }
  const att: Attachment = {
    id: newAttachmentId(),
    kind: input.kind,
    name: input.name,
    mime: input.mime,
    size,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
  await RNFS.mkdir(ATTACHMENT_DIR);
  await RNFS.writeFile(
    attachmentPath(att.id),
    await encrypt(input.base64),
    'utf8',
  );
  return att;
}

export async function loadAttachmentBase64(id: string): Promise<string> {
  const stored = await RNFS.readFile(attachmentPath(id), 'utf8');
  return decrypt(stored);
}

export async function deleteAttachmentFiles(
  attachments: Attachment[] | undefined,
): Promise<void> {
  if (!attachments) return;
  await Promise.all(
    attachments.map(a => RNFS.unlink(attachmentPath(a.id)).catch(() => {})),
  );
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

/**
 * Expands a message's attachments into OpenAI-style content parts.
 * `redact` swaps payloads for short placeholders (used for the stored,
 * human-readable copy of the request).
 */
export async function buildContentParts(
  text: string,
  attachments: Attachment[],
  redact = false,
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  const notes: string[] = [];
  for (const att of attachments) {
    let data: string;
    try {
      data = redact ? '' : await loadAttachmentBase64(att.id);
    } catch {
      notes.push(`[Attachment unavailable: ${att.name}]`);
      continue;
    }
    if (att.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: redact
            ? `[image ${att.name}, ${formatBytes(att.size)}]`
            : `data:${att.mime || 'image/jpeg'};base64,${data}`,
        },
      });
    } else if (att.kind === 'audio') {
      parts.push({
        type: 'input_audio',
        input_audio: {
          data: redact ? `[audio ${att.name}, ${formatBytes(att.size)}]` : data,
          format: audioFormat(att),
        },
      });
    } else if (isTextLike(att)) {
      if (redact) {
        parts.push({
          type: 'text',
          text: `[File: ${att.name}, ${formatBytes(att.size)}]`,
        });
      } else {
        let body = base64ToUtf8(data);
        if (body.length > MAX_INLINE_TEXT_CHARS) {
          body = `${body.slice(0, MAX_INLINE_TEXT_CHARS)}\n[truncated]`;
        }
        parts.push({
          type: 'text',
          text: `[File: ${att.name}]\n${body}\n[End of file]`,
        });
      }
    } else {
      parts.push({
        type: 'file',
        file: {
          filename: att.name,
          file_data: redact
            ? `[file ${att.name}, ${formatBytes(att.size)}]`
            : `data:${att.mime || 'application/octet-stream'};base64,${data}`,
        },
      });
    }
  }
  const textBlock = [text, ...notes].filter(Boolean).join('\n');
  return [{ type: 'text', text: textBlock }, ...parts];
}

export interface ExpandedMessages {
  /** What goes over the wire. */
  api: { role: string; content: unknown }[];
  /** Same shape with payloads replaced by placeholders, for logs/debugging. */
  display: { role: string; content: unknown }[];
}

/**
 * Turns prompt messages carrying `attachments` into multipart API messages.
 * Only the newest MAX_ATTACHED_MESSAGES attachment-bearing messages carry
 * real data; older ones are reduced to a text note so a long chat doesn't
 * re-upload every image on every turn.
 */
export async function expandMessages(
  messages: {
    role: string;
    content: string;
    attachments?: Attachment[];
  }[],
): Promise<ExpandedMessages> {
  const carrying = messages
    .map((m, i) => (m.attachments?.length ? i : -1))
    .filter(i => i >= 0);
  const live = new Set(carrying.slice(-MAX_ATTACHED_MESSAGES));
  const api: ExpandedMessages['api'] = [];
  const display: ExpandedMessages['display'] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m.attachments?.length) {
      api.push({ role: m.role, content: m.content });
      display.push({ role: m.role, content: m.content });
    } else if (live.has(i)) {
      api.push({
        role: m.role,
        content: await buildContentParts(m.content, m.attachments),
      });
      display.push({
        role: m.role,
        content: await buildContentParts(m.content, m.attachments, true),
      });
    } else {
      const note = `${m.content}\n[Earlier attachments omitted: ${m.attachments
        .map(a => a.name)
        .join(', ')}]`;
      api.push({ role: m.role, content: note });
      display.push({ role: m.role, content: note });
    }
  }
  return { api, display };
}

const DIGEST_FILE_CHARS = 3000;
/** Most images/voice notes/binary files one summary or memory call carries. */
export const DIGEST_MAX_MEDIA = 4;

/**
 * Rewrites messages for text-only consumers (summaries, long-term memory):
 * text files are inlined (truncated), everything else becomes a placeholder
 * line. The newest DIGEST_MAX_MEDIA non-text attachments are returned in
 * `media` so the caller can attach them to its request for real.
 */
export async function digestMessages(
  messages: ChatMessage[],
): Promise<{ messages: ChatMessage[]; media: Attachment[] }> {
  const media: Attachment[] = [];
  const out = messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg.attachments?.length) continue;
    const lines: string[] = [];
    for (const att of msg.attachments) {
      if (isTextLike(att)) {
        try {
          const text = base64ToUtf8(await loadAttachmentBase64(att.id));
          const cut =
            text.length > DIGEST_FILE_CHARS
              ? `${text.slice(0, DIGEST_FILE_CHARS)}\n[truncated]`
              : text;
          lines.push(`[Attached file ${att.name}]\n${cut}`);
        } catch {
          lines.push(`[Attached file ${att.name} - unavailable]`);
        }
        continue;
      }
      const label =
        att.kind === 'image'
          ? 'image'
          : att.kind === 'audio'
            ? 'voice note'
            : 'file';
      const shown = media.length < DIGEST_MAX_MEDIA;
      if (shown) media.push(att);
      lines.push(
        `[Attached ${label}: ${att.name}${shown ? '' : ' (not shown)'}]`,
      );
    }
    const base =
      msg.content === attachmentLabel(msg.attachments) ? '' : msg.content;
    out[i] = {
      ...msg,
      content: [base, ...lines].filter(Boolean).join('\n'),
      attachments: undefined,
    };
  }
  return { messages: out, media: media.reverse() };
}

/**
 * Runs `run` with media attached; if the provider rejects it (text-only
 * model, no audio support, ...) retries once without media so summaries and
 * memory keep working. Cancellations are never retried.
 */
export async function runWithMedia<T>(
  media: Attachment[],
  run: (media: Attachment[]) => Promise<T>,
): Promise<T> {
  if (media.length === 0) return run([]);
  try {
    return await run(media);
  } catch (e) {
    if (e instanceof Error && e.message === 'Request was cancelled') throw e;
    console.warn('Retrying without attachments:', e);
    return run([]);
  }
}
