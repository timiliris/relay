//! Commandes exposées au frontend.
//!
//! Chaque commande est une fonction `#[tauri::command]` enregistrée dans
//! `generate_handler!` (voir `lib.rs`) avec son chemin complet. Côté TypeScript,
//! les appels passent par les wrappers typés de `src/lib/tauri.ts` et `src/lib/openrouter.ts`.

pub mod app;
pub mod openrouter;
pub mod secrets;
