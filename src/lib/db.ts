/**
 * Persistance locale (SQLite via tauri-plugin-sql). Le schéma est défini par les
 * migrations Rust (`src-tauri/src/db.rs`). Ce module est le seul à parler SQL.
 */
import Database from '@tauri-apps/plugin-sql';
import type { Role } from './openrouter';
import { type Persona, parsePersona, serializePersona } from './persona';

/** Pièce jointe d'un message, stockée en JSON dans la colonne `attachments`. */
export interface Attachment {
  id: string;
  kind: 'image' | 'pdf' | 'text';
  name: string;
  mime: string;
  size: number;
  /** Data URL base64 (images, PDF). */
  data?: string;
  /** Contenu décodé (fichiers texte / code). */
  text?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  systemPrompt: string | null;
  pinned: boolean;
  archived: boolean;
  folderId: string | null;
  presetId: string | null;
  /** Paramètres propres à la conversation ; `null` = valeur globale. */
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  reasoning: boolean | null;
  webSearch: boolean;
  /** Résumé des anciens messages (jusqu'à `summaryUntilId` inclus). */
  summary: string | null;
  summaryUntilId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  /** Message précédent dans la branche ; `null` pour le premier. */
  parentId: string | null;
  /** Version affichée parmi les frères (même `parentId`). */
  active: boolean;
  role: Role;
  content: string;
  reasoning: string | null;
  attachments: Attachment[];
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  /** `stop`, `length`, `cancelled`, `error`, ou `streaming` si l'app a été fermée en cours. */
  finishReason: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Preset {
  id: string;
  name: string;
  systemPrompt: string | null;
  model: string | null;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  reasoning: boolean | null;
  /** Mode, traits, fiche de rôle et mode 18+ (colonne JSON `persona`). */
  persona: Persona;
  position: number;
  createdAt: string;
}

export interface UsageRow {
  day: string;
  model: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export interface SearchHit {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  role: Role | null;
  snippet: string;
  updatedAt: string;
}

interface ConversationRow {
  id: string;
  title: string;
  model: string;
  system_prompt: string | null;
  pinned: number;
  archived: number;
  folder_id: string | null;
  preset_id: string | null;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  reasoning: number | null;
  web_search: number;
  summary: string | null;
  summary_until_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  active: number;
  role: Role;
  content: string;
  reasoning: string | null;
  attachments: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  finish_reason: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface FolderRow {
  id: string;
  name: string;
  position: number;
  created_at: string;
}

interface PresetRow {
  id: string;
  name: string;
  system_prompt: string | null;
  model: string | null;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  reasoning: number | null;
  persona: string | null;
  position: number;
  created_at: string;
}

let db: Promise<Database> | null = null;
const connection = (): Promise<Database> => {
  db ??= Database.load('sqlite:relay.db');
  return db;
};

export const newId = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();
const bool = (v: number | null): boolean | null => (v === null ? null : v === 1);
const int = (v: boolean | null | undefined): number | null => (v == null ? null : v ? 1 : 0);

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  title: r.title,
  model: r.model,
  systemPrompt: r.system_prompt,
  pinned: r.pinned === 1,
  archived: r.archived === 1,
  folderId: r.folder_id,
  presetId: r.preset_id,
  temperature: r.temperature,
  topP: r.top_p,
  maxTokens: r.max_tokens,
  reasoning: bool(r.reasoning),
  webSearch: r.web_search === 1,
  summary: r.summary,
  summaryUntilId: r.summary_until_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function parseAttachments(json: string | null): Attachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
  } catch {
    return [];
  }
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  parentId: r.parent_id,
  active: r.active === 1,
  role: r.role,
  content: r.content,
  reasoning: r.reasoning,
  attachments: parseAttachments(r.attachments),
  model: r.model,
  promptTokens: r.prompt_tokens,
  completionTokens: r.completion_tokens,
  cost: r.cost,
  finishReason: r.finish_reason,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  name: r.name,
  position: r.position,
  createdAt: r.created_at,
});

const toPreset = (r: PresetRow): Preset => ({
  id: r.id,
  name: r.name,
  systemPrompt: r.system_prompt,
  model: r.model,
  temperature: r.temperature,
  topP: r.top_p,
  maxTokens: r.max_tokens,
  reasoning: bool(r.reasoning),
  persona: parsePersona(r.persona),
  position: r.position,
  createdAt: r.created_at,
});

/** Construit `SET a = $1, b = $2` à partir d'un objet { colonne: valeur }. */
function buildSet(columns: Record<string, unknown>): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  return { sql: sets.join(', '), values };
}

export type ConversationPatch = Partial<
  Pick<
    Conversation,
    | 'title'
    | 'model'
    | 'systemPrompt'
    | 'pinned'
    | 'archived'
    | 'folderId'
    | 'presetId'
    | 'temperature'
    | 'topP'
    | 'maxTokens'
    | 'reasoning'
    | 'webSearch'
    | 'summary'
    | 'summaryUntilId'
  >
>;

export const conversations = {
  async list(): Promise<Conversation[]> {
    const rows = await (await connection()).select<ConversationRow[]>(
      'SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC',
    );
    return rows.map(toConversation);
  },

  async create(input: {
    title: string;
    model: string;
    systemPrompt: string | null;
    folderId?: string | null;
    presetId?: string | null;
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
    reasoning?: boolean | null;
    webSearch?: boolean;
    createdAt?: string;
    updatedAt?: string;
    id?: string;
  }): Promise<Conversation> {
    const at = now();
    const c: Conversation = {
      id: input.id ?? newId(),
      title: input.title,
      model: input.model,
      systemPrompt: input.systemPrompt,
      pinned: false,
      archived: false,
      folderId: input.folderId ?? null,
      presetId: input.presetId ?? null,
      temperature: input.temperature ?? null,
      topP: input.topP ?? null,
      maxTokens: input.maxTokens ?? null,
      reasoning: input.reasoning ?? null,
      webSearch: input.webSearch ?? false,
      summary: null,
      summaryUntilId: null,
      createdAt: input.createdAt ?? at,
      updatedAt: input.updatedAt ?? at,
    };
    await (await connection()).execute(
      `INSERT INTO conversations
        (id, title, model, system_prompt, pinned, archived, folder_id, preset_id, temperature, top_p,
         max_tokens, reasoning, web_search, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        c.id,
        c.title,
        c.model,
        c.systemPrompt,
        c.folderId,
        c.presetId,
        c.temperature,
        c.topP,
        c.maxTokens,
        int(c.reasoning),
        c.webSearch ? 1 : 0,
        c.createdAt,
        c.updatedAt,
      ],
    );
    return c;
  },

  async update(id: string, patch: ConversationPatch): Promise<void> {
    const { sql, values } = buildSet({
      title: patch.title,
      model: patch.model,
      system_prompt: patch.systemPrompt,
      pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
      archived: patch.archived === undefined ? undefined : patch.archived ? 1 : 0,
      folder_id: patch.folderId,
      preset_id: patch.presetId,
      temperature: patch.temperature,
      top_p: patch.topP,
      max_tokens: patch.maxTokens,
      reasoning: patch.reasoning === undefined ? undefined : int(patch.reasoning),
      web_search: patch.webSearch === undefined ? undefined : patch.webSearch ? 1 : 0,
      summary: patch.summary,
      summary_until_id: patch.summaryUntilId,
    });
    if (!sql) return;
    values.push(id);
    await (await connection()).execute(
      `UPDATE conversations SET ${sql} WHERE id = $${values.length}`,
      values,
    );
  },

  /** Marque une activité récente (remonte la conversation dans l'historique). */
  async touch(id: string, at = now()): Promise<string> {
    await (await connection()).execute('UPDATE conversations SET updated_at = $1 WHERE id = $2', [
      at,
      id,
    ]);
    return at;
  },

  async remove(id: string): Promise<void> {
    const c = await connection();
    await c.execute('DELETE FROM messages WHERE conversation_id = $1', [id]);
    await c.execute('DELETE FROM conversations WHERE id = $1', [id]);
  },

  async removeArchived(): Promise<number> {
    const c = await connection();
    const rows = await c.select<Array<{ id: string }>>(
      'SELECT id FROM conversations WHERE archived = 1',
    );
    for (const row of rows) await conversations.remove(row.id);
    return rows.length;
  },
};

export type MessagePatch = Partial<
  Pick<
    Message,
    | 'content'
    | 'reasoning'
    | 'promptTokens'
    | 'completionTokens'
    | 'cost'
    | 'finishReason'
    | 'durationMs'
    | 'model'
    | 'attachments'
  >
>;

export const messages = {
  /** Tous les messages (toutes branches) ; le chemin actif est calculé par `lib/tree.ts`. */
  async list(conversationId: string): Promise<Message[]> {
    const rows = await (await connection()).select<MessageRow[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, rowid ASC',
      [conversationId],
    );
    return rows.map(toMessage);
  },

  async add(
    input: Omit<Message, 'id' | 'createdAt' | 'active'> & { id?: string; createdAt?: string },
  ): Promise<Message> {
    const message: Message = {
      ...input,
      id: input.id ?? newId(),
      active: true,
      createdAt: input.createdAt ?? now(),
    };
    const c = await connection();
    // Le nouveau message devient la version active parmi ses frères.
    await c.execute(
      'UPDATE messages SET active = 0 WHERE conversation_id = $1 AND parent_id IS $2',
      [message.conversationId, message.parentId],
    );
    await c.execute(
      `INSERT INTO messages
        (id, conversation_id, parent_id, active, role, content, reasoning, attachments, model,
         prompt_tokens, completion_tokens, cost, finish_reason, duration_ms, created_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        message.id,
        message.conversationId,
        message.parentId,
        message.role,
        message.content,
        message.reasoning,
        message.attachments.length ? JSON.stringify(message.attachments) : null,
        message.model,
        message.promptTokens,
        message.completionTokens,
        message.cost,
        message.finishReason,
        message.durationMs,
        message.createdAt,
      ],
    );
    return message;
  },

  async update(id: string, patch: MessagePatch): Promise<void> {
    const { sql, values } = buildSet({
      content: patch.content,
      reasoning: patch.reasoning,
      prompt_tokens: patch.promptTokens,
      completion_tokens: patch.completionTokens,
      cost: patch.cost,
      finish_reason: patch.finishReason,
      duration_ms: patch.durationMs,
      model: patch.model,
      attachments:
        patch.attachments === undefined
          ? undefined
          : patch.attachments.length
            ? JSON.stringify(patch.attachments)
            : null,
    });
    if (!sql) return;
    values.push(id);
    await (await connection()).execute(
      `UPDATE messages SET ${sql} WHERE id = $${values.length}`,
      values,
    );
  },

  /** Rend `id` actif parmi ses frères (même conversation, même parent). */
  async activate(conversationId: string, parentId: string | null, id: string): Promise<void> {
    await (await connection()).execute(
      'UPDATE messages SET active = CASE WHEN id = $1 THEN 1 ELSE 0 END WHERE conversation_id = $2 AND parent_id IS $3',
      [id, conversationId, parentId],
    );
  },

  /** Supprime un message et toute sa descendance. */
  async removeSubtree(conversationId: string, id: string): Promise<void> {
    const c = await connection();
    const all = await messages.list(conversationId);
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of all) {
        if (m.parentId && doomed.has(m.parentId) && !doomed.has(m.id)) {
          doomed.add(m.id);
          grew = true;
        }
      }
    }
    for (const doomedId of doomed)
      await c.execute('DELETE FROM messages WHERE id = $1', [doomedId]);
  },

  async totalCost(conversationId: string): Promise<number> {
    const rows = await (await connection()).select<Array<{ total: number | null }>>(
      'SELECT SUM(cost) AS total FROM messages WHERE conversation_id = $1',
      [conversationId],
    );
    return rows[0]?.total ?? 0;
  },
};

export const folders = {
  async list(): Promise<Folder[]> {
    const rows = await (await connection()).select<FolderRow[]>(
      'SELECT * FROM folders ORDER BY position ASC, created_at ASC',
    );
    return rows.map(toFolder);
  },
  async create(name: string): Promise<Folder> {
    const folder: Folder = { id: newId(), name, position: Date.now(), createdAt: now() };
    await (await connection()).execute(
      'INSERT INTO folders (id, name, position, created_at) VALUES ($1, $2, $3, $4)',
      [folder.id, folder.name, folder.position, folder.createdAt],
    );
    return folder;
  },
  async rename(id: string, name: string): Promise<void> {
    await (await connection()).execute('UPDATE folders SET name = $1 WHERE id = $2', [name, id]);
  },
  /** Supprime le dossier ; ses conversations redeviennent sans dossier. */
  async remove(id: string): Promise<void> {
    const c = await connection();
    await c.execute('UPDATE conversations SET folder_id = NULL WHERE folder_id = $1', [id]);
    await c.execute('DELETE FROM folders WHERE id = $1', [id]);
  },
};

export const presets = {
  async list(): Promise<Preset[]> {
    const rows = await (await connection()).select<PresetRow[]>(
      'SELECT * FROM presets ORDER BY position ASC, created_at ASC',
    );
    return rows.map(toPreset);
  },
  async save(
    preset: Omit<Preset, 'createdAt' | 'position'> & { position?: number },
  ): Promise<Preset> {
    const c = await connection();
    const existing = await c.select<PresetRow[]>('SELECT * FROM presets WHERE id = $1', [
      preset.id,
    ]);
    const full: Preset = {
      ...preset,
      position: preset.position ?? existing[0]?.position ?? Date.now(),
      createdAt: existing[0]?.created_at ?? now(),
    };
    await c.execute(
      `INSERT INTO presets (id, name, system_prompt, model, temperature, top_p, max_tokens, reasoning, persona, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt,
         model = excluded.model, temperature = excluded.temperature, top_p = excluded.top_p,
         max_tokens = excluded.max_tokens, reasoning = excluded.reasoning, persona = excluded.persona,
         position = excluded.position`,
      [
        full.id,
        full.name,
        full.systemPrompt,
        full.model,
        full.temperature,
        full.topP,
        full.maxTokens,
        int(full.reasoning),
        serializePersona(full.persona),
        full.position,
        full.createdAt,
      ],
    );
    return full;
  },
  async remove(id: string): Promise<void> {
    const c = await connection();
    await c.execute('UPDATE conversations SET preset_id = NULL WHERE preset_id = $1', [id]);
    await c.execute('DELETE FROM presets WHERE id = $1', [id]);
  },
};

/** Recherche plein texte simple (titres et contenus), insensible à la casse. */
export async function search(query: string, limit = 30): Promise<SearchHit[]> {
  const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const c = await connection();
  const titles = await c.select<Array<{ id: string; title: string; updated_at: string }>>(
    "SELECT id, title, updated_at FROM conversations WHERE title LIKE $1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT $2",
    [like, limit],
  );
  const contents = await c.select<
    Array<{
      id: string;
      conversation_id: string;
      role: Role;
      content: string;
      title: string;
      updated_at: string;
    }>
  >(
    `SELECT m.id, m.conversation_id, m.role, m.content, c.title, c.updated_at
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.content LIKE $1 ESCAPE '\\' AND m.active = 1
     ORDER BY c.updated_at DESC, m.created_at DESC LIMIT $2`,
    [like, limit],
  );
  const hits: SearchHit[] = titles.map((t) => ({
    conversationId: t.id,
    conversationTitle: t.title,
    messageId: null,
    role: null,
    snippet: t.title,
    updatedAt: t.updated_at,
  }));
  for (const m of contents) {
    hits.push({
      conversationId: m.conversation_id,
      conversationTitle: m.title,
      messageId: m.id,
      role: m.role,
      snippet: snippetAround(m.content, query),
      updatedAt: m.updated_at,
    });
  }
  return hits;
}

function snippetAround(text: string, query: string, radius = 70): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

/** Dépenses et tokens par jour et par modèle (réponses de l'assistant). */
export async function usage(sinceDays = 30): Promise<UsageRow[]> {
  const rows = await (await connection()).select<
    Array<{
      day: string;
      model: string;
      messages: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost: number;
    }>
  >(
    `SELECT substr(created_at, 1, 10) AS day, COALESCE(model, '?') AS model, COUNT(*) AS messages,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM messages WHERE role = 'assistant' AND created_at >= $1
     GROUP BY day, model ORDER BY day DESC, cost DESC`,
    [new Date(Date.now() - sinceDays * 86_400_000).toISOString()],
  );
  return rows.map((r) => ({
    day: r.day,
    model: r.model,
    messages: r.messages,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    cost: r.cost,
  }));
}

/** Export complet (sauvegarde JSON). */
export async function exportAll(): Promise<{
  conversations: Conversation[];
  messages: Message[];
  folders: Folder[];
  presets: Preset[];
}> {
  const c = await connection();
  const [convs, msgs, flds, prst] = await Promise.all([
    c.select<ConversationRow[]>('SELECT * FROM conversations ORDER BY created_at'),
    c.select<MessageRow[]>('SELECT * FROM messages ORDER BY created_at'),
    c.select<FolderRow[]>('SELECT * FROM folders ORDER BY position'),
    c.select<PresetRow[]>('SELECT * FROM presets ORDER BY position'),
  ]);
  return {
    conversations: convs.map(toConversation),
    messages: msgs.map(toMessage),
    folders: flds.map(toFolder),
    presets: prst.map(toPreset),
  };
}
