//! Imports declenches par le joueur : page de runes et set d'objets, verifies apres ecriture.
//! NEX ne remplace jamais une page du joueur sans choix explicite (`replace_page_id`).

use crate::adapters::lcu::{Lcu, paths};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunePageInput {
    pub champion_name: String,
    pub primary_style: u32,
    pub sub_style: u32,
    /// 4 runes principales, 2 secondaires, 3 fragments.
    pub perks: Vec<u32>,
    /// Page a remplacer, choisie explicitement par le joueur (capacite atteinte).
    pub replace_page_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBlock {
    pub label: String,
    pub items: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSetInput {
    pub champion_id: i32,
    pub champion_name: String,
    pub role: Option<String>,
    pub blocks: Vec<ItemBlock>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageChoice {
    pub id: i64,
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    /// done | needs_choice
    pub status: &'static str,
    /// La lecture apres ecriture correspond a ce qui a ete envoye.
    pub verified: bool,
    pub message: String,
    /// Pages remplacables si la capacite est atteinte.
    pub pages: Vec<PageChoice>,
}

fn clean_text(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

pub fn validate_runes(i: &RunePageInput) -> AppResult<()> {
    let style_ok = |s: u32| (8000..=8999).contains(&s);
    if !style_ok(i.primary_style) || !style_ok(i.sub_style) || i.primary_style == i.sub_style {
        return Err(AppError::InvalidInput("arbres de runes invalides".into()));
    }
    if i.perks.len() != 9 || !i.perks.iter().all(|p| (5000..=9999).contains(p)) {
        return Err(AppError::InvalidInput("une page doit contenir 9 runes valides".into()));
    }
    Ok(())
}

pub fn validate_items(i: &ItemSetInput) -> AppResult<()> {
    if !(1..=10_000).contains(&i.champion_id) {
        return Err(AppError::InvalidInput("champion invalide".into()));
    }
    if i.blocks.is_empty() || i.blocks.len() > 8 {
        return Err(AppError::InvalidInput("1 à 8 blocs d'objets".into()));
    }
    for b in &i.blocks {
        if b.items.is_empty() || b.items.len() > 12 || !b.items.iter().all(|x| (1..=999_999).contains(x)) {
            return Err(AppError::InvalidInput("bloc d'objets invalide".into()));
        }
    }
    Ok(())
}

pub fn page_name(champion: &str) -> String {
    let c = clean_text(champion, 20);
    format!("NEX · {c}")
}

pub async fn import_runes(lcu: &Lcu, input: &RunePageInput) -> AppResult<ImportOutcome> {
    validate_runes(input)?;
    let pages: Vec<Value> = lcu.get(paths::PERK_PAGES).await?;
    let deletable = |p: &Value| p.get("isDeletable").and_then(Value::as_bool).unwrap_or(false);
    let id_of = |p: &Value| p.get("id").and_then(Value::as_i64).unwrap_or(-1);
    let name_of = |p: &Value| p.get("name").and_then(Value::as_str).unwrap_or("").to_string();

    let target: Option<i64> = match input.replace_page_id {
        Some(id) => {
            let p = pages.iter().find(|p| id_of(p) == id).ok_or_else(|| AppError::NotFound("page introuvable".into()))?;
            if !deletable(p) {
                return Err(AppError::Forbidden);
            }
            Some(id)
        }
        // Une ancienne page NEX est reutilisee : jamais une page du joueur.
        None => pages.iter().find(|p| deletable(p) && name_of(p).starts_with("NEX")).map(id_of),
    };
    if target.is_none() {
        let inv: Value = lcu.get(paths::PERK_INVENTORY).await?;
        if !inv.get("canAddCustomPage").and_then(Value::as_bool).unwrap_or(false) {
            return Ok(ImportOutcome {
                status: "needs_choice",
                verified: false,
                message: "Toutes tes pages de runes sont utilisées. Choisis la page que NEX peut remplacer.".into(),
                pages: pages
                    .iter()
                    .filter(|p| deletable(p))
                    .map(|p| PageChoice { id: id_of(p), name: name_of(p), current: p.get("current").and_then(Value::as_bool).unwrap_or(false) })
                    .collect(),
            });
        }
    }
    if let Some(id) = target {
        lcu.delete_perk_page(id).await?;
    }
    let name = page_name(&input.champion_name);
    let body = json!({
        "name": name,
        "primaryStyleId": input.primary_style,
        "subStyleId": input.sub_style,
        "selectedPerkIds": input.perks,
        "current": true,
    });
    let (status, text) = lcu.create_perk_page(&body).await?;
    if !(200..300).contains(&status) {
        return Err(AppError::Unavailable(format!("le client a refusé la page de runes ({status}) : {}", clean_text(&text, 160))));
    }
    // Verification : la page courante doit etre celle envoyee.
    let current: Value = lcu.get(paths::PERK_CURRENT).await?;
    let sent: Vec<u64> = input.perks.iter().map(|p| *p as u64).collect();
    let got: Vec<u64> = current.get("selectedPerkIds").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
    let verified = name_of(&current) == name && got == sent;
    Ok(ImportOutcome {
        status: "done",
        verified,
        message: if verified { format!("Page « {name} » créée et activée.") } else { "Page envoyée, mais la vérification ne correspond pas : contrôle dans le client.".into() },
        pages: vec![],
    })
}

/// Ajoute (ou remplace) le set NEX du champion, en conservant tous les autres sets a l'identique.
pub fn merge_item_sets(existing: &Value, set: Value, champion_id: i32, now_ms: i64) -> Value {
    let mut sets: Vec<Value> = existing.get("itemSets").and_then(Value::as_array).cloned().unwrap_or_default();
    sets.retain(|s| {
        let nex = s.get("title").and_then(Value::as_str).is_some_and(|t| t.starts_with("NEX · "));
        let same = s.get("associatedChampions").and_then(Value::as_array).is_some_and(|a| a.len() == 1 && a[0].as_i64() == Some(champion_id as i64));
        !(nex && same)
    });
    sets.push(set);
    json!({
        "accountId": existing.get("accountId").cloned().unwrap_or(Value::Null),
        "itemSets": sets,
        "timestamp": now_ms,
    })
}

pub fn item_set_value(input: &ItemSetInput, now_ms: i64) -> Value {
    let role = input.role.as_deref().map(|r| format!(" ({})", clean_text(r, 12))).unwrap_or_default();
    json!({
        "associatedChampions": [input.champion_id],
        "associatedMaps": [11],
        "blocks": input.blocks.iter().map(|b| json!({
            "type": clean_text(&b.label, 40),
            "items": b.items.iter().map(|i| json!({"id": i.to_string(), "count": 1})).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "map": "any",
        "mode": "any",
        "preferredItemSlots": [],
        "sortrank": 0,
        "startedFrom": "blank",
        "title": format!("NEX · {}{role}", clean_text(&input.champion_name, 20)),
        "type": "custom",
        "uid": format!("nex-{}-{now_ms}", input.champion_id),
    })
}

pub async fn import_items(lcu: &Lcu, input: &ItemSetInput) -> AppResult<ImportOutcome> {
    validate_items(input)?;
    let me: Value = lcu.get(paths::SUMMONER).await?;
    let summoner_id = me.get("summonerId").and_then(Value::as_u64).ok_or_else(|| AppError::Unavailable("identifiant d'invocateur absent".into()))?;
    let now = crate::persistence::now_secs() * 1000;
    let existing = lcu.get_item_sets(summoner_id).await?;
    let before = existing.get("itemSets").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    let set = item_set_value(input, now);
    let title = set["title"].as_str().unwrap_or_default().to_string();
    let merged = merge_item_sets(&existing, set, input.champion_id, now);
    lcu.put_item_sets(summoner_id, &merged).await?;
    let after = lcu.get_item_sets(summoner_id).await?;
    let found = after
        .get("itemSets")
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|s| s.get("title").and_then(Value::as_str) == Some(title.as_str())));
    let count = after.get("itemSets").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    Ok(ImportOutcome {
        status: "done",
        verified: found && count >= before,
        message: if found { format!("Set « {title} » enregistré ({count} sets au total).") } else { "Set envoyé mais introuvable à la relecture : contrôle dans le client.".into() },
        pages: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rune_validation() {
        let ok = RunePageInput { champion_name: "Ahri".into(), primary_style: 8100, sub_style: 8200, perks: vec![8112, 8139, 8138, 8135, 8226, 8210, 5008, 5008, 5011], replace_page_id: None };
        assert!(validate_runes(&ok).is_ok());
        let bad = RunePageInput { perks: vec![1, 2], ..ok };
        assert!(validate_runes(&bad).is_err());
        assert_eq!(page_name("Ahri\u{0007}"), "NEX · Ahri");
    }

    #[test]
    fn item_sets_merge_preserves_player_sets() {
        let existing = json!({"accountId": 42, "timestamp": 1, "itemSets": [
            {"title": "Mon set perso", "associatedChampions": [103], "uid": "a"},
            {"title": "NEX · Ahri (Mid)", "associatedChampions": [103], "uid": "old"},
            {"title": "NEX · Zed (Mid)", "associatedChampions": [238], "uid": "z"}
        ]});
        let input = ItemSetInput { champion_id: 103, champion_name: "Ahri".into(), role: Some("Mid".into()), blocks: vec![ItemBlock { label: "Départ".into(), items: vec![1056, 2003] }] };
        assert!(validate_items(&input).is_ok());
        let set = item_set_value(&input, 99);
        let merged = merge_item_sets(&existing, set, 103, 99);
        let sets = merged["itemSets"].as_array().unwrap();
        assert_eq!(sets.len(), 3);
        assert!(sets.iter().any(|s| s["title"] == "Mon set perso"));
        assert!(sets.iter().any(|s| s["uid"] == "z"));
        assert!(!sets.iter().any(|s| s["uid"] == "old"));
        assert_eq!(merged["accountId"], 42);
        assert_eq!(sets[2]["blocks"][0]["items"][0]["id"], "1056");
    }

    #[test]
    fn item_validation() {
        let bad = ItemSetInput { champion_id: 0, champion_name: "x".into(), role: None, blocks: vec![] };
        assert!(validate_items(&bad).is_err());
    }
}
