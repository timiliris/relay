//! Relevé de l'environnement du poste pour le mode agent : outils présents dans le PATH avec leur
//! version, état de Playwright (paquet Python, paquet npm, navigateurs téléchargés) et
//! installation de Playwright en flux (ligne par ligne) pour le dialogue des Paramètres.
//!
//! Les sondes tournent en parallèle, jamais interactives (`stdin` fermé), avec un délai court par
//! outil. L'environnement hérité est celui de l'application : la clé API vit dans le trousseau et
//! n'y figure jamais. Le résultat est mis en cache pour la session (`EnvironmentState`).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::{AppError, AppResult};

/// Délai d'une sonde `--version`.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// `npx` passe par cmd.exe puis Node : plus lent qu'un binaire natif.
const NPX_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// Délai de chaque étape d'installation de Playwright (le téléchargement de Chromium prend ~1 min).
const INSTALL_STEP_TIMEOUT: Duration = Duration::from_secs(super::exec::MAX_TIMEOUT_SECS);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    /// Version lue dans la sortie de `--version` (`2.47.1`), `None` si absente ou illisible.
    pub version: Option<String>,
    /// Exécutable trouvé dans le PATH ; `None` : outil absent.
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaywrightInfo {
    /// Paquet Python `playwright` importable par le Python détecté.
    pub python: bool,
    /// Paquet npm `playwright` résolu par `npx` (local au dossier de travail ou global).
    pub node: bool,
    /// Familles de navigateurs déjà téléchargées (`chromium`, `firefox`, `webkit`).
    pub browsers: Vec<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    /// Ex. `Windows 11`, `macOS 15.1`, `Linux`.
    pub os: String,
    /// Shell utilisé par `run_command` : `PowerShell` ou `sh`.
    pub shell: String,
    pub tools: Vec<ToolInfo>,
    pub playwright: PlaywrightInfo,
}

/// Cache de session : dernier relevé et dossier de travail pour lequel il a été fait
/// (la détection locale de Playwright npm en dépend).
#[derive(Default)]
pub struct EnvironmentState {
    cached: Mutex<Option<(Option<String>, Environment)>>,
}

impl EnvironmentState {
    pub fn get(&self, workspace: Option<&str>) -> Option<Environment> {
        let guard = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .filter(|(ws, _)| ws.as_deref() == workspace)
            .map(|(_, env)| env.clone())
    }

    pub fn set(&self, workspace: Option<&str>, env: Environment) {
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) =
            Some((workspace.map(str::to_owned), env));
    }

    pub fn clear(&self) {
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

struct Probe {
    name: &'static str,
    /// Noms d'exécutables essayés dans l'ordre (`python`, `python3`, `py`).
    candidates: &'static [&'static str],
    args: &'static [&'static str],
}

/// Outils relevés, dans l'ordre d'affichage. `pip` et Playwright sont dérivés de Python / Node.
const PROBES: &[Probe] = &[
    Probe {
        name: "git",
        candidates: &["git"],
        args: &["--version"],
    },
    Probe {
        name: "gh",
        candidates: &["gh"],
        args: &["--version"],
    },
    Probe {
        name: "node",
        candidates: &["node"],
        args: &["--version"],
    },
    Probe {
        name: "npm",
        candidates: &["npm"],
        args: &["--version"],
    },
    Probe {
        name: "pnpm",
        candidates: &["pnpm"],
        args: &["--version"],
    },
    Probe {
        name: "yarn",
        candidates: &["yarn"],
        args: &["--version"],
    },
    Probe {
        name: "bun",
        candidates: &["bun"],
        args: &["--version"],
    },
    Probe {
        name: "python",
        candidates: &["python", "python3", "py"],
        args: &["--version"],
    },
    Probe {
        name: "cargo",
        candidates: &["cargo"],
        args: &["--version"],
    },
    Probe {
        name: "rustc",
        candidates: &["rustc"],
        args: &["--version"],
    },
    Probe {
        name: "dotnet",
        candidates: &["dotnet"],
        args: &["--version"],
    },
    Probe {
        name: "java",
        candidates: &["java"],
        args: &["-version"],
    },
    Probe {
        name: "docker",
        candidates: &["docker"],
        args: &["--version"],
    },
];

/// Ordre final des outils dans le résultat (`pip` suit `python`).
pub const TOOL_ORDER: &[&str] = &[
    "git", "gh", "node", "npm", "pnpm", "yarn", "bun", "python", "pip", "cargo", "rustc", "dotnet",
    "java", "docker",
];

/// Relevé complet, sondes en parallèle. `workspace` sert à résoudre un Playwright npm local.
pub async fn detect(workspace: Option<&Path>) -> Environment {
    let probes = futures_util::future::join_all(PROBES.iter().map(probe_tool)).await;
    let python = probes
        .iter()
        .find(|t| t.name == "python")
        .and_then(|t| t.path.clone());
    let npx = which("npx");

    let (pip, playwright) = tokio::join!(
        probe_pip(python.as_deref()),
        probe_playwright(python.as_deref(), npx.as_deref(), workspace),
    );

    let mut tools: Vec<ToolInfo> = probes;
    tools.push(pip);
    tools.sort_by_key(|t| TOOL_ORDER.iter().position(|n| *n == t.name));

    Environment {
        os: describe_os(tauri_plugin_os::platform(), &tauri_plugin_os::version()),
        shell: if cfg!(windows) { "PowerShell" } else { "sh" }.to_string(),
        tools,
        playwright,
    }
}

/// `Windows 11` (build ≥ 22000), `macOS 15.1`, `Linux 6.8`… ; la plateforme brute sinon.
pub fn describe_os(platform: &str, version: &tauri_plugin_os::Version) -> String {
    use tauri_plugin_os::Version;
    let semantic = match version {
        Version::Semantic(major, minor, patch) => Some((*major, *minor, *patch)),
        _ => None,
    };
    match (platform, semantic) {
        ("windows", Some((10, 0, build))) if build >= 22_000 => "Windows 11".into(),
        ("windows", Some((10, _, _))) => "Windows 10".into(),
        ("windows", _) => "Windows".into(),
        ("macos", Some((major, minor, _))) => format!("macOS {major}.{minor}"),
        ("macos", _) => "macOS".into(),
        ("linux", Some((major, minor, _))) => format!("Linux {major}.{minor}"),
        ("linux", _) => "Linux".into(),
        (other, _) => other.to_string(),
    }
}

async fn probe_tool(probe: &Probe) -> ToolInfo {
    let mut fallback: Option<PathBuf> = None;
    for candidate in probe.candidates {
        let Some(path) = which(candidate) else {
            continue;
        };
        let output = run_probe(&path, probe.args, None, PROBE_TIMEOUT).await;
        if let Some(version) = output.as_deref().and_then(parse_version) {
            return ToolInfo {
                name: probe.name.into(),
                version: Some(version),
                path: Some(path.to_string_lossy().into_owned()),
            };
        }
        // Alias d'exécution du Microsoft Store (`WindowsApps\python.exe`) sans Python installé :
        // il répond sans version. On ne le compte pas comme présent.
        if is_store_alias(&path) {
            continue;
        }
        fallback.get_or_insert(path);
    }
    ToolInfo {
        name: probe.name.into(),
        version: None,
        path: fallback.map(|p| p.to_string_lossy().into_owned()),
    }
}

async fn probe_pip(python: Option<&str>) -> ToolInfo {
    let version = match python {
        Some(py) => run_probe(
            Path::new(py),
            &["-m", "pip", "--version"],
            None,
            PROBE_TIMEOUT,
        )
        .await
        .as_deref()
        .and_then(parse_version),
        None => None,
    };
    ToolInfo {
        name: "pip".into(),
        path: version.as_ref().and(python).map(str::to_owned),
        version,
    }
}

async fn probe_playwright(
    python: Option<&str>,
    npx: Option<&Path>,
    workspace: Option<&Path>,
) -> PlaywrightInfo {
    let python_probe = async {
        match python {
            Some(py) => run_probe(
                Path::new(py),
                &["-m", "playwright", "--version"],
                None,
                PROBE_TIMEOUT,
            )
            .await
            .as_deref()
            .and_then(parse_version),
            None => None,
        }
    };
    // `--no-install` : jamais de téléchargement ; résolution locale (dossier de travail) puis globale.
    let npx_cwd: Option<PathBuf> = workspace.map(Path::to_path_buf).or_else(home_dir);
    let node_probe = async {
        match npx {
            Some(npx) => run_probe(
                npx,
                &["--no-install", "playwright", "--version"],
                npx_cwd.as_deref(),
                NPX_PROBE_TIMEOUT,
            )
            .await
            .as_deref()
            .and_then(parse_version),
            None => None,
        }
    };
    let (python_version, node_version) = tokio::join!(python_probe, node_probe);
    let browsers = browsers_dir()
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .map(|entries| {
            let names: Vec<String> = entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            browser_families(&names)
        })
        .unwrap_or_default();
    PlaywrightInfo {
        python: python_version.is_some(),
        node: node_version.is_some(),
        browsers,
        version: python_version.or(node_version),
    }
}

/// Dossier des navigateurs Playwright : `PLAYWRIGHT_BROWSERS_PATH`, sinon le cache de l'OS.
fn browsers_dir() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("PLAYWRIGHT_BROWSERS_PATH").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(custom));
    }
    if cfg!(windows) {
        return std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("ms-playwright"));
    }
    let home = home_dir()?;
    Some(if cfg!(target_os = "macos") {
        home.join("Library").join("Caches").join("ms-playwright")
    } else {
        home.join(".cache").join("ms-playwright")
    })
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// `chromium-1248`, `chromium_headless_shell-1248`, `ffmpeg-1013` → `["chromium"]`.
pub fn browser_families(names: &[String]) -> Vec<String> {
    let mut families: Vec<String> = names
        .iter()
        .filter_map(|name| {
            let base = name.rsplit_once('-').map(|(b, _)| b).unwrap_or(name);
            let family = base.split('_').next().unwrap_or(base);
            matches!(family, "chromium" | "firefox" | "webkit").then(|| family.to_string())
        })
        .collect();
    families.sort();
    families.dedup();
    families
}

/// Un numéro commence après un séparateur, ou après un `v` isolé (`v22.11.0`), jamais au milieu
/// d'un mot (`sha1abc`).
fn version_may_start_at(bytes: &[u8], i: usize) -> bool {
    if i == 0 || !bytes[i - 1].is_ascii_alphanumeric() {
        return true;
    }
    matches!(bytes[i - 1], b'v' | b'V') && (i == 1 || !bytes[i - 2].is_ascii_alphanumeric())
}

/// Premier numéro `x.y` ou `x.y.z` de la sortie (`git version 2.47.1.windows.1` → `2.47.1`).
pub fn parse_version(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() && version_may_start_at(bytes, i) {
            let mut end = i;
            let mut parts = 0;
            while end < bytes.len() && parts < 3 {
                let start = end;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                if end == start {
                    break;
                }
                parts += 1;
                if parts < 3 && end < bytes.len() && bytes[end] == b'.' {
                    let after = end + 1;
                    if after < bytes.len() && bytes[after].is_ascii_digit() {
                        end = after;
                        continue;
                    }
                }
                break;
            }
            if parts >= 2 {
                return Some(output[i..end].to_string());
            }
            i = end.max(i + 1);
        } else {
            i += 1;
        }
    }
    None
}

/// Lance `program args` et renvoie stdout + stderr, ou `None` si introuvable, en échec ou trop lent.
async fn run_probe(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    no_window(&mut cmd);
    let child = cmd.spawn().ok()?;
    // Délai dépassé : le futur est abandonné et `kill_on_drop` arrête le processus.
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

#[cfg_attr(not(windows), allow(unused_variables))]
fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote.
}

fn is_store_alias(path: &Path) -> bool {
    cfg!(windows)
        && path
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("\\microsoft\\windowsapps\\")
}

/// Cherche `name` dans le PATH (avec les extensions de `PATHEXT` sous Windows).
pub fn which(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(str::to_ascii_lowercase)
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path_var).filter(|d| !d.as_os_str().is_empty()) {
        for ext in &extensions {
            let candidate = dir.join(format!("{name}{ext}"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    true
}

// ---- Installation de Playwright ----

/// Événements envoyés au dialogue d'installation (`Channel`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum InstallEvent {
    /// Début d'une étape ; `command` est la ligne affichée (programme et arguments).
    Step {
        index: usize,
        total: usize,
        command: String,
    },
    Line {
        text: String,
        stderr: bool,
    },
    Done {
        success: bool,
        exit_code: Option<i32>,
        cancelled: bool,
        timed_out: bool,
    },
}

/// Étapes d'installation selon les runtimes présents : Python d'abord (`pip` puis
/// `playwright install chromium`), sinon npm (`npm install -g playwright` puis `npx playwright
/// install chromium`). `None` quand ni Python ni Node ne sont là.
pub fn plan_install(
    python: Option<&str>,
    npm: Option<&str>,
    npx: Option<&str>,
) -> Option<Vec<Vec<String>>> {
    let owned = |parts: &[&str]| parts.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    if let Some(py) = python {
        return Some(vec![
            owned(&[py, "-m", "pip", "install", "--upgrade", "playwright"]),
            owned(&[py, "-m", "playwright", "install", "chromium"]),
        ]);
    }
    match (npm, npx) {
        (Some(npm), Some(npx)) => Some(vec![
            owned(&[npm, "install", "-g", "playwright"]),
            owned(&[npx, "playwright", "install", "chromium"]),
        ]),
        _ => None,
    }
}

/// Affichage d'une étape : programme réduit à son nom de fichier, arguments à la suite.
fn display_step(step: &[String]) -> String {
    let program = step
        .first()
        .map(|p| {
            Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone())
        })
        .unwrap_or_default();
    std::iter::once(program)
        .chain(step.iter().skip(1).cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Installe Playwright et Chromium en relayant chaque ligne de sortie à `emit`.
/// Renvoie `true` si toutes les étapes ont réussi. Jamais interactif ; annulable via `cancel`.
pub async fn install_playwright(
    env: &Environment,
    cancel: CancellationToken,
    emit: impl Fn(InstallEvent),
) -> AppResult<bool> {
    let tool_path = |name: &str| {
        env.tools
            .iter()
            .find(|t| t.name == name)
            .and_then(|t| t.path.as_deref())
    };
    let npx = which("npx").map(|p| p.to_string_lossy().into_owned());
    let steps = plan_install(tool_path("python"), tool_path("npm"), npx.as_deref())
        .ok_or(AppError::Validation("playwright_no_runtime"))?;
    let total = steps.len();
    for (index, step) in steps.iter().enumerate() {
        emit(InstallEvent::Step {
            index,
            total,
            command: display_step(step),
        });
        let outcome = run_streaming(step, cancel.clone(), &emit).await?;
        let success = outcome.exit_code == Some(0);
        if !success {
            emit(InstallEvent::Done {
                success: false,
                exit_code: outcome.exit_code,
                cancelled: outcome.cancelled,
                timed_out: outcome.timed_out,
            });
            return Ok(false);
        }
    }
    emit(InstallEvent::Done {
        success: true,
        exit_code: Some(0),
        cancelled: false,
        timed_out: false,
    });
    Ok(true)
}

struct StepOutcome {
    exit_code: Option<i32>,
    cancelled: bool,
    timed_out: bool,
}

/// Exécute une étape et relaie sa sortie ligne par ligne (le dernier état d'une ligne mise à
/// jour par `\r`, barres de progression incluses). Arrêt forcé via `exec::kill_tree` au délai ou
/// à l'annulation.
async fn run_streaming(
    step: &[String],
    cancel: CancellationToken,
    emit: &impl Fn(InstallEvent),
) -> AppResult<StepOutcome> {
    let (program, args) = step.split_first().expect("non-empty step");
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .env("PIP_NO_INPUT", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("NPM_CONFIG_YES", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    no_window(&mut cmd);
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, bool)>();
    let out_task = tokio::spawn(forward_lines(stdout, false, tx.clone()));
    let err_task = tokio::spawn(forward_lines(stderr, true, tx));

    let mut status: Option<Option<i32>> = None;
    let mut cancelled = false;
    let mut timed_out = false;
    let deadline = tokio::time::sleep(INSTALL_STEP_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            line = rx.recv() => match line {
                Some((text, stderr)) => emit(InstallEvent::Line { text, stderr }),
                // Les deux flux sont fermés : le processus se termine (ou l'a déjà fait).
                None => {
                    if status.is_none() {
                        status = Some(child.wait().await?.code());
                    }
                    break;
                }
            },
            exit = child.wait(), if status.is_none() => {
                status = Some(exit?.code());
            }
            _ = &mut deadline, if status.is_none() => {
                super::exec::kill_tree(&mut child).await;
                timed_out = true;
                status = Some(None);
            }
            _ = cancel.cancelled(), if status.is_none() => {
                super::exec::kill_tree(&mut child).await;
                cancelled = true;
                status = Some(None);
            }
        }
        // Processus arrêté de force : on n'attend pas plus de deux secondes la fin des flux.
        if matches!(status, Some(None)) {
            while let Ok(Some((text, stderr))) =
                tokio::time::timeout(Duration::from_secs(2), rx.recv()).await
            {
                emit(InstallEvent::Line { text, stderr });
            }
            out_task.abort();
            err_task.abort();
            break;
        }
    }
    Ok(StepOutcome {
        exit_code: status.flatten(),
        cancelled,
        timed_out,
    })
}

/// Lit un flux ligne par ligne ; une ligne réécrite avec `\r` n'envoie que son dernier état.
async fn forward_lines(
    reader: impl tokio::io::AsyncRead + Unpin,
    stderr: bool,
    tx: tokio::sync::mpsc::UnboundedSender<(String, bool)>,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let text = line
            .rsplit('\r')
            .map(str::trim_end)
            .find(|s| !s.is_empty())
            .unwrap_or("")
            .to_string();
        if text.is_empty() {
            continue;
        }
        if tx.send((text, stderr)).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_os::Version;

    #[test]
    fn parses_versions_from_common_outputs() {
        let cases = [
            ("git version 2.47.1.windows.1", "2.47.1"),
            ("v22.11.0", "22.11.0"),
            ("Python 3.14.0", "3.14.0"),
            ("gh version 2.65.0 (2025-01-20)\nhttps://…", "2.65.0"),
            (
                "pip 25.2 from C:\\Python314\\Lib\\site-packages\\pip (python 3.14)",
                "25.2",
            ),
            ("openjdk version \"21.0.9\" 2025-10-21 LTS", "21.0.9"),
            ("Docker version 28.4.0, build d8eb465", "28.4.0"),
            ("cargo 1.90.0 (840b83a10 2025-07-30)", "1.90.0"),
            ("Version 1.64.1", "1.64.1"),
            ("10.18.0\n", "10.18.0"),
            ("9.0.305", "9.0.305"),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_version(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn ignores_outputs_without_a_version() {
        assert_eq!(
            parse_version("Python was not found; run without arguments to install"),
            None
        );
        assert_eq!(parse_version("build 2025"), None);
        assert_eq!(parse_version("abc1.2"), None, "chiffre collé à un mot");
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn groups_browser_folders_by_family() {
        let names: Vec<String> = [
            "chromium-1208",
            "chromium-1248",
            "chromium_headless_shell-1248",
            "ffmpeg-1013",
            "winldd-1007",
            "firefox-1482",
            ".links",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        assert_eq!(browser_families(&names), vec!["chromium", "firefox"]);
        assert!(browser_families(&[]).is_empty());
    }

    #[test]
    fn describes_the_operating_system() {
        assert_eq!(
            describe_os("windows", &Version::Semantic(10, 0, 26300)),
            "Windows 11"
        );
        assert_eq!(
            describe_os("windows", &Version::Semantic(10, 0, 19045)),
            "Windows 10"
        );
        assert_eq!(describe_os("windows", &Version::Unknown), "Windows");
        assert_eq!(
            describe_os("macos", &Version::Semantic(15, 1, 0)),
            "macOS 15.1"
        );
        assert_eq!(describe_os("linux", &Version::Rolling(None)), "Linux");
    }

    #[test]
    fn plans_python_first_then_npm_then_refuses() {
        // Barres obliques : `Path::file_name` ne coupe pas sur `\` sous Unix (CI Linux).
        let py = plan_install(Some("/opt/py/python.exe"), Some("npm"), Some("npx")).unwrap();
        assert_eq!(py.len(), 2);
        assert_eq!(py[0][..4], ["/opt/py/python.exe", "-m", "pip", "install"]);
        assert_eq!(py[1][1..], ["-m", "playwright", "install", "chromium"]);
        assert_eq!(
            display_step(&py[1]),
            "python.exe -m playwright install chromium"
        );

        let node = plan_install(None, Some("/usr/bin/npm"), Some("/usr/bin/npx")).unwrap();
        assert_eq!(node[0][1..], ["install", "-g", "playwright"]);
        assert_eq!(node[1][1..], ["playwright", "install", "chromium"]);

        assert!(plan_install(None, Some("npm"), None).is_none());
        assert!(plan_install(None, None, None).is_none());
    }

    #[test]
    fn which_finds_cargo_and_not_nonsense() {
        // `cargo test` tourne forcément avec cargo dans le PATH.
        assert!(which("cargo").is_some());
        assert!(which("relay-outil-inexistant-xyz").is_none());
    }

    #[tokio::test]
    async fn detects_known_tools_in_order() {
        let env = detect(None).await;
        eprintln!("{env:#?}");
        let names: Vec<&str> = env.tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, TOOL_ORDER);
        let cargo = env.tools.iter().find(|t| t.name == "cargo").unwrap();
        assert!(cargo.path.is_some());
        assert!(cargo.version.is_some(), "{cargo:?}");
        assert!(!env.os.is_empty());
    }

    #[tokio::test]
    async fn streams_lines_and_reports_the_exit_code() {
        let step: Vec<String> = if cfg!(windows) {
            ["cmd", "/c", "echo un& echo deux 1>&2& exit 3"]
        } else {
            ["sh", "-c", "echo un; echo deux 1>&2; exit 3"]
        }
        .into_iter()
        .map(String::from)
        .collect();
        let lines = std::sync::Mutex::new(Vec::new());
        let outcome = run_streaming(&step, CancellationToken::new(), &|e| {
            lines.lock().unwrap().push(e);
        })
        .await
        .unwrap();
        assert_eq!(outcome.exit_code, Some(3));
        assert!(!outcome.cancelled && !outcome.timed_out);
        let lines = lines.into_inner().unwrap();
        assert!(lines.contains(&InstallEvent::Line {
            text: "un".into(),
            stderr: false
        }));
        assert!(
            lines
                .iter()
                .any(|l| matches!(l, InstallEvent::Line { text, stderr: true } if text == "deux"))
        );
    }

    #[tokio::test]
    async fn install_refuses_without_python_or_node() {
        let env = Environment {
            os: "test".into(),
            shell: "sh".into(),
            tools: vec![],
            playwright: PlaywrightInfo::default(),
        };
        // `npx` peut exister sur le poste : sans `npm` ni `python`, le plan reste impossible.
        let result = install_playwright(&env, CancellationToken::new(), |_| {}).await;
        assert!(matches!(
            result,
            Err(AppError::Validation("playwright_no_runtime"))
        ));
    }
}
