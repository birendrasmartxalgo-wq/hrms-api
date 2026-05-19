import { collections } from '../db/collections';
import { env } from '../env';

export interface OfficeLocation {
  name: string;
  lat: number;
  lng: number;
  radiusMetres: number;
}

export interface GeofenceResult {
  withinGeofence: boolean;
  distanceFromOffice: number;
  nearestOffice: string | null;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function getDistanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getEnvOfficeLocations(): OfficeLocation[] {
  return [
    {
      name: 'HQ Office',
      lat: env.OFFICE_LAT ?? 20.2961,
      lng: env.OFFICE_LNG ?? 85.8245,
      radiusMetres: env.OFFICE_RADIUS_M ?? 200,
    },
  ];
}

async function getOfficeLocations(): Promise<OfficeLocation[]> {
  try {
    const setting = await collections.settings().findOne({ key: 'office_locations' });
    if (setting && Array.isArray(setting.value) && setting.value.length > 0) {
      return setting.value;
    }
  } catch {}
  return getEnvOfficeLocations();
}

export async function checkGeofenceAsync(lat: number, lng: number): Promise<GeofenceResult> {
  const offices = await getOfficeLocations();
  let minDistance = Infinity;
  let nearestOffice: string | null = null;
  let withinGeofence = false;

  for (const office of offices) {
    const dist = getDistanceMetres(lat, lng, office.lat, office.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestOffice = office.name;
    }
    if (dist <= office.radiusMetres) {
      withinGeofence = true;
    }
  }

  return {
    withinGeofence,
    distanceFromOffice: Math.round(minDistance),
    nearestOffice,
  };
}

export function checkGeofence(lat: number, lng: number): GeofenceResult {
  const offices = getEnvOfficeLocations();
  let minDistance = Infinity;
  let nearestOffice: string | null = null;
  let withinGeofence = false;

  for (const office of offices) {
    const dist = getDistanceMetres(lat, lng, office.lat, office.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestOffice = office.name;
    }
    if (dist <= office.radiusMetres) {
      withinGeofence = true;
    }
  }

  return {
    withinGeofence,
    distanceFromOffice: Math.round(minDistance),
    nearestOffice,
  };
}
