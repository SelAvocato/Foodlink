"use client";

import dynamic from "next/dynamic";

export type { FlyTarget, MapPoint } from "./location-picker-map";

// Leaflet touches window on import, so the map is loaded in the browser only.
export const LocationPicker = dynamic(() => import("./location-picker-map"), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full animate-pulse rounded-lg bg-(--fl-success)" aria-hidden="true" />
  ),
});
