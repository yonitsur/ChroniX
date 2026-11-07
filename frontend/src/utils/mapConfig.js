// Available basemap tile providers: 'google' | 'esriStreet' | 'esri'
// Configurable via VITE_MAP_TILE_PROVIDER in .env, or by setting ACTIVE_TILE_PROVIDER below.
const ENV_TILE_PROVIDER = import.meta.env?.VITE_MAP_TILE_PROVIDER;
export const ACTIVE_TILE_PROVIDER =
  ENV_TILE_PROVIDER === 'esri' || ENV_TILE_PROVIDER === 'esriStreet' ? ENV_TILE_PROVIDER : 'google';

// Module-level cache to remember last user-navigated map view coordinates per timeline across mode switches/theme changes:
export const lastMapViewMap = new Map();

export function clearSavedMapViews() {
  lastMapViewMap.clear();
}
