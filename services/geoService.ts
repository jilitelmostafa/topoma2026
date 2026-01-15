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
       // إذا كانت WGS84 نتأكد فقط أنها في النطاق المعقول
       if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return [x, y];
       return null;
    }
    
    // التحويل باستخدام مكتبة Proj4 والتعريفات الدقيقة أعلاه
    const coords = proj4(zoneCode, 'EPSG:4326', [x, y]);
    const lng = coords[0];
    const lat = coords[1];
    
    // التحقق من أن النتيجة تقع داخل النطاق الجغرافي للمغرب (مع هامش بسيط)
    // Lat: 20 -> 37, Lng: -18 -> 0
    if (lat >= 20 && lat <= 38 && lng >= -19 && lng <= 1 && !isNaN(lng) && !isNaN(lat)) {
      return [lng, lat];
    }
    
    return null;
  } catch (e) {
    console.error("Projection error:", e);
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