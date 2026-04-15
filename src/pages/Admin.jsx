import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createManagedUser, createUserInvite, fetchPendingInvites, fetchVisibleProfiles, updateProfile } from "../accountData.js";
import { ACCOUNT_FEATURE_FLAGS, ACCOUNT_ROLES, ACCOUNT_TEAM_SCOPES } from "../authConfig.js";
import { useAuth } from "../auth/useAuth.js";
import { fetchCurrentWnbaRosters, fetchWnbaTeams } from "../api.js";
import {
  deleteMatchupProfile,
  listMatchupProfiles,
  MATCHUP_ARCHETYPE_OPTIONS,
  MATCHUP_DEFENDER_ROLE_OPTIONS,
  MATCHUP_OFFENSIVE_ROLE_OPTIONS,
  normalizeMatchupProfileRecord,
  saveMatchupProfile,
} from "../matchupProfileData.js";
import {
  fetchRemotePregamePlayers,
  loadPregamePlayersPayload,
  normalizePregamePlayers,
  persistPregamePlayers,
  resolveSharedPregamePlayersPayload,
  saveRemotePregamePlayers,
} from "../pregamePlayers.js";
import styles from "./Admin.module.css";

function formatTimestamp(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function buildEmptyMatchupProfileDraft() {
  return {
    personId: "",
    league: "wnba",
    teamId: "",
    fullName: "",
    heightIn: "",
    archetype: "",
    defenderRole: "",
    offensiveRole: "",
    preferOffensiveRoles: [],
    avoidOffensiveRoles: [],
    preferOpponentIds: [],
    avoidOpponentIds: [],
  };
}

function buildSortableJersey(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function formatPlayerOption(player) {
  const jersey = String(player?.jerseyNum || "").trim();
  const label = String(player?.fullName || "").trim();
  if (!label) return "";
  return jersey ? `#${jersey} ${label}` : label;
}

function parseMultiSelectValues(event) {
  return Array.from(event.target.selectedOptions || []).map((option) => String(option.value || "").trim()).filter(Boolean);
}

function parseHeightToInches(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(\d+)\D+(\d+)/);
  if (!match?.[1] || !match?.[2]) return "";
  return (Number.parseInt(match[1], 10) * 12) + Number.parseInt(match[2], 10);
}

function formatHeightLabel(heightIn) {
  const numericHeight = Number.parseInt(String(heightIn || "").trim(), 10);
  if (!Number.isFinite(numericHeight) || numericHeight <= 0) return "Unavailable";
  const feet = Math.floor(numericHeight / 12);
  const inches = numericHeight % 12;
  return `${feet}'${inches}"`;
}

const ADMIN_SECTIONS = [
  {
    key: "accounts",
    kicker: "Accounts",
    title: "User administration",
  },
  {
    key: "invites",
    kicker: "Accounts",
    title: "Pending invites",
  },
  {
    key: "users",
    kicker: "Accounts",
    title: "User profiles",
  },
  {
    key: "rosters",
    kicker: "Team Data",
    title: "Shared team rosters",
  },
  {
    key: "matchups",
    kicker: "Match-Ups",
    title: "Smart matchup profiles",
  },
];

function ProfileCard({ profile, actorId, onSave }) {
  const [draftRole, setDraftRole] = useState(profile.role || "coach");
  const [draftStatus, setDraftStatus] = useState(profile.status || "active");
  const [draftScopes, setDraftScopes] = useState(profile.team_scopes || []);
  const [draftFeatureFlags, setDraftFeatureFlags] = useState(profile.feature_flags || []);
  const [saving, setSaving] = useState(false);

  const toggleScope = (scope) => {
    setDraftScopes((prev) => (
      prev.includes(scope)
        ? prev.filter((value) => value !== scope)
        : [...prev, scope]
    ));
  };

  const toggleFeatureFlag = (flag) => {
    setDraftFeatureFlags((prev) => (
      prev.includes(flag)
        ? prev.filter((value) => value !== flag)
        : [...prev, flag]
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(profile.id, {
      role: draftRole,
      status: draftStatus,
      team_scopes: draftScopes,
      feature_flags: draftFeatureFlags,
    }, actorId);
    setSaving(false);
  };

  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div>
          <div className={styles.profileName}>{profile.display_name || profile.email}</div>
          <div className={styles.profileEmail}>{profile.email}</div>
        </div>
        <div className={styles.profileMeta}>
          <span>Last login: {formatTimestamp(profile.last_login_at)}</span>
          <span>Created: {formatTimestamp(profile.created_at)}</span>
        </div>
      </div>

      <div className={styles.profileGrid}>
        <label className={styles.field}>
          <span>Role</span>
          <select value={draftRole} onChange={(event) => setDraftRole(event.target.value)}>
            {ACCOUNT_ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Status</span>
          <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>

      <div className={styles.scopeGroup}>
        <div className={styles.scopeLabel}>Team scopes</div>
        <div className={styles.scopeOptions}>
          {ACCOUNT_TEAM_SCOPES.map((scope) => (
            <label key={scope} className={styles.scopeOption}>
              <input
                type="checkbox"
                checked={draftScopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              <span>{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.scopeGroup}>
        <div className={styles.scopeLabel}>Feature access</div>
        <div className={styles.scopeOptions}>
          {ACCOUNT_FEATURE_FLAGS.map((feature) => (
            <label key={feature.key} className={styles.scopeOption}>
              <input
                type="checkbox"
                checked={draftFeatureFlags.includes(feature.key)}
                onChange={() => toggleFeatureFlag(feature.key)}
              />
              <span>{feature.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.profileActions}>
        <button type="button" className={styles.saveButton} disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save User"}
        </button>
      </div>
    </div>
  );
}

function TeamRosterCard({ teamScope, title }) {
  const queryClient = useQueryClient();
  const [draftPlayers, setDraftPlayers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [localRosterVersion, setLocalRosterVersion] = useState(0);

  const { data: remoteRoster, isLoading } = useQuery({
    queryKey: ["admin-team-roster", teamScope],
    queryFn: () => fetchRemotePregamePlayers(teamScope),
  });

  const localRoster = useMemo(() => loadPregamePlayersPayload(teamScope), [teamScope, localRosterVersion]);
  const roster = useMemo(
    () => resolveSharedPregamePlayersPayload(localRoster, remoteRoster).players,
    [localRoster, remoteRoster]
  );

  useEffect(() => {
    setDraftPlayers(roster.map((player) => ({
      id: player.id,
      name: player.name,
      display: player.display,
      personId: player.personId || "",
      cap: player.cap === "" ? "" : Number(player.cap || 48),
    })));
  }, [roster]);

  const updatePlayer = (playerId, field, value) => {
    setDraftPlayers((current) => current.map((player) => {
      if (player.id !== playerId) return player;
      if (field === "cap") {
        if (value === "") return { ...player, cap: "" };
        const parsed = Number.parseInt(value, 10);
        return { ...player, cap: Number.isFinite(parsed) ? parsed : player.cap };
      }
      return { ...player, [field]: value };
    }));
  };

  const handleAdd = () => {
    setDraftPlayers((current) => [
      ...current,
      { id: crypto.randomUUID(), name: "", display: "", personId: "", cap: 48 },
    ]);
  };

  const handleDelete = (playerId) => {
    setDraftPlayers((current) => current.filter((player) => player.id !== playerId));
  };

  const handleSave = async () => {
    const normalized = normalizePregamePlayers(
      draftPlayers.filter((player) => String(player.name || "").trim() && String(player.display || "").trim())
    );
    const updatedAt = Date.now();
    setSaveMessage("");
    setIsSaving(true);
    try {
      persistPregamePlayers(teamScope, normalized, updatedAt);
      setLocalRosterVersion(updatedAt);
      await saveRemotePregamePlayers(teamScope, normalized, updatedAt);
      await queryClient.invalidateQueries({ queryKey: ["admin-team-roster", teamScope] });
      setSaveMessage("Roster saved.");
    } catch (error) {
      setSaveMessage(error?.message || "Unable to save roster.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.rosterCard}>
      <div className={styles.rosterHeader}>
        <h3 className={styles.subTitle}>{title}</h3>
        <button type="button" className={styles.secondaryButton} onClick={handleAdd}>Add Player</button>
      </div>
      {isLoading ? (
        <div className={styles.noticeCard}>Loading roster...</div>
      ) : (
        <>
          <div className={styles.rosterGridHeader}>
            <span>Name</span>
            <span>Display</span>
            <span>Player ID</span>
            <span>Cap</span>
            <span>Actions</span>
          </div>
          <div className={styles.rosterRows}>
            {draftPlayers.map((player) => (
              <div key={player.id} className={styles.rosterRow}>
                <input value={player.name} onChange={(event) => updatePlayer(player.id, "name", event.target.value)} />
                <input value={player.display} onChange={(event) => updatePlayer(player.id, "display", event.target.value)} />
                <input value={player.personId || ""} onChange={(event) => updatePlayer(player.id, "personId", event.target.value)} />
                <input value={player.cap === "" ? "" : String(player.cap)} onChange={(event) => updatePlayer(player.id, "cap", event.target.value)} />
                <button type="button" className={styles.dangerButton} onClick={() => handleDelete(player.id)}>Delete</button>
              </div>
            ))}
          </div>
          <div className={styles.profileActions}>
            <button type="button" className={styles.saveButton} disabled={isSaving} onClick={handleSave}>
              {isSaving ? "Saving..." : "Save Roster"}
            </button>
          </div>
          {saveMessage ? <div className={styles.message}>{saveMessage}</div> : null}
        </>
      )}
    </div>
  );
}

function MatchupProfileCard({
  availableTeams,
  rosterSources,
  savedProfiles,
  onSave,
  onDelete,
}) {
  const [draft, setDraft] = useState(buildEmptyMatchupProfileDraft());
  const [useHeightOverride, setUseHeightOverride] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedTeamFilter, setSavedTeamFilter] = useState("all");

  const leagueTeams = availableTeams;
  const rosterMap = rosterSources.wnba;
  const teamNameById = useMemo(
    () => Object.fromEntries(availableTeams.map((team) => [String(team.teamId), team.fullName])),
    [availableTeams]
  );

  const teamPlayers = useMemo(() => {
    const players = Array.isArray(rosterMap?.[draft.teamId]) ? rosterMap[draft.teamId] : [];
    return [...players].sort((a, b) => {
      const jerseyCompare = buildSortableJersey(a.jerseyNum) - buildSortableJersey(b.jerseyNum);
      if (jerseyCompare !== 0) return jerseyCompare;
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    });
  }, [draft.teamId, rosterMap]);

  const selectedPlayer = useMemo(
    () => teamPlayers.find((player) => player.personId === draft.personId) || null,
    [draft.personId, teamPlayers]
  );

  const derivedHeightIn = selectedPlayer?.heightIn ?? "";

  const allLeaguePlayers = useMemo(() => {
    const options = Object.values(rosterMap || {})
      .flat()
      .filter((player) => player?.personId && player?.fullName);
    return [...options].sort((a, b) => {
      const teamCompare = String(a.teamName || "").localeCompare(String(b.teamName || ""));
      if (teamCompare !== 0) return teamCompare;
      const jerseyCompare = buildSortableJersey(a.jerseyNum) - buildSortableJersey(b.jerseyNum);
      if (jerseyCompare !== 0) return jerseyCompare;
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    });
  }, [rosterMap]);

  const savedTeamOptions = useMemo(() => {
    const seen = new Set();
    return savedProfiles
      .map((profile) => {
        const teamId = String(profile.teamId || "").trim();
        if (!teamId) return null;
        const key = `wnba:${teamId}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const teamName = teamNameById[teamId] || teamId;
        return {
          key,
          league: "wnba",
          teamId,
          label: `WNBA · ${teamName}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [savedProfiles, teamNameById]);

  const filteredSavedProfiles = useMemo(() => {
    if (savedTeamFilter === "all") return savedProfiles;
    return savedProfiles.filter((profile) => `wnba:${profile.teamId}` === savedTeamFilter);
  }, [savedProfiles, savedTeamFilter]);

  const handleDraftChange = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleTeamChange = (teamId) => {
    setDraft((current) => ({
      ...current,
      teamId,
      personId: "",
      fullName: "",
      heightIn: "",
      preferOpponentIds: [],
      avoidOpponentIds: [],
    }));
    setUseHeightOverride(false);
    setSaveMessage("");
  };

  const handlePlayerChange = (personId) => {
    const selected = teamPlayers.find((player) => player.personId === personId) || null;
    const existing = savedProfiles.find((profile) => profile.personId === personId) || null;
    if (existing) {
      const selectedHeight = selected?.heightIn ?? "";
      const existingHeight = existing.heightIn ?? "";
      setDraft({
        personId: existing.personId,
        league: existing.league,
        teamId: existing.teamId,
        fullName: existing.fullName,
        heightIn: existing.heightIn ?? "",
        archetype: existing.archetype || "",
        defenderRole: existing.defenderRole || "",
        offensiveRole: existing.offensiveRole || "",
        preferOffensiveRoles: [...(existing.preferOffensiveRoles || [])],
        avoidOffensiveRoles: [...(existing.avoidOffensiveRoles || [])],
        preferOpponentIds: [...(existing.preferOpponentIds || [])],
        avoidOpponentIds: [...(existing.avoidOpponentIds || [])],
      });
      setUseHeightOverride(existingHeight !== "" && String(existingHeight) !== String(selectedHeight));
      setSaveMessage("");
      return;
    }

    setDraft((current) => ({
      ...current,
      personId,
      fullName: selected?.fullName || "",
      heightIn: "",
      preferOpponentIds: [],
      avoidOpponentIds: [],
    }));
    setUseHeightOverride(false);
    setSaveMessage("");
  };

  const handleEdit = (profile) => {
      const rosterPlayer = (rosterSources?.wnba || {});
    const selectedHeight = Array.isArray(rosterPlayer?.[profile.teamId])
      ? (rosterPlayer[profile.teamId].find((player) => player.personId === profile.personId)?.heightIn ?? "")
      : "";
    setDraft({
      personId: profile.personId,
      league: profile.league,
      teamId: profile.teamId,
      fullName: profile.fullName,
      heightIn: profile.heightIn ?? "",
      archetype: profile.archetype || "",
      defenderRole: profile.defenderRole || "",
      offensiveRole: profile.offensiveRole || "",
      preferOffensiveRoles: [...(profile.preferOffensiveRoles || [])],
      avoidOffensiveRoles: [...(profile.avoidOffensiveRoles || [])],
      preferOpponentIds: [...(profile.preferOpponentIds || [])],
      avoidOpponentIds: [...(profile.avoidOpponentIds || [])],
    });
    setUseHeightOverride(profile.heightIn != null && String(profile.heightIn) !== "" && String(profile.heightIn) !== String(selectedHeight));
    setSaveMessage("");
  };

  const handleReset = () => {
    setDraft(buildEmptyMatchupProfileDraft());
    setUseHeightOverride(false);
    setSaveMessage("");
  };

  const handleSave = async () => {
    if (!draft.personId || !draft.fullName) {
      setSaveMessage("Select a player first.");
      return;
    }
    setIsSaving(true);
    setSaveMessage("");
    try {
      await onSave({
        ...draft,
        heightIn: useHeightOverride
          ? (draft.heightIn === "" ? null : draft.heightIn)
          : (derivedHeightIn === "" ? null : derivedHeightIn),
      });
      setSaveMessage("Matchup profile saved.");
    } catch (error) {
      setSaveMessage(error?.message || "Unable to save matchup profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.personId) {
      setSaveMessage("Select a saved profile to delete.");
      return;
    }
    setIsDeleting(true);
    setSaveMessage("");
    try {
      await onDelete(draft.personId);
      setSaveMessage("Matchup profile deleted.");
      setDraft(buildEmptyMatchupProfileDraft());
    } catch (error) {
      setSaveMessage(error?.message || "Unable to delete matchup profile.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={styles.rosterCard}>
      <div className={styles.rosterHeader}>
        <h3 className={styles.subTitle}>Matchup Profiles</h3>
        <button type="button" className={styles.secondaryButton} onClick={handleReset}>New Profile</button>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>League</span>
          <input type="text" value="WNBA" readOnly />
        </label>
        <label className={styles.field}>
          <span>Team</span>
          <select value={draft.teamId} onChange={(event) => handleTeamChange(event.target.value)}>
            <option value="">Select team</option>
            {leagueTeams.map((team) => (
              <option key={team.teamId} value={team.teamId}>{team.fullName}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Player</span>
          <select value={draft.personId} onChange={(event) => handlePlayerChange(event.target.value)} disabled={!draft.teamId}>
            <option value="">Select player</option>
            {teamPlayers.map((player) => (
              <option key={player.personId} value={player.personId}>{formatPlayerOption(player)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Roster height</span>
          <input type="text" value={formatHeightLabel(derivedHeightIn)} readOnly />
        </label>
      </div>

      <div className={styles.scopeGroup}>
        <label className={styles.scopeOption}>
          <input
            type="checkbox"
            checked={useHeightOverride}
            onChange={(event) => setUseHeightOverride(event.target.checked)}
          />
          <span>Override roster height</span>
        </label>
      </div>

      {useHeightOverride ? (
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Height override (inches)</span>
            <input
              type="number"
              value={draft.heightIn}
              onChange={(event) => handleDraftChange("heightIn", event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
      ) : null}

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Archetype</span>
          <select value={draft.archetype} onChange={(event) => handleDraftChange("archetype", event.target.value)}>
            <option value="">Auto</option>
            {MATCHUP_ARCHETYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Defender role</span>
          <select value={draft.defenderRole} onChange={(event) => handleDraftChange("defenderRole", event.target.value)}>
            <option value="">Auto</option>
            {MATCHUP_DEFENDER_ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Offensive role</span>
          <select value={draft.offensiveRole} onChange={(event) => handleDraftChange("offensiveRole", event.target.value)}>
            <option value="">Auto</option>
            {MATCHUP_OFFENSIVE_ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Prefer offensive roles</span>
          <select multiple value={draft.preferOffensiveRoles} onChange={(event) => handleDraftChange("preferOffensiveRoles", parseMultiSelectValues(event))}>
            {MATCHUP_OFFENSIVE_ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Avoid offensive roles</span>
          <select multiple value={draft.avoidOffensiveRoles} onChange={(event) => handleDraftChange("avoidOffensiveRoles", parseMultiSelectValues(event))}>
            {MATCHUP_OFFENSIVE_ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Prefer opponents</span>
          <select multiple value={draft.preferOpponentIds} onChange={(event) => handleDraftChange("preferOpponentIds", parseMultiSelectValues(event))}>
            {allLeaguePlayers.map((player) => (
              <option key={`prefer-${player.personId}`} value={player.personId}>
                {`${player.teamName || ""} · ${formatPlayerOption(player)}`.trim()}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Avoid opponents</span>
          <select multiple value={draft.avoidOpponentIds} onChange={(event) => handleDraftChange("avoidOpponentIds", parseMultiSelectValues(event))}>
            {allLeaguePlayers.map((player) => (
              <option key={`avoid-${player.personId}`} value={player.personId}>
                {`${player.teamName || ""} · ${formatPlayerOption(player)}`.trim()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.profileActions}>
        <button type="button" className={styles.dangerButton} onClick={handleDelete} disabled={isDeleting || !draft.personId}>
          {isDeleting ? "Deleting..." : "Delete Profile"}
        </button>
        <button type="button" className={styles.saveButton} onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Profile"}
        </button>
      </div>
      {saveMessage ? <div className={styles.message}>{saveMessage}</div> : null}

      <div className={styles.list}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Saved team</span>
            <select value={savedTeamFilter} onChange={(event) => setSavedTeamFilter(event.target.value)}>
              <option value="all">All teams</option>
              {savedTeamOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        {filteredSavedProfiles.length ? filteredSavedProfiles.map((profile) => (
          <div key={profile.personId} className={styles.inviteRow}>
            <div>
              <div className={styles.profileName}>{profile.fullName || profile.personId}</div>
              <div className={styles.inviteMeta}>
                {["WNBA", profile.archetype || "auto", profile.defenderRole || "auto", profile.offensiveRole || "auto"]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => handleEdit(profile)}>Edit</button>
          </div>
        )) : (
          <div className={styles.noticeCard}>
            {savedProfiles.length ? "No matchup profile overrides saved for that team yet." : "No matchup profile overrides saved yet."}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const { user, session, profile } = useAuth();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState("accounts");
  const [inviteForm, setInviteForm] = useState({
    email: "",
    displayName: "",
    password: "",
    role: "coach",
    teamScopes: [...ACCOUNT_TEAM_SCOPES],
  });
  const [inviteMessage, setInviteMessage] = useState("");

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ["visible-profiles"],
    queryFn: fetchVisibleProfiles,
    enabled: Boolean(user?.id),
  });

  const { data: invites = [], isLoading: loadingInvites } = useQuery({
    queryKey: ["account-invites"],
    queryFn: fetchPendingInvites,
    enabled: Boolean(user?.id),
  });

  const { data: availableTeams = [] } = useQuery({
    queryKey: ["admin-wnba-teams"],
    queryFn: fetchWnbaTeams,
    staleTime: 6 * 60 * 60 * 1000,
    enabled: Boolean(user?.id),
  });

  const { data: remoteWnbaRostersPayload } = useQuery({
    queryKey: ["admin-current-wnba-rosters"],
    queryFn: fetchCurrentWnbaRosters,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    enabled: Boolean(user?.id),
  });

  const { data: savedMatchupProfiles = [] } = useQuery({
    queryKey: ["matchup-player-profiles"],
    queryFn: listMatchupProfiles,
    enabled: Boolean(user?.id),
  });

  const saveProfileMutation = useMutation({
    mutationFn: ({ profileId, updates }) => updateProfile(profileId, updates, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visible-profiles"] });
    },
  });

  const saveMatchupProfileMutation = useMutation({
    mutationFn: saveMatchupProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matchup-player-profiles"] });
    },
  });

  const deleteMatchupProfileMutation = useMutation({
    mutationFn: deleteMatchupProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matchup-player-profiles"] });
    },
  });

  const wnbaRosterSources = useMemo(() => {
    const remoteTeams = remoteWnbaRostersPayload?.teams && typeof remoteWnbaRostersPayload.teams === "object"
      ? remoteWnbaRostersPayload.teams
      : {};
    return availableTeams.reduce((accumulator, team) => {
      const players = Array.isArray(remoteTeams?.[team.teamId]?.players) ? remoteTeams[team.teamId].players : [];
      accumulator[team.teamId] = players.map((player) => ({
        personId: String(player?.personId || "").trim(),
        fullName: String(player?.fullName || "").trim(),
        jerseyNum: String(player?.jerseyNum || "").trim(),
        teamId: String(player?.teamId || team.teamId).trim() || team.teamId,
        teamName: team.fullName,
        heightIn: parseHeightToInches(player?.height),
      })).filter((player) => player.personId && player.fullName);
      return accumulator;
    }, {});
  }, [availableTeams, remoteWnbaRostersPayload]);

  const rosterSources = useMemo(() => ({
    wnba: wnbaRosterSources,
  }), [wnbaRosterSources]);

  const sortedInvites = useMemo(() => invites, [invites]);
  const activeSectionConfig = ADMIN_SECTIONS.find((section) => section.key === activeSection) || ADMIN_SECTIONS[0];

  if (profile?.role !== "admin") {
    return (
      <div className={styles.page}>
        <div className={styles.noticeCard}>Admin access is required to view this page.</div>
      </div>
    );
  }

  const toggleInviteScope = (scope) => {
    setInviteForm((prev) => ({
      ...prev,
      teamScopes: prev.teamScopes.includes(scope)
        ? prev.teamScopes.filter((value) => value !== scope)
        : [...prev.teamScopes, scope],
    }));
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    setInviteMessage("");
    try {
      await createUserInvite({
        accessToken: session?.access_token,
        email: inviteForm.email,
        displayName: inviteForm.displayName,
        role: inviteForm.role,
        teamScopes: inviteForm.teamScopes,
      });
      setInviteMessage("Invite sent.");
      setInviteForm({
        email: "",
        displayName: "",
        password: "",
        role: "coach",
        teamScopes: [...ACCOUNT_TEAM_SCOPES],
      });
      queryClient.invalidateQueries({ queryKey: ["account-invites"] });
    } catch (error) {
      setInviteMessage(error?.message || "Unable to send invite.");
    }
  };

  const handleCreateUser = async () => {
    setInviteMessage("");
    try {
      await createManagedUser({
        accessToken: session?.access_token,
        email: inviteForm.email,
        password: inviteForm.password,
        displayName: inviteForm.displayName,
        role: inviteForm.role,
        teamScopes: inviteForm.teamScopes,
      });
      setInviteMessage("User account created.");
      setInviteForm({
        email: "",
        displayName: "",
        password: "",
        role: "coach",
        teamScopes: [...ACCOUNT_TEAM_SCOPES],
      });
      queryClient.invalidateQueries({ queryKey: ["visible-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["account-invites"] });
    } catch (error) {
      setInviteMessage(error?.message || "Unable to create user.");
    }
  };

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.kicker}>Admin</div>
          <h2 className={styles.title}>Settings</h2>
        </div>
        <nav className={styles.sidebarNav} aria-label="Admin sections">
          {ADMIN_SECTIONS.map((section) => (
            <button
              key={section.key}
              type="button"
              className={`${styles.sidebarButton} ${activeSection === section.key ? styles.sidebarButtonActive : ""}`.trim()}
              onClick={() => setActiveSection(section.key)}
            >
              <span className={styles.sidebarButtonKicker}>{section.kicker}</span>
              <span className={styles.sidebarButtonTitle}>{section.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className={styles.content}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.kicker}>{activeSectionConfig.kicker}</div>
            <h3 className={styles.subTitle}>{activeSectionConfig.title}</h3>
          </div>
        </div>

        {activeSection === "accounts" ? (
          <div className={styles.section}>
            <form className={styles.inviteCard} onSubmit={handleInvite}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="name@monumentalsports.com"
                  />
                </label>
                <label className={styles.field}>
                  <span>Display name</span>
                  <input
                    type="text"
                    value={inviteForm.displayName}
                    onChange={(event) => setInviteForm((prev) => ({ ...prev, displayName: event.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className={styles.field}>
                  <span>Password</span>
                  <input
                    type="password"
                    value={inviteForm.password}
                    onChange={(event) => setInviteForm((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="Required for direct account creation"
                  />
                </label>
                <label className={styles.field}>
                  <span>Role</span>
                  <select
                    value={inviteForm.role}
                    onChange={(event) => setInviteForm((prev) => ({ ...prev, role: event.target.value }))}
                  >
                    {ACCOUNT_ROLES.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.scopeGroup}>
                <div className={styles.scopeLabel}>Team scopes</div>
                <div className={styles.scopeOptions}>
                  {ACCOUNT_TEAM_SCOPES.map((scope) => (
                    <label key={scope} className={styles.scopeOption}>
                      <input
                        type="checkbox"
                        checked={inviteForm.teamScopes.includes(scope)}
                        onChange={() => toggleInviteScope(scope)}
                      />
                      <span>{scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              {inviteMessage ? <div className={styles.message}>{inviteMessage}</div> : null}

              <div className={styles.inviteActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCreateUser}
                  disabled={!inviteForm.email.trim() || inviteForm.password.length < 8}
                >
                  Create User
                </button>
                <button type="submit" className={styles.primaryButton}>
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {activeSection === "invites" ? (
          <div className={styles.section}>
            <div className={styles.list}>
              {loadingInvites ? (
                <div className={styles.noticeCard}>Loading invites...</div>
              ) : sortedInvites.length === 0 ? (
                <div className={styles.noticeCard}>No pending invites.</div>
              ) : (
                sortedInvites.map((invite) => (
                  <div key={invite.id} className={styles.inviteRow}>
                    <div>
                      <div className={styles.inviteEmail}>{invite.email}</div>
                      <div className={styles.inviteMeta}>
                        {invite.role} · {invite.team_scopes?.join(", ") || "No team scopes"}
                      </div>
                    </div>
                    <div className={styles.inviteStatus}>
                      {invite.status} · {formatTimestamp(invite.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {activeSection === "users" ? (
          <div className={styles.section}>
            <div className={styles.list}>
              {loadingProfiles ? (
                <div className={styles.noticeCard}>Loading users...</div>
              ) : (
                profiles.map((item) => (
                  <ProfileCard
                    key={item.id}
                    profile={item}
                    actorId={user?.id}
                    onSave={async (profileId, updates) => {
                      await saveProfileMutation.mutateAsync({ profileId, updates });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        ) : null}

        {activeSection === "rosters" ? (
          <div className={styles.section}>
            <div className={styles.list}>
              <TeamRosterCard teamScope="mystics" title="Mystics" />
            </div>
          </div>
        ) : null}

        {activeSection === "matchups" ? (
          <div className={styles.section}>
            <MatchupProfileCard
              availableTeams={availableTeams}
              rosterSources={rosterSources}
              savedProfiles={savedMatchupProfiles.map((profile) => normalizeMatchupProfileRecord(profile)).filter(Boolean)}
              onSave={(record) => saveMatchupProfileMutation.mutateAsync(record)}
              onDelete={(personId) => deleteMatchupProfileMutation.mutateAsync(personId)}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
