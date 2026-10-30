//! Base SQLite locale (tauri-plugin-sql) : conversations et messages.
//!
//! Schéma versionné par migrations ; elles s'appliquent au premier `load`
//! côté frontend (`src/lib/db.ts`, même `DB_URL`).

use tauri::plugin::TauriPlugin;
use tauri_plugin_sql::{Migration, MigrationKind, PluginConfig};

pub const DB_URL: &str = "sqlite:relay.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
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
    }]
}

pub fn init() -> TauriPlugin<tauri::Wry, Option<PluginConfig>> {
    tauri_plugin_sql::Builder::default()
        .add_migrations(DB_URL, migrations())
        .build()
}
