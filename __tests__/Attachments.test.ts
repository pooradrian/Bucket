import RNFS from 'react-native-fs';

jest.mock('../src/Database', () => ({ getKV: jest.fn(), setKV: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  keepLocalCopy: jest.fn(),
}));
jest.mock('../src/Crypto', () => ({
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => s.replace(/^enc:/, ''),
}));

import {
  Attachment,
  attachmentLabel,
  audioFormat,
  digestMessages,
  runWithMedia,
  expandMessages,
  isTextLike,
  kindForMime,
  saveAttachment,
} from '../src/Attachments';
import { withLatestAttachments } from '../src/PromptHandler';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (RNFS.writeFile as jest.Mock).mockImplementation(
    async (path: string, data: string) => {
      store.set(path, data);
    },
  );
  (RNFS.readFile as jest.Mock).mockImplementation(async (path: string) => {
    if (!store.has(path)) throw new Error('missing');
    return store.get(path);
  });
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('classifies kinds and formats', () => {
  expect(kindForMime('image/png')).toBe('image');
  expect(kindForMime('', 'a.JPG')).toBe('image');
  expect(kindForMime('audio/mpeg')).toBe('audio');
  expect(kindForMime('application/pdf')).toBe('file');
  expect(isTextLike({ mime: '', name: 'notes.md' })).toBe(true);
  expect(isTextLike({ mime: 'application/pdf', name: 'a.pdf' })).toBe(false);
  expect(audioFormat({ mime: 'audio/mpeg', name: 'clip' })).toBe('mp3');
  expect(audioFormat({ mime: 'audio/wav', name: 'v.wav' })).toBe('wav');
});

test('label summarises mixed attachments', () => {
  const mk = (kind: Attachment['kind']): Attachment => ({
    id: kind,
    kind,
    name: kind,
    mime: '',
    size: 1,
  });
  expect(attachmentLabel([mk('image'), mk('audio')])).toBe(
    '[Sent 1 image, a voice note]',
  );
});

test('expandMessages builds multipart content and a redacted copy', async () => {
  const img = await saveAttachment({
    kind: 'image',
    name: 'cat.png',
    mime: 'image/png',
    base64: b64('PNGDATA'),
  });
  const txt = await saveAttachment({
    kind: 'file',
    name: 'todo.txt',
    mime: 'text/plain',
    base64: b64('buy milk'),
  });
  const voice = await saveAttachment({
    kind: 'audio',
    name: 'v.wav',
    mime: 'audio/wav',
    base64: b64('RIFF'),
  });
  const { api, display } = await expandMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'look', attachments: [img, txt, voice] },
  ]);
  expect(api[0]).toEqual({ role: 'system', content: 'sys' });
  const parts = api[1].content as any[];
  expect(parts[0]).toEqual({ type: 'text', text: 'look' });
  expect(parts[1].image_url.url).toBe(
    `data:image/png;base64,${b64('PNGDATA')}`,
  );
  expect(parts[2].text).toContain('buy milk');
  expect(parts[3].input_audio).toEqual({ data: b64('RIFF'), format: 'wav' });
  expect(JSON.stringify(display)).not.toContain(b64('PNGDATA'));
  expect(JSON.stringify(display)).toContain('cat.png');
});

test('only the newest attachment-bearing messages keep payloads', async () => {
  const att: Attachment[] = [];
  for (let i = 0; i < 6; i++) {
    att.push(
      await saveAttachment({
        kind: 'image',
        name: `i${i}.png`,
        mime: 'image/png',
        base64: b64(`d${i}`),
      }),
    );
  }
  const { api } = await expandMessages(
    att.map((a, i) => ({
      role: 'user',
      content: `m${i}`,
      attachments: [a],
    })),
  );
  expect(typeof api[0].content).toBe('string');
  expect(api[0].content).toContain('omitted');
  expect(Array.isArray(api[5].content)).toBe(true);
});

test('a missing attachment file degrades to a note', async () => {
  const { api } = await expandMessages([
    {
      role: 'user',
      content: 'hi',
      attachments: [
        {
          id: 'gone',
          kind: 'image',
          name: 'x.png',
          mime: 'image/png',
          size: 1,
        },
      ],
    },
  ]);
  expect((api[0].content as any[])[0].text).toContain('unavailable');
});

test('withLatestAttachments re-attaches the trimmed latest turn', () => {
  const att: Attachment = {
    id: 'a',
    kind: 'image',
    name: 'a.png',
    mime: 'image/png',
    size: 1,
  };
  const history: any[] = [
    { id: '1', role: 'user', content: 'see', timestamp: 1, attachments: [att] },
  ];
  const out = withLatestAttachments(
    [
      { role: 'system', content: 's' },
      { role: 'user', content: 'see' },
    ],
    history,
    'see',
  );
  expect(out[1].attachments).toEqual([att]);
  expect(withLatestAttachments(out, history, '')).toBe(out);
});

test('digestMessages inlines text files and queues media for the request', async () => {
  const note = await saveAttachment({
    kind: 'file',
    name: 'notes.txt',
    mime: 'text/plain',
    base64: b64('the vault code is 4411'),
  });
  const pic = await saveAttachment({
    kind: 'image',
    name: 'door.png',
    mime: 'image/png',
    base64: b64('IMG'),
  });
  const mk = (id: string, content: string, attachments?: Attachment[]) => ({
    id,
    role: 'user' as const,
    content,
    timestamp: 1,
    attachments,
  });
  const { messages, media } = await digestMessages([
    mk('1', 'plain'),
    mk('2', attachmentLabel([note]), [note]),
    mk('3', 'see this', [pic]),
  ]);
  expect(messages[0].content).toBe('plain');
  expect(messages[1].content).toContain('the vault code is 4411');
  expect(messages[1].content).not.toContain('[Sent');
  expect(messages[2].content).toBe('see this\n[Attached image: door.png]');
  expect(messages.every(m => !m.attachments)).toBe(true);
  expect(media).toEqual([pic]);
});

test('digestMessages caps media and marks the overflow', async () => {
  const atts: Attachment[] = [];
  for (let i = 0; i < 6; i++) {
    atts.push(
      await saveAttachment({
        kind: 'image',
        name: `p${i}.png`,
        mime: 'image/png',
        base64: b64(`d${i}`),
      }),
    );
  }
  const { messages, media } = await digestMessages(
    atts.map((a, i) => ({
      id: String(i),
      role: 'user' as const,
      content: `m${i}`,
      timestamp: i,
      attachments: [a],
    })),
  );
  expect(media).toHaveLength(4);
  expect(media.map(a => a.name)).toEqual([
    'p2.png',
    'p3.png',
    'p4.png',
    'p5.png',
  ]);
  expect(messages[0].content).toContain('(not shown)');
  expect(messages[5].content).not.toContain('(not shown)');
});

test('runWithMedia retries without media but never retries a cancel', async () => {
  const att = {
    id: 'a',
    kind: 'image',
    name: 'a',
    mime: '',
    size: 1,
  } as Attachment;
  const run = jest
    .fn()
    .mockRejectedValueOnce(new Error('API error 400: no images'))
    .mockResolvedValueOnce('ok');
  expect(await runWithMedia([att], run)).toBe('ok');
  expect(run).toHaveBeenNthCalledWith(1, [att]);
  expect(run).toHaveBeenNthCalledWith(2, []);

  const cancelled = jest
    .fn()
    .mockRejectedValue(new Error('Request was cancelled'));
  await expect(runWithMedia([att], cancelled)).rejects.toThrow('cancelled');
  expect(cancelled).toHaveBeenCalledTimes(1);

  const none = jest.fn().mockResolvedValue('x');
  await runWithMedia([], none);
  expect(none).toHaveBeenCalledWith([]);
});

test('getAIResponse reports upload progress and keeps payloads out of the stored body', async () => {
  const { getAIResponse } = require('../src/Endpoint');
  const att = await saveAttachment({
    kind: 'image',
    name: 'x.png',
    mime: 'image/png',
    base64: b64('SECRETPIXELS'),
  });
  const onUpload = jest.fn();
  const result = await getAIResponse(
    [{ role: 'user', content: 'meow 1', attachments: [att] }],
    { apiUrl: "cat's api" },
    undefined,
    true,
    undefined,
    onUpload,
  );
  expect(onUpload).toHaveBeenCalledWith(0);
  expect(JSON.stringify(result.request.body)).not.toContain(
    b64('SECRETPIXELS'),
  );

  const plain = jest.fn();
  await getAIResponse(
    [{ role: 'user', content: 'meow 1' }],
    { apiUrl: "cat's api" },
    undefined,
    true,
    undefined,
    plain,
  );
  expect(plain).not.toHaveBeenCalled();
});
