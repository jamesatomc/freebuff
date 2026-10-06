import { describe, expect, test } from 'bun:test';
import { parseTranscript, projectSlug, summarizeToolCall } from '../src/transcript';

describe('parseTranscript', () => {
  test('parses user and assistant messages with plain content', () => {
    const raw = JSON.stringify([
      { id: 'm1', variant: 'user', content: 'fix the bug', timestamp: '2026-10-06T10:00:00.000Z' },
      { id: 'm2', variant: 'ai', content: 'Fixed it in **src/a.ts**.', isComplete: true },
    ]);
    const messages = parseTranscript(raw);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.text).toBe('fix the bug');
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.text).toContain('src/a.ts');
    expect(messages[1]?.running).toBe(false);
  });

  test('extracts text, reasoning, plan and tool blocks', () => {
    const raw = JSON.stringify([
      {
        id: 'm1',
        variant: 'ai',
        content: '',
        isComplete: false,
        blocks: [
          { type: 'text', textType: 'reasoning', content: 'thinking hard' },
          { type: 'text', content: 'Answer with a code block.' },
          { type: 'plan', content: '1. do a\n2. do b' },
          {
            type: 'tool',
            toolCallId: 't1',
            toolName: 'run_terminal_command',
            input: { command: 'bun test' },
            output: '13 pass',
            status: 'running',
          },
          { type: 'agent', agentId: 'a1', agentName: 'codebase-context', status: 'running', content: 'mapping files' },
        ],
      },
    ]);
    const [message] = parseTranscript(raw);
    expect(message?.role).toBe('assistant');
    expect(message?.thinking).toBe('thinking hard');
    expect(message?.text).toContain('Answer with a code block.');
    expect(message?.text).toContain('1. do a');
    expect(message?.tools).toHaveLength(2);
    expect(message?.tools[0]?.name).toBe('run_terminal_command');
    expect(message?.tools[0]?.summary).toBe('bun test');
    expect(message?.tools[0]?.output).toBe('13 pass');
    expect(message?.tools[1]?.name).toBe('agent:codebase-context');
    expect(message?.running).toBe(true);
  });

  test('maps error and agent variants', () => {
    const raw = JSON.stringify([
      { id: 'e1', variant: 'error', content: '', userError: 'model unavailable' },
      { id: 'a1', variant: 'agent', content: 'searching', agent: { agentName: 'code-search' } },
      { id: 'a2', variant: 'agent', content: '', agent: { agentName: 'silent' } },
    ]);
    const messages = parseTranscript(raw);
    expect(messages.map((message) => message.role)).toEqual(['error', 'agent']);
    expect(messages[0]?.text).toBe('model unavailable');
    expect(messages[1]?.agentName).toBe('code-search');
  });

  test('drops empty assistant messages and tolerates broken input', () => {
    const raw = JSON.stringify([
      { id: 'x', variant: 'ai', content: '', blocks: [], isComplete: true },
      { id: 'y', variant: 'ai', content: '   ' },
      null,
      'nonsense',
    ]);
    expect(parseTranscript(raw)).toHaveLength(0);
    expect(parseTranscript('not json')).toHaveLength(0);
    expect(parseTranscript('{"unexpected":"shape"}')).toHaveLength(0);
    expect(parseTranscript('[]')).toHaveLength(0);
  });
});

describe('summarizeToolCall', () => {
  test('prefers meaningful input fields', () => {
    expect(summarizeToolCall('run_terminal_command', { command: 'bun test' })).toBe('bun test');
    expect(summarizeToolCall('write_file', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(summarizeToolCall('code_search', { pattern: 'foo', flags: '-n' })).toBe('foo');
    const long = summarizeToolCall('x', { command: 'a'.repeat(200) });
    expect(long.length).toBe(140);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('projectSlug', () => {
  test('mirrors the CLI project folder naming', () => {
    expect(projectSlug('D:\\work\\My Project')).toBe('my-project');
    expect(projectSlug('/home/dev/freebuff')).toBe('freebuff');
    expect(projectSlug('/tmp/Foo_Bar.baz')).toBe('foo_bar.baz');
  });
});
