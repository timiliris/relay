//! Lecture de pages web pour le modèle (outil `fetch_url`).
//!
//! Garde-fous :
//! - client `reqwest` dédié, sans aucun en-tête d'autorisation (la clé OpenRouter ne sort jamais
//!   d'`openrouter/`), `User-Agent: Relay`, 20 s au total, 5 Mo de corps au maximum ;
//! - `http(s)` uniquement ; refus de `localhost` et des adresses locales ou privées (boucle
//!   locale, 10/8, 172.16/12, 192.168/16, 169.254/16, `::1`, `fc00::/7`, `fe80::/10`…) pour ne pas
//!   exposer le réseau local au modèle. Le nom d'hôte est résolu **avant** la connexion et la
//!   requête est épinglée sur les adresses vérifiées (`resolve_to_addrs`) ; les redirections sont
//!   suivies à la main (5 au plus) avec les mêmes vérifications à chaque saut ;
//! - HTML → texte lisible : `<main>` ou `<article>` quand la page en a, scripts, styles,
//!   navigation, en-têtes, pieds de page et formulaires retirés, puis rendu par `html2text`.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::LazyLock;
use std::time::Duration;

use futures_util::StreamExt;
use regex::Regex;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, LOCATION};
use reqwest::{Url, redirect};
use serde::Serialize;

use crate::{AppError, AppResult};

pub const DEFAULT_MAX_CHARS: usize = 20_000;
pub const MIN_MAX_CHARS: usize = 200;
pub const MAX_MAX_CHARS: usize = 200_000;
const MAX_BYTES: usize = 5 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = "Relay";
/// Largeur de rendu du texte : assez large pour les tableaux, lisible pour le modèle.
const WRAP_WIDTH: usize = 100;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    /// URL finale, après redirections.
    pub url: String,
    pub title: Option<String>,
    pub text: String,
    /// `true` si le texte a été coupé à `max_chars` (ou le corps à 5 Mo).
    pub truncated: bool,
}

fn refuse(message: impl Into<String>) -> AppError {
    AppError::Tool(message.into())
}

/// Vérifie le schéma et l'hôte d'une URL avant toute résolution DNS.
pub fn validate_url(input: &str) -> AppResult<Url> {
    let url = Url::parse(input.trim())
        .map_err(|e| refuse(format!("Invalid URL `{}`: {e}", input.trim())))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(refuse(format!(
            "Only http(s) URLs can be fetched (got `{}`).",
            url.scheme()
        )));
    }
    match url.host() {
        None => Err(refuse("The URL has no host.")),
        Some(url::Host::Domain(domain)) if is_blocked_host(domain) => Err(refuse(format!(
            "Local addresses are not allowed (`{domain}`)."
        ))),
        Some(url::Host::Ipv4(ip)) if is_private_ip(IpAddr::V4(ip)) => Err(refuse(format!(
            "Private or local addresses are not allowed (`{ip}`)."
        ))),
        Some(url::Host::Ipv6(ip)) if is_private_ip(IpAddr::V6(ip)) => Err(refuse(format!(
            "Private or local addresses are not allowed (`{ip}`)."
        ))),
        Some(_) => Ok(url),
    }
}

/// Noms d'hôte qui désignent la machine locale sans passer par le DNS public.
pub fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local")
}

/// Adresse non routable publiquement : boucle locale, privée, lien local, multicast, non spécifiée…
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, _, _] = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                // 100.64.0.0/10 (NAT de fournisseur) et 0.0.0.0/8.
                || (a == 100 && (64..128).contains(&b))
                || a == 0
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7 (adresses locales uniques) et fe80::/10 (lien local).
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
        }
    }
}

/// Résout l'hôte et refuse si une seule des adresses obtenues est locale ou privée.
async fn resolve_public(url: &Url) -> AppResult<Vec<SocketAddr>> {
    let host = url
        .host_str()
        .ok_or_else(|| refuse("The URL has no host."))?;
    if url
        .host()
        .is_some_and(|h| !matches!(h, url::Host::Domain(_)))
    {
        // Adresse IP littérale, déjà vérifiée par `validate_url`.
        return Ok(Vec::new());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let lookup = (host.to_string(), port);
    let addrs: Vec<SocketAddr> = tokio::task::spawn_blocking(move || lookup.to_socket_addrs())
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .map_err(|e| refuse(format!("Could not resolve `{host}`: {e}")))?
        .collect();
    if addrs.is_empty() {
        return Err(refuse(format!("`{host}` does not resolve to any address.")));
    }
    if let Some(private) = addrs.iter().find(|a| is_private_ip(a.ip())) {
        return Err(refuse(format!(
            "`{host}` resolves to a private or local address ({}): refused.",
            private.ip()
        )));
    }
    Ok(addrs)
}

fn client_for(url: &Url, addrs: &[SocketAddr]) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        .redirect(redirect::Policy::none());
    if let Some(host) = url.host_str()
        && !addrs.is_empty()
    {
        // Épingle la connexion sur les adresses vérifiées (pas de seconde résolution DNS).
        let pinned: Vec<SocketAddr> = addrs.iter().map(|a| SocketAddr::new(a.ip(), 0)).collect();
        builder = builder.resolve_to_addrs(host, &pinned);
    }
    Ok(builder.build()?)
}

/// Télécharge `input` et renvoie son texte, coupé à `max_chars` (défaut 20 000).
pub async fn fetch_url(input: &str, max_chars: Option<usize>) -> AppResult<PageText> {
    let max_chars = max_chars
        .unwrap_or(DEFAULT_MAX_CHARS)
        .clamp(MIN_MAX_CHARS, MAX_MAX_CHARS);
    let mut url = validate_url(input)?;

    for _ in 0..=MAX_REDIRECTS {
        let addrs = resolve_public(&url).await?;
        let client = client_for(&url, &addrs)?;
        let response = client
            .get(url.clone())
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            )
            .header(ACCEPT_LANGUAGE, "fr,en;q=0.8")
            .send()
            .await
            .map_err(|e| refuse(format!("Request to {url} failed: {e}")))?;

        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| refuse(format!("HTTP {status} from {url} without Location.")))?;
            let next = url
                .join(location)
                .map_err(|e| refuse(format!("Invalid redirect `{location}`: {e}")))?;
            url = validate_url(next.as_str())?;
            continue;
        }
        if !status.is_success() {
            return Err(refuse(format!("HTTP {status} for {url}.")));
        }

        let final_url = response.url().to_string();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = classify(&content_type)
            .ok_or_else(|| refuse(format!("Unsupported content type `{content_type}`.")))?;

        let (body, body_truncated) = read_body(response).await?;
        let (title, text) = match kind {
            Kind::Html => (extract_title(&body), html_to_text(&body)),
            Kind::Text => (None, body),
        };
        let (text, truncated) = truncate_chars(&text, max_chars);
        return Ok(PageText {
            url: final_url,
            title,
            text,
            truncated: truncated || body_truncated,
        });
    }
    Err(refuse(format!(
        "Too many redirects (more than {MAX_REDIRECTS})."
    )))
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Html,
    Text,
}

/// Type de contenu exploitable ; `None` pour les binaires (images, PDF, archives…).
fn classify(content_type: &str) -> Option<Kind> {
    let mime = content_type.split(';').next().unwrap_or("").trim();
    match mime {
        "" | "text/html" | "application/xhtml+xml" => Some(Kind::Html),
        m if m.starts_with("text/") => Some(Kind::Text),
        "application/json"
        | "application/xml"
        | "application/ld+json"
        | "application/rss+xml"
        | "application/atom+xml"
        | "application/javascript" => Some(Kind::Text),
        m if m.ends_with("+json") || m.ends_with("+xml") => Some(Kind::Text),
        _ => None,
    }
}

/// Lit le corps jusqu'à 5 Mo ; au-delà, le reste est ignoré et `truncated` vaut `true`.
async fn read_body(response: reqwest::Response) -> AppResult<(String, bool)> {
    let mut bytes: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| refuse(format!("Download failed: {e}")))?;
        if bytes.len() + chunk.len() > MAX_BYTES {
            bytes.extend_from_slice(&chunk[..MAX_BYTES - bytes.len()]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// Coupe à `max` caractères (pas octets) sur une limite de caractère.
pub fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((index, _)) => (format!("{}…", text[..index].trim_end()), true),
        None => (text.to_string(), false),
    }
}

static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title\s*>").expect("regex"));
static COMMENTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").expect("regex"));
/// Éléments retirés partout : code, styles, médias vectoriels, cadres, navigation, formulaires.
static NOISE: LazyLock<Regex> = LazyLock::new(|| {
    block_regex(&[
        "script", "style", "noscript", "template", "svg", "iframe", "canvas", "nav", "form",
        "dialog",
    ])
});
/// Habillage de page retiré seulement hors `<main>`/`<article>` (un article a ses propres en-têtes).
static CHROME: LazyLock<Regex> = LazyLock::new(|| block_regex(&["header", "footer", "aside"]));
static MAIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<main\b[^>]*>.*?</main\s*>").expect("regex"));
static ARTICLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<article\b[^>]*>.*?</article\s*>").expect("regex"));
static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("regex"));
static BLANK_LINES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n{3,}").expect("regex"));

/// `<tag …>…</tag>` pour chaque balise, sans tenir compte de la casse, sur plusieurs lignes.
fn block_regex(tags: &[&str]) -> Regex {
    let alternatives: Vec<String> = tags
        .iter()
        .map(|tag| format!(r"<{tag}\b[^>]*>.*?</{tag}\s*>"))
        .collect();
    Regex::new(&format!("(?is){}", alternatives.join("|"))).expect("regex")
}

/// Décode les entités les plus courantes d'un fragment de texte (titre).
fn decode_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

/// Contenu de `<title>`, espaces normalisés ; `None` s'il est absent ou vide.
pub fn extract_title(html: &str) -> Option<String> {
    let raw = decode_entities(TITLE.captures(html)?.get(1)?.as_str());
    let title = WHITESPACE.replace_all(&raw, " ");
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_string())
}

/// Texte lisible d'une page HTML : contenu principal, sans code ni habillage.
pub fn html_to_text(html: &str) -> String {
    let without_comments = COMMENTS.replace_all(html, "");
    let fragment = match MAIN
        .find(&without_comments)
        .or_else(|| ARTICLE.find(&without_comments))
    {
        Some(main) => NOISE.replace_all(main.as_str(), "").into_owned(),
        None => {
            let stripped = NOISE.replace_all(&without_comments, "");
            CHROME.replace_all(&stripped, "").into_owned()
        }
    };
    let rendered = html2text::config::plain_no_decorate()
        .string_from_read(fragment.as_bytes(), WRAP_WIDTH)
        .unwrap_or_else(|_| fragment.clone());
    tidy(&rendered)
}

/// Espaces de fin de ligne retirés, lignes vides groupées par deux au plus.
fn tidy(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
    BLANK_LINES
        .replace_all(&lines.join("\n"), "\n\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_non_http_schemes_and_hostless_urls() {
        for input in [
            "file:///etc/passwd",
            "ftp://example.com/",
            "javascript:alert(1)",
            "tauri://localhost",
            "not a url",
            "http://",
        ] {
            assert!(
                matches!(validate_url(input), Err(AppError::Tool(_))),
                "{input} should be refused"
            );
        }
        assert_eq!(
            validate_url(" https://example.com/path?q=1 ")
                .unwrap()
                .as_str(),
            "https://example.com/path?q=1"
        );
    }

    #[test]
    fn refuses_local_hosts_and_private_literal_addresses() {
        for input in [
            "http://localhost/",
            "http://LOCALHOST:8080/admin",
            "http://api.localhost/",
            "http://printer.local/",
            "http://127.0.0.1/",
            "http://127.1.2.3:9000/",
            "http://10.0.0.5/",
            "http://172.16.0.1/",
            "http://172.31.255.254/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/",
            "http://100.64.0.1/",
            "http://[::1]/",
            "http://[::]/",
            "http://[fe80::1]/",
            "http://[fd00::1]/",
            "http://[::ffff:192.168.0.1]/",
        ] {
            assert!(
                matches!(validate_url(input), Err(AppError::Tool(_))),
                "{input} should be refused"
            );
        }
        for input in [
            "http://172.32.0.1/",
            "http://8.8.8.8/",
            "https://[2606:4700::1111]/",
            "https://example.com/",
        ] {
            assert!(validate_url(input).is_ok(), "{input} should be accepted");
        }
    }

    #[test]
    fn classifies_content_types() {
        assert_eq!(classify("text/html; charset=utf-8"), Some(Kind::Html));
        assert_eq!(classify(""), Some(Kind::Html));
        assert_eq!(classify("text/plain"), Some(Kind::Text));
        assert_eq!(classify("application/json"), Some(Kind::Text));
        assert_eq!(classify("application/problem+json"), Some(Kind::Text));
        assert_eq!(classify("image/png"), None);
        assert_eq!(classify("application/pdf"), None);
    }

    #[test]
    fn extracts_the_title_and_decodes_entities() {
        let html = "<html><head>\n<title>\n  Tom &amp; Jerry &#39;24\n</title></head></html>";
        assert_eq!(extract_title(html).as_deref(), Some("Tom & Jerry '24"));
        assert_eq!(extract_title("<html><title></title></html>"), None);
        assert_eq!(extract_title("<p>no title</p>"), None);
    }

    #[test]
    fn keeps_the_main_content_and_drops_boilerplate() {
        let html = r#"<!doctype html><html><head><title>Doc</title>
            <style>body{color:red}</style><script>alert('x')</script></head>
            <body>
            <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
            <!-- un commentaire -->
            <main>
              <h1>Getting started</h1>
              <p>Install the <b>tool</b>, then run <code>relay --help</code>.</p>
              <script>track()</script>
              <form><input name="q"><button>Search</button></form>
              <ul><li>First step</li><li>Second step</li></ul>
            </main>
            <footer>© 2026 Example — <a href="/legal">Legal</a></footer>
            </body></html>"#;
        let text = html_to_text(html);
        assert!(text.contains("Getting started"), "{text}");
        assert!(
            text.contains("Install the tool, then run relay --help."),
            "{text}"
        );
        assert!(text.contains("First step"), "{text}");
        for noise in [
            "Home",
            "About",
            "alert",
            "track()",
            "Search",
            "Legal",
            "color:red",
            "commentaire",
        ] {
            assert!(
                !text.contains(noise),
                "`{noise}` should be removed from:\n{text}"
            );
        }
    }

    #[test]
    fn falls_back_to_the_whole_body_without_main() {
        let html = "<html><body><header>Site</header><aside>Ads</aside>\
                    <div><h2>Title</h2><p>Body text.</p></div><footer>Foot</footer></body></html>";
        let text = html_to_text(html);
        assert!(
            text.contains("Title") && text.contains("Body text."),
            "{text}"
        );
        for noise in ["Site", "Ads", "Foot"] {
            assert!(
                !text.contains(noise),
                "`{noise}` should be removed from:\n{text}"
            );
        }
        assert!(!text.contains("\n\n\n"));
    }

    #[test]
    fn truncates_on_character_boundaries() {
        let (text, truncated) = truncate_chars("héllo wörld", 5);
        assert_eq!(text, "héllo…");
        assert!(truncated);
        let (text, truncated) = truncate_chars("short", 10);
        assert_eq!(text, "short");
        assert!(!truncated);
    }

    /// Lit une vraie page : `cargo test -- --ignored reads_a_real_page`.
    #[tokio::test]
    #[ignore]
    async fn reads_a_real_page() {
        let page = fetch_url("https://example.com/", Some(5000)).await.unwrap();
        assert_eq!(page.url, "https://example.com/");
        assert_eq!(page.title.as_deref(), Some("Example Domain"));
        assert!(page.text.contains("illustrative examples"), "{}", page.text);
        assert!(!page.truncated);
    }
}
