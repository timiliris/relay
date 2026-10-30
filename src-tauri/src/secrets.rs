//! Stockage sécurisé de la clé API dans le trousseau du système
//! (Gestionnaire d'identifiants Windows, Trousseau macOS, Secret Service Linux).
//! La clé ne transite jamais en clair vers le frontend : seul un indice masqué est exposé.

use keyring::Entry;

use crate::AppResult;

const SERVICE: &str = "com.example.relay";
const ACCOUNT: &str = "openrouter_api_key";

fn entry() -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, ACCOUNT)?)
}

pub fn set_api_key(key: &str) -> AppResult<()> {
    entry()?.set_password(key.trim())?;
    Ok(())
}

pub fn get_api_key() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn clear_api_key() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// `sk-or-v1-…a1b2` : assez pour reconnaître la clé, pas pour la réutiliser.
pub fn hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        return "•".repeat(chars.len());
    }
    let head: String = chars[..9].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::hint;

    #[test]
    fn masks_the_middle_of_the_key() {
        assert_eq!(hint("sk-or-v1-0123456789abcdef"), "sk-or-v1-…cdef");
        assert_eq!(hint("short"), "•••••");
    }
}
