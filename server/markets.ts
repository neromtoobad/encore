// The touring markets Encore scores. Metro populations are rounded estimates,
// used only to turn a count of booked shows into shows per million people.
// Ticketmaster's Discovery API covers North America and much of Europe, not
// Africa, so those markets are scored on demand alone.

import type { Market, Region } from './types.ts'

const m = (id: string, name: string, country: string, cc: string, lat: number, lng: number, region: Market['region'], metroM: number, diaspora = false): Market => ({
  id, name, country, cc, lat, lng, region, metroM, diaspora,
  ticketmaster: region !== 'africa',
})

export const MARKETS: Market[] = [
  m('nyc', 'New York', 'United States', 'US', 40.7128, -74.006, 'na', 19.5, true),
  m('la', 'Los Angeles', 'United States', 'US', 34.0522, -118.2437, 'na', 12.8),
  m('chicago', 'Chicago', 'United States', 'US', 41.8781, -87.6298, 'na', 9.4),
  m('houston', 'Houston', 'United States', 'US', 29.7604, -95.3698, 'na', 7.3, true),
  m('dallas', 'Dallas', 'United States', 'US', 32.7767, -96.797, 'na', 7.9, true),
  m('atlanta', 'Atlanta', 'United States', 'US', 33.749, -84.388, 'na', 6.3, true),
  m('dc', 'Washington', 'United States', 'US', 38.9072, -77.0369, 'na', 6.3, true),
  m('philly', 'Philadelphia', 'United States', 'US', 39.9526, -75.1652, 'na', 6.2),
  m('miami', 'Miami', 'United States', 'US', 25.7617, -80.1918, 'na', 6.2),
  m('boston', 'Boston', 'United States', 'US', 42.3601, -71.0589, 'na', 4.9),
  m('phoenix', 'Phoenix', 'United States', 'US', 33.4484, -112.074, 'na', 5.0),
  m('sf', 'San Francisco', 'United States', 'US', 37.7749, -122.4194, 'na', 4.6),
  m('detroit', 'Detroit', 'United States', 'US', 42.3314, -83.0458, 'na', 4.3),
  m('seattle', 'Seattle', 'United States', 'US', 47.6062, -122.3321, 'na', 4.0),
  m('minneapolis', 'Minneapolis', 'United States', 'US', 44.9778, -93.265, 'na', 3.7, true),
  m('denver', 'Denver', 'United States', 'US', 39.7392, -104.9903, 'na', 3.0),
  m('charlotte', 'Charlotte', 'United States', 'US', 35.2271, -80.8431, 'na', 2.7),
  m('portland', 'Portland', 'United States', 'US', 45.5152, -122.6784, 'na', 2.5),
  m('austin', 'Austin', 'United States', 'US', 30.2672, -97.7431, 'na', 2.4),
  m('columbus', 'Columbus', 'United States', 'US', 39.9612, -82.9988, 'na', 2.1, true),
  m('kc', 'Kansas City', 'United States', 'US', 39.0997, -94.5786, 'na', 2.2),
  m('nashville', 'Nashville', 'United States', 'US', 36.1627, -86.7816, 'na', 2.0),
  m('raleigh', 'Raleigh', 'United States', 'US', 35.7796, -78.6382, 'na', 1.5),
  m('nola', 'New Orleans', 'United States', 'US', 29.9511, -90.0715, 'na', 1.3),
  m('toronto', 'Toronto', 'Canada', 'CA', 43.6532, -79.3832, 'na', 6.7, true),
  m('montreal', 'Montreal', 'Canada', 'CA', 45.5019, -73.5674, 'na', 4.3),
  m('vancouver', 'Vancouver', 'Canada', 'CA', 49.2827, -123.1207, 'na', 2.7),
  m('calgary', 'Calgary', 'Canada', 'CA', 51.0447, -114.0719, 'na', 1.6, true),
  m('london', 'London', 'United Kingdom', 'GB', 51.5074, -0.1278, 'europe', 14.8, true),
  m('manchester', 'Manchester', 'United Kingdom', 'GB', 53.4808, -2.2426, 'europe', 2.8, true),
  m('birmingham', 'Birmingham', 'United Kingdom', 'GB', 52.4862, -1.8904, 'europe', 2.9, true),
  m('glasgow', 'Glasgow', 'United Kingdom', 'GB', 55.8642, -4.2518, 'europe', 1.8),
  m('dublin', 'Dublin', 'Ireland', 'IE', 53.3498, -6.2603, 'europe', 2.1, true),
  m('paris', 'Paris', 'France', 'FR', 48.8566, 2.3522, 'europe', 12.3, true),
  m('amsterdam', 'Amsterdam', 'Netherlands', 'NL', 52.3676, 4.9041, 'europe', 2.5),
  m('brussels', 'Brussels', 'Belgium', 'BE', 50.8503, 4.3517, 'europe', 2.1, true),
  m('berlin', 'Berlin', 'Germany', 'DE', 52.52, 13.405, 'europe', 6.1),
  m('lagos', 'Lagos', 'Nigeria', 'NG', 6.5244, 3.3792, 'africa', 16.5),
  m('abuja', 'Abuja', 'Nigeria', 'NG', 9.0765, 7.3986, 'africa', 3.8),
  m('accra', 'Accra', 'Ghana', 'GH', 5.6037, -0.187, 'africa', 5.5),
  m('nairobi', 'Nairobi', 'Kenya', 'KE', -1.2921, 36.8219, 'africa', 5.3),
  m('joburg', 'Johannesburg', 'South Africa', 'ZA', -26.2041, 28.0473, 'africa', 10.0),
]

export function marketsFor(region: Region): Market[] {
  if (region === 'all') return MARKETS
  if (region === 'diaspora') return MARKETS.filter((x) => x.diaspora)
  return MARKETS.filter((x) => x.region === region)
}

export function marketById(id: string) {
  return MARKETS.find((x) => x.id === id)
}

// Great-circle distance in kilometres.
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
