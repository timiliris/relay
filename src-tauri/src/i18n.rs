//! Chaînes côté Rust (menus natifs, tray, messages).
//!
//! Le frontend gère sa propre i18n (react-i18next) et informe Rust de la langue
//! active via la commande `set_language`. Garder les deux listes de langues alignées.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    En,
    Fr,
}

impl Lang {
    /// `fr`, `fr-FR`, `fr_CA` → `Fr` ; tout le reste → `En`.
    pub fn from_tag(tag: &str) -> Self {
        match tag.get(..2).map(str::to_ascii_lowercase).as_deref() {
            Some("fr") => Self::Fr,
            _ => Self::En,
        }
    }
}

/// Textes utilisés par les menus et le tray.
/// Certaines variantes ne servent que sur une plateforme (menu macOS), d'où l'`allow`.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub enum Text {
    File,
    Edit,
    Window,
    Help,
    Quit,
    CloseWindow,
    Minimize,
    Zoom,
    Fullscreen,
    Show,
    Docs,
    CheckUpdates,
    About,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Hide,
    HideOthers,
    ShowAll,
    Services,
}

pub fn t(lang: Lang, text: Text) -> &'static str {
    match lang {
        Lang::En => en(text),
        Lang::Fr => fr(text),
    }
}

fn en(text: Text) -> &'static str {
    match text {
        Text::File => "File",
        Text::Edit => "Edit",
        Text::Window => "Window",
        Text::Help => "Help",
        Text::Quit => "Quit",
        Text::CloseWindow => "Close Window",
        Text::Minimize => "Minimize",
        Text::Zoom => "Zoom",
        Text::Fullscreen => "Toggle Full Screen",
        Text::Show => "Show",
        Text::Docs => "Documentation",
        Text::CheckUpdates => "Check for Updates…",
        Text::About => "About",
        Text::Undo => "Undo",
        Text::Redo => "Redo",
        Text::Cut => "Cut",
        Text::Copy => "Copy",
        Text::Paste => "Paste",
        Text::SelectAll => "Select All",
        Text::Hide => "Hide",
        Text::HideOthers => "Hide Others",
        Text::ShowAll => "Show All",
        Text::Services => "Services",
    }
}

fn fr(text: Text) -> &'static str {
    match text {
        Text::File => "Fichier",
        Text::Edit => "Édition",
        Text::Window => "Fenêtre",
        Text::Help => "Aide",
        Text::Quit => "Quitter",
        Text::CloseWindow => "Fermer la fenêtre",
        Text::Minimize => "Réduire",
        Text::Zoom => "Zoom",
        Text::Fullscreen => "Plein écran",
        Text::Show => "Afficher",
        Text::Docs => "Documentation",
        Text::CheckUpdates => "Rechercher des mises à jour…",
        Text::About => "À propos",
        Text::Undo => "Annuler",
        Text::Redo => "Rétablir",
        Text::Cut => "Couper",
        Text::Copy => "Copier",
        Text::Paste => "Coller",
        Text::SelectAll => "Tout sélectionner",
        Text::Hide => "Masquer",
        Text::HideOthers => "Masquer les autres",
        Text::ShowAll => "Tout afficher",
        Text::Services => "Services",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_french_tags() {
        assert_eq!(Lang::from_tag("fr"), Lang::Fr);
        assert_eq!(Lang::from_tag("fr-CA"), Lang::Fr);
        assert_eq!(Lang::from_tag("FR_FR"), Lang::Fr);
        assert_eq!(Lang::from_tag("en-US"), Lang::En);
        assert_eq!(Lang::from_tag(""), Lang::En);
    }
}
