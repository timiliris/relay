//! Outils fichiers : liste, lecture, écriture et édition avec diff unifié.

use std::path::Path;

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use similar::TextDiff;

use super::{display_relative, resolve};
use crate::{AppError, AppResult};

/// Dossiers jamais listés ni fouillés, même sans `.gitignore`.
pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".venv",
    "__pycache__",
];
const MAX_ENTRIES: usize = 500;
const MAX_READ_BYTES: usize = 200 * 1024;
const MAX_WRITE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: &'static str,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Change {
    Write {
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Edit {
        old: String,
        new: String,
        #[serde(default)]
        replace_all: bool,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreview {
    pub diff: String,
    pub exists: bool,
    pub created: bool,
}

/// Parcours respectant `.gitignore` (même hors dépôt Git) et les dossiers toujours ignorés.
pub fn walker(root: &Path, start: &Path, depth: Option<usize>) -> WalkBuilder {
    let mut builder = WalkBuilder::new(start);
    builder
        .hidden(false)
        .require_git(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .max_depth(depth)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_some_and(|t| t.is_dir())
                && IGNORED_DIRS.contains(&name.as_ref()))
        });
    // Les ignorés du dépôt racine s'appliquent même quand on liste un sous-dossier.
    if start != root {
        builder.add_ignore(root.join(".gitignore"));
    }
    builder
}

pub fn list_files(root: &Path, path: &str, depth: u8) -> AppResult<ListResult> {
    let start = resolve(root, if path.is_empty() { "." } else { path })?;
    if !start.is_dir() {
        return Err(AppError::Tool(format!("not a directory: {path}")));
    }
    let depth = depth.clamp(1, 3) as usize;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in walker(root, &start, Some(depth)).build().flatten() {
        if entry.depth() == 0 {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        entries.push(FileEntry {
            path: display_relative(root, entry.path()),
            kind: if is_dir { "dir" } else { "file" },
            size: if is_dir {
                None
            } else {
                entry.metadata().ok().map(|m| m.len())
            },
        });
    }
    // Dossiers d'abord, puis ordre alphabétique.
    entries.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then(a.path.cmp(&b.path))
    });
    Ok(ListResult { entries, truncated })
}

fn read_text(path: &Path, max_bytes: usize) -> AppResult<(String, bool)> {
    let bytes = std::fs::read(path)?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Err(AppError::Tool("binary file".into()));
    }
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };
    let text = String::from_utf8(slice.to_vec()).or_else(|_| {
        // Coupure au milieu d'un caractère multi-octets : on recule jusqu'à une frontière valide.
        let mut end = slice.len();
        while end > 0 && std::str::from_utf8(&slice[..end]).is_err() {
            end -= 1;
        }
        if end == 0 && !slice.is_empty() {
            Err(AppError::Tool("binary file".into()))
        } else {
            Ok(String::from_utf8_lossy(&slice[..end]).into_owned())
        }
    })?;
    Ok((text, truncated))
}

pub fn read_file(
    root: &Path,
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> AppResult<FileContent> {
    let file = resolve(root, path)?;
    if !file.is_file() {
        return Err(AppError::Tool(format!("not a file: {path}")));
    }
    let (text, truncated_bytes) = read_text(&file, MAX_READ_BYTES)?;
    let lines: Vec<&str> = text.lines().collect();
    let total_lines = lines.len();
    let start = offset.unwrap_or(1).max(1) - 1;
    let count = limit.unwrap_or(total_lines).max(1);
    let selected: Vec<&str> = lines.iter().skip(start).take(count).copied().collect();
    let truncated = truncated_bytes || start + selected.len() < total_lines;
    Ok(FileContent {
        content: selected.join("\n"),
        total_lines,
        truncated,
    })
}

/// Calcule le nouveau contenu et son diff ; écrit sur disque seulement si `apply`.
pub fn change_file(
    root: &Path,
    path: &str,
    change: &Change,
    apply: bool,
) -> AppResult<ChangePreview> {
    let file = resolve(root, path)?;
    let exists = file.exists();
    if exists && !file.is_file() {
        return Err(AppError::Tool(format!("not a file: {path}")));
    }
    let before = if exists {
        read_text(&file, MAX_WRITE_BYTES)?.0
    } else {
        String::new()
    };
    let after = match change {
        Change::Write { content } => content.clone(),
        Change::Edit {
            old,
            new,
            replace_all,
        } => {
            if !exists {
                return Err(AppError::Tool(format!("file not found: {path}")));
            }
            if old.is_empty() {
                return Err(AppError::Tool("anchor_missing: `old` is empty".into()));
            }
            match before.matches(old.as_str()).count() {
                0 => {
                    return Err(AppError::Tool(
                        "anchor_missing: `old` was not found in the file".into(),
                    ));
                }
                1 => before.replacen(old.as_str(), new, 1),
                n if *replace_all => {
                    let _ = n;
                    before.replace(old.as_str(), new)
                }
                n => {
                    return Err(AppError::Tool(format!(
                        "anchor_ambiguous: `old` occurs {n} times; add context or set replace_all"
                    )));
                }
            }
        }
    };
    if after.len() > MAX_WRITE_BYTES {
        return Err(AppError::Tool("content too large (max 2 MB)".into()));
    }
    let rel = display_relative(root, &file);
    let diff = TextDiff::from_lines(&before, &after)
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{rel}"), &format!("b/{rel}"))
        .to_string();
    if apply {
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&file, &after)?;
    }
    Ok(ChangePreview {
        diff,
        exists,
        created: !exists,
    })
}

#[cfg(test)]
mod tests {
    use super::super::testing::TempDir;
    use super::*;

    fn setup(label: &str) -> TempDir {
        let dir = TempDir::new(label);
        std::fs::create_dir_all(dir.0.join("src/deep")).unwrap();
        std::fs::create_dir_all(dir.0.join("node_modules/pkg")).unwrap();
        std::fs::write(dir.0.join("src/a.rs"), "fn a() {}\nfn b() {}\nfn c() {}\n").unwrap();
        std::fs::write(dir.0.join("src/deep/d.rs"), "deep").unwrap();
        std::fs::write(dir.0.join("node_modules/pkg/index.js"), "x").unwrap();
        std::fs::write(dir.0.join("secret.log"), "log").unwrap();
        std::fs::write(dir.0.join(".gitignore"), "*.log\n").unwrap();
        dir
    }

    #[test]
    fn lists_folders_first_and_skips_ignored_entries() {
        let dir = setup("list");
        let result = list_files(&dir.0, ".", 1).unwrap();
        let paths: Vec<_> = result.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["src", ".gitignore"]);
        assert!(!result.truncated);

        let deep = list_files(&dir.0, "src", 2).unwrap();
        let paths: Vec<_> = deep.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["src/deep", "src/a.rs", "src/deep/d.rs"]);
        assert!(list_files(&dir.0, "src/a.rs", 1).is_err());
    }

    #[test]
    fn reads_with_offset_and_limit_and_rejects_binaries() {
        let dir = setup("read");
        let all = read_file(&dir.0, "src/a.rs", None, None).unwrap();
        assert_eq!(all.total_lines, 3);
        assert!(!all.truncated);
        let part = read_file(&dir.0, "src/a.rs", Some(2), Some(1)).unwrap();
        assert_eq!(part.content, "fn b() {}");
        assert!(part.truncated);

        std::fs::write(dir.0.join("img.bin"), [0u8, 159, 146, 150]).unwrap();
        assert!(matches!(
            read_file(&dir.0, "img.bin", None, None),
            Err(AppError::Tool(m)) if m.contains("binary")
        ));
        assert!(read_file(&dir.0, "../x", None, None).is_err());
    }

    #[test]
    fn edits_require_a_unique_anchor_and_produce_a_diff() {
        let dir = setup("edit");
        let ok = change_file(
            &dir.0,
            "src/a.rs",
            &Change::Edit {
                old: "fn b() {}".into(),
                new: "fn b() { 2 }".into(),
                replace_all: false,
            },
            true,
        )
        .unwrap();
        assert!(ok.exists && !ok.created);
        assert!(ok.diff.contains("--- a/src/a.rs"));
        assert!(ok.diff.contains("-fn b() {}"));
        assert!(ok.diff.contains("+fn b() { 2 }"));
        assert!(
            std::fs::read_to_string(dir.0.join("src/a.rs"))
                .unwrap()
                .contains("fn b() { 2 }")
        );

        let missing = change_file(
            &dir.0,
            "src/a.rs",
            &Change::Edit {
                old: "nope".into(),
                new: "x".into(),
                replace_all: false,
            },
            false,
        );
        assert!(matches!(missing, Err(AppError::Tool(m)) if m.contains("anchor_missing")));

        let ambiguous = change_file(
            &dir.0,
            "src/a.rs",
            &Change::Edit {
                old: "fn ".into(),
                new: "pub fn ".into(),
                replace_all: false,
            },
            false,
        );
        assert!(matches!(ambiguous, Err(AppError::Tool(m)) if m.contains("anchor_ambiguous")));

        let all = change_file(
            &dir.0,
            "src/a.rs",
            &Change::Edit {
                old: "fn ".into(),
                new: "pub fn ".into(),
                replace_all: true,
            },
            true,
        )
        .unwrap();
        assert_eq!(all.diff.matches("+pub fn").count(), 3);
    }

    #[test]
    fn writes_create_parent_folders_and_preview_does_not_touch_disk() {
        let dir = setup("write");
        let preview = change_file(
            &dir.0,
            "new/dir/n.txt",
            &Change::Write {
                content: "hello\n".into(),
            },
            false,
        )
        .unwrap();
        assert!(preview.created && !preview.exists);
        assert!(preview.diff.contains("+hello"));
        assert!(!dir.0.join("new/dir/n.txt").exists());

        change_file(
            &dir.0,
            "new/dir/n.txt",
            &Change::Write {
                content: "hello\n".into(),
            },
            true,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("new/dir/n.txt")).unwrap(),
            "hello\n"
        );
    }
}
