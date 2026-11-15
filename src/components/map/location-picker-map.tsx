"use client";

import "leaflet/dist/leaflet.css";
import { divIcon } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export interface MapPoint {
  latitude: number;
  longitude: number;
}

// Metro Manila; only the starting view, never stored as a pin.
const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const DEFAULT_ZOOM = 12;
const PICKED_ZOOM = 16;

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

interface LocationPickerMapProps {
  value: MapPoint | null;
  flyTo?: FlyTarget | null;
  onPick: (point: MapPoint) => void;
}

export default function LocationPickerMap({ value, flyTo = null, onPick }: LocationPickerMapProps) {
  return (
    <MapContainer
      center={value ? [value.latitude, value.longitude] : DEFAULT_CENTER}
      zoom={value ? PICKED_ZOOM : DEFAULT_ZOOM}
      scrollWheelZoom={false}
      worldCopyJump
      className="z-0 h-72 w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
