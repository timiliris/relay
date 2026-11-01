//! Base SQLite locale (tauri-plugin-sql) : conversations et messages.
//!
//! Schéma versionné par migrations ; elles s'appliquent au premier `load`
//! côté frontend (`src/lib/db.ts`, même `DB_URL`).

use tauri::plugin::TauriPlugin;
use tauri_plugin_sql::{Migration, MigrationKind, PluginConfig};

pub const DB_URL: &str = "sqlite:relay.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_conversations_and_messages",
            sql: "
            CREATE TABLE IF NOT EXISTS conversations (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL,
                model         TEXT NOT NULL,
                system_prompt TEXT,
                pinned        INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS messages (
                id                TEXT PRIMARY KEY,
                conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role              TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
                content           TEXT NOT NULL,
                reasoning         TEXT,
                model             TEXT,
                prompt_tokens     INTEGER,
                completion_tokens INTEGER,
                cost              REAL,
                finish_reason     TEXT,
                created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_conversations_updated
                ON conversations(pinned DESC, updated_at DESC);
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "message_tree_attachments_folders_presets",
            sql: "
            -- Arbre de messages : versions alternatives (édition, régénération).
            ALTER TABLE messages ADD COLUMN parent_id TEXT;
            ALTER TABLE messages ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE messages ADD COLUMN attachments TEXT;
            ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
            UPDATE messages SET parent_id = (
                SELECT m2.id FROM messages m2
                WHERE m2.conversation_id = messages.conversation_id AND m2.rowid < messages.rowid
                ORDER BY m2.rowid DESC LIMIT 1
            );
            CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(conversation_id, parent_id);

            -- Organisation et paramètres par conversation.
            ALTER TABLE conversations ADD COLUMN folder_id TEXT;
            ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE conversations ADD COLUMN preset_id TEXT;
            ALTER TABLE conversations ADD COLUMN temperature REAL;
            ALTER TABLE conversations ADD COLUMN top_p REAL;
            ALTER TABLE conversations ADD COLUMN max_tokens INTEGER;
            ALTER TABLE conversations ADD COLUMN reasoning INTEGER;
            ALTER TABLE conversations ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE conversations ADD COLUMN summary TEXT;
            ALTER TABLE conversations ADD COLUMN summary_until_id TEXT;

            CREATE TABLE IF NOT EXISTS folders (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                position   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS presets (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                system_prompt TEXT,
                model         TEXT,
                temperature   REAL,
                top_p         REAL,
                max_tokens    INTEGER,
                reasoning     INTEGER,
                position      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "preset_persona",
            sql: "
            -- Personnalité du persona (mode, traits, fiche de rôle, 18+) en JSON.
            ALTER TABLE presets ADD COLUMN persona TEXT;
        ",
            kind: MigrationKind::Up,
        },
    ]
}

pub fn init() -> TauriPlugin<tauri::Wry, Option<PluginConfig>> {
    tauri_plugin_sql::Builder::default()
        .add_migrations(DB_URL, migrations())
        .build()
}
