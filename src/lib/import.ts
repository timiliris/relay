/**
 * Import de conversations depuis des exports tiers (ChatGPT, Claude) ou Relay.
 * Les fonctions de parsing sont pures (testables) ; `importConversations` écrit en base.
 */

import { conversations as convRepo, type Message, messages as msgRepo } from './db';
import type { Role } from './openrouter';

export type ImportSource = 'relay' | 'chatgpt' | 'claude';

export interface ImportedMessage {
  role: Role;
  content: string;
  createdAt: string;
}

export interface ImportedConversation {
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ImportedMessage[];
}

export interface ImportResult {
  source: ImportSource;
  conversations: ImportedConversation[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function isoFromUnix(seconds: unknown, fallback: string): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : fallback;
}

function isoFromString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

/** Détecte le format et extrait les conversations. Lève une erreur si inconnu. */
export function parseImport(json: unknown): ImportResult {
  if (isRecord(json) && Array.isArray(json.conversations) && Array.isArray(json.messages)) {
    return { source: 'relay', conversations: parseRelay(json) };
  }
  if (Array.isArray(json) && json.length > 0) {
    const first = json[0];
    if (isRecord(first) && isRecord(first.mapping)) {
      return { source: 'chatgpt', conversations: json.map(parseChatGpt).filter(nonEmpty) };
    }
    if (isRecord(first) && Array.isArray(first.chat_messages)) {
      return { source: 'claude', conversations: json.map(parseClaude).filter(nonEmpty) };
    }
  }
  if (Array.isArray(json) && json.length === 0) return { source: 'relay', conversations: [] };
  throw new Error('unrecognized');
}

const nonEmpty = (c: ImportedConversation) => c.messages.length > 0;

function parseRelay(json: Record<string, unknown>): ImportedConversation[] {
  const convs = json.conversations as Array<Record<string, unknown>>;
  const msgs = json.messages as Array<Record<string, unknown>>;
  return convs
    .map((c) => {
      const own = msgs
        .filter((m) => m.conversationId === c.id && (m.active === undefined || m.active === true))
        .sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
      return {
        title: str(c.title, 'Import'),
        createdAt: str(c.createdAt, new Date().toISOString()),
        updatedAt: str(c.updatedAt, str(c.createdAt, new Date().toISOString())),
        messages: own
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as Role,
            content: str(m.content),
            createdAt: str(m.createdAt, new Date().toISOString()),
          })),
      };
    })
    .filter(nonEmpty);
}

/** Export ChatGPT : `mapping` est un arbre ; on remonte depuis `current_node`. */
function parseChatGpt(raw: unknown): ImportedConversation {
  const c = isRecord(raw) ? raw : {};
  const mapping = isRecord(c.mapping) ? c.mapping : {};
  const createdAt = isoFromUnix(c.create_time, new Date().toISOString());
  const updatedAt = isoFromUnix(c.update_time, createdAt);

  // Chemin actif : du nœud courant vers la racine, puis inversé.
  let nodeId = typeof c.current_node === 'string' ? c.current_node : lastLeaf(mapping);
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (!isRecord(node)) break;
    chain.push(node);
    nodeId = typeof node.parent === 'string' ? node.parent : '';
  }
  chain.reverse();

  const messages: ImportedMessage[] = [];
  for (const node of chain) {
    const message = node.message;
    if (!isRecord(message)) continue;
    const author = isRecord(message.author) ? message.author : {};
    const role = author.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = isRecord(message.content) ? message.content : {};
    if (content.content_type !== 'text' && content.content_type !== 'multimodal_text') continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .filter((p): p is string => typeof p === 'string')
      .join('\n')
      .trim();
    if (!text) continue;
    messages.push({ role, content: text, createdAt: isoFromUnix(message.create_time, createdAt) });
  }
  return { title: str(c.title, 'ChatGPT'), createdAt, updatedAt, messages };
}

function lastLeaf(mapping: Record<string, unknown>): string {
  const ids = Object.keys(mapping);
  const parents = new Set(
    ids
      .map((id) => mapping[id])
      .filter(isRecord)
      .map((n) => n.parent)
      .filter((p): p is string => typeof p === 'string'),
  );
  return ids.find((id) => !parents.has(id)) ?? '';
}

/** Export Claude : `chat_messages` linéaire, `sender` human | assistant. */
function parseClaude(raw: unknown): ImportedConversation {
  const c = isRecord(raw) ? raw : {};
  const createdAt = isoFromString(c.created_at, new Date().toISOString());
  const updatedAt = isoFromString(c.updated_at, createdAt);
  const list = Array.isArray(c.chat_messages) ? c.chat_messages : [];
  const messages: ImportedMessage[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const role: Role | null =
      item.sender === 'human' ? 'user' : item.sender === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    let text = str(item.text).trim();
    if (!text && Array.isArray(item.content)) {
      text = item.content
        .filter(isRecord)
        .map((part) => (part.type === 'text' ? str(part.text) : ''))
        .join('\n')
        .trim();
    }
    if (!text) continue;
    messages.push({ role, content: text, createdAt: isoFromString(item.created_at, createdAt) });
  }
  return { title: str(c.name) || 'Claude', createdAt, updatedAt, messages };
}

/** Écrit les conversations importées en base (chaîne linéaire de messages). */
export async function importConversations(
  result: ImportResult,
  defaultModel: string,
): Promise<{ conversations: number; messages: number }> {
  let messageCount = 0;
  for (const imported of result.conversations) {
    const conversation = await convRepo.create({
      title: imported.title.slice(0, 120),
      model: defaultModel,
      systemPrompt: null,
      createdAt: imported.createdAt,
      updatedAt: imported.updatedAt,
    });
    let parentId: string | null = null;
    for (const m of imported.messages) {
      const saved: Message = await msgRepo.add({
        conversationId: conversation.id,
        parentId,
        role: m.role,
        content: m.content,
        reasoning: null,
        attachments: [],
        model: m.role === 'assistant' ? `import:${result.source}` : null,
        promptTokens: null,
        completionTokens: null,
        cost: null,
        finishReason: m.role === 'assistant' ? 'stop' : null,
        durationMs: null,
        createdAt: m.createdAt,
      });
      parentId = saved.id;
      messageCount++;
    }
  }
  return { conversations: result.conversations.length, messages: messageCount };
}
