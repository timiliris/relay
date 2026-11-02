//! Exécution d'une commande dans le dossier de travail : sortie plafonnée, délai, annulation.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

use crate::AppResult;

const MAX_OUTPUT_BYTES: usize = 64 * 1024;
pub const MAX_TIMEOUT_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub truncated: bool,
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
    cmd
}

/// Lit un flux jusqu'au bout en ne conservant que les `MAX_OUTPUT_BYTES` premiers octets.
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

async fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    let _ = child.kill().await;
}

pub async fn run_command(
    cwd: &Path,
    command: &str,
    timeout_secs: u64,
    cancel: CancellationToken,
) -> AppResult<CommandOutput> {
    let started = Instant::now();
    let mut child = shell_command(command, cwd).spawn()?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_task = tokio::spawn(drain(stdout));
    let err_task = tokio::spawn(drain(stderr));
    let timeout = Duration::from_secs(timeout_secs.clamp(1, MAX_TIMEOUT_SECS));

    let (status, timed_out) = tokio::select! {
        status = child.wait() => (status?.code(), false),
        _ = tokio::time::sleep(timeout) => {
            kill_tree(&mut child).await;
            (None, true)
        }
        _ = cancel.cancelled() => {
            kill_tree(&mut child).await;
            (None, false)
        }
    };
    let (stdout, out_trunc) = out_task.await.unwrap_or_default();
    let (stderr, err_trunc) = err_task.await.unwrap_or_default();
    Ok(CommandOutput {
        exit_code: status,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out,
        truncated: out_trunc || err_trunc,
    })
}

#[cfg(test)]
mod tests {
    use super::super::testing::TempDir;
    use super::*;

    #[tokio::test]
    async fn runs_a_command_and_captures_its_output() {
        let dir = TempDir::new("exec-ok");
        let out = run_command(&dir.0, "echo bonjour", 10, CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(out.stdout.contains("bonjour"), "{out:?}");
        assert!(!out.timed_out && !out.truncated);
    }

    #[tokio::test]
    async fn reports_a_failing_exit_code() {
        let dir = TempDir::new("exec-fail");
        let out = run_command(&dir.0, "exit 3", 10, CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(3));
    }

    #[tokio::test]
    async fn kills_the_command_after_the_timeout() {
        let dir = TempDir::new("exec-timeout");
        let sleep = if cfg!(windows) {
            "Start-Sleep -Seconds 20"
        } else {
            "sleep 20"
        };
        let out = run_command(&dir.0, sleep, 1, CancellationToken::new())
            .await
            .unwrap();
        assert!(out.timed_out);
        assert!(out.duration_ms < 15_000, "{}", out.duration_ms);
    }

    #[tokio::test]
    async fn stops_when_cancelled() {
        let dir = TempDir::new("exec-cancel");
        let sleep = if cfg!(windows) {
            "Start-Sleep -Seconds 20"
        } else {
            "sleep 20"
        };
        let cancel = CancellationToken::new();
        let canceller = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            canceller.cancel();
        });
        let out = run_command(&dir.0, sleep, 30, cancel).await.unwrap();
        assert!(!out.timed_out);
        assert!(out.exit_code.is_none());
        assert!(out.duration_ms < 15_000, "{}", out.duration_ms);
    }
}
