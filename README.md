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
| Who else do their fans love? | `/v2/insights` with `signal.interests.entities` (15 acts, which also drive supply below) |
| Which cities over-index on this audience? | One `/v2/insights` heatmap (`filter.type=urn:heatmap`, `output.heatmap.boundary=urn:geohash`) over a polygon covering all 42 markets, so every city is on one scale. Each market takes its nearest ~150 km cell's `affinity` and `affinity_rank`. |
| Where in the city is the crowd? | The same heatmap inside the city: `filter.location=POINT(lng lat)`, 35 km radius |
| Which rooms fit? | `/v2/insights` for `urn:entity:place`, filtered by a venue tag from `/v2/tags` (music venue, then concert hall, then nightclub, and so on per kind), inside the city |
| Who should open or co-host? | `/v2/insights` for the same entity type with `filter.popularity.max` set to the act's own popularity: a support act, not a co-headliner |
| Which partners for promo? | Podcasts the audience likes, weighted to the city (`signal.location`), and restaurants they like there |
| Who is the crowd? | `/v2/insights` with `filter.type=urn:demographics` |

Cities always go to Qloo as coordinates, never names: a locality search for "Washington" lands in Washington State.

## The whitespace score

Every team building a tour tool will find where fans are. Encore also asks what's already booked there.

- **Demand** comes from Qloo: where each of 42 touring markets ranks among all the places on Qloo's world heatmap for this audience ("top 4% of places").
- **Supply** comes from the Ticketmaster Discovery API, over the next 90 days within 50 km:
  - **genre shows**, the baseline of how busy the city's scene is, and
  - **same-crowd shows**: dates by the act itself and by the 15 acts Qloo says its audience loves most, found by name and matched on the attraction. These compete directly for the same people's nights out ("Omah Lay and Adekunle Gold both play London in November").
- **Whitespace** combines the two: high demand with little booked scores highest.

```
percentile = share of places on Qloo's world heatmap this market beats
crowding   = genre shows per million / median across markets
             + 0.5 per same-crowd show + 1 per show by the act itself
whitespace = clamp((percentile - 0.5) / 0.5) * 1 / (1 + 0.6 * crowding) * 100
```

Each market gets a verdict: **underserved**, **balanced**, **crowded**, **cold**, or **no listings data**. The last one applies where Ticketmaster lists almost nothing: Lagos, Accra and Nairobi, and also Paris, where Discovery returns zero events of any kind. Those cities are scored as if supply were the median and are never called underserved on evidence Encore doesn't have.

## The agent

Type a brief, like "8 dates in February, start in London, rooms under 1,000", and the planning agent (Claude) works through tools:

1. `inspect_city` opens a market: Qloo heatmap, venues, openers, partners, audience mix, and the comparable shows already booked there, with dates.
2. `build_route` orders the chosen cities nearest-first, adds travel days by distance, and moves any date that clashes with a same-crowd show in that city.
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
