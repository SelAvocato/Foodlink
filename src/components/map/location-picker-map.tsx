"use client";

import "leaflet/dist/leaflet.css";
import { DomEvent, divIcon } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export interface MapPoint {
  latitude: number;
  longitude: number;
}

// Metro Manila; only the starting view, never stored as a pin.
const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const DEFAULT_ZOOM = 12;
const PICKED_ZOOM = 16;

// Tiles are real up to zoom 19; zooming further stretches the zoom 19 tiles (blurry, not blank).
// Where Esri has no imagery at a high zoom it may draw a "Map data not yet available" tile.
const MAX_NATIVE_ZOOM = 19;
const MAX_ZOOM = 21;

type MapLayerId = "street" | "satellite";

const MAP_LAYER_IDS: MapLayerId[] = ["street", "satellite"];

const MAP_LAYERS: Record<MapLayerId, { label: string; url: string; attribution: string }> = {
  street: {
    label: "Street",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
};

const PIN_FILL = "#eaf4ee"; // --fl-success
const PIN_STROKE = "#176448"; // --fl-primary

// An inline SVG teardrop; its tip (16, 41) is the anchor, so the tip sits on the clicked point.
const PIN_ICON = divIcon({
  className: "",
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1.5C8.5 1.5 2.5 7.5 2.5 15c0 9.8 13.5 25.5 13.5 25.5S29.5 24.8 29.5 15C29.5 7.5 23.5 1.5 16 1.5z" fill="${PIN_FILL}" stroke="${PIN_STROKE}" stroke-width="2.5"/><circle cx="16" cy="15" r="5" fill="${PIN_STROKE}"/></svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 41],
});

function ClickHandler({ onPick }: { onPick: (point: MapPoint) => void }) {
  useMapEvents({
    click(event) {
      // The keyboard button sits inside the map; pressing it is not a pick on the map.
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest("[data-map-control]")) return;
      // wrap() keeps longitude inside -180..180 after the map is panned around the world.
      const point = event.latlng.wrap();
      onPick({ latitude: point.lat, longitude: point.lng });
    },
  });
  return null;
}

/** A new object (new id) asks the map to move; the pin itself is still set through onPick. */
export type FlyTarget = MapPoint & { id: number };

function FlyToPoint({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.latitude, target.longitude], PICKED_ZOOM);
  }, [map, target]);
  return null;
}

// Hidden for mouse and touch users; it appears only when a keyboard user tabs to it.
function CenterPickButton({ onPick }: { onPick: (point: MapPoint) => void }) {
  const map = useMap();
  return (
    <button
      type="button"
      data-map-control
      className="pointer-events-none absolute bottom-6 left-1/2 z-[1000] h-11 -translate-x-1/2 rounded-lg border border-(--fl-primary) bg-(--fl-card) px-4 text-sm font-semibold text-(--fl-primary) opacity-0 shadow outline-none focus:pointer-events-auto focus:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => {
        const center = map.getCenter().wrap();
        onPick({ latitude: center.lat, longitude: center.lng });
      }}
    >
      Place pin at map center
    </button>
  );
}

function LayerToggle({
  layer,
  onChange,
}: {
  layer: MapLayerId;
  onChange: (layer: MapLayerId) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Taps and double taps on the switch must not reach the map (no pin, no zoom).
    if (ref.current) DomEvent.disableClickPropagation(ref.current);
  }, []);
  return (
    <div
      ref={ref}
      data-map-control
      role="group"
      aria-label="Map type"
      className="absolute top-2 right-2 z-[1000] flex overflow-hidden rounded-sm border border-(--fl-primary) bg-(--fl-card) shadow-sm"
    >
      {MAP_LAYER_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={layer === id}
          className={
            layer === id
              ? "h-9 bg-(--fl-primary) px-3 text-xs font-medium text-white"
              : "h-9 bg-(--fl-card) px-3 text-xs font-medium text-(--fl-primary)"
          }
          onClick={() => onChange(id)}
        >
          {MAP_LAYERS[id].label}
        </button>
      ))}
    </div>
  );
}

interface LocationPickerMapProps {
  value: MapPoint | null;
  flyTo?: FlyTarget | null;
  onPick: (point: MapPoint) => void;
}

export default function LocationPickerMap({ value, flyTo = null, onPick }: LocationPickerMapProps) {
  const [layer, setLayer] = useState<MapLayerId>("street");
  const activeLayer = MAP_LAYERS[layer];
  return (
    <MapContainer
      center={value ? [value.latitude, value.longitude] : DEFAULT_CENTER}
      zoom={value ? PICKED_ZOOM : DEFAULT_ZOOM}
      scrollWheelZoom={false}
      worldCopyJump
      maxZoom={MAX_ZOOM}
      className="z-0 h-72 w-full rounded-lg"
    >
      <TileLayer
        key={layer}
        attribution={activeLayer.attribution}
        url={activeLayer.url}
        maxNativeZoom={MAX_NATIVE_ZOOM}
        maxZoom={MAX_ZOOM}
      />
      <LayerToggle layer={layer} onChange={setLayer} />
      <ClickHandler onPick={onPick} />
      <FlyToPoint target={flyTo} />
      <CenterPickButton onPick={onPick} />
      {value ? (
        <Marker
          position={[value.latitude, value.longitude]}
          icon={PIN_ICON}
          interactive={false}
          keyboard={false}
        />
      ) : null}
    </MapContainer>
  );
}
