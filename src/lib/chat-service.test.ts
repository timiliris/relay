import { describe, expect, it } from 'vitest';
import { useAgent } from '@/stores/agent';
import { useEnvironment } from '@/stores/environment';
import { useSettings } from '@/stores/settings';
import { buildHistory, effectiveParams } from './chat-service';
import type { Conversation, Message } from './db';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c',
  title: 'Test',
  model: 'openrouter/auto',
  systemPrompt: null,
  pinned: false,
  archived: false,
  folderId: null,
  presetId: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  reasoning: null,
  webSearch: false,
  summary: null,
  summaryUntilId: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const msg = (
  id: string,
  role: Message['role'],
  content: string,
  over: Partial<Message> = {},
): Message => ({
  id,
  conversationId: 'c',
  parentId: null,
  active: true,
  role,
  content,
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  pinned: false,
  durationMs: null,
  createdAt: '',
  ...over,
});

describe('buildHistory', () => {
  it('place instruction système et résumé en tête, puis les messages après le résumé', () => {
    const history = buildHistory(
      conv({ systemPrompt: 'Sois bref.', summary: 'On a parlé de Rust.', summaryUntilId: 'a1' }),
      [msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'R1'), msg('u2', 'user', 'Q2')],
    );
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('system');
    expect(history[0]?.content).toContain('Sois bref.');
    expect(history[0]?.content).toContain('On a parlé de Rust.');
    expect(history[1]).toEqual({ role: 'user', content: 'Q2' });
  });

  it('convertit les pièces jointes en parties multimodales', () => {
    const history = buildHistory(conv(), [
      msg('u1', 'user', 'Regarde', {
        attachments: [
          {
            id: 'i',
            kind: 'image',
            name: 'a.png',
            mime: 'image/png',
            size: 10,
            data: 'data:image/png;base64,AAA',
          },
          { id: 't', kind: 'text', name: 'n.md', mime: 'text/markdown', size: 5, text: '# Notes' },
        ],
      }),
    ]);
    const content = history[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error('attendu : tableau');
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as { text: string }).text).toContain('# Notes');
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    });
  });
});

describe('buildHistory : images générées', () => {
  it("renvoie les images de l'assistant dans `images`, pas dans le contenu", () => {
    const history = buildHistory(conv(), [
      msg('u1', 'user', 'Dessine un chat'),
      msg('a1', 'assistant', 'Voici.', {
        attachments: [
          {
            id: 'g',
            kind: 'image',
            name: 'image-1.png',
            mime: 'image/png',
            size: 10,
            data: 'data:image/png;base64,AAA',
          },
        ],
      }),
      msg('u2', 'user', 'Rends-le bleu'),
    ]);
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'Voici.',
      images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
    });
    expect(history[2]).toEqual({ role: 'user', content: 'Rends-le bleu' });
  });

  it("n'ajoute pas de champ images à un message assistant sans image", () => {
    const history = buildHistory(conv(), [msg('a1', 'assistant', 'Texte seul')]);
    expect(history[0]).toEqual({ role: 'assistant', content: 'Texte seul' });
  });
});

describe('buildHistory en mode agent', () => {
  it('ajoute le bloc agent, relaie les appels d’outils et les résultats au format OpenAI', () => {
    const history = buildHistory(
      conv({ systemPrompt: 'Sois bref.', workspace: 'C:\\work\\relay', agent: true }),
      [
        msg('u1', 'user', 'Lis a.rs'),
        msg('a1', 'assistant', '', {
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{"path":"a.rs"}' }],
        }),
        msg('t1', 'tool', 'fn main() {}', { toolCallId: 'call_1', toolName: 'read_file' }),
        msg('a2', 'assistant', 'Voici a.rs.'),
      ],
    );
    expect(history[0]?.role).toBe('system');
    expect(history[0]?.content).toContain('Sois bref.');
    expect(history[0]?.content).toContain('Mode agent');
    expect(history[0]?.content).toContain('C:\\work\\relay');
    expect(history[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.rs"}' },
        },
      ],
    });
    expect(history[3]).toEqual({ role: 'tool', content: 'fn main() {}', tool_call_id: 'call_1' });
    expect(history[4]).toEqual({ role: 'assistant', content: 'Voici a.rs.' });
  });

  it('n’ajoute rien quand le mode agent est inactif ou sans dossier', () => {
    const off = buildHistory(conv({ systemPrompt: 'Sois bref.', agent: true }), [
      msg('u1', 'user', 'Salut'),
    ]);
    expect(off[0]?.content).toBe('Sois bref.');
  });
});

describe('buildHistory : contexte de projet', () => {
  const agentConv = conv({ workspace: 'C:\\work\\relay', agent: true });
  const entry = {
    workspace: 'C:\\work\\relay',
    text: 'Project context:\nWorkspace "relay" (Git repository).',
    instructionsFile: null,
    packageManager: 'pnpm' as const,
    git: true,
    tokens: 12,
    builtAt: Date.now(),
  };

  it('ajoute le bloc après le bloc agent quand le cache est rempli et le réglage actif', () => {
    useSettings.setState({ agentProjectContext: true });
    useAgent.setState({ projectContext: { c: entry } });
    const system = String(buildHistory(agentConv, [msg('u1', 'user', 'Salut')])[0]?.content);
    expect(system).toContain('Project context:');
    expect(system.indexOf('Agent mode')).toBeLessThan(system.indexOf('Project context:'));
  });

  it('n’ajoute rien si le réglage est inactif, si le cache est vide ou vise un autre dossier', () => {
    useSettings.setState({ agentProjectContext: false });
    useAgent.setState({ projectContext: { c: entry } });
    expect(buildHistory(agentConv, [])[0]?.content).not.toContain('Project context:');

    useSettings.setState({ agentProjectContext: true });
    useAgent.setState({ projectContext: {} });
    expect(buildHistory(agentConv, [])[0]?.content).not.toContain('Project context:');

    useAgent.setState({ projectContext: { c: { ...entry, workspace: 'D:\\autre' } } });
    expect(buildHistory(agentConv, [])[0]?.content).not.toContain('Project context:');

    // Hors mode agent, le cache est ignoré même s'il est rempli.
    useAgent.setState({ projectContext: { c: entry } });
    expect(buildHistory(conv({ workspace: 'C:\\work\\relay' }), [])).toEqual([]);
  });
});

describe('buildHistory : bloc Environment', () => {
  const agentConv = conv({ workspace: 'C:\\work\\relay', agent: true });
  const environment = {
    os: 'Windows 11',
    shell: 'PowerShell',
    tools: [
      { name: 'git', version: '2.47.1', path: 'C:\\Git\\git.exe' },
      { name: 'docker', version: null, path: null },
    ],
    playwright: { python: true, node: false, browsers: ['chromium'], version: '1.64.1' },
  };
  const projectContext = {
    workspace: 'C:\\work\\relay',
    text: 'Project context:\nWorkspace "relay".',
    instructionsFile: null,
    packageManager: null,
    git: true,
    tokens: 8,
    builtAt: Date.now(),
  };

  it('ajoute le bloc après le contexte de projet quand le relevé est connu et le réglage actif', () => {
    useSettings.setState({ agentEnvironment: true, agentProjectContext: true });
    useAgent.setState({ projectContext: { c: projectContext } });
    useEnvironment.setState({ environment, workspace: null });
    const system = String(buildHistory(agentConv, [msg('u1', 'user', 'Salut')])[0]?.content);
    expect(system).toContain('Environment: Windows 11, PowerShell shell.');
    expect(system).toContain(
      'Available: git 2.47.1, playwright 1.64.1 (python; browsers: chromium).',
    );
    expect(system).toContain('Missing: docker.');
    expect(system.indexOf('Project context:')).toBeLessThan(system.indexOf('Environment:'));
  });

  it('n’ajoute rien sans relevé, réglage inactif ou hors mode agent', () => {
    useSettings.setState({ agentEnvironment: false });
    useEnvironment.setState({ environment, workspace: null });
    expect(buildHistory(agentConv, [])[0]?.content).not.toContain('Environment:');

    useSettings.setState({ agentEnvironment: true });
    useEnvironment.setState({ environment: null });
    expect(buildHistory(agentConv, [])[0]?.content).not.toContain('Environment:');

    useEnvironment.setState({ environment, workspace: null });
    expect(buildHistory(conv({ workspace: 'C:\\work\\relay' }), [])).toEqual([]);
  });
});

describe('effectiveParams', () => {
  it('préfère les réglages de la conversation aux valeurs globales', () => {
    useSettings.setState({ temperature: 0.7, topP: null, maxTokens: null, reasoning: true });
    expect(effectiveParams(conv()).temperature).toBe(0.7);
    expect(effectiveParams(conv({ temperature: 0.2, reasoning: false }))).toMatchObject({
      temperature: 0.2,
      reasoning: false,
      webSearch: false,
    });
  });
});
