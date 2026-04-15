const ASSIGNMENTS_URL = "https://official.nba.com/referee-assignments/";

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, " ");
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanCellText(cellHtml) {
  return decodeEntities(stripTags(cellHtml))
    .replace(/\s+/g, " ")
    .trim();
}

function stripNumberSuffix(value) {
  return String(value || "")
    .replace(/\s*\(#\d+\)\s*/gi, "")
    .trim();
}

function parseAssignmentsFromHtml(html) {
  const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const assignments = [];

  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 4) continue;

    const values = cells.map(cleanCellText);
    const game = values[0] || "";
    const crewChief = stripNumberSuffix(values[1] || "");
    const referee = stripNumberSuffix(values[2] || "");
    const umpire = stripNumberSuffix(values[3] || "");
    const alternate = stripNumberSuffix(values[4] || "");

    if (!game.includes("@")) continue;
    if (!crewChief || !referee || !umpire) continue;

    assignments.push({ game, crewChief, referee, umpire, alternate });
  }

  return assignments;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch(ASSIGNMENTS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NBA Dashboard Assignments Bot)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return res.status(502).json({
        error: `Failed to fetch assignments page (${response.status})`,
      });
    }

    const html = await response.text();
    const assignments = parseAssignmentsFromHtml(html);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
    return res.status(200).json({
      source: ASSIGNMENTS_URL,
      count: assignments.length,
      assignments,
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to fetch assignments",
      detail: error?.message || "unknown",
    });
  }
}
