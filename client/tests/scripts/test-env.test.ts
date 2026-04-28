import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import treeKill from 'tree-kill';
import { spawnProcess, teardown } from '../../scripts/test-env.js';

// Mock child_process and tree-kill
vi.mock('child_process', () => {
  const spawnMock = vi.fn();
  return {
    default: { spawn: spawnMock },
    spawn: spawnMock,
  };
});

vi.mock('tree-kill', () => {
  return {
    default: vi.fn((pid, signal, cb) => cb()),
  };
});

describe('test-env script utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Attempt teardown to clear any state just in case, though vi.resetModules is better.
    // However given we mocked process.exit, we'll spy on process.exit
    vi.restoreAllMocks();
  });

  it('spawnProcess should call child_process.spawn with correct arguments', () => {
    const mockOnStdOut = vi.fn();
    const mockOnStdErr = vi.fn();
    const mockOnClose = vi.fn();
    const mockOnError = vi.fn();

    const mockChild = {
      pid: 12345,
      stdout: { on: mockOnStdOut },
      stderr: { on: mockOnStdErr },
      on: vi.fn((event, cb) => {
        if (event === 'close') mockOnClose.mockImplementation(cb);
        if (event === 'error') mockOnError.mockImplementation(cb);
      })
    };

    // @ts-ignore
    child_process.spawn.mockReturnValue(mockChild);

    const child = spawnProcess('[TEST]', 'npm', ['run', 'dev'], '/mock/cwd');
    
    // Check if spawn was called correctly
    expect(child_process.spawn).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({
      cwd: '/mock/cwd',
      stdio: 'pipe',
      shell: process.platform === 'win32' // Will match local environment
    }));

    // Expect event listeners bound
    expect(mockOnStdOut).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockOnStdErr).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockChild.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockChild.on).toHaveBeenCalledWith('error', expect.any(Function));

    expect(child).toBe(mockChild);
  });

  it('teardown should call tree-kill for active processes and process.exit(0)', async () => {
    // Setup process tracking using spawnProcess
    const mockChild = {
      pid: 9999,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    };
    // @ts-ignore
    child_process.spawn.mockReturnValue(mockChild);

    spawnProcess('[MOCK]', 'echo', ['test'], '/');

    // Make process.exit non-destructive
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });

    await teardown();

    // Verify tree-kill was triggered with correct PID
    expect(treeKill).toHaveBeenCalledWith(9999, 'SIGKILL', expect.any(Function));
    
    // Verify it called exit(0)
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
