// The map: every scanned market as a circle (size = demand, colour = verdict),
// the chosen city's Qloo heatmap when one is open, and the planned route.

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { CityDetail, MarketScore } from './api.ts'
import { VERDICT, topPct } from './labels.ts'

type Props = {
  markets: MarketScore[]
  selected: string | null
  detail: CityDetail | null
  route: { lat: number; lng: number; label: string }[] | null
  onSelect: (id: string) => void
}

export default function MarketMap({ markets, selected, detail, route, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ markets: L.LayerGroup; heat: L.LayerGroup; route: L.LayerGroup } | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    if (!host.current || map.current) return
    const m = L.map(host.current, { zoomControl: false, worldCopyJump: true, attributionControl: true }).setView([35, -30], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    // Esri's light-gray canvas: keyless, quiet enough for data on top.
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
    L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 16 }).addTo(m)
    L.tileLayer(`${esri}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'shadowPane' }).addTo(m)
    layers.current = { heat: L.layerGroup().addTo(m), route: L.layerGroup().addTo(m), markets: L.layerGroup().addTo(m) }
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // Market circles.
  useEffect(() => {
    const g = layers.current?.markets
    if (!g || !map.current) return
    g.clearLayers()
    for (const r of markets) {
      const v = VERDICT[r.verdict]
      const on = r.market.id === selected
      const c = L.circleMarker([r.market.lat, r.market.lng], {
        radius: 4 + Math.max(0, r.percentile - 0.5) * 22,
        color: on ? '#14161c' : '#ffffff',
        weight: on ? 3 : 1.5,
        fillColor: v.color,
        fillOpacity: r.verdict === 'cold' ? 0.35 : 0.85,
      })
      c.bindTooltip(`<b>${r.market.name}</b> · ${v.label}<br/>Whitespace ${r.whitespace} · top ${topPct(r.percentile)}% for demand`, { direction: 'top', offset: [0, -6] })
      c.on('click', () => select.current(r.market.id))
      c.addTo(g)
    }
  }, [markets, selected])

  // Fit to the markets when the scan changes and nothing is open.
  useEffect(() => {
    if (!map.current || !markets.length || selected || route) return
    const b = L.latLngBounds(markets.map((r) => [r.market.lat, r.market.lng]))
    map.current.fitBounds(b, { padding: [40, 40], maxZoom: 5 })
  }, [markets, selected, route])

  // Heatmap for the open city.
  useEffect(() => {
    const g = layers.current?.heat
    if (!g || !map.current) return
    g.clearLayers()
    if (!detail || detail.market.id !== selected) return
    // Qloo returns ~1,300 cells for a big city; the hottest 400 tell the story.
    const cells = [...detail.heat].sort((a, b) => b.affinity - a.affinity).slice(0, 400)
    const max = Math.max(0.01, cells[0]?.affinity ?? 0)
    const min = cells[cells.length - 1]?.affinity ?? 0
    for (const s of [...cells].reverse()) {
      const k = max > min ? (s.affinity - min) / (max - min) : 1
      L.circle([s.lat, s.lng], { radius: 350 + k * 650, stroke: false, fillColor: k > 0.66 ? '#ff5a36' : k > 0.33 ? '#ffb020' : '#7c8db5', fillOpacity: 0.1 + k * 0.45, interactive: false }).addTo(g)
    }
    // Frame the hottest quarter, clear of the city drawer on the right (or bottom, on phones).
    const phone = window.innerWidth < 860
    const hot = cells.slice(0, Math.max(8, Math.ceil(cells.length / 4)))
    const pts = hot.length ? hot.map((s) => [s.lat, s.lng] as [number, number]) : [[detail.market.lat, detail.market.lng] as [number, number]]
    const w = map.current.getSize().x
    const drawer = phone ? 0 : Math.min(430, Math.max(0, w - 260)) // leave at least 240 px of map visible
    map.current.flyToBounds(L.latLngBounds(pts).pad(0.1), { paddingTopLeft: [20, 20], paddingBottomRight: [drawer + 20, 20], maxZoom: 12, duration: 0.8 })
  }, [detail, selected])

  // Planned route.
  useEffect(() => {
    const g = layers.current?.route
    if (!g || !map.current) return
    g.clearLayers()
    if (!route?.length) return
    L.polyline(route.map((p) => [p.lat, p.lng]), { color: '#14161c', weight: 2, dashArray: '2 7', lineCap: 'round' }).addTo(g)
    route.forEach((p, i) => {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'stop-pin', html: `<span>${i + 1}</span>`, iconSize: [26, 26] }), zIndexOffset: 1000 })
        .bindTooltip(p.label, { direction: 'top', offset: [0, -12] })
        .addTo(g)
    })
    map.current.fitBounds(L.latLngBounds(route.map((p) => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 6 })
  }, [route])

  return <div ref={host} className="map" />
}
