import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = join(__dirname, '..');
const source = join(__dirname, 'native', 'AesGcmVectors.cpp');
const aesGcm = join(root, 'cpp', 'AesGcm.cpp');
const hasCompiler = spawnSync('g++', ['--version']).status === 0;
const describeIfCompiler = hasCompiler ? describe : describe.skip;

describeIfCompiler('native AES-256-GCM', () => {
  const buildDir = mkdtempSync(join(tmpdir(), 'aesgcm-vectors-'));

  afterAll(() => {
    rmSync(buildDir, {recursive: true, force: true});
  });

  test('matches the OpenSSL reference vectors', () => {
    const binary = join(buildDir, 'aesGcmVectors');
    execFileSync('g++', ['-std=c++20', '-O1', '-o', binary, source, aesGcm], {stdio: 'pipe'});
    const output = execFileSync(binary, {encoding: 'utf8'});
    expect(output).toContain('0 failures');
  }, 120000);
});
