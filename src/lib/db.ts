/**
 * Persistance locale (SQLite via tauri-plugin-sql). Le schéma est défini par les
 * migrations Rust (`src-tauri/src/db.rs`). Ce module est le seul à parler SQL.
 */
import Database from '@tauri-apps/plugin-sql';
import type { Role } from './openrouter';

export interface Conversation {
  id: string;
  title: string;
  model: string;
  systemPrompt: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  reasoning: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  finishReason: string | null;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  title: string;
  model: string;
  system_prompt: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  reasoning: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  finish_reason: string | null;
  created_at: string;
}

let db: Promise<Database> | null = null;
const connection = (): Promise<Database> => {
  db ??= Database.load('sqlite:relay.db');
  return db;
};

export const newId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  title: r.title,
  model: r.model,
  systemPrompt: r.system_prompt,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  reasoning: r.reasoning,
  model: r.model,
  promptTokens: r.prompt_tokens,
  completionTokens: r.completion_tokens,
  cost: r.cost,
  finishReason: r.finish_reason,
  createdAt: r.created_at,
});

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
  }): Promise<Conversation> {
    const conversation: Conversation = {
      id: newId(),
      title: input.title,
      model: input.model,
      systemPrompt: input.systemPrompt,
      pinned: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await (await connection()).execute(
      'INSERT INTO conversations (id, title, model, system_prompt, pinned, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, $5, $5)',
      [
        conversation.id,
        conversation.title,
        conversation.model,
        conversation.systemPrompt,
        conversation.createdAt,
      ],
    );
    return conversation;
  },

  async update(
    id: string,
    patch: Partial<Pick<Conversation, 'title' | 'model' | 'systemPrompt' | 'pinned'>>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.title !== undefined) push('title', patch.title);
    if (patch.model !== undefined) push('model', patch.model);
    if (patch.systemPrompt !== undefined) push('system_prompt', patch.systemPrompt);
    if (patch.pinned !== undefined) push('pinned', patch.pinned ? 1 : 0);
    if (sets.length === 0) return;
    values.push(id);
    await (await connection()).execute(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${values.length}`,
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
};

export const messages = {
  async list(conversationId: string): Promise<Message[]> {
    const rows = await (await connection()).select<MessageRow[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, rowid ASC',
      [conversationId],
    );
    return rows.map(toMessage);
  },

  async add(input: Omit<Message, 'id' | 'createdAt'> & { id?: string }): Promise<Message> {
    const message: Message = { ...input, id: input.id ?? newId(), createdAt: now() };
    await (await connection()).execute(
      `INSERT INTO messages
        (id, conversation_id, role, content, reasoning, model, prompt_tokens, completion_tokens, cost, finish_reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.reasoning,
        message.model,
        message.promptTokens,
        message.completionTokens,
        message.cost,
        message.finishReason,
        message.createdAt,
      ],
    );
    return message;
  },

  async remove(id: string): Promise<void> {
    await (await connection()).execute('DELETE FROM messages WHERE id = $1', [id]);
  },

  async totalCost(conversationId: string): Promise<number> {
    const rows = await (await connection()).select<Array<{ total: number | null }>>(
      'SELECT SUM(cost) AS total FROM messages WHERE conversation_id = $1',
      [conversationId],
    );
    return rows[0]?.total ?? 0;
  },
};

/** Export complet (sauvegarde JSON). */
export async function exportAll(): Promise<{ conversations: Conversation[]; messages: Message[] }> {
  const c = await connection();
  const [convs, msgs] = await Promise.all([
    c.select<ConversationRow[]>('SELECT * FROM conversations ORDER BY created_at'),
    c.select<MessageRow[]>('SELECT * FROM messages ORDER BY created_at'),
  ]);
  return { conversations: convs.map(toConversation), messages: msgs.map(toMessage) };
}
