import {parseArgs} from '../debuggerUtils';
import {DebuggerEnv, DebuggerIO, CommandHandler} from './types';
import {
  charsCommand,
  charCommand,
  promptCommand,
  sendCommand,
  historyCommand,
} from './charCommands';
import {
  configCommand,
  configSetCommand,
  storageCommand,
  providersCommand,
  providerCommand,
  lorebooksCommand,
  lorebookCommand,
} from './configCommands';
import {
  testCommand,
  apiCommand,
  tiktokenCommand,
  crashCommand,
  unlockCommand,
  activityCommand,
  encryptCommand,
  settingsCommand,
} from './toolCommands';
import {dbCommand, DB_HELP_TEXT} from './dbCommands';

const GENERAL_HELP = [
  'General:',
  '  help                              Show this help',
  '  help db                           Show DB commands',
  '  help provider                     Show provider commands',
  '  help lorebook                     Show lorebook commands',
  '  verbose [on|off]                  Toggle fetch request monitoring',
  '  test [--verbose]                  Diagnose API connection',
  '  clear                             Clear terminal output',
  '',
  'Characters & Chat:',
  '  chars                             List all characters',
  '  char <id|name>                    Show character details',
  '  prompt <id|name> <message>        Build prompt and show messages array',
  '  send <id|name> <message>          Build prompt and send to LLM',
  '  history <id|name>                 Show chat history',
  '',
  'Providers & API:',
  '  providers                         List all API providers',
  '  provider.active                   Show active provider',
  '  provider.key <id>                 Show masked API key',
  '  api <GET|POST|PUT|DELETE> <url>   Make HTTP request',
  '     [--body <json>]',
  '',
  'Prompt Config:',
  '  config                            Show current prompt config',
  '  config.set <key> <value>          Set config value',
  '     keys: prefix, suffix, usr, model, apiurl,',
  '           apikey, cutoffmode, cutoffamount',
  '',
  'Storage:',
  '  storage <key>                     Read stored value',
  '  storage.set <key> <value>         Write stored value',
  '  storage.keys                      List all stored keys',
  '',
  'Lorebooks:',
  '  lorebooks                         List all lorebooks',
  '  lorebook <id>                     Show lorebook entries',
  '',
  'Theme & Settings:',
  '  settings                          Show current app settings',
  '',
  'Tools:',
  '  unlock sysstats                   Toggle system stats overlay',
  '  tiktoken [text]                   Test tiktoken encoding',
  '  crash                             Trigger crash export (test)',
  '  encrypt <text>                   Test encryption',
  '  encrypt test                      Run encryption test suite',
  '',
  '  activity [N]                      Show recent activity log (default 20)',
  '  activity clear                    Clear activity log',
  '  activity status                   Show if logging is enabled',
  '',
  'DB (type "help db" for more):',
  ...DB_HELP_TEXT.split('\n').slice(1),
].join('\n');

const PROVIDER_HELP = [
  'Provider Commands:',
  '  providers                         List all API providers',
  '  provider.active                   Show the active provider',
  '  provider.key <id>                 Show masked API key for a provider',
].join('\n');

const LOREBOOK_HELP = [
  'Lorebook Commands:',
  '  lorebooks                         List all lorebooks',
  '  lorebook <id>                     Show lorebook entries',
].join('\n');

export const COMMANDS: Record<string, CommandHandler> = {
  chars: charsCommand,
  char: charCommand,
  prompt: promptCommand,
  send: sendCommand,
  history: historyCommand,
  config: configCommand,
  'config.set': configSetCommand,
  storage: storageCommand,
  providers: providersCommand,
  provider: providerCommand,
  lorebooks: lorebooksCommand,
  lorebook: lorebookCommand,
  test: testCommand,
  api: apiCommand,
  tiktoken: tiktokenCommand,
  crash: crashCommand,
  unlock: unlockCommand,
  activity: activityCommand,
  encrypt: encryptCommand,
  settings: settingsCommand,
  db: dbCommand,
};

export async function executeDebuggerCommand(
  raw: string,
  env: DebuggerEnv,
  io: DebuggerIO,
): Promise<void> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }

  const args = parseArgs(trimmed);
  const cmd = args[0]?.toLowerCase();
  const rest = args.slice(1);
  const isSensitive = cmd === 'encrypt' || cmd === 'decrypt';
  io.log(
    'input',
    isSensitive
      ? `$ ${cmd} ${'*'.repeat(trimmed.length - (cmd?.length ?? 0))}`
      : `$ ${trimmed}`,
  );

  try {
    if (cmd === 'help') {
      const sub = rest[0]?.toLowerCase();
      if (sub === 'db') {
        io.log('info', DB_HELP_TEXT);
      } else if (sub === 'provider') {
        io.log('info', PROVIDER_HELP);
      } else if (sub === 'lorebook') {
        io.log('info', LOREBOOK_HELP);
      } else {
        io.log('info', GENERAL_HELP);
      }
      return;
    }

    if (cmd === 'verbose') {
      const flag = rest[0]?.toLowerCase();
      if (flag === 'on' || flag === '1' || flag === 'true') {
        env.enableVerbose();
      } else if (flag === 'off' || flag === '0' || flag === 'false') {
        env.disableVerbose();
      } else if (env.isVerbose()) {
        env.disableVerbose();
      } else {
        env.enableVerbose();
      }
      return;
    }

    if (cmd === 'clear') {
      io.clear();
      return;
    }

    const handler = cmd ? COMMANDS[cmd] : undefined;
    if (handler) {
      await handler(rest, env, io);
    } else {
      io.log('error', `Unknown command: "${cmd}". Type "help" for available commands.`);
    }
  } catch (e: unknown) {
    io.log('error', `Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
