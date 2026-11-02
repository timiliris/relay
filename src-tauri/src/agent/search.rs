//! Recherche par expression régulière dans les fichiers texte du dossier de travail.

use std::path::Path;

use globset::Glob;
use regex::Regex;
use serde::Serialize;

use super::fs::walker;
use super::{display_relative, resolve};
use crate::{AppError, AppResult};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LINE_CHARS: usize = 400;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

pub fn search(
    root: &Path,
    pattern: &str,
    glob: Option<&str>,
    max_results: usize,
) -> AppResult<SearchResult> {
    let regex = Regex::new(pattern).map_err(|e| AppError::Tool(format!("invalid regex: {e}")))?;
    let matcher = glob
        .filter(|g| !g.trim().is_empty())
        .map(|g| {
            Glob::new(g.trim())
                .map(|g| g.compile_matcher())
                .map_err(|e| AppError::Tool(format!("invalid glob: {e}")))
        })
        .transpose()?;
    let start = resolve(root, ".")?;
    let max_results = max_results.clamp(1, 500);
    let mut matches = Vec::new();
    let mut truncated = false;

    'files: for entry in walker(root, &start, None).build().flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if entry
            .metadata()
            .map(|m| m.len() > MAX_FILE_BYTES)
            .unwrap_or(true)
        {
            continue;
        }
        let rel = display_relative(root, entry.path());
        if let Some(m) = &matcher
            && !m.is_match(&rel)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if bytes.iter().take(8192).any(|b| *b == 0) {
            continue; // binaire
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if !regex.is_match(line) {
                continue;
            }
            if matches.len() >= max_results {
                truncated = true;
                break 'files;
            }
            matches.push(SearchMatch {
                path: rel.clone(),
                line: i as u32 + 1,
                text: line
                    .chars()
                    .take(MAX_LINE_CHARS)
                    .collect::<String>()
                    .trim_end()
                    .to_string(),
            });
        }
    }
    Ok(SearchResult { matches, truncated })
}

#[cfg(test)]
mod tests {
    use super::super::testing::TempDir;
    use super::*;

    #[test]
    fn finds_lines_respects_gitignore_and_globs() {
        let dir = TempDir::new("search");
        std::fs::create_dir_all(dir.0.join("src")).unwrap();
        std::fs::write(dir.0.join("src/a.rs"), "fn alpha() {}\nlet beta = 1;\n").unwrap();
        std::fs::write(dir.0.join("src/b.ts"), "const alpha = 2;\n").unwrap();
        std::fs::write(dir.0.join("notes.log"), "alpha in a log\n").unwrap();
        std::fs::write(dir.0.join(".gitignore"), "*.log\n").unwrap();
        std::fs::write(dir.0.join("bin.dat"), [0u8, 1, 2]).unwrap();

        let all = search(&dir.0, "alpha", None, 100).unwrap();
        let paths: Vec<_> = all.matches.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths, vec!["src/a.rs", "src/b.ts"]);
        assert_eq!(all.matches[0].line, 1);

        let rust_only = search(&dir.0, "alpha", Some("**/*.rs"), 100).unwrap();
        assert_eq!(rust_only.matches.len(), 1);

        let capped = search(&dir.0, "a", None, 1).unwrap();
        assert_eq!(capped.matches.len(), 1);
        assert!(capped.truncated);

        assert!(
            matches!(search(&dir.0, "(", None, 10), Err(AppError::Tool(m)) if m.contains("regex"))
        );
    }
}
