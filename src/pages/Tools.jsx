import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentWnbaRosters, fetchWnbaTeams, teamLogoUrl } from "../api.js";
import { useAuth } from "../auth/useAuth.js";
import {
  deleteSavedToolRecord,
  deleteSavedToolRecordRemote,
  getSavedToolRecord,
  getSavedToolRecordRemote,
  saveToolRecord,
  saveToolRecordRemote,
} from "../toolVault.js";
import { exportMatchupGraphic } from "./matchupGraphicExport.js";
import styles from "./Tools.module.css";

const EMPTY_PLAYER_IDS = Array(5).fill("");
const DEFAULT_TEAM_ID = "1611661322";

function buildEmptyDraft() {
  return {
    league: "wnba",
    leftTeamId: "",
    rightTeamId: "",
    leftPlayerIds: [...EMPTY_PLAYER_IDS],
    rightPlayerIds: [...EMPTY_PLAYER_IDS],
    logoTeamId: "",
  };
}

function normalizeTeamScopes(teamScopes) {
  return new Set(
    (Array.isArray(teamScopes) ? teamScopes : [])
      .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean)
  );
}

function buildDefaultDraftForLeague(teamScopes) {
  const scopes = normalizeTeamScopes(teamScopes);
  const nextDraft = {
    ...buildEmptyDraft(),
    league: "wnba",
    leftTeamId: scopes.has("mystics") ? DEFAULT_TEAM_ID : "",
    logoTeamId: scopes.has("mystics") ? DEFAULT_TEAM_ID : "",
  };

  if (!nextDraft.leftTeamId && scopes.has("washington")) {
    nextDraft.leftTeamId = DEFAULT_TEAM_ID;
    nextDraft.logoTeamId = DEFAULT_TEAM_ID;
  }

  return nextDraft;
}

function buildDefaultDraftForProfile(profile) {
  return buildDefaultDraftForLeague(profile?.team_scopes);
}

function isDraftBlank(draft) {
  if (!draft || typeof draft !== "object") return true;
  const leftPlayerIds = Array.isArray(draft.leftPlayerIds) ? draft.leftPlayerIds : [];
  const rightPlayerIds = Array.isArray(draft.rightPlayerIds) ? draft.rightPlayerIds : [];
  return !String(draft.leftTeamId || "").trim() &&
    !String(draft.rightTeamId || "").trim() &&
    !String(draft.logoTeamId || "").trim() &&
    !leftPlayerIds.some((value) => String(value || "").trim()) &&
    !rightPlayerIds.some((value) => String(value || "").trim());
}

function hydrateDraftPayload(payload, fallbackDraft) {
  return {
    league: "wnba",
    leftTeamId: String(payload?.leftTeamId || "").trim() || String(fallbackDraft?.leftTeamId || "").trim(),
    rightTeamId: String(payload?.rightTeamId || "").trim(),
    leftPlayerIds: [...EMPTY_PLAYER_IDS].map((_, index) => String(payload?.leftPlayerIds?.[index] || "").trim()),
    rightPlayerIds: [...EMPTY_PLAYER_IDS].map((_, index) => String(payload?.rightPlayerIds?.[index] || "").trim()),
    logoTeamId: String(payload?.logoTeamId || "").trim() || String(fallbackDraft?.logoTeamId || "").trim(),
  };
}

function teamDisplayCode(team) {
  const explicitCode = String(team?.tricode || team?.teamAbbreviation || "").trim();
  if (explicitCode) return explicitCode.toUpperCase();
  return String(team?.fullName || "Match-Up")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function buildAvailableTeamsFromRosterPayload(payload) {
  const teams = payload?.teams && typeof payload.teams === "object" ? payload.teams : {};
  return Object.entries(teams)
    .map(([teamId, team]) => ({
      teamId: String(team?.teamId || teamId).trim() || String(teamId),
      tricode: String(team?.teamAbbreviation || team?.tricode || "").trim().toUpperCase(),
      fullName: `${String(team?.teamCity || "").trim()} ${String(team?.teamName || "").trim()}`.trim(),
    }))
    .filter((team) => team.teamId && team.fullName)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function buildDraftTitle(draft) {
  const leftTeam = draft?.availableTeams?.find?.((team) => team.teamId === draft?.leftTeamId) || null;
  const rightTeam = draft?.availableTeams?.find?.((team) => team.teamId === draft?.rightTeamId) || null;
  if (leftTeam && rightTeam) {
    return `${teamDisplayCode(leftTeam)} vs ${teamDisplayCode(rightTeam)} Match-Up`;
  }
  if (leftTeam || rightTeam) {
    return `${teamDisplayCode(leftTeam || rightTeam) || "WNBA"} Match-Up`;
  }
  return "WNBA Match-Up Draft";
}

function formatPlayerOption(player) {
  return `#${player.jerseyNum || "--"} ${player.fullName}`.trim();
}

function slugifyPlayerText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseLegacySyntheticPlayerId(playerId) {
  const text = String(playerId || "").trim();
  if (!text.startsWith("wnba-")) return null;
  const match = /^wnba-(\d+)-(.+)-(\d+)$/.exec(text);
  if (!match) return null;
  return {
    teamId: match[1],
    slug: match[2],
    jerseyNum: match[3],
  };
}

function resolveLegacySyntheticPlayer(playerId, roster) {
  const parsed = parseLegacySyntheticPlayerId(playerId);
  if (!parsed) return null;
  const normalizedSlug = parsed.slug;
  const normalizedJersey = String(parsed.jerseyNum || "").trim();
  return (roster || []).find((player) => {
    const playerSlug = slugifyPlayerText(player?.fullName || `${player?.firstName || ""} ${player?.familyName || ""}`);
    const playerJersey = String(player?.jerseyNum || "").trim();
    return playerSlug === normalizedSlug && playerJersey === normalizedJersey;
  }) || null;
}

function resolveSelectedPlayers(playerIds, roster) {
  const playersById = new Map((roster || []).map((player) => [player.personId, player]));
  return [...EMPTY_PLAYER_IDS].map((_, index) => {
    const playerId = String(playerIds?.[index] || "").trim();
    return playersById.get(playerId) || resolveLegacySyntheticPlayer(playerId, roster) || null;
  });
}

function ToolColumn({
  columnId,
  teamId,
  teams,
  playerIds,
  rosterMap,
  onTeamChange,
  onPlayerChange,
}) {
  const roster = useMemo(() => rosterMap[String(teamId || "")] || [], [rosterMap, teamId]);

  return (
    <section className={styles.toolColumn}>
      <label className={styles.field}>
        <select className={styles.select} value={teamId} onChange={(event) => onTeamChange(event.target.value)}>
          <option value="">Team</option>
          {teams.map((team) => (
            <option key={team.teamId} value={team.teamId}>{team.fullName}</option>
          ))}
        </select>
      </label>

      <div className={styles.playerFields}>
        {Array.from({ length: 5 }, (_, index) => {
          const selectedIds = new Set(playerIds.filter(Boolean));
          const currentId = playerIds[index] || "";
          selectedIds.delete(currentId);
          return (
            <label key={`${columnId}-player-${index}`} className={styles.field}>
              <select
                className={styles.select}
                value={currentId}
                onChange={(event) => onPlayerChange(index, event.target.value)}
                disabled={!teamId}
              >
                <option value="">Player</option>
                {roster.map((player) => (
                  <option
                    key={player.personId}
                    value={player.personId}
                    disabled={selectedIds.has(player.personId)}
                  >
                    {formatPlayerOption(player)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function DiagnosticEntry({ entry }) {
  const attempts = Array.isArray(entry?.attempts) ? entry.attempts : [];
  return (
    <div className={styles.diagnosticEntry}>
      <div className={styles.diagnosticHeader}>
        <span>{entry?.label || entry?.teamId || "Asset"}</span>
        {entry?.personId ? <span className={styles.diagnosticMeta}>ID {entry.personId}</span> : null}
      </div>
      {attempts.length ? attempts.map((attempt, index) => (
        <div key={`${attempt.sourceUrl || attempt.proxiedUrl}-${index}`} className={styles.diagnosticAttempt}>
          <div className={styles.diagnosticUrl}>{attempt.sourceUrl || attempt.proxiedUrl || "No URL"}</div>
          <div className={styles.diagnosticStageRow}>
            {attempt.stages.map((stage, stageIndex) => (
              <span
                key={`${attempt.sourceUrl || attempt.proxiedUrl}-${stage.stage}-${stageIndex}`}
                className={stage.ok ? styles.stageOk : styles.stageFail}
              >
                {stage.stage}
                {stage.status ? ` ${stage.status}` : ""}
                {stage.contentType ? ` ${stage.contentType}` : ""}
                {stage.width && stage.height ? ` ${stage.width}x${stage.height}` : ""}
                {stage.message ? ` ${stage.message}` : ""}
              </span>
            ))}
          </div>
        </div>
      )) : (
        <div className={styles.diagnosticEmpty}>No attempts recorded.</div>
      )}
    </div>
  );
}

export default function Tools() {
  const { accountsEnabled, user, profile, hasFeature } = useAuth();
  const [params, setParams] = useSearchParams();
  const defaultDraft = useMemo(() => buildDefaultDraftForProfile(profile), [profile]);
  const [draft, setDraft] = useState(defaultDraft);
  const [recordId, setRecordId] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [exportDiagnostics, setExportDiagnostics] = useState(null);

  const canUseTools = hasFeature("tools");
  const draftParam = String(params.get("draft") || "").trim();
  const { data: availableTeamsQuery = [] } = useQuery({
    queryKey: ["tools-wnba-teams"],
    queryFn: fetchWnbaTeams,
    enabled: canUseTools,
    staleTime: 6 * 60 * 60 * 1000,
  });
  const { data: remoteWnbaRostersPayload } = useQuery({
    queryKey: ["tools-current-wnba-rosters"],
    queryFn: fetchCurrentWnbaRosters,
    enabled: canUseTools,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
  const availableTeams = useMemo(() => {
    if (Array.isArray(availableTeamsQuery) && availableTeamsQuery.length) {
      return availableTeamsQuery;
    }
    return buildAvailableTeamsFromRosterPayload(remoteWnbaRostersPayload);
  }, [availableTeamsQuery, remoteWnbaRostersPayload]);

  const wnbaRosterMap = useMemo(() => {
    const remoteTeams = remoteWnbaRostersPayload?.teams && typeof remoteWnbaRostersPayload.teams === "object"
      ? remoteWnbaRostersPayload.teams
      : {};
    const next = {};
    availableTeams.forEach((team) => {
      const remoteRoster = Array.isArray(remoteTeams?.[team.teamId]?.players)
        ? remoteTeams[team.teamId].players.map((player) => ({
          personId: String(player?.personId || "").trim(),
          firstName: String(player?.firstName || "").trim(),
          familyName: String(player?.familyName || "").trim(),
          fullName: String(player?.fullName || "").trim(),
          jerseyNum: String(player?.jerseyNum || "").trim(),
          teamId: String(player?.teamId || team.teamId).trim() || team.teamId,
        })).filter((player) => player.personId && player.fullName)
        : [];
      next[team.teamId] = remoteRoster;
    });
    return next;
  }, [availableTeams, remoteWnbaRostersPayload]);

  const league = "wnba";
  const rosterMap = wnbaRosterMap;
  const remoteRostersPayload = remoteWnbaRostersPayload;
  const leftRoster = useMemo(() => rosterMap[String(draft.leftTeamId || "")] || [], [draft.leftTeamId, rosterMap]);
  const rightRoster = useMemo(() => rosterMap[String(draft.rightTeamId || "")] || [], [draft.rightTeamId, rosterMap]);
  const leftTeam = useMemo(() => availableTeams.find((team) => team.teamId === draft.leftTeamId) || null, [availableTeams, draft.leftTeamId]);
  const rightTeam = useMemo(() => availableTeams.find((team) => team.teamId === draft.rightTeamId) || null, [availableTeams, draft.rightTeamId]);
  const selectedLeftPlayers = useMemo(
    () => resolveSelectedPlayers(draft.leftPlayerIds, leftRoster),
    [draft.leftPlayerIds, leftRoster]
  );
  const selectedRightPlayers = useMemo(
    () => resolveSelectedPlayers(draft.rightPlayerIds, rightRoster),
    [draft.rightPlayerIds, rightRoster]
  );
  const exportReady = Boolean(
    leftTeam &&
    rightTeam &&
    draft.logoTeamId &&
    selectedLeftPlayers.every(Boolean) &&
    selectedRightPlayers.every(Boolean)
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDraft() {
      if (!draftParam || !user?.id) {
        if (cancelled) return;
        setRecordId("");
        setDraft(defaultDraft);
        setSaveStatus("");
        return;
      }

      let savedRecord = null;
      try {
        savedRecord = accountsEnabled
          ? await getSavedToolRecordRemote(user.id, draftParam)
          : getSavedToolRecord(user.id, draftParam);
      } catch (error) {
        console.error("Failed to load remote tool draft, falling back to local storage.", error);
        savedRecord = getSavedToolRecord(user.id, draftParam);
      }

      if (cancelled) return;

      if (!savedRecord?.payload) {
        setRecordId("");
        setDraft(defaultDraft);
        setSaveStatus("");
        return;
      }

      setRecordId(savedRecord.id);
      setDraft(hydrateDraftPayload(savedRecord.payload, defaultDraft));
      setSaveStatus(`Loaded ${savedRecord.title}`);
    }

    loadDraft();

    return () => {
      cancelled = true;
    };
  }, [accountsEnabled, defaultDraft, draftParam, user?.id]);

  useEffect(() => {
    if (draftParam) return;
    setDraft((current) => (isDraftBlank(current) ? defaultDraft : current));
  }, [defaultDraft, draftParam]);

  if (accountsEnabled && !canUseTools) {
    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.kicker}>Tools</div>
          <h1 className={styles.title}>Access Required</h1>
          <p className={styles.subtitle}>An admin needs to grant the Tools feature flag before you can use this page.</p>
        </section>
      </div>
    );
  }

  const handleTeamChange = (side, nextTeamId) => {
    setDraft((current) => ({
      ...current,
      [`${side}TeamId`]: nextTeamId,
      [`${side}PlayerIds`]: [...EMPTY_PLAYER_IDS],
    }));
    setSaveStatus("");
  };

  const handlePlayerChange = (side, index, nextPlayerId) => {
    setDraft((current) => {
      const key = `${side}PlayerIds`;
      const nextIds = [...current[key]];
      nextIds[index] = String(nextPlayerId || "").trim();
      return {
        ...current,
        [key]: nextIds,
      };
    });
    setSaveStatus("");
  };

  const handleSave = async () => {
    if (!user?.id) return;
    if (busyAction) return;
    setBusyAction("save");
    const id = recordId || crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const record = {
      id,
      type: "matchup_graphic",
      title: buildDraftTitle({ ...draft, availableTeams }),
      updatedAt: timestamp,
      createdAt: timestamp,
      payload: draft,
    };

    try {
      const savedRecord = accountsEnabled
        ? await saveToolRecordRemote(user.id, record)
        : saveToolRecord(user.id, record);
      if (!savedRecord) return;
      setRecordId(savedRecord.id);
      const nextParams = new URLSearchParams(params);
      nextParams.set("draft", savedRecord.id);
      setParams(nextParams, { replace: true });
      setSaveStatus(`Saved to My Vault as ${savedRecord.title}`);
    } catch (error) {
      console.error("Failed to save tool draft remotely, falling back to local storage.", error);
      const savedRecord = saveToolRecord(user.id, record);
      if (!savedRecord) return;
      setRecordId(savedRecord.id);
      const nextParams = new URLSearchParams(params);
      nextParams.set("draft", savedRecord.id);
      setParams(nextParams, { replace: true });
      setSaveStatus(`Saved locally as ${savedRecord.title}`);
    } finally {
      setBusyAction("");
    }
  };

  const handleDelete = async () => {
    if (!user?.id || !recordId) return;
    const confirmed = window.confirm("Delete this saved match-up draft?");
    if (!confirmed) return;
    if (busyAction) return;
    setBusyAction("delete");
    try {
      if (accountsEnabled) {
        await deleteSavedToolRecordRemote(user.id, recordId);
      } else {
        deleteSavedToolRecord(user.id, recordId);
      }
      setRecordId("");
      setDraft(defaultDraft);
      const nextParams = new URLSearchParams(params);
      nextParams.delete("draft");
      setParams(nextParams, { replace: true });
      setSaveStatus("Deleted saved draft.");
    } catch (error) {
      console.error("Failed to delete remote tool draft, falling back to local storage.", error);
      deleteSavedToolRecord(user.id, recordId);
      setRecordId("");
      setDraft(defaultDraft);
      const nextParams = new URLSearchParams(params);
      nextParams.delete("draft");
      setParams(nextParams, { replace: true });
      setSaveStatus("Deleted saved draft locally.");
    } finally {
      setBusyAction("");
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm("Are you sure you want to reset this match-up graphic?");
    if (!confirmed) return;
    setDraft(defaultDraft);
    setRecordId("");
    const nextParams = new URLSearchParams(params);
    nextParams.delete("draft");
    setParams(nextParams, { replace: true });
    setSaveStatus("Reset match-up graphic.");
  };

  const handleExport = async () => {
    if (!exportReady || busyAction) return;
    setBusyAction("export");
    setSaveStatus("Rendering export...");
    setExportDiagnostics(null);
    try {
      const diagnostics = await exportMatchupGraphic({
        league,
        leftPlayers: selectedLeftPlayers,
        rightPlayers: selectedRightPlayers,
        logoTeamId: draft.logoTeamId,
        leftTeam,
        rightTeam,
      });
      setExportDiagnostics(diagnostics);
      const nextPayload = {
        ...draft,
        leftTeamLabel: leftTeam?.fullName || "",
        rightTeamLabel: rightTeam?.fullName || "",
      };
      setDraft(nextPayload);
      setSaveStatus("Exported match-up PNG.");
    } catch (error) {
      console.error("Failed to export match-up graphic.", error);
      setSaveStatus("Export failed. Please try again.");
    } finally {
      setBusyAction("");
    }
  };

  const logoPreviewUrl = draft.logoTeamId ? teamLogoUrl(draft.logoTeamId, league) : "";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Match-Up Graphic Generator</h1>
        {!remoteRostersPayload?.teams ? (
          <p className={styles.statusNote}>
            Live WNBA rosters will appear here once the `wnba-rosters` Supabase function is deployed.
          </p>
        ) : null}
      </section>

      <section className={styles.workspace}>
        <div className={styles.toolGrid}>
          <ToolColumn
            columnId="left"
            teamId={draft.leftTeamId}
            teams={availableTeams}
            playerIds={draft.leftPlayerIds}
            rosterMap={rosterMap}
            onTeamChange={(nextTeamId) => handleTeamChange("left", nextTeamId)}
            onPlayerChange={(index, nextPlayerId) => handlePlayerChange("left", index, nextPlayerId)}
          />

          <ToolColumn
            columnId="right"
            teamId={draft.rightTeamId}
            teams={availableTeams}
            playerIds={draft.rightPlayerIds}
            rosterMap={rosterMap}
            onTeamChange={(nextTeamId) => handleTeamChange("right", nextTeamId)}
            onPlayerChange={(index, nextPlayerId) => handlePlayerChange("right", index, nextPlayerId)}
          />
        </div>

        <div className={styles.footerRow}>
          <label className={`${styles.field} ${styles.logoField}`}>
            <span className={styles.fieldLabel}>Logo</span>
            <select
              className={styles.select}
              value={draft.logoTeamId}
              onChange={(event) => {
                setDraft((current) => ({ ...current, logoTeamId: event.target.value }));
                setSaveStatus("");
              }}
            >
              <option value="">Logo</option>
              {availableTeams.map((team) => (
                <option key={`logo-${team.teamId}`} value={team.teamId}>{team.fullName}</option>
              ))}
            </select>
          </label>

          {logoPreviewUrl ? (
            <div className={styles.logoPreview}>
              <img src={logoPreviewUrl} alt="" />
            </div>
          ) : null}

          <div className={styles.actionCluster}>
            {recordId ? (
              <button type="button" className={styles.secondaryButton} onClick={handleDelete} disabled={Boolean(busyAction)}>
                Delete
              </button>
            ) : null}
            <button type="button" className={styles.secondaryButton} onClick={handleReset} disabled={Boolean(busyAction)}>
              Reset
            </button>
            <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={Boolean(busyAction)}>
              Save
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleExport}
              disabled={!exportReady || Boolean(busyAction)}
              title={exportReady ? "Export the matchup graphic as a PNG" : "Select both teams, all ten players, and a logo first"}
            >
              {busyAction === "export" ? "Exporting..." : "Export"}
            </button>
          </div>
        </div>

        {saveStatus ? <div className={styles.statusNote}>{saveStatus}</div> : null}

        {exportDiagnostics ? (
          <section className={styles.diagnosticsPanel}>
            <h2 className={styles.diagnosticsTitle}>Export Diagnostics</h2>
            <p className={styles.diagnosticsText}>
              This shows the exact image URLs and decode stages used by the exporter in your browser.
            </p>

            <div className={styles.diagnosticsGroup}>
              <div className={styles.diagnosticsGroupTitle}>Left Players</div>
              {exportDiagnostics.leftPlayers.map((entry) => (
                <DiagnosticEntry key={`left-${entry.personId}-${entry.label}`} entry={entry} />
              ))}
            </div>

            <div className={styles.diagnosticsGroup}>
              <div className={styles.diagnosticsGroupTitle}>Right Players</div>
              {exportDiagnostics.rightPlayers.map((entry) => (
                <DiagnosticEntry key={`right-${entry.personId}-${entry.label}`} entry={entry} />
              ))}
            </div>

            <div className={styles.diagnosticsGroup}>
              <div className={styles.diagnosticsGroupTitle}>Logo</div>
              <DiagnosticEntry entry={exportDiagnostics.logo} />
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
