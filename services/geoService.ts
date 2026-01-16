import proj4 from 'proj4';

// تعريف المساقط العالمية
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

/**
 * تعريف النطاقات المغربية (Maroc Lambert)
 * Reference: https://epsg.io/
 * Ellipsoid: Clarke 1880 (IGN) -> a=6378249.2, b=6356515.0
 * TOWGS84: 31, 146, 47, 0, 0, 0, 0
 */

// Zone I (Nord Maroc) - EPSG:26191
proj4.defs("EPSG:26191", "+proj=lcc +lat_1=33.3 +lat_0=33.3 +lon_0=-5.4 +k_0=0.999625769 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515.0 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs");

// Zone II (Sud Maroc / Centre) - EPSG:26192
proj4.defs("EPSG:26192", "+proj=lcc +lat_1=29.7 +lat_0=29.7 +lon_0=-5.4 +k_0=0.999615596 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515.0 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs");

// Zone III (Sahara Nord) - EPSG:26194
proj4.defs("EPSG:26194", "+proj=lcc +lat_1=26.1 +lat_0=26.1 +lon_0=-5.4 +k_0=0.999616304 +x_0=1200000 +y_0=400000 +a=6378249.2 +b=6356515.0 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs");

// Zone IV (Sahara Sud) - EPSG:26195
proj4.defs("EPSG:26195", "+proj=lcc +lat_1=22.5 +lat_0=22.5 +lon_0=-5.4 +k_0=0.999616437 +x_0=1500000 +y_0=400000 +a=6378249.2 +b=6356515.0 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs");

export interface WGS84Coords {
  lat: string;
  lng: string;
}

export const convertToWGS84 = (x: number, y: number): WGS84Coords => {
  try {
    const coords = proj4('EPSG:3857', 'EPSG:4326', [x, y]);
    return {
      lng: coords[0].toFixed(6),
      lat: coords[1].toFixed(6)
    };
  } catch (e) {
    return { lat: '0.000000', lng: '0.000000' };
  }
};

/**
 * دالة للتحويل المباشر بناءً على النطاق المحدد
 */
export const projectFromZone = (x: number, y: number, zoneCode: string): number[] | null => {
  try {
    if (zoneCode === 'EPSG:4326') {
       if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return [x, y];
       return null;
    }
    const coords = proj4(zoneCode, 'EPSG:4326', [x, y]);
    const lng = coords[0];
    const lat = coords[1];
    
    if (lat >= 20 && lat <= 38 && lng >= -19 && lng <= 1 && !isNaN(lng) && !isNaN(lat)) {
      return [lng, lat];
    }
    
    return null;
  } catch (e) {
    console.error("Projection error:", e);
    return null;
  }
};

export const projectToZone = (lon: number, lat: number, zoneCode: string): { x: number, y: number } | null => {
    try {
        if (zoneCode === 'EPSG:4326') return { x: lon, y: lat };
        const coords = proj4('EPSG:4326', zoneCode, [lon, lat]);
        return { x: coords[0], y: coords[1] };
    } catch (e) {
        return null;
    }
};

// حساب مقياس الرسم الحقيقي عند خط عرض معين
export const calculateScale = (resolution: number, lat: number): string => {
  const groundResolution = resolution * Math.cos(lat * Math.PI / 180);
  const scale = groundResolution / 0.000264583333;
  return scale.toFixed(0);
};

// تحويل مقياس الرسم إلى دقة خريطة (Resolution)
export const getResolutionFromScale = (scaleValue: number, lat: number): number => {
  const resolution = (scaleValue * 0.000264583333) / Math.cos(lat * Math.PI / 180);
  return resolution;
};

// تنسيق المساحة للعرض
export const formatArea = (area: number): { formattedM2: string, formattedHa: string } => {
  const formattedM2 = area.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hectares = Math.floor(area / 10000);
  const remainder = area % 10000;
  const ares = Math.floor(remainder / 100);
  const centiares = remainder % 100;

  let formattedHa = "";
  if (hectares > 0) {
      formattedHa += `${hectares} ha `;
  }
  if (ares > 0 || hectares > 0) {
      formattedHa += `${ares} a `;
  }
  formattedHa += `${centiares.toFixed(2)} ca`;

  return { formattedM2, formattedHa };
};

// Reverse Geocoding
export const fetchLocationName = async (lat: number, lon: number): Promise<string> => {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1`, {
            headers: { 'User-Agent': 'GeoMapperPro/1.0' }
        });
        const data = await response.json();
        const addr = data.address;
        if (!addr) return "location";
        const name = addr.village || addr.town || addr.city || addr.municipality || addr.county || "maroc";
        return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    } catch (e) {
        console.error("Geocoding failed", e);
        return "location";
    }
};

export interface SearchResult {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    icon?: string;
}

// Search Places (Nominatim)
export const searchPlaces = async (query: string): Promise<SearchResult[]> => {
    try {
        if (!query || query.length < 3) return [];
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`, {
            headers: { 'User-Agent': 'GeoMapperPro/1.0' }
        });
        const data = await response.json();
        return data;
    } catch (e) {
        console.error("Search failed", e);
        return [];
    }
};

// Fetch Elevation (Z)
export const fetchElevation = async (lat: number, lon: number): Promise<number> => {
    try {
        // Using Open-Elevation API (Public/Free)
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`);
        const data = await response.json();
        if (data && data.results && data.results.length > 0) {
            return data.results[0].elevation;
        }
        return 0;
    } catch (e) {
        console.warn("Elevation fetch failed, defaulting to 0", e);
        return 0;
    }
};

// Generate Point DXF
export const createPointDXF = (x: number, y: number, z: number, label: string) => {
    return `0
SECTION
2
ENTITIES
0
POINT
8
Points
10
${x.toFixed(3)}
20
${y.toFixed(3)}
30
${z.toFixed(3)}
0
TEXT
8
Labels
10
${x.toFixed(3)}
20
${y.toFixed(3)}
30
${z.toFixed(3)}
40
2.5
1
${label}
0
ENDSEC
0
EOF`;
};

// Generate Point Text File
export const createPointText = (x: number, y: number, z: number, lat: number, lon: number, label: string, zoneLabel: string) => {
    return `POINT DATA REPORT
-------------------
Label: ${label}
Zone: ${zoneLabel}

PROJECTED COORDINATES (Meters)
X : ${x.toFixed(3)} m
Y : ${y.toFixed(3)} m
Z : ${z.toFixed(3)} m

GEOGRAPHIC COORDINATES (WGS84)
Latitude  : ${lat.toFixed(7)}
Longitude : ${lon.toFixed(7)}
`;
};

// Generate Point KML File
export const createPointKML = (lat: number, lon: number, label: string) => {
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>${label}</name>
    <Point>
      <coordinates>${lon},${lat},0</coordinates>
    </Point>
  </Placemark>
</kml>`;
};