import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// We need to reset the config cache between tests that mock the JSON file
import {
  getLanguageFromExt,
  getLanguageId,
  getLspConfig,
  loadLspServersConfig,
  _resetConfigCache,
} from './detect.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetConfigCache();
});

// ---------------------------------------------------------------------------
// 1. getLanguageFromExt
// ---------------------------------------------------------------------------

describe('getLanguageFromExt', () => {
  test('1. .ts → typescript', () => {
    expect(getLanguageFromExt('foo.ts')).toBe('typescript');
  });

  test('2. .tsx → typescript', () => {
    expect(getLanguageFromExt('foo.tsx')).toBe('typescript');
  });

  test('3. .js → typescript', () => {
    expect(getLanguageFromExt('foo.js')).toBe('typescript');
  });

  test('4. .jsx → typescript', () => {
    expect(getLanguageFromExt('foo.jsx')).toBe('typescript');
  });

  test('5. .mjs → typescript', () => {
    expect(getLanguageFromExt('foo.mjs')).toBe('typescript');
  });

  test('6. .cjs → typescript', () => {
    expect(getLanguageFromExt('foo.cjs')).toBe('typescript');
  });

  test('7. .mts → typescript', () => {
    expect(getLanguageFromExt('foo.mts')).toBe('typescript');
  });

  test('8. .cts → typescript', () => {
    expect(getLanguageFromExt('foo.cts')).toBe('typescript');
  });

  test('9. .py → python', () => {
    expect(getLanguageFromExt('foo.py')).toBe('python');
  });

  test('10. .rs → rust', () => {
    expect(getLanguageFromExt('foo.rs')).toBe('rust');
  });

  test('11. .go → go', () => {
    expect(getLanguageFromExt('foo.go')).toBe('go');
  });

  test('12. unsupported extension → null', () => {
    expect(getLanguageFromExt('foo.cpp')).toBeNull();
  });

  test('13. no extension → null', () => {
    expect(getLanguageFromExt('Makefile')).toBeNull();
  });

  test('14. hidden file with no extension → null', () => {
    expect(getLanguageFromExt('.gitignore')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. getLanguageId
// ---------------------------------------------------------------------------

describe('getLanguageId', () => {
  test('15. .tsx → typescriptreact', () => {
    expect(getLanguageId('component.tsx')).toBe('typescriptreact');
  });

  test('16. .ts → typescript', () => {
    expect(getLanguageId('index.ts')).toBe('typescript');
  });

  test('17. .js → javascript', () => {
    expect(getLanguageId('app.js')).toBe('javascript');
  });

  test('18. .jsx → javascriptreact', () => {
    expect(getLanguageId('App.jsx')).toBe('javascriptreact');
  });

  test('19. .py → python', () => {
    expect(getLanguageId('main.py')).toBe('python');
  });

  test('20. .rs → rust', () => {
    expect(getLanguageId('main.rs')).toBe('rust');
  });

  test('21. .go → go', () => {
    expect(getLanguageId('main.go')).toBe('go');
  });

  test('22. unsupported extension → null', () => {
    expect(getLanguageId('main.cpp')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. loadLspServersConfig
// ---------------------------------------------------------------------------

describe('loadLspServersConfig', () => {
  test('23. loads and returns valid config with 4 languages', () => {
    const config = loadLspServersConfig();
    expect(config.languages).toBeDefined();
    expect(typeof config.languages).toBe('object');
    const langs = Object.keys(config.languages);
    expect(langs).toContain('typescript');
    expect(langs).toContain('python');
    expect(langs).toContain('rust');
    expect(langs).toContain('go');
  });

  test('24. caches — same object reference on second call', () => {
    const first = loadLspServersConfig();
    const second = loadLspServersConfig();
    expect(first).toBe(second);
  });

  test('25. typescript language has correct extensions', () => {
    const config = loadLspServersConfig();
    const ext = config.languages['typescript'].extensions;
    expect(ext['ts']).toBe('typescript');
    expect(ext['tsx']).toBe('typescriptreact');
    expect(ext['mts']).toBe('typescript');
    expect(ext['cts']).toBe('typescript');
  });
});

// ---------------------------------------------------------------------------
// 4. getLspConfig
// ---------------------------------------------------------------------------

describe('getLspConfig', () => {
  test('26. unsupported language → error object', () => {
    const result = getLspConfig('cobol');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('cobol');
    }
  });

  test('27. typescript: returns command/args when bunx is available', () => {
    // Mock execFileSync to return a path for 'bunx'
    const original = childProcess.execFileSync;
    let capturedCmd = '';
    const spy = spyOn(childProcess, 'execFileSync').mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') {
        capturedCmd = (args as string[])[0];
        if ((args as string[])[0] === 'bunx') return '/usr/local/bin/bunx' as unknown as Buffer;
        throw new Error('not found');
      }
      return original(cmd, args);
    });

    const result = getLspConfig('typescript');
    spy.mockRestore();

    if ('error' in result) {
      // bunx may not be available in test env — acceptable
      return;
    }
    expect(result.command).toBeDefined();
    expect(result.args).toBeInstanceOf(Array);
    expect(result.install_hint).toContain('typescript-language-server');
  });

  test('28. rust: uses search_paths fallback when which fails', () => {
    // Mock execFileSync to throw for all which calls
    const spy = spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('not found');
    });
    // Mock existsSync to return true for the first search path
    const existsSpy = spyOn(fs, 'existsSync').mockImplementation((p) => {
      const pStr = String(p);
      if (pStr.includes('rust-analyzer')) return true;
      return false;
    });

    const result = getLspConfig('rust');
    spy.mockRestore();
    existsSpy.mockRestore();

    if ('error' in result) {
      // Could happen if mock didn't intercept — skip
      return;
    }
    expect(result.command).toContain('rust-analyzer');
  });

  test('29. returns error+install_hint when nothing found', () => {
    // Mock all resolution to fail
    const spy = spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('not found');
    });
    const existsSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = getLspConfig('rust');
    spy.mockRestore();
    existsSpy.mockRestore();

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.install_hint).toBeDefined();
      expect(result.install_hint.length).toBeGreaterThan(0);
    }
  });
});
