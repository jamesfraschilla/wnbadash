const ROLE_ORDER = {
  crewChief: 0,
  referee: 1,
  umpire: 2,
};

const ROLE_PATHS = [
  "roleKey",
  "assignment",
  "role",
  "title",
  "position",
  "officialRole",
  "roleName",
  "assignment.name",
  "assignment.title",
  "assignment.role",
  "assignment.position",
  "assignment.description",
  "assignment.label",
  "assignment.type",
  "assignment.assignment",
  "metadata.assignment",
  "metadata.role",
];

const ORDER_PATHS = [
  "assignmentOrder",
  "sortOrder",
  "order",
  "sequence",
  "assignmentSequence",
  "sequenceNumber",
  "positionOrder",
  "officialOrder",
  "assignment.order",
  "assignment.sequence",
  "assignment.sortOrder",
  "assignment.position",
  "assignment.orderNumber",
  "metadata.order",
  "metadata.sequence",
];

let publishedAssignmentsPromise = null;
const OFFICIALS_ASSIGNMENTS_URL = "https://official.nba.com/referee-assignments/";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function deriveSupabaseFunctionUrl() {
  const raw = String(SUPABASE_URL || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname;
    if (!host.endsWith(".supabase.co")) return null;
    const projectRef = host.split(".")[0];
    if (!projectRef) return null;
    return `https://${projectRef}.functions.supabase.co/referee-assignments`;
  } catch {
    return null;
  }
}

const ASSIGNMENTS_PROXY_URLS = [
  import.meta.env.VITE_ASSIGNMENTS_PROXY_URL,
  deriveSupabaseFunctionUrl(),
  "/api/referee-assignments",
].filter(Boolean);
const ASSIGNMENTS_SOURCE_URLS = [
  OFFICIALS_ASSIGNMENTS_URL,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(OFFICIALS_ASSIGNMENTS_URL)}`,
  `https://allorigins.hexlet.app/raw?url=${encodeURIComponent(OFFICIALS_ASSIGNMENTS_URL)}`,
];

export function normalizeNameKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function normalizeGameKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildTeamAssignmentKeys(team) {
  const city = String(team?.teamCity || "").trim();
  const name = String(team?.teamName || "").trim();
  const tricode = String(team?.teamTricode || "").trim();
  const keys = new Set();
  const push = (value) => {
    const normalized = normalizeGameKey(value);
    if (normalized) keys.add(normalized);
  };

  push(city);
  push(name);
  push(`${city} ${name}`);
  push(tricode);

  if (name.toLowerCase() === "liberty") push("new york");
  if (name.toLowerCase() === "fever") push("indiana");
  if (name.toLowerCase() === "storm") push("seattle");
  if (name.toLowerCase() === "sky") push("chicago");
  if (name.toLowerCase() === "mercury") push("phoenix");
  if (name.toLowerCase() === "mystics") push("washington");
  if (name.toLowerCase() === "lynx") push("minnesota");
  if (name.toLowerCase() === "dream") push("atlanta");
  if (name.toLowerCase() === "aces") push("las vegas");
  if (name.toLowerCase() === "wings") push("dallas");
  if (name.toLowerCase() === "sparks") push("los angeles");
  if (name.toLowerCase() === "sun") push("connecticut");
  if (name.toLowerCase() === "valkyries") push("golden state");

  return [...keys];
}

export function normalizeOfficialRole(rawValue) {
  const numericRole = normalizeRoleOrderValue(rawValue);
  if (numericRole != null) {
    if (numericRole === 1) return "crewChief";
    if (numericRole === 2) return "referee";
    if (numericRole === 3) return "umpire";
  }
  const compact = String(rawValue || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (!compact) return null;
  if (compact.includes("alternate")) return "alternate";
  if (compact === "crewchief" || (compact.includes("crew") && compact.includes("chief"))) {
    return "crewChief";
  }
  if (compact.includes("umpire")) return "umpire";
  if (compact.includes("referee")) return "referee";
  return null;
}

function getNestedValue(source, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function normalizeRoleOrderValue(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    const rounded = Math.round(rawValue);
    return rounded >= 1 && rounded <= 3 ? rounded : null;
  }

  const text = String(rawValue ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return parsed >= 1 && parsed <= 3 ? parsed : null;
}

export function getOfficialSortMeta(official) {
  const explicitAlternate = Boolean(official?.isAlternate || official?.alternate);

  let role = null;
  for (const path of ROLE_PATHS) {
    const candidate = getNestedValue(official, path);
    const nextRole = normalizeOfficialRole(candidate);
    if (nextRole) {
      role = nextRole;
      break;
    }
  }

  let order = null;
  for (const path of ORDER_PATHS) {
    const candidate = getNestedValue(official, path);
    const nextOrder = normalizeRoleOrderValue(candidate);
    if (nextOrder != null) {
      order = nextOrder;
      break;
    }
  }

  if (order == null && role && role !== "alternate") {
    order = (ROLE_ORDER[role] ?? 99) + 1;
  }

  return {
    role,
    order,
    isAlternate: explicitAlternate || role === "alternate",
  };
}

export function getOfficialDisplayName(official) {
  const first = String(official?.firstName || "").trim();
  const last = String(official?.familyName || official?.lastName || "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return String(
    official?.name ||
    official?.fullName ||
    official?.displayName ||
    official?.officialName ||
    ""
  ).trim();
}

export function isAlternateOfficial(official) {
  return getOfficialSortMeta(official).isAlternate;
}

function filterPrimaryOfficials(officials) {
  const entries = [...(officials || [])].map((official, index) => ({
    official,
    index,
    isAlternate: isAlternateOfficial(official),
  }));
  const primary = entries.filter(({ isAlternate }) => !isAlternate);

  if (!entries.some(({ isAlternate }) => isAlternate) && entries.length === 4) {
    return entries.slice(0, 3).map(({ official }) => official);
  }

  return primary.map(({ official }) => official);
}

export function sortOfficialsByRole(officials) {
  const primary = filterPrimaryOfficials(officials)
    .map((official, index) => ({
      official,
      index,
      ...getOfficialSortMeta(official),
    }))
    .filter(({ isAlternate }) => !isAlternate);

  const hasExplicitOrder = primary.some(({ order }) => order != null);
  if (hasExplicitOrder) {
    return primary
      .sort((a, b) => {
        const aOrder = a.order == null ? 99 : a.order;
        const bOrder = b.order == null ? 99 : b.order;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.index - b.index;
      })
      .map(({ official }) => official);
  }

  const hasExplicitRole = primary.some(({ role }) => role && role !== "alternate");
  if (!hasExplicitRole) {
    return primary.map(({ official }) => official);
  }

  return primary
    .sort((a, b) => {
      const aOrder = a.role ? (ROLE_ORDER[a.role] ?? 99) : 99;
      const bOrder = b.role ? (ROLE_ORDER[b.role] ?? 99) : 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map(({ official }) => official);
}

export function orderOfficials(officials, publishedOrder = null) {
  const primary = filterPrimaryOfficials(officials);
  if (!publishedOrder?.length) return primary;

  const rankMap = new Map(
    publishedOrder.map((name, index) => [normalizeNameKey(name), index])
  );

  return primary
    .map((official, index) => ({ official, index }))
    .sort((a, b) => {
      const aRank = rankMap.get(normalizeNameKey(getOfficialDisplayName(a.official)));
      const bRank = rankMap.get(normalizeNameKey(getOfficialDisplayName(b.official)));
      const safeARank = aRank == null ? 99 : aRank;
      const safeBRank = bRank == null ? 99 : bRank;
      if (safeARank !== safeBRank) return safeARank - safeBRank;
      return a.index - b.index;
    })
    .map(({ official }) => official);
}

function stripNumberSuffix(value) {
  return String(value || "")
    .replace(/\s*\(#\d+\)\s*/gi, "")
    .trim();
}

function parseAssignmentTables(html) {
  if (!html || typeof DOMParser === "undefined") return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const assignments = rows
      .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() || ""))
      .filter((cells) => cells.length >= 4)
      .map((cells) => ({
        game: cells[0],
        crewChief: stripNumberSuffix(cells[1]),
        referee: stripNumberSuffix(cells[2]),
        umpire: stripNumberSuffix(cells[3]),
        alternate: stripNumberSuffix(cells[4] || ""),
      }))
      .filter((row) => row.crewChief && row.referee && row.umpire);

    if (assignments.length) {
      return assignments;
    }
  }

  return [];
}

function normalizeAssignmentsPayload(payload) {
  const assignments = Array.isArray(payload?.assignments) ? payload.assignments : [];
  return assignments
    .map((row) => ({
      game: String(row?.game || "").trim(),
      crewChief: stripNumberSuffix(row?.crewChief || ""),
      referee: stripNumberSuffix(row?.referee || ""),
      umpire: stripNumberSuffix(row?.umpire || ""),
      alternate: stripNumberSuffix(row?.alternate || ""),
    }))
    .filter((row) => row.crewChief && row.referee && row.umpire);
}

async function fetchAssignmentsViaProxy() {
  for (const proxyUrl of ASSIGNMENTS_PROXY_URLS) {
    try {
      const response = await fetch(proxyUrl, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      const assignments = normalizeAssignmentsPayload(payload);
      if (assignments.length) return assignments;
    } catch {
      // Try the next proxy.
    }
  }
  return [];
}

async function fetchFirstWorkingAssignments() {
  for (const url of ASSIGNMENTS_SOURCE_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const html = await response.text();
      const assignments = parseAssignmentTables(html);
      if (assignments.length) return assignments;
    } catch {
      // Try the next source.
    }
  }

  return [];
}

async function fetchPublishedAssignments() {
  if (!publishedAssignmentsPromise) {
    publishedAssignmentsPromise = fetchAssignmentsViaProxy()
      .then((proxyAssignments) => {
        if (proxyAssignments.length) return proxyAssignments;
        return fetchFirstWorkingAssignments();
      })
      .then((assignments) => {
        if (assignments.length) return assignments;

        return fetch(
          "https://official.nba.com/wp-json/wp/v2/posts?slug=referee-assignments&_fields=content.rendered"
        , { cache: "no-store" })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed legacy assignments request: ${response.status}`);
            }
            return response.json();
          })
          .then((payload) => parseAssignmentTables(payload?.[0]?.content?.rendered));
      })
      .catch(() => []);
  }

  return publishedAssignmentsPromise;
}

export async function fetchPublishedOrderForOfficials(officials) {
  const nameSet = new Set(
    (officials || [])
      .map((official) => normalizeNameKey(getOfficialDisplayName(official)))
      .filter(Boolean)
  );

  if (nameSet.size < 3) return null;

  const assignments = await fetchPublishedAssignments();
  for (const row of assignments) {
    const publishedNames = [row.crewChief, row.referee, row.umpire];
    const matchCount = publishedNames.reduce((count, name) => (
      nameSet.has(normalizeNameKey(name)) ? count + 1 : count
    ), 0);

    if (matchCount === 3) {
      return publishedNames;
    }
  }

  return null;
}

function assignmentMatchesGame(row, awayTeam, homeTeam) {
  const gameKey = normalizeGameKey(row?.game || "");
  if (!gameKey) return false;

  const awayKeys = buildTeamAssignmentKeys(awayTeam);
  const homeKeys = buildTeamAssignmentKeys(homeTeam);
  const hasAway = awayKeys.some((key) => gameKey.includes(key));
  const hasHome = homeKeys.some((key) => gameKey.includes(key));
  return hasAway && hasHome;
}

function buildPublishedOfficial(fullName, roleKey, order) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    personId: `published-${normalizeNameKey(fullName)}`,
    firstName: parts.slice(0, -1).join(" ") || parts[0] || "",
    familyName: parts.length > 1 ? parts.slice(-1).join(" ") : "",
    jerseyNum: "",
    roleKey,
    assignmentOrder: order,
  };
}

export async function fetchPublishedOfficialsForGame({ awayTeam, homeTeam }) {
  if (!awayTeam || !homeTeam) return [];

  const assignments = await fetchPublishedAssignments();
  const match = assignments.find((row) => assignmentMatchesGame(row, awayTeam, homeTeam));
  if (!match) return [];

  return [
    buildPublishedOfficial(match.crewChief, "crewChief", 1),
    buildPublishedOfficial(match.referee, "referee", 2),
    buildPublishedOfficial(match.umpire, "umpire", 3),
    ...(match.alternate ? [buildPublishedOfficial(match.alternate, "alternate", 4)] : []),
  ];
}
