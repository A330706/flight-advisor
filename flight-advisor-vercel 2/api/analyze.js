const SYSTEM_PROMPT = `You are an elite personal flight advisor for a very high-status frequent flyer.

ELITE STATUS:
- American Airlines: Concierge Key (highest tier — confirmed upgrades at booking on domestic upgradeable fares, dedicated CK phone line, systemwide upgrades)
- Delta Air Lines: Diamond Medallion (highest public tier — complimentary upgrades, 4 Global Upgrade Certificates/year, Delta One lounge access)
- Miles: 3 million+ combined (AAdvantage + SkyMiles)

AIRLINE PREFERENCES: Strongly prefer Delta (DL) and American Airlines (AA) metal. Open to partners for exceptional award value.

MILES vs CASH — always present 3 options:
1. CASH BUSINESS CLASS: Best available cash fare for business class, with fare class noted
2. MILES BUSINESS CLASS: Best award redemption for business class — show miles cost, program, and CPM calculation
3. CHEAPEST UPGRADEABLE FARE + STATUS UPGRADE: Lowest fare class eligible for CK/Diamond upgrade, show that fare price, whether upgrade is complimentary or uses a certificate, and net cost

CPM benchmarks:
- AAdvantage miles baseline ~1.5 cpp. Worth spending >1.5 cpp, exceptional >2.0 cpp
- SkyMiles baseline ~1.1 cpp. Worth spending >1.3 cpp, exceptional >1.8 cpp
- Key partner sweet spots: Virgin Atlantic Flying Club for Delta miles to Europe, Japan Airlines for AA miles to Asia, Iberia for AA miles to Europe

UPGRADE STRATEGY:
- Concierge Key: complimentary upgrades confirmed at booking on domestic upgradeable fares. High likelihood on international if inventory opens.
- Diamond: use Global Upgrade Certificates on transatlantic. Complimentary on domestic by availability.
- Cheapest upgradeable economy/PE fare + CK complimentary upgrade often beats buying business outright.

OUTPUT FORMAT — always use exactly these sections:

✈️ ROUTE SUMMARY
Brief route overview, flight time, aircraft, and key considerations for these dates.

💳 OPTION 1 — CASH BUSINESS
Exact fare if available, fare class, what's included (lounge, bags, upgrade eligibility). Value verdict.

🏆 OPTION 2 — MILES BUSINESS  
Best award program, miles required each way and round trip, CPM calculation vs cash fare, availability notes.

💡 OPTION 3 — UPGRADEABLE FARE + STATUS
Cheapest upgradeable fare price and class, upgrade method (complimentary CK / GUC / waitlist), realistic upgrade probability, total effective cost.

⭐ MY RECOMMENDATION
One clear winner in 3 sentences. Be opinionated. State which option wins and exactly why given their status.`;

const EU_AIRPORTS = new Set([
  "LHR","LGW","LCY","STN","MAN","EDI","GLA","BHX","CDG","ORY","NCE","LYS",
  "MRS","TLS","BOD","AMS","FRA","MUC","BER","HAM","DUS","STR","FCO","MXP",
  "LIN","VCE","NAP","MAD","BCN","AGP","PMI","LIS","OPO","ZRH","GVA","BSL",
  "VIE","BRU","CPH","ARN","OSL","HEL","ATH","IST","DUB","PRG","WAW","BUD"
]);

function getRouteType(from, to) {
  return EU_AIRPORTS.has(from) || EU_AIRPORTS.has(to) ? "transatlantic" : "domestic";
}

function getSources(routeType) {
  return routeType === "transatlantic"
    ? "american,delta,virginatlantic,flyingblue,aeroplan"
    : "american,delta,united,alaska";
}

async function fetchAwards(from, to, depart, ret, cabin, seatsKey) {
  const cabinCode = { economy: "Y", "premium economy": "W", business: "J", first: "F" }[cabin] || "J";
  const routeType = getRouteType(from, to);

  const params = new URLSearchParams({
    origin_airport: from,
    destination_airport: to,
    start_date: depart,
    ...(ret ? { end_date: ret } : {}),
    sources: getSources(routeType),
    order_by: "lowest_mileage",
    take: "30",
  });

  const res = await fetch(`https://seats.aero/partnerapi/search?${params}`, {
    headers: { "Partner-Authorization": seatsKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seats.aero ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const rows = data.data || [];
  if (!rows.length) return "No award results from Seats.aero for this route/dates.";

  const avail = rows.filter(r => r[`${cabinCode}Available`]);
  if (!avail.length) {
    const any = rows.filter(r => r.YAvailable || r.WAvailable || r.JAvailable || r.FAvailable);
    if (!any.length) return "No award availability on any cabin for this route/dates.";
    return `No ${cabin} awards found. Other cabins available:\n` +
      any.slice(0, 8).map(r => {
        const pts = [];
        if (r.FAvailable) pts.push(`First: ${r.FMileageCost}mi (${r.FAirlines})`);
        if (r.JAvailable) pts.push(`Business: ${r.JMileageCost}mi (${r.JAirlines})`);
        if (r.WAvailable) pts.push(`PremEco: ${r.WMileageCost}mi (${r.WAirlines})`);
        if (r.YAvailable) pts.push(`Economy: ${r.YMileageCost}mi (${r.YAirlines})`);
        return `${r.Date} | ${r.Source} | ${pts.join(" | ")}`;
      }).join("\n");
  }

  return `${cabin.toUpperCase()} AWARDS FOUND (${avail.length} dates):\n` +
    avail.slice(0, 15).map(r =>
      `${r.Date} | ${r.Source} | ${r[`${cabinCode}MileageCost`]}mi | ${r[`${cabinCode}Airlines`]} | ${r[`${cabinCode}Direct`] ? "Direct ✓" : "Connecting"} | seats:${r[`${cabinCode}RemainingSeats`] || "?"}`
    ).join("\n");
}

async function fetchPrices(from, to, depart, ret, cabin, pax, serpKey) {
  const travelClass = { economy: "1", "premium economy": "2", business: "3", first: "4" }[cabin] || "3";
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: from,
    arrival_id: to,
    outbound_date: depart,
    ...(ret ? { return_date: ret } : { type: "2" }),
    currency: "USD",
    adults: pax,
    travel_class: travelClass,
    api_key: serpKey,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

  const data = await res.json();
  const flights = [...(data.best_flights || []), ...(data.other_flights || [])].slice(0, 8);
  if (!flights.length) return "No cash prices returned for this route/date.";

  return `LIVE CASH PRICES (${cabin.toUpperCase()}):\n` +
    flights.map(f => {
      const legs = (f.flights || []).map(l => `${l.airline} ${l.flight_number} (${l.travel_class || cabin})`).join(" + ");
      const h = Math.floor((f.total_duration || 0) / 60);
      const m = (f.total_duration || 0) % 60;
      return `$${f.price} | ${legs} | ${h}h${m}m`;
    }).join("\n");
}

async function fetchUpgradeableFares(from, to, depart, ret, pax, serpKey) {
  // Fetch economy/PE fares to find cheapest upgradeable option
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: from,
    arrival_id: to,
    outbound_date: depart,
    ...(ret ? { return_date: ret } : { type: "2" }),
    currency: "USD",
    adults: pax,
    travel_class: "1", // economy
    api_key: serpKey,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) return "Could not fetch economy fares for upgrade analysis.";

  const data = await res.json();
  const flights = [...(data.best_flights || []), ...(data.other_flights || [])]
    .filter(f => (f.flights || []).some(l => l.airline === "American Airlines" || l.airline === "Delta Air Lines"))
    .slice(0, 4);

  if (!flights.length) return "No AA/Delta economy fares found for upgrade analysis.";

  return `ECONOMY/PE FARES ON AA OR DELTA (for upgrade analysis):\n` +
    flights.map(f => {
      const legs = (f.flights || []).map(l => `${l.airline} ${l.flight_number}`).join(" + ");
      return `$${f.price} | ${legs} | class:${(f.flights || [])[0]?.travel_class || "?"}`;
    }).join("\n");
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { from, to, depart, ret, cabin, pax, notes } = req.body;

  if (!from || !to || !depart) {
    return res.status(400).json({ error: "Missing required fields: from, to, depart" });
  }

  const SEATS_KEY    = process.env.SEATS_AERO_KEY;
  const SERP_KEY     = process.env.SERP_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SEATS_KEY || !SERP_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "Missing API keys in environment variables" });
  }

  const routeType = getRouteType(from, to);

  // Fetch all data in parallel
  const [awardData, priceData, upgradeData] = await Promise.allSettled([
    fetchAwards(from, to, depart, ret, cabin, SEATS_KEY),
    fetchPrices(from, to, depart, ret, cabin, pax, SERP_KEY),
    fetchUpgradeableFares(from, to, depart, ret, pax, SERP_KEY),
  ]);

  const awardsText  = awardData.status  === "fulfilled" ? awardData.value  : `Seats.aero error: ${awardData.reason}`;
  const pricesText  = priceData.status  === "fulfilled" ? priceData.value  : `SerpAPI error: ${priceData.reason}`;
  const upgradeText = upgradeData.status === "fulfilled" ? upgradeData.value : `Upgrade fare error: ${upgradeData.reason}`;

  const userMessage = `Analyze this trip and give me all 3 options:

TRIP: ${from} → ${to} | ${routeType}
Departure: ${depart}${ret ? ` | Return: ${ret}` : " (one-way)"}
Cabin preference: ${cabin} | Passengers: ${pax}
${notes ? `Notes: ${notes}` : ""}

--- SEATS.AERO AWARD DATA ---
${awardsText}

--- GOOGLE FLIGHTS CASH PRICES ---
${pricesText}

--- ECONOMY/PE FARES FOR UPGRADE ANALYSIS ---
${upgradeText}

Please give all 3 options with exact numbers.`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(500).json({ error: `Anthropic API error: ${err.slice(0, 200)}` });
    }

    const anthropicData = await anthropicRes.json();
    const analysis = anthropicData.content
      ?.filter(b => b.type === "text")
      .map(b => b.text)
      .join("") || "No analysis returned.";

    return res.status(200).json({
      analysis,
      debug: { awardsText, pricesText, upgradeText },
    });
  } catch (e) {
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
