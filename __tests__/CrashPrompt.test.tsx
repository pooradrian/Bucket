jest.mock('../src/CrashExport', () => ({
  crashExport: jest.fn().mockResolvedValue(null),
  getCrashLogText: jest.fn().mockResolvedValue(''),
}));

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ appSettings: { debugLogging: false } }),
}));

jest.mock('../src/ThemeContext', () => ({
  useTheme: () => ({}),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn() },
}));

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import CrashPrompt from '../src/CrashPrompt';
import type { CrashReport } from '../src/CrashExport';

function makeReport(events: CrashReport['events']): CrashReport {
  return {
    timestamp: '2026-10-24T12:00:00.000Z',
    kind: 'crash',
    context: '',
    errorName: 'Error',
    errorMessage: 'boom',
    errorStack: '',
    appVersion: '1.8.0',
    platform: 'android 36',
    events,
  };
}

function render(report: CrashReport): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <CrashPrompt report={report} onDismiss={jest.fn()} />,
    );
  });
  return tree;
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map(node => String(node.props.children))
    .join(' ');
}

it('warns when the report contains activity even if logging is off', () => {
  const tree = render(
    makeReport([
      { type: 'message_sent', timestamp: 1000, summary: 'Sent message' },
    ]),
  );

  expect(textOf(tree)).toContain('includes recent activity');
});

it('hides the warning when the report has no activity', () => {
  const tree = render(makeReport([]));

  expect(textOf(tree)).not.toContain('includes recent activity');
});
