//! Contrats JSON du backend NEX (`/v1/...`), relayes tels quels a l'interface par l'app.
//! Toute evolution incompatible passe par un nouveau prefixe de version.

use serde::{Deserialize, Serialize};

/// Erreur normalisee du backend : meme forme que les erreurs IPC de l'app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApiError {
    /// invalid_input | not_found | rate_limited | unavailable | upstream
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "retryAfterSecs")]
    pub retry_after_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthDto {
    pub service: String,
    pub version: String,
    /// La cle Riot est-elle configuree (sans jamais l'exposer).
    pub riot_key_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankDto {
    /// RANKED_SOLO_5x5 | RANKED_FLEX_SR | autre file renvoyee par league-v4
    pub queue: String,
    pub tier: String,
    pub division: Option<String>,
    pub lp: i32,
    pub wins: u32,
    pub losses: u32,
}

/// Releve de rang observe a un instant. Riot ne fournit que le rang courant : l'historique
/// n'existe que parce que NEX enregistre ce qu'il voit, a partir du premier releve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankSnapshotDto {
    /// Instant de l'observation, ms epoch.
    pub at: i64,
    pub queue: String,
    pub tier: String,
    pub division: Option<String>,
    pub lp: i32,
    pub wins: u32,
    pub losses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerProfileDto {
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub platform: String,
    pub level: u32,
    pub profile_icon_id: u32,
    pub ranks: Vec<RankDto>,
    /// Horodatage (ms) de la recuperation cote backend.
    pub fetched_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectivesDto {
    pub champion: u32,
    pub baron: u32,
    pub dragon: u32,
    pub herald: u32,
    pub horde: u32,
    pub tower: u32,
    pub inhibitor: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamDto {
    pub team_id: u16,
    pub win: bool,
    /// Identifiants numeriques des champions bannis (-1 = aucun ban).
    pub bans: Vec<i32>,
    pub objectives: ObjectivesDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantDto {
    /// 1..=10 (ordre Riot), sert a relier la timeline.
    pub participant_id: u8,
    pub puuid: String,
    /// Peut etre vide si Riot ne fournit pas l'identite.
    pub game_name: String,
    pub tag_line: String,
    /// Cle Data Dragon du champion (ex. "MonkeyKing").
    pub champion: String,
    pub champion_id: i32,
    pub champion_level: u32,
    pub team_id: u16,
    /// TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY, absent hors Faille.
    pub position: Option<String>,
    pub win: bool,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    /// Sbires + monstres neutres.
    pub cs: u32,
    pub gold_earned: u32,
    pub damage_to_champions: u32,
    pub damage_taken: u32,
    pub vision_score: u32,
    pub wards_placed: u32,
    pub wards_killed: u32,
    pub control_wards_bought: u32,
    /// Emplacements 0-5 puis trinket (6). 0 = vide.
    pub items: [u32; 7],
    pub spells: [u32; 2],
    pub keystone: Option<u32>,
    pub primary_style: Option<u32>,
    pub secondary_style: Option<u32>,
    /// Toutes les runes choisies (primaire puis secondaire), dans l'ordre.
    pub perks: Vec<u32>,
    pub stat_perks: Vec<u32>,
    /// challenges.soloKills si fourni par Riot.
    pub solo_kills: Option<u32>,
    pub largest_multi_kill: u32,
    // Champs ajoutes apres coup : `None` sur une partie normalisee par une version
    // anterieure, ou lue dans le client League quand il ne la fournit pas. Un badge
    // qui en depend n'est alors pas decerne, plutot que decerne a tort.
    /// A porte le premier sang de la partie.
    #[serde(default)]
    pub first_blood: Option<bool>,
    /// Temps de controle de foule inflige, en secondes (`timeCCingOthers`).
    #[serde(default)]
    pub cc_time_sec: Option<u32>,
    /// Degats aux objectifs (tours, inhibiteurs, monstres epiques).
    #[serde(default)]
    pub damage_to_objectives: Option<u32>,
    /// Degats aux tours seules, inclus dans `damage_to_objectives`.
    #[serde(default)]
    pub damage_to_turrets: Option<u32>,
    /// Plus longue serie d'eliminations sans mourir.
    #[serde(default)]
    pub largest_killing_spree: Option<u32>,
    /// Balises de controle posees (`detectorWardsPlaced`), a distinguer des achetees.
    #[serde(default)]
    pub detector_wards_placed: Option<u32>,
    /// Temps passe mort, en secondes (`totalTimeSpentDead`).
    #[serde(default)]
    pub time_dead_sec: Option<u32>,
    /// `challenges.turretPlatesTaken` de Riot. NON AFFICHE : sur une partie observee la
    /// somme des dix joueurs atteignait 68 pour 30 plaques existantes, dont 25 pour un
    /// seul joueur. Ce nombre ne compte donc pas des plaques de tourelle.
    #[serde(default)]
    pub turret_plates: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchDto {
    pub id: String,
    pub platform: String,
    pub queue_id: u32,
    /// solo | flex | normal | aram | arena | other
    pub queue: String,
    pub game_mode: String,
    /// Version complete du client (ex. "15.21.715.1234").
    pub game_version: String,
    /// Debut de partie (ms epoch).
    pub started_at: i64,
    pub duration_sec: u32,
    /// Partie annulee (remake / reddition anticipee).
    pub remake: bool,
    pub participants: Vec<ParticipantDto>,
    pub teams: Vec<TeamDto>,
    /// Or total par participant a 15:00, dans l'ordre de `participants`,
    /// present seulement si la timeline est connue du backend.
    #[serde(default)]
    pub gold_at_15: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchPageDto {
    pub matches: Vec<MatchDto>,
    pub start: u32,
    pub count: u32,
    /// Vrai si Riot a renvoye autant d'identifiants que demande.
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FramePlayerDto {
    pub participant_id: u8,
    pub total_gold: u32,
    pub cs: u32,
    pub xp: u32,
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameDto {
    pub timestamp: u64,
    pub players: Vec<FramePlayerDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEventDto {
    pub timestamp: u64,
    /// item_purchased | item_sold | item_undo | item_destroyed | skill_level_up |
    /// champion_kill | elite_monster_kill | building_kill | ward_placed
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant_id: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<u32>,
    /// Pour item_undo : objet annule (beforeId) ; item_id = afterId.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_item_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_slot: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub victim_id: Option<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assisting_ids: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<u16>,
    /// DRAGON, BARON_NASHOR, RIFTHERALD, HORDE, ATAKHAN, TOWER_BUILDING, INHIBITOR_BUILDING...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monster_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub match_id: String,
    pub frame_interval_ms: u64,
    pub frames: Vec<FrameDto>,
    pub events: Vec<TimelineEventDto>,
}

// ---------- Statistiques agregees (etape 3) ----------

/// Perimetre commun a toutes les statistiques agregees.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsScopeDto {
    /// Patch "16.20" ; "all" = tous les patchs collectes.
    pub patch: String,
    /// Plateforme (EUW1...) ou "all".
    pub platform: String,
    pub queue_id: u32,
    /// Rang du joueur source de la partie : CHALLENGER | GRANDMASTER | MASTER | all.
    pub tier: String,
    /// Nombre de parties distinctes dans le perimetre.
    pub matches: u32,
}

/// Repere d'une mesure du Data Studio : la mediane observee sur les parties collectees.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDto {
    /// Cle de la mesure, commune au catalogue de l'interface.
    pub key: String,
    /// `None` quand aucune ligne collectee ne porte cette donnee.
    pub median: Option<f64>,
    /// Nombre de lignes qui portaient la donnee.
    pub games: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaselinesDto {
    /// Poste du repere, ou chaine vide pour tous postes confondus.
    pub position: String,
    /// Lignes de joueur dans le perimetre, toutes mesures confondues.
    pub sample: u32,
    pub stats: Vec<BaselineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStatusDto {
    pub enabled: bool,
    pub platforms: Vec<String>,
    pub matches_total: u32,
    pub last_ingested_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsMetaDto {
    /// Patchs disponibles, du plus recent au plus ancien, avec leur effectif.
    pub patches: Vec<(String, u32)>,
    pub platforms: Vec<(String, u32)>,
    pub tiers: Vec<(String, u32)>,
    pub collector: CollectorStatusDto,
    /// Taille minimale d'echantillon sous laquelle une valeur est marquee "insuffisante".
    pub min_games: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampionStatDto {
    pub champion_id: i32,
    pub position: String,
    pub games: u32,
    pub wins: u32,
    /// Part des parties du perimetre ou ce champion est joue a ce poste.
    pub pick_rate: f64,
    /// Part des parties du perimetre ou ce champion est banni (tous postes).
    pub ban_rate: f64,
    /// Taux de victoire ajuste (retrait bayesien vers 50 %, cf. methode).
    pub adjusted_win_rate: f64,
    /// S+ | S | A | B | C | D | "?" (echantillon insuffisant)
    pub tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TierListDto {
    pub scope: StatsScopeDto,
    pub champions: Vec<ChampionStatDto>,
}

/// Une variante (page de runes, paire de sorts, objets...) avec son effectif.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VariantDto {
    pub ids: Vec<u32>,
    pub games: u32,
    pub wins: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampionBuildDto {
    pub scope: StatsScopeDto,
    pub champion_id: i32,
    pub position: String,
    pub games: u32,
    pub wins: u32,
    /// Postes joues par ce champion dans le perimetre (pour choisir).
    pub positions: Vec<(String, u32)>,
    /// Pages : [arbre principal, 4 runes, arbre secondaire, 2 runes, 3 fragments].
    pub rune_pages: Vec<VariantDto>,
    pub spells: Vec<VariantDto>,
    pub start_items: Vec<VariantDto>,
    /// Trois premiers objets termines, dans l'ordre d'achat.
    pub core_items: Vec<VariantDto>,
    pub boots: Vec<VariantDto>,
    /// Objets termines achetes en 4e/5e/6e position (alternatives situationnelles).
    pub late_items: Vec<VariantDto>,
    /// Priorite de montee au rang max, ex. [1,3,2] = A > E > Z.
    pub skill_priority: Vec<VariantDto>,
    /// Trois premiers points de competence, ex. [1,2,3].
    pub skill_start: Vec<VariantDto>,
    /// Parties disposant de la timeline (achats et competences).
    pub timeline_games: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchupDto {
    pub opponent_id: i32,
    pub games: u32,
    pub wins: u32,
    pub win_rate: f64,
    /// Ecart en points de pourcentage avec le taux moyen du champion sur le meme perimetre.
    pub delta_pp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchupsDto {
    pub scope: StatsScopeDto,
    pub champion_id: i32,
    pub position: String,
    pub games: u32,
    pub wins: u32,
    /// Taux moyen du champion a ce poste, base de reference des deltas.
    pub average_win_rate: f64,
    pub matchups: Vec<MatchupDto>,
}

// ---------- Classements et parties en cours (etape 6) ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntryDto {
    pub rank: u32,
    pub puuid: String,
    /// Vide si le Riot ID n'a pas pu etre resolu (limite de debit) : jamais invente.
    pub game_name: String,
    pub tag_line: String,
    pub lp: i32,
    pub wins: u32,
    pub losses: u32,
    pub hot_streak: bool,
    /// Icone d'invocateur (summoner-v4) ; absente si Riot n'a pas repondu.
    #[serde(default)]
    pub profile_icon_id: Option<u32>,
}

/// Equipes professionnelles et comptes classes declares, d'apres Leaguepedia (CC BY-SA).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProTeamsDto {
    pub source: String,
    pub source_url: String,
    pub license: String,
    /// Date (ms) de la collecte Leaguepedia.
    pub fetched_at: i64,
    pub teams: Vec<ProTeamDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProTeamDto {
    /// Nom de l'equipe sur Leaguepedia.
    pub name: String,
    /// Ligue (ex. « LEC »), pour l'affichage.
    pub league: String,
    pub players: Vec<ProPlayerDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProPlayerDto {
    /// Pseudo professionnel (identifiant Leaguepedia).
    pub name: String,
    /// Top, Jungle, Mid, Bot, Support.
    pub role: String,
    pub residency: String,
    pub page_url: String,
    /// Comptes classes declares avec un Riot ID complet et une region connue.
    pub accounts: Vec<ProAccountDto>,
    /// Comptes declares mais inexploitables (sans tag ou sans region).
    pub unusable_accounts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProAccountDto {
    pub riot_id: String,
    /// Code de plateforme Riot (ex. « EUW1 »).
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardDto {
    pub platform: String,
    pub queue: String,
    pub tier: String,
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
    /// Date (ms) du releve league-v4 utilise.
    pub fetched_at: i64,
    pub entries: Vec<LeaderboardEntryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveParticipantDto {
    pub puuid: String,
    pub riot_id: String,
    pub champion_id: i32,
    pub team_id: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveGameDto {
    pub in_game: bool,
    pub game_id: Option<i64>,
    pub queue_id: Option<u32>,
    pub game_mode: Option<String>,
    /// Debut de partie (ms) ; 0 pendant le chargement.
    pub start_time: Option<i64>,
    pub participants: Vec<LiveParticipantDto>,
    pub fetched_at: i64,
}

/// Cle d'observation plausible (presence d'un ami dans le client) : base64, 1 a 128 caracteres.
pub fn valid_spectator_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 128 && key.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// Classe une file Riot (queueId) dans les categories NEX.
pub fn queue_category(queue_id: u32) -> &'static str {
    match queue_id {
        420 => "solo",
        440 => "flex",
        400 | 430 | 490 | 480 => "normal",
        450 | 2400 => "aram",
        1700 | 1710 => "arena",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queues() {
        assert_eq!(queue_category(420), "solo");
        assert_eq!(queue_category(450), "aram");
        assert_eq!(queue_category(9999), "other");
    }

    #[test]
    fn api_error_shape() {
        let e = ApiError { code: "rate_limited".into(), message: "x".into(), retry_after_secs: Some(3) };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["retryAfterSecs"], 3);
    }
}
