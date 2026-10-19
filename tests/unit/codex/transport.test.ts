import { describe, expect, it } from 'vitest';
import { sharedArguments } from '../../../src/codex/transport.js';

describe('desktop transport selection', () => {
  it.each([['app-server'], ['app-server', '--stdio'], ['app-server', '--listen', 'stdio://'], ['app-server', '--listen=stdio://']])('shares only the desktop stdio server %j', (...args) => {
    expect(sharedArguments(args, '/private/socket')).toEqual(['app-server', '--listen', 'unix:///private/socket']);
  });
  it('retains model, permission, native-tool and analytics arguments byte for byte', () => {
    const args = ['-c', 'model="existing"', 'app-server', '--analytics-default-enabled', '-c', 'tools.native.path="/some path"'];
    expect(sharedArguments(args, '/socket')).toEqual([...args, '--listen', 'unix:///socket']);
  });
  it.each([['--version'], ['app-server', '--help'], ['app-server', 'daemon', 'start'], ['app-server', 'proxy'], ['app-server', 'generate-json-schema'], ['app-server', '--listen', 'unix:///custom'], ['app-server', '--listen=off']])('does not replace explicit tooling or another transport %j', (...args) => {
    expect(sharedArguments(args, '/socket')).toBeNull();
  });
});
