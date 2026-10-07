import type { LngLat } from "./types";

export interface Place {
  name: string;
  detail: string;
  at: LngLat;
  /** [west, south, east, north] when the place has an extent */
  extent?: [number, number, number, number];
  zoom: number;
}

const ZOOM: Record<string, number> = {
  country: 5,
  state: 7,
  county: 9,
  city: 11,
  district: 13,
  locality: 13,
  street: 15,
  house: 16,
};

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    type?: string;
    osm_value?: string;
    city?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number];
  };
}

/** Free OpenStreetMap search by Komoot's Photon. Fine for occasional lookups as you type. */
export async function searchPlaces(q: string, signal: AbortSignal): Promise<Place[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Search isn't answering right now.");
  const data = (await res.json()) as { features: PhotonFeature[] };
  return data.features
    .filter((f) => f.properties.name)
    .map((f) => {
      const p = f.properties;
      const detail = [p.osm_value?.replace(/_/g, " "), p.city !== p.name ? p.city : undefined, p.state, p.country]
        .filter(Boolean)
        .join(", ");
      const zoom = p.osm_value === "peak" || p.osm_value === "volcano" ? 12 : (ZOOM[p.type ?? ""] ?? 12);
      return { name: p.name!, detail, at: f.geometry.coordinates, extent: p.extent, zoom };
    });
}
