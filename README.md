# Encore

**Find the crowd that's waiting for you.**

Encore is a touring agent for anyone who takes their work on the road: musicians, comedians, authors, podcasters, brands doing pop-ups, film screenings, game events and chefs. You name what you make. Encore finds the cities that love work like yours but aren't getting enough of it, then plans the run and drafts the outreach.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

## Why it needs Qloo

A language model can guess that an Afrobeats star should play London. It can't tell you that a 40k-listener folk act's audience over-indexes on Columbus, which venues in Columbus that crowd already likes, or which local act shares their fans. That comes from Qloo's taste graph.

Encore uses Qloo for every demand-side number:

| Question | Qloo call |
|---|---|
| Who is this? | `/search` by entity type (artist, person, book, podcast, brand, movie, video game, place) |
| Who else do their fans love? | `/v2/insights` with `signal.interests.entities` |
| Which cities over-index on this audience? | `/v2/insights` with `filter.type=urn:entity:destination`, falling back to averaging each city's heatmap |
| Where in the city is the crowd? | `/v2/insights` with `filter.type=urn:heatmap` and `filter.location.query` |
| Which rooms fit? | `/v2/insights` for `urn:entity:place`, filtered by a venue tag from `/v2/tags`, inside the city |
| Who should open or co-host? | `/v2/insights` for the same entity type, biased with `signal.location.query` |
| Which partners for promo? | podcasts and restaurants the same audience likes in that city |
| Who is the crowd? | `/v2/insights` with `filter.type=urn:demographics` |

## The whitespace score

Every team building a tour tool will find where fans are. Encore also asks what's already booked there.

- **Demand** comes from Qloo: the audience's affinity for each of 42 touring markets, as a multiple of the average.
- **Supply** comes from the Ticketmaster Discovery API: the comparable shows booked within 50 km in the next 90 days, per million people.
- **Whitespace** combines the two: high demand with few comparable shows scores highest.

```
index      = market affinity / mean affinity across markets scanned
crowding   = shows per million / median shows per million
whitespace = clamp((index - 0.6) / 1.2) * 1 / (1 + 0.6 * crowding) * 100
```

Each market gets a verdict: **underserved**, **balanced**, **crowded**, **cold**, or **no listings data**. The last one applies where Ticketmaster has no coverage, such as Lagos, Accra and Nairobi. Those cities are scored as if supply were the median and are never called underserved on evidence Encore doesn't have.

## The agent

Type a brief, like "8 dates in February, start in London, rooms under 1,000", and the planning agent (Claude) works through tools:

1. `inspect_city` opens a market: Qloo heatmap, venues, openers, partners, audience mix, and the comparable shows already booked there, with dates.
2. `build_route` orders the chosen cities nearest-first, adds travel days by distance, and moves any date that clashes with a comparable show already booked in that city.
3. `submit_plan` returns the dated run, with evidence for every stop, outreach drafts for venues, openers and partners, poster lines for each city, and cautions.

The agent may only name venues, openers and partners that came back from Qloo. Without an Anthropic key, a rule-based planner runs the same tools in a fixed order.

## Run it

```bash
npm install
cp .env.example .env   # add QLOO_API_KEY, TICKETMASTER_API_KEY, ANTHROPIC_API_KEY
npm run build
npm start              # http://localhost:8794
```

For development, run `npm run server` and `npm run dev` (Vite on :5194, proxying `/api`).

Any key left empty switches that source to demo data, so the app still runs end to end. When that happens, the header pills and a banner say so.

## Stack

- Node 24 server (`server/`), no framework, running TypeScript directly.
- React + Vite (`src/`), with Leaflet on Esri's light-gray basemap.
- Qloo Insights API (hackathon endpoint), Ticketmaster Discovery API, and Claude through the Anthropic SDK.
- Deploys as one Docker service (`Dockerfile`, `railway.json`).

Responses from Qloo and Ticketmaster are cached privately on the server in `.cache/`, which is never committed.

## License

MIT. See [LICENSE](LICENSE).
