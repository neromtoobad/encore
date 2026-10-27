# Devpost submission: Encore

## Project overview

**Project name:** Encore

**Elevator pitch (200 characters max):**
An agent that finds the cities that love your work but aren't getting enough of it, using Qloo taste demand against Ticketmaster bookings, then routes the run and writes the outreach.

## Project details

### About the project

## Inspiration

Most acts route tours on instinct and a spreadsheet. The big markets are obvious, and so is the problem with them: everyone plays them. The useful question is harder. Which cities love work like yours, and *aren't getting enough of it*?

An LLM can guess that an Afrobeats star should play London. It can't tell you that the same artist's audience in London is already being courted by Omah Lay and Adekunle Gold in the same month, or that Washington and Atlanta sit in the top 15% of places for that audience with almost nothing booked. That needs two things no model has on its own: real taste data and real listings.

## What it does

You tell Encore what you take on the road: a musician, a comedian, a podcast, a book, a brand pop-up, a film, a game or a restaurant. It scans 42 touring markets across North America, the UK and Europe, and Africa, and gives each one a **whitespace score**:

- **Demand (Qloo):** where the market ranks among every place on Qloo's world heatmap for this audience ("top 4% of places").
- **Supply (Ticketmaster):** what is already booked within 50 km in the next 90 days. That's the genre baseline, plus **same-crowd shows**: dates by the act itself and by the 15 acts Qloo says its audience loves most. Those are the direct competitors for the same people's nights out.
- **Verdict:** underserved, balanced, crowded, cold, or *no listings data*. Lagos, Accra, Nairobi and Paris (where Ticketmaster returns zero events of any kind) are never called underserved on evidence Encore doesn't have.

Open any city to see the evidence: Qloo's heatmap of where the crowd lives in that city, rooms the same audience already likes, support acts with the same fans, podcasts and restaurants for promo partnerships, the audience's age mix, and the shows already on sale, tagged by which act they belong to.

Then type a brief like *"7 dates in North America, theatres of 2,000 to 5,000, skip anywhere already crowded"* and the **planning agent** (Claude) works through tools:

1. `inspect_city` opens each candidate market (Qloo plus Ticketmaster).
2. `build_route` orders the cities nearest-first, adds travel days by distance, and moves any date that clashes with a same-crowd show.
3. `submit_plan` returns the dated run with evidence for every stop, outreach drafts for venues, openers and promo partners, a poster line tuned to each city, and the cautions you should check before booking.

The agent can only name venues, openers and partners that came back from Qloo, and it says when the evidence is thin.

## How I built it

Qloo does all the demand-side work:

| Question | Qloo call |
|---|---|
| Who is this? | `/search` by entity type |
| Who else do their fans love? | `/v2/insights` with `signal.interests.entities` (15 acts, which also drive supply) |
| Which cities over-index? | One `urn:heatmap` over a polygon covering every market, `output.heatmap.boundary=urn:geohash`, so all cities share one scale |
| Where in the city? | The same heatmap inside the city, `filter.location=POINT(lng lat)` with a 35 km radius |
| Which rooms fit? | `urn:entity:place` filtered by venue tags from `/v2/tags` (music venue, concert hall, comedy club, performing arts theater…) |
| Who supports? | The same entity type, capped with `filter.popularity.max` at the act's own popularity, so a support slot rather than a co-headliner |
| Promo partners? | Podcasts weighted to the city with `signal.location`, plus restaurants the audience likes there |
| Who is the crowd? | `urn:demographics` |

Supply comes from the Ticketmaster Discovery API: one genre count per market, plus a name search for each of the 15 related acts, matched on the attraction and assigned to any market within 50 km of the venue.

The stack is a Node 24 server running TypeScript directly, React and Vite, and Leaflet on Esri's light-gray basemap. The agent runs on Claude Opus through the Anthropic SDK with strict tool schemas. It's deployed as one Docker service on Railway. Qloo and Ticketmaster responses are cached privately on the server and never committed.

## Challenges I ran into

- **Comparing cities.** Qloo rejects an artist signal on destinations, and a per-city heatmap rescales to 1 inside each city, so cities can't be compared that way. One world-sized heatmap per act solved it: every city lands on the same scale, and `affinity_rank` gives the spread.
- **"Washington" is a state.** Location searches by name sent Washington, D.C. to Washington State, and Birmingham could be Alabama. Every city now goes to Qloo as coordinates. The agent caught this one itself: it flagged in its own cautions that DC's venues pointed to Seattle.
- **A zero that means nothing.** Ticketmaster returns zero events for all of Paris. Without a coverage check, Paris looked like the most underserved city in Europe.
- **People are not all comedians.** Qloo's person graph for Ali Wong surfaces finance creators and parenting accounts. Filtering by her occupation tag (`urn:tag:occupation:person:comedian`) turns that into Phoebe Robinson, Maya Rudolph and Naomi Ekperigin.
- **"Comparable" is a taste question.** Ticketmaster's genre filter counted cumbia nights against an Afrobeats artist. Using Qloo's related acts to define the same crowd made supply mean something.

## Accomplishments that I'm proud of

- It works for eight kinds of touring work, not only bands, from the same engine and the same input box.
- Every number on screen traces back to a Qloo or Ticketmaster call, and the app says plainly when data is missing instead of filling the gap.
- The agent's plans read like a booking agent's memo: specific rooms, clashes avoided, and honest cautions such as "Charlotte falls on Thanksgiving".

## What I learned

Taste data is most valuable at the edges: not "where are the fans" (everyone knows the top five cities) but "where are the fans that nobody is serving". Qloo's graph is also what makes supply meaningful. Without it, "comparable shows" is just a genre filter.

## What's next for Encore

- Wider supply: AXS, Dice, Eventbrite, and the act's own announced dates.
- Feed ticket sales back in so the whitespace score learns from what actually sold.
- Comedy club and bookshop calendars, where Ticketmaster is thin.
- Venue capacities, so "rooms of 1,500 to 2,500" is a filter rather than the agent's judgement.

### Built with
qloo, claude, anthropic-api, ticketmaster-discovery-api, node.js, typescript, react, vite, leaflet, docker, railway

### Try it out
- https://encore.nerom.site
- https://github.com/neromtoobad/encore

## Additional info (for judges)

- **When did you begin your project?** October 26, 2026
- **The public URL to your project:** https://encore.nerom.site
- **Link to your PUBLIC code repo:** https://github.com/neromtoobad/encore
- **If this was an existing project…:** New project, started for this hackathon on October 26, 2026.
