/**
 * Données de démonstration, utilisées uniquement par `pnpm dev` dans un navigateur
 * (hors Tauri, mode `development`) pour travailler l'interface sans base SQLite.
 * Jamais chargées dans l'application ni dans les tests.
 */
import type { Conversation, Message } from './db';
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
    id: 'demo-rp',
    title: 'Maître du jeu',
    model: 'anthropic/claude-sonnet-4.5',
    presetId: 'default-gamemaster',
    systemPrompt: 'Tu mènes une partie de jeu de rôle textuel.',
    temperature: 0.9,
    createdAt: at(2 * day),
    updatedAt: at(2 * day - 3_600_000),
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
  'demo-rp': [
    {
      ...msgBase,
      conversationId: 'demo-rp',
      id: 'r1',
      parentId: null,
      active: true,
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4.5',
      content:
        "La pluie bat les volets de la taverne du Héron Gris. Tu ouvres les yeux sur une table poisseuse, la tête lourde. Le tavernier t'observe en essuyant une chope. « Enfin réveillé. » Que fais-tu ?",
      finishReason: 'stop',
      createdAt: at(2 * day),
    },
    {
      ...msgBase,
      conversationId: 'demo-rp',
      id: 'r2',
      parentId: 'r1',
      active: true,
      role: 'user',
      content: 'Je me redresse et je fouille ma poche. 🎲 d20 → [14] = 14',
      createdAt: at(2 * day - 3_600_000),
    },
  ],
  'demo-4': [],
};
