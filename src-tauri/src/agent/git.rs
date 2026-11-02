//! Panneau Git du dossier de travail : exécution du binaire `git` du poste dans la racine
//! enregistrée (`current_dir`), sortie plafonnée, délai de 60 s, erreurs avec le stderr de git.
//!
//! Aucun `push` ni `pull` ici : l'utilisateur passe par `gh` ou son terminal. Tout chemin reçu
//! est résolu avec [`super::resolve`], qui refuse ce qui sort de la racine.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::{AppError, AppResult};

use super::{display_relative, resolve};

const TIMEOUT: Duration = Duration::from_secs(60);
/// Au-delà, la sortie (diff, journal) est coupée et signalée comme tronquée.
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
/// Nombre maximal de commits renvoyés par `log`.
const MAX_LOG: usize = 200;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Chemin relatif à la racine, séparateurs `/`.
    pub path: String,
    pub status: FileStatus,
    /// `true` : entrée de l'index (sera commitée) ; `false` : modification de l'arbre de travail.
    pub staged: bool,
    /// Ancien chemin d'un fichier renommé.
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Nom de la branche, ou le hash court en tête détachée.
    pub branch: String,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub diff: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    /// Date d'auteur en ISO 8601 strict.
    pub date: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

struct Output {
    exit_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
    truncated: bool,
}

/// Lit un flux en ne conservant que les `MAX_OUTPUT_BYTES` premiers octets.
async fn drain(mut reader: impl AsyncReadExt + Unpin) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut truncated = false;
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = MAX_OUTPUT_BYTES.saturating_sub(kept.len());
                if n > room {
                    truncated = true;
                }
                kept.extend_from_slice(&buf[..n.min(room)]);
            }
        }
    }
    (kept, truncated)
}

/// Lance `git <args>` dans `root` sans jamais attendre une saisie (identifiants, éditeur).
async fn run(root: &Path, args: &[&str]) -> AppResult<Output> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env(
            "GIT_EDITOR",
            if cfg!(windows) {
                "cmd /c exit 1"
            } else {
                "false"
            },
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote.
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::Tool(
            "git est introuvable sur ce poste : installez-le ou ajoutez-le au PATH.".into(),
        ),
        _ => AppError::Tool(format!("git : {e}")),
    })?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_task = tokio::spawn(drain(stdout));
    let err_task = tokio::spawn(drain(stderr));
    let status = match tokio::time::timeout(TIMEOUT, child.wait()).await {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(AppError::Tool(format!(
                "git {} : délai de {} s dépassé",
                args.first().unwrap_or(&""),
                TIMEOUT.as_secs()
            )));
        }
    };
    let (stdout, out_trunc) = out_task
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let (stderr, _) = err_task
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(Output {
        exit_code: status.code(),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
        truncated: out_trunc,
    })
}

/// Comme [`run`], mais tout code de sortie hors de `accepted` devient une erreur portant le stderr.
async fn run_ok(root: &Path, args: &[&str], accepted: &[i32]) -> AppResult<Output> {
    let out = run(root, args).await?;
    match out.exit_code {
        Some(code) if accepted.contains(&code) => Ok(out),
        _ => {
            let detail = if out.stderr.is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                out.stderr.clone()
            };
            Err(AppError::Tool(if detail.is_empty() {
                format!("git {} a échoué", args.first().unwrap_or(&""))
            } else {
                detail
            }))
        }
    }
}

fn text(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Un dépôt doit avoir son `.git` (dossier, ou fichier pour un arbre de travail lié) à la racine
/// même : les chemins du status sont relatifs à la racine du dépôt, pas au dossier courant.
fn ensure_repo(root: &Path) -> AppResult<()> {
    root.join(".git")
        .exists()
        .then_some(())
        .ok_or(AppError::Validation("git_not_repo"))
}

/// Chemin relatif sûr (sous la racine), en séparateurs `/`, tel que git l'attend.
fn relative(root: &Path, path: &str) -> AppResult<String> {
    let resolved = resolve(root, path)?;
    let rel = display_relative(root, &resolved);
    if rel.is_empty() || rel == root.to_string_lossy() {
        return Err(AppError::Validation("workspace_denied"));
    }
    Ok(rel)
}

pub async fn status(root: &Path) -> AppResult<GitStatus> {
    ensure_repo(root)?;
    let out = run_ok(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
            "-z",
        ],
        &[0],
    )
    .await?;
    Ok(parse_status(&text(&out)))
}

/// Analyse `git status --porcelain=v2 --branch -z`. Une entrée `1`/`2` peut produire deux
/// fichiers : la part indexée (colonne X) et la part de l'arbre de travail (colonne Y).
pub fn parse_status(raw: &str) -> GitStatus {
    let mut status = GitStatus {
        branch: String::new(),
        detached: false,
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
    };
    let mut oid = String::new();
    let mut records = raw.split('\0').filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" => oid = value.to_string(),
                "branch.head" => {
                    if value == "(detached)" {
                        status.detached = true;
                    } else {
                        status.branch = value.to_string();
                    }
                }
                "branch.upstream" => status.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            status.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            status.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let mut fields = record.splitn(2, ' ');
        let kind = fields.next().unwrap_or("");
        let rest = fields.next().unwrap_or("");
        match kind {
            "?" => status.files.push(GitFile {
                path: rest.to_string(),
                status: FileStatus::Untracked,
                staged: false,
                orig_path: None,
            }),
            "1" | "2" => {
                // `1 XY sub mH mI mW hH hI path` ; `2 XY sub mH mI mW hH hI Xscore path` + orig.
                let field_count = if kind == "1" { 8 } else { 9 };
                let mut parts = rest.splitn(field_count, ' ');
                let xy = parts.next().unwrap_or("..");
                let path = parts.nth(field_count - 2).unwrap_or("").to_string();
                let orig = if kind == "2" {
                    records.next().map(str::to_string)
                } else {
                    None
                };
                let mut xy = xy.chars();
                let x = xy.next().unwrap_or('.');
                let y = xy.next().unwrap_or('.');
                if let Some(s) = status_of(x) {
                    status.files.push(GitFile {
                        path: path.clone(),
                        status: s,
                        staged: true,
                        orig_path: orig.clone(),
                    });
                }
                if let Some(s) = status_of(y) {
                    status.files.push(GitFile {
                        path,
                        status: s,
                        staged: false,
                        orig_path: None,
                    });
                }
            }
            "u" => {
                // `u XY sub m1 m2 m3 mW h1 h2 h3 path`
                let path = rest.splitn(10, ' ').nth(9).unwrap_or("").to_string();
                status.files.push(GitFile {
                    path,
                    status: FileStatus::Conflicted,
                    staged: false,
                    orig_path: None,
                });
            }
            _ => {}
        }
    }
    if status.detached || status.branch.is_empty() {
        status.branch = if oid == "(initial)" || oid.is_empty() {
            status.branch.clone()
        } else {
            oid.chars().take(7).collect()
        };
    }
    status
}

fn status_of(code: char) -> Option<FileStatus> {
    match code {
        'M' | 'T' => Some(FileStatus::Modified),
        'A' | 'C' => Some(FileStatus::Added),
        'D' => Some(FileStatus::Deleted),
        'R' => Some(FileStatus::Renamed),
        'U' => Some(FileStatus::Conflicted),
        _ => None,
    }
}

/// Diff d'un fichier (ou de tout le dépôt sans `path`), indexé ou non. Un fichier non suivi est
/// comparé à `/dev/null` pour montrer son contenu entier.
pub async fn diff(root: &Path, path: Option<&str>, staged: bool) -> AppResult<GitDiff> {
    ensure_repo(root)?;
    let rel = path.map(|p| relative(root, p)).transpose()?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    if let Some(rel) = &rel {
        if !staged && !is_tracked(root, rel).await? {
            let out = run_ok(
                root,
                &["diff", "--no-color", "--no-index", "--", "/dev/null", rel],
                &[0, 1],
            )
            .await?;
            return Ok(GitDiff {
                diff: text(&out),
                truncated: out.truncated,
            });
        }
        args.push("--");
        args.push(rel);
    }
    let out = run_ok(root, &args, &[0, 1]).await?;
    Ok(GitDiff {
        diff: text(&out),
        truncated: out.truncated,
    })
}

async fn is_tracked(root: &Path, rel: &str) -> AppResult<bool> {
    let out = run(root, &["ls-files", "--error-unmatch", "--", rel]).await?;
    Ok(out.exit_code == Some(0))
}

/// Indexe (`git add -A`) ou désindexe (`git reset`) des chemins, tous sous la racine.
pub async fn stage(root: &Path, paths: &[String], stage: bool) -> AppResult<()> {
    ensure_repo(root)?;
    if paths.is_empty() {
        return Err(AppError::Validation("git_no_paths"));
    }
    let rels = paths
        .iter()
        .map(|p| relative(root, p))
        .collect::<AppResult<Vec<_>>>()?;
    let mut args: Vec<&str> = if stage {
        vec!["add", "-A", "--"]
    } else {
        vec!["reset", "-q", "--"]
    };
    args.extend(rels.iter().map(String::as_str));
    run_ok(root, &args, &[0]).await?;
    Ok(())
}

pub async fn commit(root: &Path, message: &str) -> AppResult<GitCommit> {
    ensure_repo(root)?;
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::Validation("git_empty_message"));
    }
    run_ok(
        root,
        &["commit", "--quiet", "--no-edit", "-m", message],
        &[0],
    )
    .await?;
    let out = run_ok(root, &["log", "-1", "--format=%H%x1f%s"], &[0]).await?;
    let line = text(&out);
    let (hash, summary) = line.trim().split_once('\x1f').unwrap_or((line.trim(), ""));
    Ok(GitCommit {
        hash: hash.to_string(),
        summary: summary.to_string(),
    })
}

/// Les `limit` derniers commits ; vide dans un dépôt sans commit.
pub async fn log(root: &Path, limit: usize) -> AppResult<Vec<GitLogEntry>> {
    ensure_repo(root)?;
    if !has_head(root).await? {
        return Ok(Vec::new());
    }
    let n = limit.clamp(1, MAX_LOG).to_string();
    let out = run_ok(
        root,
        &["log", "-n", &n, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"],
        &[0],
    )
    .await?;
    Ok(parse_log(&text(&out)))
}

pub fn parse_log(raw: &str) -> Vec<GitLogEntry> {
    raw.lines()
        .filter_map(|line| {
            let mut f = line.split('\x1f');
            Some(GitLogEntry {
                hash: f.next()?.to_string(),
                short: f.next()?.to_string(),
                subject: f.next()?.to_string(),
                author: f.next()?.to_string(),
                date: f.next()?.to_string(),
            })
        })
        .collect()
}

async fn has_head(root: &Path) -> AppResult<bool> {
    let out = run(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).await?;
    Ok(out.exit_code == Some(0))
}

/// Branches locales, la courante marquée.
pub async fn branches(root: &Path) -> AppResult<Vec<GitBranch>> {
    ensure_repo(root)?;
    let out = run_ok(
        root,
        &["branch", "--list", "--format=%(refname:short)%1f%(HEAD)"],
        &[0],
    )
    .await?;
    Ok(text(&out)
        .lines()
        .filter_map(|line| {
            let (name, head) = line.split_once('\x1f')?;
            (!name.is_empty()).then(|| GitBranch {
                name: name.to_string(),
                current: head == "*",
            })
        })
        .collect())
}

/// Bascule sur une branche locale existante (nom validé par git, jamais interprété comme option).
pub async fn checkout(root: &Path, branch: &str) -> AppResult<()> {
    ensure_repo(root)?;
    let branch = branch.trim();
    if branch.is_empty() || branch.starts_with('-') {
        return Err(AppError::Validation("git_bad_branch"));
    }
    run_ok(root, &["check-ref-format", "--branch", branch], &[0])
        .await
        .map_err(|_| AppError::Validation("git_bad_branch"))?;
    run_ok(root, &["checkout", "--quiet", branch, "--"], &[0]).await?;
    Ok(())
}

/// `git init` dans la racine (sans effet sur un dépôt existant).
pub async fn init(root: &Path) -> AppResult<()> {
    run_ok(root, &["init", "--quiet"], &[0]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::testing::TempDir;
    use super::*;

    /// `None` quand `git` est absent du poste : les tests sont alors sautés.
    async fn repo(label: &str) -> Option<TempDir> {
        let dir = TempDir::new(&format!("git-{label}"));
        if run(&dir.0, &["--version"]).await.is_err() {
            eprintln!("git introuvable : test sauté");
            return None;
        }
        init(&dir.0).await.unwrap();
        for (k, v) in [
            ("user.name", "Relay"),
            ("user.email", "relay@example.com"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            run_ok(&dir.0, &["config", k, v], &[0]).await.unwrap();
        }
        Some(dir)
    }

    fn write(dir: &TempDir, name: &str, content: &str) {
        std::fs::write(dir.0.join(name), content).unwrap();
    }

    fn find<'a>(s: &'a GitStatus, path: &str, staged: bool) -> Option<&'a GitFile> {
        s.files
            .iter()
            .find(|f| f.path == path && f.staged == staged)
    }

    #[test]
    fn parses_porcelain_v2_headers_and_entries() {
        let raw = [
            "# branch.oid 1234567890abcdef",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 abc abc src/a.rs",
            "1 A. N... 000000 100644 100644 000 abc src/new.rs",
            "1 MM N... 100644 100644 100644 abc abc src/both.rs",
            "1 .D N... 100644 100644 000000 abc abc gone.txt",
            "2 R. N... 100644 100644 100644 abc abc R100 new-name.txt",
            "old-name.txt",
            "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
            "? notes.md",
            "! ignored.log",
        ]
        .join("\0");
        let s = parse_status(&raw);
        assert_eq!(s.branch, "main");
        assert!(!s.detached);
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        let expect = |path: &str, staged: bool, status: FileStatus| {
            let f = find(&s, path, staged).unwrap_or_else(|| panic!("{path} staged={staged}"));
            assert_eq!(f.status, status, "{path}");
        };
        expect("src/a.rs", false, FileStatus::Modified);
        expect("src/new.rs", true, FileStatus::Added);
        expect("src/both.rs", true, FileStatus::Modified);
        expect("src/both.rs", false, FileStatus::Modified);
        expect("gone.txt", false, FileStatus::Deleted);
        expect("new-name.txt", true, FileStatus::Renamed);
        assert_eq!(
            find(&s, "new-name.txt", true).unwrap().orig_path.as_deref(),
            Some("old-name.txt")
        );
        expect("conflict.txt", false, FileStatus::Conflicted);
        expect("notes.md", false, FileStatus::Untracked);
        assert!(s.files.iter().all(|f| f.path != "ignored.log"));
        assert_eq!(s.files.len(), 8);
    }

    #[test]
    fn parses_detached_head_and_initial_repo() {
        let s = parse_status("# branch.oid 1234567890abcdef\0# branch.head (detached)\0");
        assert!(s.detached);
        assert_eq!(s.branch, "1234567");
        let s = parse_status("# branch.oid (initial)\0# branch.head main\0? a.txt\0");
        assert_eq!(s.branch, "main");
        assert_eq!(s.files.len(), 1);
        assert_eq!(parse_status("").files.len(), 0);
    }

    #[test]
    fn parses_log_lines() {
        let raw = "abc\x1fabc1234\x1ffeat: x\x1fRelay\x1f2026-01-01T00:00:00+01:00\nbad line\n";
        let log = parse_log(raw);
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].short, "abc1234");
        assert_eq!(log[0].subject, "feat: x");
        assert_eq!(log[0].author, "Relay");
    }

    #[tokio::test]
    async fn refuses_folders_without_a_repository() {
        let dir = TempDir::new("git-norepo");
        let err = status(&dir.0).await.unwrap_err();
        assert!(matches!(err, AppError::Validation("git_not_repo")));
    }

    #[tokio::test]
    async fn status_lists_untracked_modified_and_staged_files() {
        let Some(dir) = repo("status").await else {
            return;
        };
        write(&dir, "tracked.txt", "v1\n");
        stage(&dir.0, &["tracked.txt".into()], true).await.unwrap();
        commit(&dir.0, "init").await.unwrap();

        write(&dir, "tracked.txt", "v2\n");
        write(&dir, "new.txt", "nouveau\n");
        write(&dir, "staged.txt", "indexé\n");
        stage(&dir.0, &["staged.txt".into()], true).await.unwrap();

        let s = status(&dir.0).await.unwrap();
        assert!(!s.branch.is_empty());
        assert_eq!(s.upstream, None);
        assert_eq!(
            find(&s, "tracked.txt", false).unwrap().status,
            FileStatus::Modified
        );
        assert_eq!(
            find(&s, "new.txt", false).unwrap().status,
            FileStatus::Untracked
        );
        assert_eq!(
            find(&s, "staged.txt", true).unwrap().status,
            FileStatus::Added
        );
        assert_eq!(s.files.len(), 3);
    }

    #[tokio::test]
    async fn diff_shows_worktree_index_and_untracked_changes() {
        let Some(dir) = repo("diff").await else {
            return;
        };
        write(&dir, "a.txt", "ligne 1\n");
        stage(&dir.0, &["a.txt".into()], true).await.unwrap();
        commit(&dir.0, "init").await.unwrap();
        write(&dir, "a.txt", "ligne 1\nligne 2\n");
        write(&dir, "b.txt", "contenu b\n");

        let d = diff(&dir.0, Some("a.txt"), false).await.unwrap();
        assert!(d.diff.contains("+ligne 2"), "{}", d.diff);
        assert!(!d.truncated);
        let d = diff(&dir.0, Some("b.txt"), false).await.unwrap();
        assert!(d.diff.contains("+contenu b"), "{}", d.diff);

        stage(&dir.0, &["a.txt".into()], true).await.unwrap();
        let d = diff(&dir.0, Some("a.txt"), true).await.unwrap();
        assert!(d.diff.contains("+ligne 2"), "{}", d.diff);
        let d = diff(&dir.0, Some("a.txt"), false).await.unwrap();
        assert!(d.diff.is_empty(), "{}", d.diff);
        // Diff global de l'index.
        let d = diff(&dir.0, None, true).await.unwrap();
        assert!(d.diff.contains("a.txt"));

        assert!(diff(&dir.0, Some("../outside.txt"), false).await.is_err());
    }

    #[tokio::test]
    async fn stage_and_unstage_move_files_between_groups() {
        let Some(dir) = repo("stage").await else {
            return;
        };
        write(&dir, "x.txt", "x\n");
        stage(&dir.0, &["x.txt".into()], true).await.unwrap();
        assert!(find(&status(&dir.0).await.unwrap(), "x.txt", true).is_some());
        // Désindexation avant tout commit (sans HEAD).
        stage(&dir.0, &["x.txt".into()], false).await.unwrap();
        let s = status(&dir.0).await.unwrap();
        assert!(find(&s, "x.txt", true).is_none());
        assert_eq!(
            find(&s, "x.txt", false).unwrap().status,
            FileStatus::Untracked
        );

        stage(&dir.0, &["x.txt".into()], true).await.unwrap();
        commit(&dir.0, "init").await.unwrap();
        std::fs::remove_file(dir.0.join("x.txt")).unwrap();
        stage(&dir.0, &["x.txt".into()], true).await.unwrap();
        assert_eq!(
            find(&status(&dir.0).await.unwrap(), "x.txt", true)
                .unwrap()
                .status,
            FileStatus::Deleted
        );

        assert!(stage(&dir.0, &[], true).await.is_err());
        assert!(stage(&dir.0, &["../x.txt".into()], true).await.is_err());
    }

    #[tokio::test]
    async fn commit_then_log_lists_the_commit() {
        let Some(dir) = repo("commit").await else {
            return;
        };
        assert!(log(&dir.0, 10).await.unwrap().is_empty());
        assert!(commit(&dir.0, "   ").await.is_err());
        write(&dir, "f.txt", "f\n");
        stage(&dir.0, &["f.txt".into()], true).await.unwrap();
        let c = commit(&dir.0, "feat: premier commit\n\ncorps")
            .await
            .unwrap();
        assert_eq!(c.hash.len(), 40);
        assert_eq!(c.summary, "feat: premier commit");
        // Rien à commiter : erreur portant le message de git.
        assert!(commit(&dir.0, "vide").await.is_err());

        let entries = log(&dir.0, 10).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, c.hash);
        assert_eq!(entries[0].subject, "feat: premier commit");
        assert_eq!(entries[0].author, "Relay");
        assert!(entries[0].date.contains('T'));
    }

    #[tokio::test]
    async fn branches_list_and_checkout() {
        let Some(dir) = repo("branches").await else {
            return;
        };
        assert!(branches(&dir.0).await.unwrap().is_empty());
        write(&dir, "f.txt", "f\n");
        stage(&dir.0, &["f.txt".into()], true).await.unwrap();
        commit(&dir.0, "init").await.unwrap();
        let main = status(&dir.0).await.unwrap().branch;
        run_ok(&dir.0, &["branch", "feature"], &[0]).await.unwrap();

        let list = branches(&dir.0).await.unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|b| b.name == main && b.current));
        assert!(list.iter().any(|b| b.name == "feature" && !b.current));

        checkout(&dir.0, "feature").await.unwrap();
        assert_eq!(status(&dir.0).await.unwrap().branch, "feature");
        assert!(checkout(&dir.0, "absente").await.is_err());
        assert!(checkout(&dir.0, "--orphan").await.is_err());
        assert!(checkout(&dir.0, "").await.is_err());
    }
}
