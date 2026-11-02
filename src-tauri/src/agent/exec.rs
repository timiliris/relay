//! Exécution de commandes dans le dossier de travail : sortie diffusée au fil de l'eau et
//! plafonnée, délai, annulation, processus d'arrière-plan (serveur de dev, watcher) et registre
//! des processus lancés pendant la session.
//!
//! Chaque commande est enregistrée dans `ProcessRegistry` avec son PID, son heure de départ et
//! un tampon de sortie borné (les derniers `MAX_OUTPUT_BYTES` octets de chaque flux). Les
//! fragments de sortie et la fin du processus sont transmis au `sink` fourni par l'appelant
//! (`commands/agent.rs` les émet au webview principal). Tout processus encore vivant est tué
//! à la fermeture de l'application (`ProcessRegistry::kill_all`).

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::{AppError, AppResult};

/// Octets conservés par flux (les derniers ; au-delà, `truncated` est levé).
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024;
pub const MAX_TIMEOUT_SECS: u64 = 600;
/// Temps laissé à un processus d'arrière-plan pour produire ses premières lignes avant de
/// rendre la main au modèle.
pub const BACKGROUND_GRACE: Duration = Duration::from_secs(3);
/// Entrées conservées dans le registre (les plus anciennes terminées sont oubliées au-delà).
const MAX_ENTRIES: usize = 100;
/// Attente de la sortie restante après un arrêt forcé (un petit-enfant survivant peut garder
/// le tube ouvert).
const AFTER_KILL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Running,
    Done,
    Killed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

/// Fiche d'un processus lancé par l'agent (vivante ou terminée).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub id: String,
    pub pid: Option<u32>,
    pub command: String,
    pub cwd: String,
    /// Millisecondes depuis l'époque Unix.
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub status: ProcessStatus,
    pub exit_code: Option<i32>,
    pub background: bool,
    pub timed_out: bool,
}

/// Résultat de `run_command` : sortie complète (plafonnée) d'une commande au premier plan, ou
/// premières lignes d'un processus d'arrière-plan qui continue (`running`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub truncated: bool,
    pub pid: Option<u32>,
    pub started_at: u64,
    pub background: bool,
    pub running: bool,
}

/// Sortie accumulée d'un processus, relue à la demande (`read_process_output`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutput {
    pub info: ProcessInfo,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

/// Événement transmis au `sink` : fragment de sortie ou fin du processus.
#[derive(Debug, Clone, PartialEq)]
pub enum ProcessEvent {
    Output {
        id: String,
        stream: Stream,
        chunk: String,
    },
    Exit(ProcessInfo),
}

pub type Sink = Arc<dyn Fn(ProcessEvent) + Send + Sync>;

/// Tampon qui ne garde que les derniers `MAX_OUTPUT_BYTES` octets.
#[derive(Default)]
struct Tail {
    bytes: Vec<u8>,
    truncated: bool,
}

impl Tail {
    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > MAX_OUTPUT_BYTES {
            let excess = self.bytes.len() - MAX_OUTPUT_BYTES;
            self.bytes.drain(..excess);
            self.truncated = true;
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
}

struct Entry {
    info: ProcessInfo,
    stdout: Tail,
    stderr: Tail,
    cancel: CancellationToken,
    finished: watch::Receiver<bool>,
}

/// Registre partagé des processus de la session (état Tauri, cloné dans les tâches).
#[derive(Clone, Default)]
pub struct ProcessRegistry(Arc<Mutex<HashMap<String, Entry>>>);

impl ProcessRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&mut Entry) -> T) -> Option<T> {
        self.lock().get_mut(id).map(f)
    }

    /// Fiches de tous les processus connus, du plus ancien au plus récent.
    pub fn list(&self) -> Vec<ProcessInfo> {
        let mut all: Vec<ProcessInfo> = self.lock().values().map(|e| e.info.clone()).collect();
        all.sort_by_key(|p| (p.started_at, p.id.clone()));
        all
    }

    pub fn info(&self, id: &str) -> AppResult<ProcessInfo> {
        self.with(id, |e| e.info.clone()).ok_or_else(|| unknown(id))
    }

    /// Sortie accumulée (derniers 64 Ko par flux) et état courant.
    pub fn output(&self, id: &str) -> AppResult<ProcessOutput> {
        self.with(id, |e| ProcessOutput {
            info: e.info.clone(),
            stdout: e.stdout.text(),
            stderr: e.stderr.text(),
            truncated: e.stdout.truncated || e.stderr.truncated,
        })
        .ok_or_else(|| unknown(id))
    }

    /// Demande l'arrêt (arbre de processus tué) et attend la fin, cinq secondes au plus.
    pub async fn stop(&self, id: &str) -> AppResult<ProcessInfo> {
        let (cancel, finished) = self
            .with(id, |e| (e.cancel.clone(), e.finished.clone()))
            .ok_or_else(|| unknown(id))?;
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(5), wait_finished(finished)).await;
        self.info(id)
    }

    /// Attend la fin du processus (sans limite : l'appelant borne l'attente).
    pub async fn wait(&self, id: &str) -> AppResult<()> {
        let finished = self
            .with(id, |e| e.finished.clone())
            .ok_or_else(|| unknown(id))?;
        wait_finished(finished).await;
        Ok(())
    }

    /// Tue tout ce qui tourne encore, de façon bloquante (fermeture de l'application).
    pub fn kill_all(&self) {
        let pids: Vec<(String, Option<u32>)> = self
            .lock()
            .values_mut()
            .filter(|e| e.info.status == ProcessStatus::Running)
            .map(|e| {
                e.cancel.cancel();
                (e.info.id.clone(), e.info.pid)
            })
            .collect();
        for (id, pid) in pids {
            log::info!("arrêt du processus {id} (pid {pid:?}) à la fermeture");
            if let Some(pid) = pid {
                kill_tree_blocking(pid);
            }
        }
    }

    fn insert(&self, entry: Entry) {
        let mut map = self.lock();
        if map.len() >= MAX_ENTRIES {
            let mut finished: Vec<(u64, String)> = map
                .values()
                .filter(|e| e.info.status != ProcessStatus::Running)
                .map(|e| (e.info.started_at, e.info.id.clone()))
                .collect();
            finished.sort();
            for (_, id) in finished.into_iter().take(map.len() + 1 - MAX_ENTRIES) {
                map.remove(&id);
            }
        }
        map.insert(entry.info.id.clone(), entry);
    }

    fn append(&self, id: &str, stream: Stream, chunk: &[u8]) {
        self.with(id, |e| match stream {
            Stream::Stdout => e.stdout.push(chunk),
            Stream::Stderr => e.stderr.push(chunk),
        });
    }

    fn finish(&self, id: &str, exit_code: Option<i32>, timed_out: bool) -> Option<ProcessInfo> {
        self.with(id, |e| {
            e.info.status = if exit_code.is_some() {
                ProcessStatus::Done
            } else {
                ProcessStatus::Killed
            };
            e.info.exit_code = exit_code;
            e.info.timed_out = timed_out;
            e.info.ended_at = Some(now_ms());
            e.info.clone()
        })
    }
}

fn unknown(id: &str) -> AppError {
    AppError::Tool(format!("unknown process id \"{id}\""))
}

async fn wait_finished(mut finished: watch::Receiver<bool>) {
    let _ = finished.wait_for(|done| *done).await;
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Paramètres d'un lancement.
pub struct Spawn<'a> {
    pub id: &'a str,
    pub cwd: &'a Path,
    pub command: &'a str,
    /// Délai au premier plan (ignoré en arrière-plan), borné à `MAX_TIMEOUT_SECS`.
    pub timeout_secs: u64,
    pub background: bool,
    pub cancel: CancellationToken,
}

/// Shell du système : PowerShell sous Windows, `sh` ailleurs. Aucune variable n'est ajoutée à
/// l'environnement hérité (la clé API vit dans le trousseau, jamais dans l'environnement).
fn shell_command(command: &str, cwd: &Path) -> Command {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-lc", command]);
        c
    };
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Unix : groupe de processus dédié, pour tuer aussi les enfants du shell (`sleep`, `node`…).
    #[cfg(unix)]
    cmd.process_group(0);
    cmd
}

/// Longueur du préfixe UTF-8 complet de `bytes` (une séquence coupée en fin de fragment est
/// gardée pour le fragment suivant plutôt que remplacée par `U+FFFD`).
fn utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(err) if err.error_len().is_none() => err.valid_up_to(),
        Err(_) => bytes.len(),
    }
}

/// Lit un flux jusqu'au bout : chaque fragment est ajouté au registre et transmis au `sink`.
async fn pump(
    mut reader: impl AsyncReadExt + Unpin,
    registry: ProcessRegistry,
    id: String,
    stream: Stream,
    sink: Sink,
) {
    let mut buf = [0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                let ready = utf8_prefix_len(&pending);
                if ready == 0 {
                    continue;
                }
                let chunk: Vec<u8> = pending.drain(..ready).collect();
                registry.append(&id, stream, &chunk);
                sink(ProcessEvent::Output {
                    id: id.clone(),
                    stream,
                    chunk: String::from_utf8_lossy(&chunk).into_owned(),
                });
            }
        }
    }
    if !pending.is_empty() {
        registry.append(&id, stream, &pending);
        sink(ProcessEvent::Output {
            id,
            stream,
            chunk: String::from_utf8_lossy(&pending).into_owned(),
        });
    }
}

fn kill_tree_blocking(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Arrêt forcé du processus et de ses enfants (partagé avec `env.rs`).
pub(crate) async fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        let _ = tokio::task::spawn_blocking(move || kill_tree_blocking(pid)).await;
    }
    let _ = child.kill().await;
}

/// Attend les lecteurs de sortie ; après un arrêt forcé, deux secondes au plus.
async fn drain_readers(readers: Vec<tokio::task::JoinHandle<()>>, killed: bool) {
    let wait = if killed {
        AFTER_KILL
    } else {
        Duration::from_secs(MAX_TIMEOUT_SECS)
    };
    for mut task in readers {
        if tokio::time::timeout(wait, &mut task).await.is_err() {
            task.abort();
        }
    }
}

/// Lance la commande, l'enregistre et surveille sa fin dans une tâche dédiée.
/// Renvoie dès que le processus est parti ; `started_at` et `pid` sont alors connus.
pub fn spawn(registry: &ProcessRegistry, opts: Spawn<'_>, sink: Sink) -> AppResult<ProcessInfo> {
    let mut child = shell_command(opts.command, opts.cwd).spawn()?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let id = opts.id.to_string();
    let info = ProcessInfo {
        id: id.clone(),
        pid: child.id(),
        command: opts.command.to_string(),
        cwd: opts.cwd.to_string_lossy().into_owned(),
        started_at: now_ms(),
        ended_at: None,
        status: ProcessStatus::Running,
        exit_code: None,
        background: opts.background,
        timed_out: false,
    };
    let (done_tx, done_rx) = watch::channel(false);
    registry.insert(Entry {
        info: info.clone(),
        stdout: Tail::default(),
        stderr: Tail::default(),
        cancel: opts.cancel.clone(),
        finished: done_rx,
    });
    let readers = vec![
        tokio::spawn(pump(
            stdout,
            registry.clone(),
            id.clone(),
            Stream::Stdout,
            sink.clone(),
        )),
        tokio::spawn(pump(
            stderr,
            registry.clone(),
            id.clone(),
            Stream::Stderr,
            sink.clone(),
        )),
    ];
    let timeout = if opts.background {
        None
    } else {
        Some(Duration::from_secs(
            opts.timeout_secs.clamp(1, MAX_TIMEOUT_SECS),
        ))
    };
    let cancel = opts.cancel;
    let registry = registry.clone();
    tokio::spawn(async move {
        let (status, timed_out) = tokio::select! {
            status = child.wait() => (status.ok().and_then(|s| s.code()), false),
            _ = sleep_or_forever(timeout) => {
                kill_tree(&mut child).await;
                (None, true)
            }
            _ = cancel.cancelled() => {
                kill_tree(&mut child).await;
                (None, false)
            }
        };
        drain_readers(readers, status.is_none()).await;
        if let Some(info) = registry.finish(&id, status, timed_out) {
            sink(ProcessEvent::Exit(info));
        }
        let _ = done_tx.send(true);
    });
    Ok(info)
}

async fn sleep_or_forever(timeout: Option<Duration>) {
    match timeout {
        Some(d) => tokio::time::sleep(d).await,
        None => std::future::pending::<()>().await,
    }
}

/// Exécute une commande : au premier plan, attend sa fin (délai, annulation) ; en arrière-plan,
/// rend la main après `BACKGROUND_GRACE` (ou dès la fin si elle survient avant) avec le PID et
/// les premières lignes, le processus continuant dans le registre.
pub async fn run_command(
    registry: &ProcessRegistry,
    opts: Spawn<'_>,
    sink: Sink,
) -> AppResult<CommandOutput> {
    let started = Instant::now();
    let background = opts.background;
    let info = spawn(registry, opts, sink)?;
    let id = info.id.clone();
    if background {
        let _ = tokio::time::timeout(BACKGROUND_GRACE, registry.wait(&id)).await;
    } else {
        registry.wait(&id).await?;
    }
    let out = registry.output(&id)?;
    Ok(CommandOutput {
        exit_code: out.info.exit_code,
        stdout: out.stdout,
        stderr: out.stderr,
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out: out.info.timed_out,
        truncated: out.truncated,
        pid: out.info.pid,
        started_at: out.info.started_at,
        background,
        running: out.info.status == ProcessStatus::Running,
    })
}

#[cfg(test)]
mod tests {
    use super::super::testing::TempDir;
    use super::*;

    fn collecting() -> (Sink, Arc<Mutex<Vec<ProcessEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let sink: Sink = Arc::new(move |event| seen.lock().unwrap().push(event));
        (sink, events)
    }

    fn opts<'a>(id: &'a str, cwd: &'a Path, command: &'a str, timeout: u64) -> Spawn<'a> {
        Spawn {
            id,
            cwd,
            command,
            timeout_secs: timeout,
            background: false,
            cancel: CancellationToken::new(),
        }
    }

    fn sleep_cmd() -> &'static str {
        if cfg!(windows) {
            "Start-Sleep -Seconds 20"
        } else {
            "sleep 20"
        }
    }

    #[tokio::test]
    async fn runs_a_command_and_captures_its_output() {
        let dir = TempDir::new("exec-ok");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        let out = run_command(&registry, opts("p1", &dir.0, "echo bonjour", 10), sink)
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(out.stdout.contains("bonjour"), "{out:?}");
        assert!(!out.timed_out && !out.truncated && !out.running && !out.background);
        assert!(out.pid.is_some());
        assert!(out.started_at > 0);
        let info = registry.info("p1").unwrap();
        assert_eq!(info.status, ProcessStatus::Done);
        assert!(info.ended_at.is_some());
    }

    #[tokio::test]
    async fn reports_a_failing_exit_code() {
        let dir = TempDir::new("exec-fail");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        let out = run_command(&registry, opts("p1", &dir.0, "exit 3", 10), sink)
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(3));
    }

    #[tokio::test]
    async fn streams_output_chunks_then_signals_exit() {
        let dir = TempDir::new("exec-stream");
        let registry = ProcessRegistry::default();
        let (sink, events) = collecting();
        let command = if cfg!(windows) {
            "echo un; Start-Sleep -Milliseconds 300; echo deux; [Console]::Error.WriteLine('err')"
        } else {
            "echo un; sleep 0.3; echo deux; echo err 1>&2"
        };
        let out = run_command(&registry, opts("p1", &dir.0, command, 10), sink)
            .await
            .unwrap();
        assert!(
            out.stdout.contains("un") && out.stdout.contains("deux"),
            "{out:?}"
        );
        assert!(out.stderr.contains("err"), "{out:?}");

        let events = events.lock().unwrap();
        let outputs: Vec<(Stream, String)> = events
            .iter()
            .filter_map(|e| match e {
                ProcessEvent::Output { stream, chunk, .. } => Some((*stream, chunk.clone())),
                ProcessEvent::Exit(_) => None,
            })
            .collect();
        let stdout_chunks = outputs.iter().filter(|(s, _)| *s == Stream::Stdout).count();
        assert!(
            stdout_chunks >= 2,
            "sortie diffusée en plusieurs fragments : {outputs:?}"
        );
        assert!(
            outputs
                .iter()
                .any(|(s, c)| *s == Stream::Stderr && c.contains("err"))
        );
        assert!(matches!(
            events.last(),
            Some(ProcessEvent::Exit(info)) if info.status == ProcessStatus::Done && info.exit_code == Some(0)
        ));
    }

    #[tokio::test]
    async fn kills_the_command_after_the_timeout() {
        let dir = TempDir::new("exec-timeout");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        let out = run_command(&registry, opts("p1", &dir.0, sleep_cmd(), 1), sink)
            .await
            .unwrap();
        assert!(out.timed_out);
        assert!(out.duration_ms < 15_000, "{}", out.duration_ms);
        assert_eq!(registry.info("p1").unwrap().status, ProcessStatus::Killed);
    }

    #[tokio::test]
    async fn stops_when_cancelled() {
        let dir = TempDir::new("exec-cancel");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        let cancel = CancellationToken::new();
        let canceller = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            canceller.cancel();
        });
        let mut o = opts("p1", &dir.0, sleep_cmd(), 30);
        o.cancel = cancel;
        let out = run_command(&registry, o, sink).await.unwrap();
        assert!(!out.timed_out);
        assert!(out.exit_code.is_none());
        assert!(out.duration_ms < 15_000, "{}", out.duration_ms);
    }

    #[tokio::test]
    async fn background_returns_early_then_stops_on_request() {
        let dir = TempDir::new("exec-background");
        let registry = ProcessRegistry::default();
        let (sink, events) = collecting();
        let command = if cfg!(windows) {
            "echo ready; Start-Sleep -Seconds 20"
        } else {
            "echo ready; sleep 20"
        };
        let mut o = opts("bg", &dir.0, command, 600);
        o.background = true;
        let started = Instant::now();
        let out = run_command(&registry, o, sink).await.unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "{:?}",
            started.elapsed()
        );
        assert!(out.running && out.background, "{out:?}");
        assert!(out.pid.is_some());
        assert!(out.exit_code.is_none());
        assert!(out.stdout.contains("ready"), "{out:?}");
        assert_eq!(registry.info("bg").unwrap().status, ProcessStatus::Running);
        assert_eq!(registry.list().len(), 1);
        assert!(registry.output("bg").unwrap().stdout.contains("ready"));

        let info = registry.stop("bg").await.unwrap();
        assert_eq!(info.status, ProcessStatus::Killed);
        assert!(info.ended_at.is_some());
        assert!(matches!(
            events.lock().unwrap().last(),
            Some(ProcessEvent::Exit(i)) if i.status == ProcessStatus::Killed
        ));
        assert!(registry.stop("absent").await.is_err());
    }

    #[tokio::test]
    async fn kill_all_terminates_background_processes() {
        let dir = TempDir::new("exec-kill-all");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        let mut o = opts("bg", &dir.0, sleep_cmd(), 600);
        o.background = true;
        let out = run_command(&registry, o, sink).await.unwrap();
        assert!(out.running);
        registry.kill_all();
        tokio::time::timeout(Duration::from_secs(10), registry.wait("bg"))
            .await
            .expect("le processus doit se terminer")
            .unwrap();
        assert_eq!(registry.info("bg").unwrap().status, ProcessStatus::Killed);
        assert!(
            registry
                .list()
                .iter()
                .all(|p| p.status != ProcessStatus::Running)
        );
    }

    #[tokio::test]
    async fn keeps_only_the_tail_of_a_long_output() {
        let dir = TempDir::new("exec-tail");
        let registry = ProcessRegistry::default();
        let (sink, _) = collecting();
        // ~100 Ko : 2000 lignes de 50 caractères.
        let command = if cfg!(windows) {
            "1..2000 | ForEach-Object { 'x' * 48 + $_ }"
        } else {
            "i=0; while [ $i -lt 2000 ]; do printf '%048dEND\\n' $i; i=$((i+1)); done"
        };
        let out = run_command(&registry, opts("p1", &dir.0, command, 30), sink)
            .await
            .unwrap();
        assert!(out.truncated);
        assert!(out.stdout.len() <= MAX_OUTPUT_BYTES);
        assert!(out.stdout.contains("1999"), "la fin est conservée");
    }

    #[test]
    fn tail_drops_the_oldest_bytes() {
        let mut tail = Tail::default();
        tail.push(&vec![b'a'; MAX_OUTPUT_BYTES]);
        assert!(!tail.truncated);
        tail.push(b"bcd");
        assert!(tail.truncated);
        assert_eq!(tail.bytes.len(), MAX_OUTPUT_BYTES);
        assert!(tail.text().ends_with("bcd"));
    }

    #[test]
    fn utf8_prefix_keeps_incomplete_sequences_for_later() {
        let text = "é".as_bytes();
        assert_eq!(utf8_prefix_len(&text[..1]), 0);
        assert_eq!(utf8_prefix_len(text), 2);
        assert_eq!(utf8_prefix_len(b"ab\xff"), 3);
    }
}
