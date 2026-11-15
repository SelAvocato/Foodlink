/**
 * Pure helpers for the map pin: rounding to what the database stores,
 * the text the button shows, and the geolocation failure messages.
 * No React, no Leaflet, no browser globals, so everything here is testable.
 */

export interface MapPinPoint {
  latitude: number;
  longitude: number;
}

/** The addresses columns are numeric(9,6), so the pin keeps 6 decimals. */
export const PIN_DECIMALS = 6;

/**
 * Round both coordinates to 6 decimals so what is shown is what is saved.
 * Returns a new object; the input is not mutated.
 */
export function roundPin(point: MapPinPoint): MapPinPoint {
  return {
    latitude: Math.round(point.latitude * 1e6) / 1e6,
    longitude: Math.round(point.longitude * 1e6) / 1e6,
  };
}

/** The coordinates for the button label, always padded to 6 decimals. */
export function formatPin(point: MapPinPoint): string {
  return `${point.latitude.toFixed(PIN_DECIMALS)}, ${point.longitude.toFixed(PIN_DECIMALS)}`;
}

/** navigator.geolocation is missing (older browser or insecure origin). */
export const LOCATION_UNSUPPORTED_MESSAGE =
  "Your browser cannot share its location. Tap the map instead.";

/** The user (or the browser policy) denied the permission. */
export const LOCATION_BLOCKED_MESSAGE =
  "Location access was blocked. Allow it in your browser, or tap the map instead.";

/** Position unavailable or timed out. */
export const LOCATION_UNAVAILABLE_MESSAGE = "We could not find your location. Tap the map instead.";

/**
 * Map a GeolocationPositionError code to its message.
 * 1 is PERMISSION_DENIED in the spec; every other code gets the unavailable text.
 */
export function locationFailureMessage(code: number): string {
  if (code === 1) return LOCATION_BLOCKED_MESSAGE;
  return LOCATION_UNAVAILABLE_MESSAGE;
}
