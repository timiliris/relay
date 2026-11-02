//! Navigateur intégré : une page web affichée **dans la fenêtre principale**.
//!
//! Voie retenue : le webview enfant de Tauri 2 (`Window::add_child`, feature `unstable` de la
//! crate `tauri`). Le frontend mesure la zone de contenu du volet « Navigateur » et envoie sa
//! position et sa taille (pixels logiques, relatifs à la zone cliente de la fenêtre) ; Rust place
//! le webview `browser` dans ce rectangle et le suit à chaque redimensionnement.
//!
//! Effet de bord de la feature `unstable` : le webview principal est lui aussi créé en mode
//! « enfant » par `tauri-runtime-wry`. Sous Windows, le gestionnaire de redimensionnement des
//! fenêtres sans décorations n'est alors plus attaché à la création : `setup` le rétablit.
//!
//! Sécurité : `http(s)` est accepté (y compris `localhost`, puisque l'utilisateur voit la page),
//! ainsi que `file://` pour les fichiers d'un dossier de travail enregistré (`WorkspaceState`),
//! afin que l'agent puisse tester un site qu'il vient d'écrire. Tout le reste (`tauri://`,
//! `ipc:`, `javascript:`, fichiers hors dossier…) est refusé avant navigation et dans
//! `on_navigation`. Le webview `browser` n'apparaît dans aucune capacité
//! (`capabilities/default.json` ne vise que `main`) : les pages chargées n'ont aucun accès IPC.
//!
//! Outils de l'agent : `eval` exécute un script dans la page et renvoie sa valeur par le
//! mécanisme natif de chaque plateforme (`ExecuteScript` de WebView2, `evaluateJavaScript` de
//! WKWebView, `evaluate_javascript` de WebKitGTK) ; `wait_load` attend la fin du chargement grâce
//! aux événements `on_page_load`. Un script d'initialisation collecte les erreurs de console de
//! chaque page (`window.__relayLog`) pour que le modèle puisse les lire.

use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl,
};
use tokio::sync::{oneshot, watch};

use crate::agent::WorkspaceState;
use crate::{AppError, AppResult};

/// Libellé du webview enfant.
pub const LABEL: &str = "browser";
/// Fenêtre (et webview) principale qui héberge le navigateur et reçoit ses événements.
pub const MAIN: &str = "main";
/// Événement émis vers `main` à chaque changement de page ou de titre.
pub const NAVIGATED_EVENT: &str = "browser://navigated";

/// Délai par défaut et plafond d'un script (`eval`) et d'une attente de chargement.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_TIMEOUT: Duration = Duration::from_secs(120);
/// Taille maximale d'un script envoyé à la page.
pub const MAX_SCRIPT_BYTES: usize = 512 * 1024;
/// Taille maximale du JSON renvoyé par la page au modèle (au-delà : coupé, `truncated`).
pub const MAX_RESULT_CHARS: usize = 200_000;
/// Période de relance d'un script asynchrone (promesse en attente).
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Dernière URL connue du webview `browser` (mise à jour au début de chaque chargement).
static CURRENT_URL: Mutex<String> = Mutex::new(String::new());

/// État de chargement observé par `wait_load` : la génération change à chaque navigation.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct LoadState {
    pub generation: u64,
    pub loading: bool,
}

static LOAD: LazyLock<watch::Sender<LoadState>> =
    LazyLock::new(|| watch::channel(LoadState::default()).0);

/// Script injecté dans chaque page : journal des erreurs et avertissements de console, lu par
/// l'outil `browser_read` du modèle (`window.__relayLog`, 50 entrées au plus).
pub const INIT_SCRIPT: &str = r#"(() => {
  if (window.__relayLog) return;
  const log = (window.__relayLog = []);
  const push = (level, message) => {
    if (log.length >= 50) log.shift();
    log.push({ level, message: String(message).slice(0, 500) });
  };
  window.addEventListener('error', (e) =>
    push('error', e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')),
  );
  window.addEventListener('unhandledrejection', (e) =>
    push('error', 'Unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason)),
  );
  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = function (...args) {
      push(
        level,
        args
          .map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.message;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(' '),
      );
      return original.apply(this, args);
    };
  }
})();"#;

/// Rectangle en pixels logiques, relatif au coin supérieur gauche de la zone cliente.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    /// Un webview de taille nulle est refusé par certaines plateformes : 1 px minimum.
    fn clamped(self) -> Self {
        Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
        }
    }
}

/// Charge utile de `browser://navigated` ; `title` est `null` tant que la page ne l'a pas fourni.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Navigated {
    pub url: String,
    pub title: Option<String>,
}

/// Résultat d'un script exécuté dans la page (`eval`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalOutcome {
    /// `false` si le script a levé une exception (ou une promesse rejetée) ; `json` la décrit.
    pub ok: bool,
    /// Valeur sérialisée en JSON par la page (texte JSON, pas re-parsé).
    pub json: String,
    /// `true` si la page a dû couper la valeur sérialisée.
    pub truncated: bool,
}

/// Résultat de `wait_load`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    /// `false` si le délai est écoulé avant la fin du chargement (ou sans webview).
    pub loaded: bool,
    pub url: String,
}

/// Analyse une URL destinée au navigateur : `http(s)` avec un hôte, ou `file://` sous l'un des
/// dossiers de travail `roots`. `AppError::Tool` porte un message lisible pour le modèle.
pub fn parse_url(input: &str, roots: &[PathBuf]) -> AppResult<Url> {
    let input = input.trim();
    let url = Url::parse(input)
        .map_err(|_| AppError::Tool(format!("Invalid URL `{input}`: expected an absolute URL.")))?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(url),
        "http" | "https" => Err(AppError::Tool(format!("The URL `{input}` has no host."))),
        "file" => {
            let path = url.to_file_path().map_err(|_| {
                AppError::Tool(format!("`{input}` is not a valid local file path."))
            })?;
            let real = dunce::canonicalize(&path)
                .map_err(|_| AppError::Tool(format!("File not found: `{}`.", path.display())))?;
            if !roots.iter().any(|root| real.starts_with(root)) {
                return Err(AppError::Tool(format!(
                    "`{}` is outside the workspace: only workspace files can be opened.",
                    path.display()
                )));
            }
            Url::from_file_path(&real)
                .map_err(|_| AppError::Tool(format!("`{input}` is not a valid local file path.")))
        }
        other => Err(AppError::Tool(format!(
            "Only http(s) URLs and workspace files (file://) can be opened (got `{other}:`)."
        ))),
    }
}

/// Schémas que le webview peut suivre de lui-même (liens, redirections) : `http(s)`, `about`,
/// et `file` tant que le fichier reste dans un dossier de travail enregistré.
fn is_allowed(url: &Url, workspaces: &WorkspaceState) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "about" => true,
        "file" => url
            .to_file_path()
            .ok()
            .and_then(|p| dunce::canonicalize(p).ok())
            .is_some_and(|real| workspaces.contains(&real)),
        _ => false,
    }
}

/// Correctif Windows décrit en tête de module : réattache le redimensionnement par les bords.
pub fn setup<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(windows)]
    if let Some(window) = app.get_window(MAIN)
        && let Err(err) = window.set_resizable(true)
    {
        log::warn!("redimensionnement de la fenêtre principale : {err}");
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn webview<R: Runtime>(app: &AppHandle<R>) -> AppResult<Webview<R>> {
    app.get_webview(LABEL)
        .ok_or(AppError::Validation("browser_closed"))
}

fn emit<R: Runtime>(app: &AppHandle<R>, url: String, title: Option<String>) {
    if let Err(err) = app.emit_to(MAIN, NAVIGATED_EVENT, Navigated { url, title }) {
        log::warn!("événement {NAVIGATED_EVENT} : {err}");
    }
}

/// Nouvelle navigation demandée ou commencée : la génération avance et la page est « en charge ».
fn mark_loading() {
    LOAD.send_modify(|s| {
        s.generation = s.generation.wrapping_add(1);
        s.loading = true;
    });
}

fn mark_loaded() {
    LOAD.send_modify(|s| s.loading = false);
}

#[cfg(test)]
fn load_state() -> LoadState {
    *LOAD.borrow()
}

fn remember(url: &Url) {
    *CURRENT_URL.lock().unwrap_or_else(|e| e.into_inner()) = url.to_string();
    mark_loading();
}

pub fn current_url() -> String {
    CURRENT_URL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// Ouvre le navigateur sur `url` : crée le webview enfant s'il n'existe pas, sinon y navigue.
///
/// `add_child` attend le fil principal : sous Windows il bloquerait une commande synchrone
/// (voir la documentation de Tauri), d'où l'exécution dans `spawn_blocking`.
pub async fn open<R: Runtime>(
    app: &AppHandle<R>,
    url: Url,
    bounds: Option<Bounds>,
) -> AppResult<()> {
    if let Ok(existing) = webview(app) {
        if let Some(bounds) = bounds {
            set_bounds(app, bounds)?;
        }
        remember(&url);
        existing.navigate(url)?;
        existing.show()?;
        return Ok(());
    }

    let window = app
        .get_window(MAIN)
        .ok_or(AppError::Validation("browser_window_missing"))?;
    remember(&url);

    let on_navigation = app.clone();
    let on_new_window = app.clone();
    let on_page_load = app.clone();
    let on_title = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |url| is_allowed(url, &on_navigation.state::<WorkspaceState>()))
        // `target="_blank"` : la page s'ouvre dans le même webview plutôt qu'une nouvelle fenêtre.
        .on_new_window(move |url, _| {
            if is_allowed(&url, &on_new_window.state::<WorkspaceState>())
                && let Some(webview) = on_new_window.get_webview(LABEL)
            {
                remember(&url);
                if let Err(err) = webview.navigate(url) {
                    log::warn!("navigation depuis window.open : {err}");
                }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| match payload.event() {
            PageLoadEvent::Started => {
                remember(payload.url());
                emit(&on_page_load, payload.url().to_string(), None);
            }
            PageLoadEvent::Finished => mark_loaded(),
        })
        .on_document_title_changed(move |_, title| emit(&on_title, current_url(), Some(title)))
        .zoom_hotkeys_enabled(true);

    let bounds = bounds
        .unwrap_or(Bounds {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        })
        .clamped();
    tokio::task::spawn_blocking(move || {
        window.add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))??;
    Ok(())
}

pub fn navigate<R: Runtime>(app: &AppHandle<R>, url: Url) -> AppResult<()> {
    let webview = webview(app)?;
    remember(&url);
    webview.navigate(url)?;
    Ok(())
}

pub fn back<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    webview(app)?.eval("history.back()")?;
    Ok(())
}

pub fn forward<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    webview(app)?.eval("history.forward()")?;
    Ok(())
}

pub fn reload<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let webview = webview(app)?;
    mark_loading();
    webview.reload()?;
    Ok(())
}

/// Déplace et redimensionne le webview (appelé par le frontend à chaque `ResizeObserver`).
pub fn set_bounds<R: Runtime>(app: &AppHandle<R>, bounds: Bounds) -> AppResult<()> {
    let webview = webview(app)?;
    let bounds = bounds.clamped();
    webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
    webview.set_size(LogicalSize::new(bounds.width, bounds.height))?;
    Ok(())
}

/// Ferme le webview ; sans effet s'il n'existe pas.
pub fn close<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.close()?;
    }
    mark_loaded();
    Ok(())
}

/// Borne un délai demandé par le frontend (millisecondes) entre 1 s et `MAX_TIMEOUT`.
pub fn clamp_timeout(ms: Option<u64>) -> Duration {
    ms.map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT)
        .clamp(Duration::from_secs(1), MAX_TIMEOUT)
}

/// Attend la fin du chargement de la page courante, au plus `timeout`.
///
/// `settle` : après une action qui *peut* déclencher une navigation (clic, envoi de formulaire),
/// on laisse ce délai au webview pour la commencer avant de conclure qu'il ne se passe rien.
pub async fn wait_load<R: Runtime>(
    app: &AppHandle<R>,
    timeout: Duration,
    settle: Duration,
) -> Loaded {
    let deadline = Instant::now() + timeout;
    let mut rx = LOAD.subscribe();
    let start = *rx.borrow();
    if !settle.is_zero() && !start.loading {
        let _ = tokio::time::timeout(
            settle,
            rx.wait_for(|s| s.generation != start.generation || s.loading),
        )
        .await;
    }
    loop {
        let state = *rx.borrow_and_update();
        if app.get_webview(LABEL).is_some() && !state.loading {
            return Loaded {
                loaded: true,
                url: current_url(),
            };
        }
        if Instant::now() >= deadline {
            return Loaded {
                loaded: false,
                url: current_url(),
            };
        }
        // Un changement d'état réveille l'attente ; sinon on revérifie l'existence du webview.
        let _ = tokio::time::timeout(Duration::from_millis(100), rx.changed()).await;
    }
}

/// Enveloppe d'exécution : évalue `src` comme la console (valeur de la dernière expression),
/// attend une éventuelle promesse, sérialise le résultat avec un plafond de taille et le range
/// dans `window.__relay.evals[id]` pour que Rust puisse le relire si la promesse est en attente.
pub fn eval_wrapper(id: &str, src: &str, max_chars: usize) -> String {
    let id = serde_json::to_string(id).unwrap_or_default();
    let src = serde_json::to_string(src).unwrap_or_default();
    format!(
        r#"(() => {{
  const relay = (window.__relay = window.__relay || {{ evals: {{}} }});
  const id = {id};
  const max = {max_chars};
  const serialize = (value) => {{
    const seen = new WeakSet();
    const replacer = (_key, v) => {{
      if (typeof v === 'bigint') return String(v) + 'n';
      if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
      if (typeof v === 'symbol') return String(v);
      if (v instanceof Error) return {{ name: v.name, message: v.message, stack: v.stack }};
      if (typeof Node !== 'undefined' && v instanceof Node) {{
        return v.nodeType === 1 ? v.outerHTML.slice(0, 500) : v.nodeName;
      }}
      if (v && typeof v === 'object') {{
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
        if (v instanceof Map) return Object.fromEntries(v);
        if (v instanceof Set) return [...v];
        if (typeof NodeList !== 'undefined' && (v instanceof NodeList || v instanceof HTMLCollection)) {{
          return [...v];
        }}
      }}
      return v;
    }};
    let text;
    try {{
      text = JSON.stringify(value === undefined ? null : value, replacer);
    }} catch (e) {{
      text = JSON.stringify(String(value));
    }}
    if (text === undefined) text = 'null';
    const truncated = text.length > max;
    return {{ json: truncated ? text.slice(0, max) : text, truncated }};
  }};
  const finish = (ok, value) => {{
    relay.evals[id] = {{ state: 'done', ok, ...serialize(value) }};
  }};
  try {{
    const value = (0, eval)({src});
    if (value && typeof value.then === 'function') {{
      relay.evals[id] = {{ state: 'pending' }};
      Promise.resolve(value).then((r) => finish(true, r), (e) => finish(false, e));
    }} else {{
      finish(true, value);
    }}
  }} catch (e) {{
    finish(false, e);
  }}
  return relay.evals[id];
}})()"#
    )
}

/// Relit (et efface si terminé) le résultat d'un script asynchrone.
fn poll_script(id: &str) -> String {
    let id = serde_json::to_string(id).unwrap_or_default();
    format!(
        r#"(() => {{
  const evals = window.__relay && window.__relay.evals;
  const entry = evals && evals[{id}];
  if (!entry) return {{ state: 'lost' }};
  if (entry.state === 'done') delete evals[{id}];
  return entry;
}})()"#
    )
}

/// État rangé par l'enveloppe, tel que la plateforme nous le renvoie (JSON).
#[derive(Debug, Deserialize)]
struct EvalEntry {
    state: String,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    json: String,
    #[serde(default)]
    truncated: bool,
}

/// Interprète la chaîne JSON rendue par la plateforme pour un script d'évaluation.
fn parse_entry(raw: &str) -> AppResult<EvalEntry> {
    let raw = raw.trim();
    if raw.is_empty() || raw == "null" {
        return Err(AppError::Tool(
            "The page did not return a result (script blocked or page unloaded).".into(),
        ));
    }
    serde_json::from_str::<EvalEntry>(raw)
        .map_err(|e| AppError::Tool(format!("Unreadable script result: {e}")))
}

/// Coupe un JSON trop long en le gardant parseable comme chaîne : la page tronque déjà, ceci ne
/// sert qu'en garde-fou contre une page qui aurait remplacé l'enveloppe.
pub fn cap_json(json: String, max_chars: usize) -> (String, bool) {
    if json.chars().count() <= max_chars {
        return (json, false);
    }
    let cut: String = json.chars().take(max_chars).collect();
    (cut, true)
}

/// Exécute `script` dans la page courante et renvoie sa valeur sérialisée en JSON.
///
/// Une exception ou une promesse rejetée donne `ok: false` avec l'erreur dans `json` ; un script
/// qui ne répond pas dans `timeout` (page bloquée, promesse jamais résolue) est une erreur.
pub async fn eval<R: Runtime>(
    app: &AppHandle<R>,
    script: &str,
    timeout: Duration,
) -> AppResult<EvalOutcome> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err(AppError::Tool(format!(
            "Script too large ({} bytes, limit {MAX_SCRIPT_BYTES}).",
            script.len()
        )));
    }
    let deadline = Instant::now() + timeout;
    let id = format!(
        "{}-{:x}",
        EVAL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        rand_u64()
    );
    let raw = run_script(app, eval_wrapper(&id, script, MAX_RESULT_CHARS), deadline).await?;
    let mut entry = parse_entry(&raw)?;
    while entry.state == "pending" {
        if Instant::now() >= deadline {
            return Err(AppError::Tool(format!(
                "Script timed out after {} s (promise still pending).",
                timeout.as_secs()
            )));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
        entry = parse_entry(&run_script(app, poll_script(&id), deadline).await?)?;
    }
    if entry.state != "done" {
        return Err(AppError::Tool(
            "The page navigated away before the script finished.".into(),
        ));
    }
    let (json, cut) = cap_json(entry.json, MAX_RESULT_CHARS);
    Ok(EvalOutcome {
        ok: entry.ok,
        json,
        truncated: entry.truncated || cut,
    })
}

static EVAL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Pseudo-aléa suffisant pour un identifiant de script (pas de crate `rand` dans l'arbre).
fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, RandomState};
    RandomState::new().hash_one(Instant::now())
}

/// Lance `script` sur le fil principal et attend sa valeur JSON jusqu'à `deadline`.
async fn run_script<R: Runtime>(
    app: &AppHandle<R>,
    script: String,
    deadline: Instant,
) -> AppResult<String> {
    let webview = webview(app)?;
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let reply = Arc::new(Mutex::new(Some(tx)));
    webview.with_webview(move |platform| evaluate_native(platform, script, reply))?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    match tokio::time::timeout(remaining, rx).await {
        Ok(Ok(Ok(json))) => Ok(json),
        Ok(Ok(Err(message))) => Err(AppError::Tool(format!("Script failed: {message}"))),
        Ok(Err(_)) => Err(AppError::Validation("browser_closed")),
        Err(_) => Err(AppError::Tool("Script timed out.".into())),
    }
}

type Reply = Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>;

fn send(reply: &Reply, result: Result<String, String>) {
    if let Some(tx) = reply.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = tx.send(result);
    }
}

/// Évaluation native avec rappel : la valeur arrive sérialisée en JSON par la plateforme.
#[cfg(windows)]
fn evaluate_native(platform: tauri::webview::PlatformWebview, script: String, reply: Reply) {
    use webview2_com::ExecuteScriptCompletedHandler;
    use windows_core::HSTRING;

    // SAFETY : appels COM sur le fil principal, objets détenus par le webview vivant.
    let core = match unsafe { platform.controller().CoreWebView2() } {
        Ok(core) => core,
        Err(err) => return send(&reply, Err(err.to_string())),
    };
    let js = HSTRING::from(script.as_str());
    let done = reply.clone();
    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |error, json| {
        send(&done, error.map(|()| json).map_err(|e| e.to_string()));
        Ok(())
    }));
    if let Err(err) = unsafe { core.ExecuteScript(&js, &handler) } {
        send(&reply, Err(err.to_string()));
    }
}

#[cfg(target_os = "macos")]
fn evaluate_native(platform: tauri::webview::PlatformWebview, script: String, reply: Reply) {
    use objc2::AnyThread;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{
        NSError, NSJSONSerialization, NSJSONWritingOptions, NSString, NSUTF8StringEncoding,
    };
    use objc2_web_kit::WKWebView;

    // SAFETY : `inner()` est le WKWebView vivant du webview, utilisé sur le fil principal.
    let webview: &WKWebView = unsafe { &*(platform.inner() as *const WKWebView) };
    let handler = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        if !error.is_null() {
            // SAFETY : pointeur non nul fourni par WebKit pour la durée du rappel.
            let description = unsafe { (*error).localizedDescription().to_string() };
            return send(&reply, Err(description));
        }
        if value.is_null() {
            return send(&reply, Ok(String::new()));
        }
        // SAFETY : idem, valeur fournie par WebKit.
        let json = unsafe {
            NSJSONSerialization::dataWithJSONObject_options_error(
                &*value,
                NSJSONWritingOptions::FragmentsAllowed,
            )
        }
        .ok()
        .and_then(|data| {
            NSString::initWithData_encoding(NSString::alloc(), &data, NSUTF8StringEncoding)
        })
        .map(|s| s.to_string())
        .unwrap_or_default();
        send(&reply, Ok(json));
    });
    unsafe {
        webview.evaluateJavaScript_completionHandler(&NSString::from_str(&script), Some(&handler));
    }
}

#[cfg(target_os = "linux")]
fn evaluate_native(platform: tauri::webview::PlatformWebview, script: String, reply: Reply) {
    use javascriptcore::ValueExt;
    use webkit2gtk::WebViewExt;
    use webkit2gtk::gio::Cancellable;

    platform.inner().evaluate_javascript(
        &script,
        None,
        None,
        None::<&Cancellable>,
        move |result| match result {
            Ok(value) => send(
                &reply,
                Ok(value.to_json(0).map(|s| s.to_string()).unwrap_or_default()),
            ),
            Err(err) => send(&reply, Err(err.to_string())),
        },
    );
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn evaluate_native(_platform: tauri::webview::PlatformWebview, _script: String, reply: Reply) {
    send(
        &reply,
        Err("Script evaluation is not supported on this platform.".into()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "relay-browser-{label}-{}-{}",
            std::process::id(),
            rand_u64()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dunce::canonicalize(dir).unwrap()
    }

    #[test]
    fn accepts_http_and_https_with_a_host() {
        assert_eq!(
            parse_url(" https://example.com/a?b=1 ", &[])
                .unwrap()
                .as_str(),
            "https://example.com/a?b=1"
        );
        assert!(parse_url("http://localhost:1420/", &[]).is_ok());
        for denied in [
            "tauri://localhost/index.html",
            "ipc://localhost",
            "javascript:alert(1)",
            "data:text/html,hi",
            "about:blank",
            "ftp://example.com",
            "example.com",
            "",
        ] {
            assert!(
                matches!(parse_url(denied, &[]), Err(AppError::Tool(_))),
                "{denied} should be refused"
            );
        }
    }

    #[test]
    fn accepts_files_inside_a_workspace_only() {
        let root = temp_root("file");
        std::fs::write(root.join("index.html"), "<p>hi</p>").unwrap();
        let inside = Url::from_file_path(root.join("index.html")).unwrap();
        let parsed = parse_url(inside.as_str(), std::slice::from_ref(&root)).unwrap();
        assert_eq!(parsed.scheme(), "file");
        assert_eq!(parsed.to_file_path().unwrap(), root.join("index.html"));

        // Hors dossier, dossier non enregistré, fichier absent.
        assert!(matches!(
            parse_url(inside.as_str(), &[]),
            Err(AppError::Tool(m)) if m.contains("outside the workspace")
        ));
        let outside = Url::from_file_path(std::env::temp_dir().join("x.html")).unwrap();
        assert!(matches!(
            parse_url(outside.as_str(), std::slice::from_ref(&root)),
            Err(AppError::Tool(_))
        ));
        let missing = Url::from_file_path(root.join("absent.html")).unwrap();
        assert!(matches!(
            parse_url(missing.as_str(), std::slice::from_ref(&root)),
            Err(AppError::Tool(m)) if m.contains("File not found")
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn navigation_follows_workspace_files_but_nothing_else_local() {
        let root = temp_root("nav");
        std::fs::write(root.join("a.html"), "").unwrap();
        let state = WorkspaceState::default();
        state.register(root.to_str().unwrap()).unwrap();
        assert!(is_allowed(
            &Url::from_file_path(root.join("a.html")).unwrap(),
            &state
        ));
        assert!(is_allowed(
            &Url::parse("https://example.com").unwrap(),
            &state
        ));
        assert!(is_allowed(&Url::parse("about:blank").unwrap(), &state));
        assert!(!is_allowed(
            &Url::from_file_path(std::env::temp_dir()).unwrap(),
            &state
        ));
        assert!(!is_allowed(
            &Url::parse("tauri://localhost/").unwrap(),
            &state
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bounds_never_collapse_to_zero() {
        let b = Bounds {
            x: -3.0,
            y: 10.0,
            width: 0.0,
            height: -1.0,
        }
        .clamped();
        assert_eq!(
            b,
            Bounds {
                x: 0.0,
                y: 10.0,
                width: 1.0,
                height: 1.0
            }
        );
    }

    #[test]
    fn wrapper_embeds_the_script_as_a_json_string() {
        let js = eval_wrapper("abc", "document.title + \"\\n\"", 1_000);
        assert!(js.contains("const id = \"abc\";"));
        assert!(js.contains("const max = 1000;"));
        assert!(js.contains(r#"(0, eval)("document.title + \"\\n\"")"#));
        assert!(poll_script("abc").contains("evals[\"abc\"]"));
    }

    #[test]
    fn parses_and_caps_script_results() {
        let entry =
            parse_entry(r#"{"state":"done","ok":true,"json":"42","truncated":false}"#).unwrap();
        assert_eq!(
            (
                entry.state.as_str(),
                entry.ok,
                entry.json.as_str(),
                entry.truncated
            ),
            ("done", true, "42", false)
        );
        assert_eq!(
            parse_entry(r#"{"state":"pending"}"#).unwrap().state,
            "pending"
        );
        assert!(matches!(parse_entry(""), Err(AppError::Tool(_))));
        assert!(matches!(parse_entry("null"), Err(AppError::Tool(_))));
        assert!(matches!(parse_entry("{bad"), Err(AppError::Tool(_))));

        assert_eq!(cap_json("héllo".into(), 10), ("héllo".into(), false));
        assert_eq!(cap_json("héllo".into(), 2), ("hé".into(), true));
    }

    #[test]
    fn timeouts_are_clamped() {
        assert_eq!(clamp_timeout(None), DEFAULT_TIMEOUT);
        assert_eq!(clamp_timeout(Some(0)), Duration::from_secs(1));
        assert_eq!(clamp_timeout(Some(3_000)), Duration::from_secs(3));
        assert_eq!(clamp_timeout(Some(u64::MAX)), MAX_TIMEOUT);
    }

    #[test]
    fn load_state_tracks_generations() {
        let before = load_state();
        mark_loading();
        let during = load_state();
        assert_eq!(during.generation, before.generation.wrapping_add(1));
        assert!(during.loading);
        mark_loaded();
        assert!(!load_state().loading);
    }

    #[test]
    fn init_script_is_valid_enough_to_embed() {
        assert!(INIT_SCRIPT.starts_with("(() => {"));
        assert!(INIT_SCRIPT.contains("__relayLog"));
    }
}
