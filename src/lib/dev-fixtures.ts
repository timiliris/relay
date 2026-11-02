/**
 * Données de démonstration, utilisées uniquement par `pnpm dev` dans un navigateur
 * (hors Tauri, mode `development`) pour travailler l'interface sans base SQLite.
 * Jamais chargées dans l'application ni dans les tests.
 */
import type { FileEntry } from './agent/commands';
import type { Conversation, Message, PersonaMemory } from './db';
import { defaultPresetId } from './default-presets';
import { isTauri } from './tauri';

export const devFixturesEnabled = (): boolean =>
  import.meta.env.MODE === 'development' && !isTauri();

const day = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();

const base = {
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
};

export const sampleConversations: Conversation[] = [
  {
    ...base,
    id: 'demo-1',
    title: 'Mutex vs sémaphore en Rust',
    model: 'anthropic/claude-sonnet-4.5',
    pinned: true,
    createdAt: at(2 * 3_600_000),
    updatedAt: at(3_600_000),
  },
  {
    ...base,
    id: 'demo-2',
    title: 'E-mail pour décaler la réunion',
    model: 'openai/gpt-4.1-mini',
    createdAt: at(day + 3_600_000),
    updatedAt: at(day),
  },
  {
    ...base,
    id: 'demo-3',
    title: 'Idées de projets Rust',
    model: 'google/gemini-2.5-flash',
    folderId: 'folder-1',
    createdAt: at(4 * day),
    updatedAt: at(3 * day),
  },
  {
    ...base,
    id: 'demo-5',
    title: 'La crypte de Varnhold',
    model: 'anthropic/claude-sonnet-4.5',
    presetId: defaultPresetId('gamemaster'),
    reasoning: false,
    createdAt: at(2 * day),
    updatedAt: at(2 * day - 3_600_000),
  },
  {
    ...base,
    id: 'demo-agent',
    title: 'Corriger le test du parseur',
    model: 'anthropic/claude-sonnet-4.5',
    workspace: 'C:\\Users\\Detou\\Documents\\Github\\relay',
    agent: true,
    createdAt: at(3_600_000),
    updatedAt: at(600_000),
  },
  {
    ...base,
    id: 'demo-4',
    title: 'Ancienne discussion archivée',
    model: 'openrouter/auto',
    archived: true,
    createdAt: at(30 * day),
    updatedAt: at(29 * day),
  },
];

export const sampleFolders = [
  { id: 'folder-1', name: 'Rust', position: 1, createdAt: at(5 * day) },
];

const msgBase = {
  conversationId: 'demo-1',
  reasoning: null,
  attachments: [],
  model: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  finishReason: null,
  durationMs: null,
  pinned: false,
};

export const sampleMessages: Record<string, Message[]> = {
  'demo-1': [
    {
      ...msgBase,
      id: 'm1',
      parentId: null,
      active: true,
      role: 'user',
      content:
        'Explique-moi la différence entre un mutex et un sémaphore, avec un exemple en Rust.',
      createdAt: at(2 * 3_600_000),
    },
    {
      ...msgBase,
      id: 'm2a',
      parentId: 'm1',
      active: false,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content: 'Première version, plus courte, de la réponse.',
      promptTokens: 42,
      completionTokens: 12,
      cost: 0.00031,
      finishReason: 'stop',
      durationMs: 1800,
      createdAt: at(2 * 3_600_000 - 20_000),
    },
    {
      ...msgBase,
      id: 'm2',
      parentId: 'm1',
      active: true,
      pinned: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      reasoning:
        "L'utilisateur veut une distinction conceptuelle puis un exemple concret. Je commence par la définition, puis un tableau, puis du code idiomatique avec std::sync.",
      content: `Un **mutex** garantit l'exclusion mutuelle : un seul détenteur à la fois. Un **sémaphore** compte des *permis* : jusqu'à $n$ détenteurs simultanés.

| | Mutex | Sémaphore |
|---|---|---|
| Détenteurs | 1 | $n$ |
| Protège | une donnée | une ressource limitée |
| Libération | par le détenteur | par n'importe qui |

\`\`\`rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let counter = Arc::clone(&counter);
            thread::spawn(move || *counter.lock().unwrap() += 1)
        })
        .collect();
    for h in handles { h.join().unwrap(); }
    println!("total = {}", *counter.lock().unwrap());
}
\`\`\`

Pour un sémaphore, utilisez \`tokio::sync::Semaphore\` ; la bibliothèque standard n'en fournit pas.

\`\`\`mermaid
flowchart LR
  A[Thread] -->|lock| M{Mutex}
  M -->|libre| B[Section critique]
  M -->|occupé| C[Attente]
\`\`\``,
      promptTokens: 42,
      completionTokens: 318,
      cost: 0.00512,
      finishReason: 'stop',
      durationMs: 6400,
      createdAt: at(2 * 3_600_000 - 10_000),
    },
    {
      ...msgBase,
      id: 'm3',
      parentId: 'm2',
      active: true,
      role: 'user',
      content: 'Et voici le schéma dont je parlais.',
      attachments: [
        {
          id: 'a1',
          kind: 'image',
          name: 'schema.png',
          mime: 'image/png',
          size: 18_234,
          data: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="%23334155"/><circle cx="160" cy="100" r="60" fill="%2360a5fa"/></svg>',
        },
        {
          id: 'a2',
          kind: 'text',
          name: 'notes.md',
          mime: 'text/markdown',
          size: 1_204,
          text: '# Notes',
        },
      ],
      createdAt: at(3_600_000 + 60_000),
    },
    {
      ...msgBase,
      id: 'm4',
      parentId: 'm3',
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content:
        'Le schéma montre bien le point de contention au centre. Si plusieurs threads attendent, pensez à `parking_lot::Mutex`, plus rapide sous forte contention.',
      promptTokens: 1_420,
      completionTokens: 64,
      cost: 0.0049,
      finishReason: 'length',
      durationMs: 2100,
      createdAt: at(3_600_000),
    },
    {
      ...msgBase,
      id: 'm5',
      parentId: 'm4',
      active: true,
      role: 'user',
      content: 'Dessine-moi ce schéma en version illustrée.',
      createdAt: at(3_000_000),
    },
    {
      ...msgBase,
      id: 'm6',
      parentId: 'm5',
      active: true,
      role: 'assistant',
      model: 'google/gemini-2.5-flash-image',
      content: 'Voici une illustration du mutex et de ses threads en attente.',
      attachments: [
        {
          id: 'g1',
          kind: 'image',
          name: 'image-1.svg',
          mime: 'image/svg+xml',
          size: 412,
          data: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%230f172a"/><circle cx="200" cy="150" r="70" fill="%23f59e0b"/><circle cx="70" cy="70" r="28" fill="%2360a5fa"/><circle cx="330" cy="70" r="28" fill="%2360a5fa"/><circle cx="70" cy="230" r="28" fill="%2360a5fa"/><circle cx="330" cy="230" r="28" fill="%2360a5fa"/></svg>',
        },
      ],
      promptTokens: 60,
      completionTokens: 1_290,
      cost: 0.039,
      finishReason: 'stop',
      durationMs: 8300,
      createdAt: at(2_990_000),
    },
  ],
  'demo-2': [
    {
      ...msgBase,
      conversationId: 'demo-2',
      id: 'n1',
      parentId: null,
      active: true,
      role: 'user',
      content: 'Rédige un e-mail poli pour décaler la réunion de jeudi à vendredi.',
      createdAt: at(day + 3_600_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-2',
      id: 'n2',
      parentId: 'n1',
      active: true,
      pinned: true,
      role: 'assistant',
      model: 'openai/gpt-4.1-mini',
      content:
        'Objet : Décalage de notre réunion\n\nBonjour,\n\nAuriez-vous la possibilité de décaler notre réunion de jeudi à vendredi, à la même heure ? Je vous remercie par avance pour votre compréhension.\n\nBien cordialement,',
      promptTokens: 30,
      completionTokens: 58,
      cost: 0.00009,
      finishReason: 'stop',
      durationMs: 1400,
      createdAt: at(day),
    },
  ],
  'demo-3': [],
  'demo-4': [],
  'demo-agent': [
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag1',
      parentId: null,
      active: true,
      role: 'user',
      content: 'Le test `parses_tool_call_fragments` échoue : regarde et corrige.',
      createdAt: at(3_600_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag2',
      parentId: 'ag1',
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content: 'Je commence par lire le test concerné.',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"src-tauri/src/openrouter/sse.rs","offset":120,"limit":40}',
        },
      ],
      createdAt: at(3_500_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag3',
      parentId: 'ag2',
      active: true,
      role: 'tool',
      content:
        '[src-tauri/src/openrouter/sse.rs — lines 120-124 of 190]\n  120| #[test]\n  121| fn parses_tool_call_fragments() {\n  122|     let first = r#"{"choices":[…]}"#;\n  123|     let chunk: Chunk = serde_json::from_str(first).unwrap();\n  124|     assert_eq!(call.index, 1);',
      toolCallId: 'call_1',
      toolName: 'read_file',
      toolMeta: {
        args: { path: 'src-tauri/src/openrouter/sse.rs', offset: 120, limit: 40 },
        status: 'done',
        risk: 'read',
        durationMs: 12,
      },
      createdAt: at(3_400_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag4',
      parentId: 'ag3',
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content:
        "L'assertion attend l'index 1 alors que le premier fragment porte l'index 0. Je corrige.",
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_2',
          name: 'edit_file',
          arguments:
            '{"path":"src-tauri/src/openrouter/sse.rs","old":"assert_eq!(call.index, 1);","new":"assert_eq!(call.index, 0);"}',
        },
      ],
      createdAt: at(3_300_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag5',
      parentId: 'ag4',
      active: true,
      role: 'tool',
      content: 'Updated src-tauri/src/openrouter/sse.rs.',
      toolCallId: 'call_2',
      toolName: 'edit_file',
      toolMeta: {
        args: {
          path: 'src-tauri/src/openrouter/sse.rs',
          old: 'assert_eq!(call.index, 1);',
          new: 'assert_eq!(call.index, 0);',
        },
        status: 'done',
        risk: 'write',
        durationMs: 8,
        diff: '--- a/src-tauri/src/openrouter/sse.rs\n+++ b/src-tauri/src/openrouter/sse.rs\n@@ -121,4 +121,4 @@\n fn parses_tool_call_fragments() {\n     let chunk: Chunk = serde_json::from_str(first).unwrap();\n-    assert_eq!(call.index, 1);\n+    assert_eq!(call.index, 0);\n }',
      },
      createdAt: at(3_200_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag6',
      parentId: 'ag5',
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content: 'Je relance les tests Rust pour confirmer.',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_3',
          name: 'run_command',
          arguments: '{"command":"cargo test parses_tool_call_fragments","timeout_secs":300}',
        },
      ],
      createdAt: at(3_100_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-agent',
      id: 'ag7',
      parentId: 'ag6',
      active: true,
      role: 'tool',
      content: '',
      toolCallId: 'call_3',
      toolName: 'run_command',
      toolMeta: {
        args: { command: 'cargo test parses_tool_call_fragments', timeout_secs: 300 },
        status: 'pending',
        risk: 'write',
      },
      createdAt: at(3_000_000),
    },
  ],
  'demo-5': [
    {
      ...msgBase,
      conversationId: 'demo-5',
      id: 'r1',
      parentId: null,
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content:
        "La torche crépite. Devant vous, la porte de la crypte de Varnhold est entrouverte ; une odeur de terre humide s'en échappe. Que faites-vous, Tom ?",
      finishReason: 'stop',
      createdAt: at(2 * day),
    },
    {
      ...msgBase,
      conversationId: 'demo-5',
      id: 'r2',
      parentId: 'r1',
      active: true,
      role: 'user',
      content: "Je pousse la porte avec mon bouclier et j'avance, dague en main.",
      createdAt: at(2 * day - 60_000),
    },
    {
      ...msgBase,
      conversationId: 'demo-5',
      id: 'r3',
      parentId: 'r2',
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content:
        "La porte grince et cède. Dans la pénombre, un médaillon d'argent brille sur un autel renversé : celui que Lyra cherchait depuis le chapitre 2. Un souffle froid éteint presque votre torche.",
      promptTokens: 210,
      completionTokens: 54,
      cost: 0.0012,
      finishReason: 'stop',
      durationMs: 2300,
      createdAt: at(2 * day - 3_600_000),
    },
  ],
};

/** Souvenirs de démonstration, par persona. */
export const sampleMemories: Record<string, PersonaMemory[]> = {
  [defaultPresetId('gamemaster')]: [
    {
      id: 'mem-1',
      presetId: defaultPresetId('gamemaster'),
      content: "Le joueur s'appelle Tom et incarne un éclaireur nain.",
      sourceConversationId: 'demo-5',
      pinned: true,
      createdAt: at(3 * day),
    },
    {
      id: 'mem-2',
      presetId: defaultPresetId('gamemaster'),
      content: 'Lyra a perdu son médaillon au chapitre 2.',
      sourceConversationId: 'demo-5',
      pinned: false,
      createdAt: at(2 * day),
    },
  ],
};

/** Dossier de travail fictif pour le volet Fichiers (hors Tauri, les commandes Rust échouent). */
export const sampleWorkspaceFiles: Record<string, string> = {
  'README.md': `# Relay

Client de bureau pour **OpenRouter**.

- Tauri v2 + React 19
- \`pnpm dev --port 1441\`

> Voir [la doc](https://tauri.app) pour la configuration.
`,
  'package.json': `{
  "name": "demo",
  "version": "1.0.0",
  "scripts": { "dev": "vite" },
  "ok": true,
  "count": 42
}
`,
  'src/main.ts': `import { createRoot } from 'react-dom/client';

/** Point d'entrée : monte l'application. */
export function boot(selector = '#root'): void {
  const el = document.querySelector<HTMLDivElement>(selector);
  if (!el) throw new Error(\`Élément introuvable : \${selector}\`);
  const root = createRoot(el);
  root.render(null);
  console.log('started', { at: Date.now(), retries: 3 });
}

boot();
`,
  'src/styles.css': `:root {
  --accent: oklch(0.6 0.16 240);
}

.card:hover > .title {
  color: var(--accent);
  font-weight: 600;
}
`,
  'src-tauri/src/main.rs': `use std::collections::HashMap;\r
\r
#[derive(Debug, Default)]\r
struct Counter {\r
    hits: HashMap<String, u32>,\r
}\r
\r
impl Counter {\r
    /// Incrémente la clé et renvoie la nouvelle valeur.\r
    fn bump(&mut self, key: &str) -> u32 {\r
        let n = self.hits.entry(key.to_owned()).or_insert(0);\r
        *n += 1;\r
        *n\r
    }\r
}\r
\r
fn main() {\r
    let mut c = Counter::default();\r
    println!("{}", c.bump("boot"));\r
}\r
`,
  'scripts/release.py': `import json
from pathlib import Path

def bump(version: str) -> str:
    """Incrémente le dernier segment."""
    major, minor, patch = (int(p) for p in version.split("."))
    return f"{major}.{minor}.{patch + 1}"

if __name__ == "__main__":
    data = json.loads(Path("package.json").read_text())
    print(bump(data["version"]))
`,
  '.github/workflows/ci.yml': `name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
`,
  LICENSE: 'MIT License\n\nCopyright (c) 2026\n',
};

/** Entrées d'un dossier fictif (`.` pour la racine), dossiers d'abord. */
export function sampleWorkspaceEntries(dir: string): FileEntry[] {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const seen = new Map<string, 'file' | 'dir'>();
  for (const path of Object.keys(sampleWorkspaceFiles)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) seen.set(path, 'file');
    else seen.set(prefix + rest.slice(0, slash), 'dir');
  }
  return [...seen]
    .map(([path, kind]) => ({
      path,
      kind,
      size: kind === 'file' ? new TextEncoder().encode(sampleWorkspaceFiles[path]).length : null,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'dir' ? -1 : 1));
}
