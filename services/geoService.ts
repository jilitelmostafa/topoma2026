
import proj4 from 'proj4';

// تعريف المساقط
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

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

// حساب مقياس الرسم الحقيقي عند خط عرض معين
export const calculateScale = (resolution: number, lat: number): string => {
  // المقياس = (الدقة بالبكسل * معامل التصحيح لخط العرض) / حجم البكسل القياسي (0.264583 ملم)
  const groundResolution = resolution * Math.cos(lat * Math.PI / 180);
  const scale = groundResolution / 0.000264583333;
  return scale.toFixed(0);
};

// تحويل مقياس الرسم إلى دقة خريطة (Resolution)
export const getResolutionFromScale = (scaleValue: number, lat: number): number => {
  // الدقة = (المقياس * حجم البكسل القياسي) / معامل التصحيح لخط العرض
  const resolution = (scaleValue * 0.000264583333) / Math.cos(lat * Math.PI / 180);
  return resolution;
};
