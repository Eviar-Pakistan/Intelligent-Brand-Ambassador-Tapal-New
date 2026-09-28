import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Map, { Marker, NavigationControl, Popup } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapPin } from 'lucide-react'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

export type StoreMapPin = {
  id: number
  name: string
  city: string
  lat: number
  lng: number
  level: 'high' | 'medium' | 'low'
  shoppers: number
  engagement_rate: number
  conversion_rate: number
}

const levelColor: Record<StoreMapPin['level'], string> = {
  high: '#16a34a',
  medium: '#f59e0b',
  low: '#e11d48',
}

const PAKISTAN_VIEW = { longitude: 69.3451, latitude: 30.3753, zoom: 4.6 }

/** Mapbox map of stores, coloured by performance. Pins come from /api/intelligence/campaign-metrics/. */
export function LiveStoreMap({ pins }: { pins: StoreMapPin[] }) {
  const [activeId, setActiveId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const active = pins.find((p) => p.id === activeId) ?? null
  const hovered = pins.find((p) => p.id === hoveredId) ?? null

  const initialView = useMemo(() => {
    if (!pins.length) return PAKISTAN_VIEW
    const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length
    const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length
    return { latitude: lat, longitude: lng, zoom: pins.length === 1 ? 10 : 5.2 }
  }, [pins])

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-600 sm:h-64">
        <MapPin className="text-brand-600" size={22} />
        <p className="font-medium text-slate-800">Mapbox token required</p>
        <p className="max-w-xs text-xs text-slate-500">
          Add <code className="rounded bg-white px-1">VITE_MAPBOX_TOKEN</code> to the{' '}
          <code className="rounded bg-white px-1">.env</code> file in the project root, then restart Vite.
        </p>
      </div>
    )
  }

  if (!pins.length) {
    return (
      <div className="flex h-52 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500 sm:h-64">
        No stores to show on the map yet.
      </div>
    )
  }

  return (
    <div className="relative h-52 overflow-hidden rounded-xl sm:h-64">
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={initialView}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            latitude={pin.lat}
            longitude={pin.lng}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              setActiveId(pin.id)
            }}
          >
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white transition hover:scale-110"
              style={{ backgroundColor: levelColor[pin.level] }}
              aria-label={pin.name}
              onMouseEnter={() => setHoveredId(pin.id)}
              onMouseLeave={() => setHoveredId((id) => (id === pin.id ? null : id))}
            >
              <MapPin size={14} />
            </button>
          </Marker>
        ))}
        {hovered && activeId !== hovered.id && (
          <Popup
            latitude={hovered.lat}
            longitude={hovered.lng}
            anchor="bottom"
            offset={34}
            closeButton={false}
            closeOnClick={false}
          >
            <div className="whitespace-nowrap px-0.5 py-0.5 text-xs font-semibold text-slate-900">{hovered.name}</div>
          </Popup>
        )}
        {active && (
          <Popup
            latitude={active.lat}
            longitude={active.lng}
            anchor="top"
            offset={12}
            onClose={() => setActiveId(null)}
            closeOnClick={false}
          >
            <div className="min-w-[160px] p-1 text-left">
              <div className="text-sm font-semibold text-slate-900">{active.name}</div>
              <div className="text-xs text-slate-500">{active.city}</div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
                <span>Shoppers</span>
                <span className="text-right font-semibold">{active.shoppers}</span>
                <span>Engagement</span>
                <span className="text-right font-semibold">{active.engagement_rate}%</span>
                <span>Conversion</span>
                <span className="text-right font-semibold">{active.conversion_rate}%</span>
              </div>
              <Link to={`/ho/stores/${active.id}`} className="mt-2 inline-block text-[11px] font-semibold text-brand-600">
                Open store →
              </Link>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  )
}
