interface Team {
  id: number;
  name: string;
}

interface MatchScore {
  winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
  fullTime: {
    home: number | null;
    away: number | null;
  };
}

interface Match {
  homeTeam: Team;
  awayTeam: Team;
  score: MatchScore;
}

interface TeamForm {
  result: "W" | "D" | "L";
  goalsFor: number;
  goalsAgainst: number;
}

export interface Prediction {
  teams: {
    homeTeamName: string;
    awayTeamName: string;
  };
  homeProb: number;
  awayProb: number;
  predictedWinner: "Home Team" | "Away Team";
}

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
let cachedPredictions: Prediction[] | null = null;
let lastFetched: number | null = null;

const API_TOKEN = process.env.FOOTBALL_DATA_API_KEY ?? "";

// ✅ MAIN FUNCTION
async function getFootballPredictions(): Promise<Prediction[]> {
  try {
    const now = Date.now();

    if (cachedPredictions && lastFetched && now - lastFetched < CACHE_TTL) {
      console.log("Returning cached predictions");
      return cachedPredictions;
    }

    const response = await fetch(`https://api.football-data.org/v4/matches`, {
      headers: { "X-Auth-Token": API_TOKEN },
    });

    if (!response.ok) throw new Error("Failed to fetch matches");

    const data: { matches: Match[] } = await response.json();

    // ✅ LIMIT MATCHES (avoid 429)
    const limitedMatches = data.matches.slice(0, 5);

    const predictions: Prediction[] = [];

    for (const match of limitedMatches) {
      const [homeMatches, awayMatches] = await Promise.all([
        getLastFiveMatches(match.homeTeam.id),
        getLastFiveMatches(match.awayTeam.id),
      ]);

      if (!homeMatches || !awayMatches) continue;

      const prediction = calculateProbabilities(
        {
          homeTeamName: match.homeTeam.name,
          awayTeamName: match.awayTeam.name,
        },
        homeMatches,
        awayMatches,
      );

      if (prediction) predictions.push(prediction);
    }

    cachedPredictions = predictions;
    lastFetched = now;

    return predictions;
  } catch (error) {
    console.error("Error in getFootballPredictions:", error);
    return [];
  }
}

// ✅ CALCULATE
function calculateProbabilities(
  teams: { homeTeamName: string; awayTeamName: string },
  homeMatches: TeamForm[],
  awayMatches: TeamForm[],
): Prediction | null {
  try {
    if (!homeMatches.length || !awayMatches.length) return null;

    const calcFormPoints = (matches: TeamForm[]) =>
      matches.reduce((sum, m) => {
        if (m.result === "W") return sum + 3;
        if (m.result === "D") return sum + 1;
        return sum;
      }, 0);

    const calcGoalsDiff = (matches: TeamForm[]) =>
      matches.reduce((sum, m) => sum + (m.goalsFor - m.goalsAgainst), 0);

    const homeRaw = calcFormPoints(homeMatches) * 0.6 + calcGoalsDiff(homeMatches) * 0.4;
    const awayRaw = calcFormPoints(awayMatches) * 0.6 + calcGoalsDiff(awayMatches) * 0.4;

    const homeScore = Math.max(0, homeRaw);
    const awayScore = Math.max(0, awayRaw);

    const total = homeScore + awayScore;

    if (total === 0) {
      return {
        teams,
        homeProb: 50,
        awayProb: 50,
        predictedWinner: "Home Team",
      };
    }

    const homeProb = Math.round((homeScore / total) * 100);
    const awayProb = 100 - homeProb;

    return {
      teams,
      homeProb,
      awayProb,
      predictedWinner: homeProb >= awayProb ? "Home Team" : "Away Team",
    };
  } catch (error) {
    console.error("Error calculating probabilities:", error);
    return null;
  }
}

// ✅ TEAM FORM
async function getLastFiveMatches(teamId: number): Promise<TeamForm[] | null> {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
      { headers: { "X-Auth-Token": API_TOKEN } },
    );

    if (!response.ok) throw new Error("Failed to fetch team matches");

    const data: { matches: Match[] } = await response.json();

    return data.matches.map((match): TeamForm => {
      const isHome = match.homeTeam.id === teamId;

      const goalsFor = isHome
        ? (match.score.fullTime.home ?? 0)
        : (match.score.fullTime.away ?? 0);

      const goalsAgainst = isHome
        ? (match.score.fullTime.away ?? 0)
        : (match.score.fullTime.home ?? 0);

      let result: "W" | "D" | "L" = "D";

      if (match.score.winner === "DRAW") result = "D";
      else if (
        (match.score.winner === "HOME_TEAM" && isHome) ||
        (match.score.winner === "AWAY_TEAM" && !isHome)
      ) result = "W";
      else result = "L";

      return { result, goalsFor, goalsAgainst };
    });
  } catch (error) {
    console.error("Error fetching team matches:", error);
    return null;
  }
}

// ✅ API ROUTE HANDLER (VERY IMPORTANT)
export default async function handler(req: any, res: any) {
  try {
    const predictions = await getFootballPredictions();
    res.status(200).json(predictions);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}
