/**
 * Asserts the Copilot-style chat webview is complete (header controls,
 * composer affordances, slash menu, transcript containers) and materializes
 * `.preview/chat.html` so the UI can be opened in a browser preview.
 */
import { describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

mock.module('vscode', () => ({}));

async function renderHtml(): Promise<string> {
  const { ChatViewProvider } = await import('../src/chatView');
  const provider = new ChatViewProvider({
    onSend: () => undefined,
    onAction: () => undefined,
    onQueryFiles: () => undefined,
    onSelectModel: () => undefined,
    onReady: () => undefined,
  });
  return (provider as unknown as { html(cspSource: string): string }).html('vscode-cdn');
}

describe('ChatViewProvider.html', () => {
  test('ships a Copilot-style shell', async () => {
    const html = await renderHtml();
    // Header controls.
    expect(html).toContain('id="btnNew"');
    expect(html).toContain('id="btnHistory"');
    expect(html).toContain('id="btnModel"');
    expect(html).toContain('id="btnTerminal"');
    // Transcript + empty state suggestions.
    expect(html).toContain('id="messages"');
    expect(html).toContain('id="empty"');
    expect(html).toContain('Explain this codebase');
    // Composer affordances.
    expect(html).toContain('id="input"');
    expect(html).toContain('id="popup"');
    expect(html).toContain('id="send"');
    // Model picker affordances.
    expect(html).toContain('id="modelMenu"');
    expect(html).toContain('id="modelLabel"');
    expect(html).toContain("type: 'selectModel'");
    // Security: scripts are nonce-gated.
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+'/);
  });

  test('offers the real Freebuff slash commands', async () => {
    const html = await renderHtml();
    for (const command of ['/new', '/model', '/history', '/plan', '/review', '/usage', '/export']) {
      expect(html).toContain(`'${command}'`);
    }
  });

  test('writes the browser preview harness', async () => {
    const html = await renderHtml();
    const nonce = html.match(/script-src 'nonce-([^']+)'/)?.[1] ?? '';
    const stub =
      `<script nonce="${nonce}">window.acquireVsCodeApi=function(){return{postMessage:function(){},getState:function(){return undefined}}};</script>`;
    // Outside VS Code the --vscode-* variables are undefined, so the harness
    // ships dark-theme fallbacks to keep the preview readable.
    const theme = `<style>:root{--vscode-font-family:-apple-system,"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;--vscode-foreground:#cccccc;--vscode-sideBar-background:#181818;--vscode-sideBarSectionHeader-background:#2a2a2a;--vscode-sideBarSectionHeader-border:#2f2f2f;--vscode-descriptionForeground:#9d9d9d;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#454545;--vscode-editorWidget-background:#252526;--vscode-editorWidget-border:#454545;--vscode-toolbar-hoverBackground:#3a3a3a;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#3a3d41;--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff;--vscode-charts-blue:#3794ff;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;--vscode-errorForeground:#f14c4c;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-textCodeBlock-background:#2d2d2d;--vscode-textBlockQuote-border:#6a6a6a;--vscode-textBlockQuote-background:#232323;--vscode-panel-border:#2f2f2f;}</style>`;
    const harness = html.replace('</head>', `${theme}${stub}</head>`);
    const directory = '.preview';
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'chat.html'), harness);
    expect(fs.existsSync(path.join(directory, 'chat.html'))).toBe(true);
  });
});
