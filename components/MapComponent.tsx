import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import Draw, { createBox } from 'ol/interaction/Draw';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style';
import { ScaleLine, Zoom } from 'ol/control';
import Overlay from 'ol/Overlay';
import { getArea } from 'ol/sphere';
import KML from 'ol/format/KML';
import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { convertToWGS84, calculateScale, getResolutionFromScale, projectFromZone, formatArea } from '../services/geoService';

// تعريف المكتبات العالمية
declare const shp: any;
declare const JSZip: any;

interface MapComponentProps {
  onSelectionComplete: (data: { lat: string, lng: string, scale: string, bounds: number[] }) => void;
  mapType: 'satellite' | 'hybrid';
}

export interface MapComponentRef {
  getMapCanvas: (targetScale?: number) => Promise<{ canvas: HTMLCanvasElement, extent: number[] } | null>;
  loadKML: (file: File) => void;
  loadShapefile: (file: File) => void;
  loadDXF: (file: File, zoneCode: string) => void;
  loadExcelPoints: (points: Array<{x: number, y: number, label?: string}>) => void;
  setDrawTool: (type: 'Rectangle' | 'Polygon' | null) => void;
  clearAll: () => void;
  setMapScale: (scale: number) => void;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({ onSelectionComplete, mapType }, ref) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource>(new VectorSource());
  const kmlSourceRef = useRef<VectorSource>(new VectorSource());
  const pointsSourceRef = useRef<VectorSource>(new VectorSource());
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  
  // Refs for Popup Overlay
  const popupRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const [popupContent, setPopupContent] = useState<{ m2: string, ha: string } | null>(null);

  // تعريف النمط الأحمر الشفاف للرسم
  const redBoundaryStyle = new Style({
    fill: new Fill({ color: 'rgba(0, 0, 0, 0)' }), 
    stroke: new Stroke({ color: '#ff0000', width: 3 }),
  });

  // نمط النقاط المستوردة (Excel)
  const pointStyle = (feature: any) => {
    return new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#0ea5e9' }), // Sky Blue
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: feature.get('label') || '',
        offsetY: -15,
        font: '12px Roboto, sans-serif',
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#000000', width: 3 }),
      })
    });
  };

  useImperativeHandle(ref, () => ({
    setMapScale: (scale) => {
      if (!mapRef.current) return;
      const view = mapRef.current.getView();
      const center = view.getCenter();
      if (!center) return;
      
      const lonLat = toLonLat(center);
      const res = getResolutionFromScale(scale, lonLat[1]);
      
      view.animate({ resolution: res, duration: 600 });
    },
    loadKML: (file: File) => {
      overlayRef.current?.setPosition(undefined); // Hide popup
      const processFeatures = (features: any[]) => {
         kmlSourceRef.current.clear();
         sourceRef.current.clear();
         kmlSourceRef.current.addFeatures(features);
         if (features.length > 0 && mapRef.current) {
           const extent = kmlSourceRef.current.getExtent();
           mapRef.current.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 800 });
           const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
           const wgs = convertToWGS84(center[0], center[1]);
           const currentRes = mapRef.current.getView().getResolution() || 1;
           const scale = calculateScale(currentRes, parseFloat(wgs.lat));
           onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent });
         }
      };

      if (file.name.toLowerCase().endsWith('.kmz')) {
          const zip = new JSZip();
          zip.loadAsync(file).then((unzipped: any) => {
             const kmlFileName = Object.keys(unzipped.files).find(name => name.toLowerCase().endsWith('.kml'));
             if (kmlFileName) {
                 unzipped.files[kmlFileName].async("string").then((kmlText: string) => {
                     const features = new KML().readFeatures(kmlText, {
                        dataProjection: 'EPSG:4326',
                        featureProjection: 'EPSG:3857'
                     });
                     processFeatures(features);
                 });
             } else {
                 alert("Aucun fichier KML trouvé dans l'archive KMZ.");
             }
          }).catch((e: any) => {
              console.error(e);
              alert("Erreur lors de la lecture du fichier KMZ.");
          });
      } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const kmlText = e.target?.result as string;
            const features = new KML().readFeatures(kmlText, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            });
            processFeatures(features);
          };
          reader.readAsText(file);
      }
    },
    loadShapefile: (file: File) => {
      overlayRef.current?.setPosition(undefined); // Hide popup
      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          try {
            const buffer = e.target.result as ArrayBuffer;
            // استخدام shpjs الافتراضي (يدعم ZIP فقط)
            const geojson = await shp(buffer);

            const format = new GeoJSON();
            let features: any[] = [];
            if (Array.isArray(geojson)) {
               geojson.forEach(g => {
                   const f = format.readFeatures(g, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
                   features = features.concat(f);
               });
            } else {
               features = format.readFeatures(geojson, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
            }
            kmlSourceRef.current.clear();
            sourceRef.current.clear();
            kmlSourceRef.current.addFeatures(features);

            if (features.length > 0 && mapRef.current) {
              const extent = kmlSourceRef.current.getExtent();
              mapRef.current.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 800 });
              const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
              const wgs = convertToWGS84(center[0], center[1]);
              const currentRes = mapRef.current.getView().getResolution() || 1;
              const scale = calculateScale(currentRes, parseFloat(wgs.lat));
              onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent });
            }
          } catch (error: any) {
            console.error("Error parsing shapefile:", error);
            alert("Erreur lors de la lecture du fichier Shapefile. Assurez-vous d'utiliser un fichier ZIP valide.");
          }
        }
      };
      reader.readAsArrayBuffer(file);
    },
    loadDXF: (file: File, zoneCode: string) => {
      overlayRef.current?.setPosition(undefined); // Hide popup
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        try {
            // Access DxfParser from global window object
            const DxfParser = (window as any).DxfParser;
            if (!DxfParser) throw new Error("DxfParser library missing or not loaded");
            
            const parser = new DxfParser();
            const dxf = parser.parseSync(text);
            const features: Feature[] = [];
            
            // دالة مساعدة لتحويل الإحداثيات من النطاق المختار إلى إسقاط الخريطة
            const transform = (x: number, y: number) => {
                const ll = projectFromZone(x, y, zoneCode);
                if (ll) return fromLonLat(ll);
                // في حال الفشل أو إذا كانت الإحداثيات WGS84
                if (zoneCode === 'EPSG:4326') return fromLonLat([x, y]);
                return null; 
            };

            if (dxf && dxf.entities) {
                for (const entity of dxf.entities) {
                    if (entity.type === 'LINE') {
                         const p1 = transform(entity.vertices[0].x, entity.vertices[0].y);
                         const p2 = transform(entity.vertices[1].x, entity.vertices[1].y);
                         if (p1 && p2) {
                             features.push(new Feature(new LineString([p1, p2])));
                         }
                    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                        if (entity.vertices && entity.vertices.length > 1) {
                            const coords = entity.vertices.map((v: any) => transform(v.x, v.y)).filter((c: any) => c !== null);
                            if (coords.length > 1) {
                                features.push(new Feature(new LineString(coords)));
                            }
                        }
                    }
                }
            }
            
            kmlSourceRef.current.clear();
            sourceRef.current.clear();
            kmlSourceRef.current.addFeatures(features);

            if (features.length > 0 && mapRef.current) {
                const extent = kmlSourceRef.current.getExtent();
                mapRef.current.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 800 });
                const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
                const wgs = convertToWGS84(center[0], center[1]);
                const currentRes = mapRef.current.getView().getResolution() || 1;
                const scale = calculateScale(currentRes, parseFloat(wgs.lat));
                onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent });
            } else {
                alert("Aucune entité supportée trouvée dans le fichier DXF ou coordonnées hors zone.");
            }

        } catch (err) {
            console.error("DXF Error:", err);
            alert("Erreur lors de la lecture du fichier DXF. Vérifiez la console pour plus de détails.");
        }
      };
      reader.readAsText(file);
    },
    loadExcelPoints: (points) => {
        overlayRef.current?.setPosition(undefined); // Hide popup
        pointsSourceRef.current.clear();
        const features = points.map((pt, index) => {
            const feature = new Feature({
                geometry: new Point(fromLonLat([pt.x, pt.y])),
                label: pt.label || `P${index + 1}`
            });
            return feature;
        });
        
        pointsSourceRef.current.addFeatures(features);
        
        if (features.length > 0 && mapRef.current) {
            const extent = pointsSourceRef.current.getExtent();
            if (features.length === 1) {
                mapRef.current.getView().setCenter(fromLonLat([points[0].x, points[0].y]));
                mapRef.current.getView().setZoom(16);
            } else {
                mapRef.current.getView().fit(extent, { padding: [100, 100, 100, 100], duration: 1000 });
            }
        }
    },
    setDrawTool: (type) => {
      if (!mapRef.current) return;
      mapRef.current.getInteractions().forEach((i) => { if (i instanceof Draw) mapRef.current?.removeInteraction(i); });
      overlayRef.current?.setPosition(undefined); // Reset popup when changing tool
      
      if (!type) return;
      
      const draw = new Draw({
        source: sourceRef.current,
        type: type === 'Rectangle' ? 'Circle' : 'Polygon',
        geometryFunction: type === 'Rectangle' ? createBox() : undefined,
        style: redBoundaryStyle,
      });

      draw.on('drawstart', () => { 
        sourceRef.current.clear(); 
        kmlSourceRef.current.clear(); 
        overlayRef.current?.setPosition(undefined); // Hide popup on start drawing
      });

      draw.on('drawend', (event) => {
        const geometry = event.feature.getGeometry();
        if (!geometry) return;
        
        // Calculate Area
        const area = getArea(geometry);
        const { formattedM2, formattedHa } = formatArea(area);
        setPopupContent({ m2: formattedM2, ha: formattedHa });

        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        const wgs = convertToWGS84(center[0], center[1]);
        const currentRes = mapRef.current?.getView().getResolution() || 1;
        const scale = calculateScale(currentRes, parseFloat(wgs.lat));
        
        // Show Popup
        if (overlayRef.current) {
             // For Polygons, try to use interior point, otherwise center of extent
             let position = center;
             if (geometry instanceof Polygon) {
                 position = geometry.getInteriorPoint().getCoordinates();
             }
             overlayRef.current.setPosition(position);
        }

        onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent });
      });
      mapRef.current.addInteraction(draw);
    },
    clearAll: () => { 
        sourceRef.current.clear(); 
        kmlSourceRef.current.clear(); 
        pointsSourceRef.current.clear();
        overlayRef.current?.setPosition(undefined);
    },
    getMapCanvas: async (targetScale) => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      const allFeatures = [...kmlSourceRef.current.getFeatures(), ...sourceRef.current.getFeatures(), ...pointsSourceRef.current.getFeatures()];
      if (allFeatures.length === 0) return null;

      const extent = sourceRef.current.getFeatures().length > 0 
          ? sourceRef.current.getExtent() 
          : (kmlSourceRef.current.getFeatures().length > 0 ? kmlSourceRef.current.getExtent() : pointsSourceRef.current.getExtent());

      if (!extent) return null;

      const view = map.getView();
      const originalSize = map.getSize();
      const originalRes = view.getResolution();
      const originalCenter = view.getCenter();

      const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
      const wgs = convertToWGS84(center[0], center[1]);
      const exportRes = targetScale ? getResolutionFromScale(targetScale, parseFloat(wgs.lat)) : (originalRes || 1);

      const widthPx = Math.ceil((extent[2] - extent[0]) / exportRes);
      const heightPx = Math.ceil((extent[3] - extent[1]) / exportRes);

      if (widthPx > 16384 || heightPx > 16384) {
        alert("La zone est trop grande pour cette résolution, veuillez choisir une échelle plus grande (ex: 1:2500).");
        return null;
      }

      map.setSize([widthPx, heightPx]);
      view.setResolution(exportRes);
      view.setCenter(center);

      return new Promise((resolve) => {
        map.once('rendercomplete', () => {
          const mapCanvas = document.createElement('canvas');
          mapCanvas.width = widthPx;
          mapCanvas.height = heightPx;
          const mapContext = mapCanvas.getContext('2d');
          if (!mapContext) return resolve(null);

          mapContext.beginPath();
          allFeatures.forEach(feature => {
            const geom = feature.getGeometry();
            const coords: any[] = [];
            // Handle Polygons
            if (geom instanceof Polygon) coords.push(geom.getCoordinates());
            else if (geom instanceof MultiPolygon) coords.push(...geom.getCoordinates());
            // Handle Lines (DXF)
            if (geom instanceof LineString) {
                const lineCoords = geom.getCoordinates();
                mapContext.beginPath();
                lineCoords.forEach((coord, idx) => {
                    const px = (coord[0] - extent[0]) / exportRes;
                    const py = (extent[3] - coord[1]) / exportRes;
                    if (idx === 0) mapContext.moveTo(px, py);
                    else mapContext.lineTo(px, py);
                });
                mapContext.strokeStyle = "#f59e0b";
                mapContext.lineWidth = 2.5;
                mapContext.stroke();
            }

            coords.forEach(polyCoords => {
              polyCoords.forEach((ring: any[]) => {
                ring.forEach((coord, idx) => {
                  const px = (coord[0] - extent[0]) / exportRes;
                  const py = (extent[3] - coord[1]) / exportRes;
                  if (idx === 0) mapContext.moveTo(px, py);
                  else mapContext.lineTo(px, py);
                });
                mapContext.closePath();
              });
            });
            // Handle Points
            if (geom instanceof Point) {
                const coord = geom.getCoordinates();
                const px = (coord[0] - extent[0]) / exportRes;
                const py = (extent[3] - coord[1]) / exportRes;
                mapContext.moveTo(px + 5, py);
                mapContext.arc(px, py, 5, 0, 2 * Math.PI);
            }
          });
          // Only clip if polygons exist in the drawing source
          if (sourceRef.current.getFeatures().length > 0) mapContext.clip();
          
          const canvases = mapElement.current?.querySelectorAll('.ol-layer canvas');
          canvases?.forEach((canvas: any) => {
            if (canvas.width > 0) {
              const opacity = canvas.parentNode.style.opacity;
              mapContext.globalAlpha = opacity === '' ? 1 : Number(opacity);
              const transform = canvas.style.transform;
              let matrix;
              if (transform) {
                const match = transform.match(/^matrix\(([^\(]*)\)$/);
                if (match) matrix = match[1].split(',').map(Number);
              }
              if (!matrix) matrix = [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0];
              CanvasRenderingContext2D.prototype.setTransform.apply(mapContext, matrix);
              mapContext.drawImage(canvas, 0, 0);
            }
          });
          
          mapContext.setTransform(1, 0, 0, 1, 0, 0);
          mapContext.globalAlpha = 1;
          
          // Redraw points/lines on top to be visible
          allFeatures.forEach(feature => {
             const geom = feature.getGeometry();
             if (geom instanceof Point) {
                 const coord = geom.getCoordinates();
                 const px = (coord[0] - extent[0]) / exportRes;
                 const py = (extent[3] - coord[1]) / exportRes;
                 mapContext.beginPath();
                 mapContext.arc(px, py, 6, 0, 2 * Math.PI);
                 mapContext.fillStyle = "#0ea5e9";
                 mapContext.fill();
                 mapContext.strokeStyle = "#ffffff";
                 mapContext.lineWidth = 2;
                 mapContext.stroke();
             }
          });

          map.setSize(originalSize);
          view.setResolution(originalRes);
          view.setCenter(originalCenter);
          
          resolve({ canvas: mapCanvas, extent: extent });
        });
        map.renderSync();
      });
    }
  }));

  useEffect(() => {
    if (baseLayerRef.current) {
      const lyrCode = mapType === 'satellite' ? 's' : 'y';
      baseLayerRef.current.setSource(new XYZ({
        url: `https://mt{0-3}.google.com/vt/lyrs=${lyrCode}&x={x}&y={y}&z={z}`,
        maxZoom: 22,
        crossOrigin: 'anonymous',
      }));
    }
  }, [mapType]);

  useEffect(() => {
    if (!mapElement.current) return;
    
    // Create Overlay for Area Popup
    const overlay = new Overlay({
        element: popupRef.current!,
        autoPan: true,
        positioning: 'bottom-center',
        stopEvent: false,
        offset: [0, -10],
    });
    overlayRef.current = overlay;

    const lyrCode = mapType === 'satellite' ? 's' : 'y';
    const baseLayer = new TileLayer({
      source: new XYZ({
        url: `https://mt{0-3}.google.com/vt/lyrs=${lyrCode}&x={x}&y={y}&z={z}`,
        maxZoom: 22,
        crossOrigin: 'anonymous',
      }),
    });
    baseLayerRef.current = baseLayer;

    const map = new Map({
      target: mapElement.current,
      layers: [
        baseLayer,
        new VectorLayer({
            source: kmlSourceRef.current,
            style: new Style({
              stroke: new Stroke({ color: '#f59e0b', width: 2.5 }),
              fill: new Fill({ color: 'rgba(245, 158, 11, 0.05)' }),
            }),
        }),
        new VectorLayer({
            source: pointsSourceRef.current,
            style: pointStyle
        }),
        new VectorLayer({
          source: sourceRef.current,
          style: redBoundaryStyle,
        })
      ],
      view: new View({ center: fromLonLat([-7.5898, 33.5731]), zoom: 6, maxZoom: 22 }),
      controls: [new Zoom(), new ScaleLine({ units: 'metric' })],
      overlays: [overlay], // Add overlay to map
    });
    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, []);

  return (
      <div ref={mapElement} className="w-full h-full bg-slate-900 relative">
          {/* Popup Element */}
          <div ref={popupRef} className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-xl p-3 shadow-xl pointer-events-none transform translate-y-[-10px] min-w-[200px]">
             {popupContent && (
                 <div className="text-center">
                     <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Surface Calculée</div>
                     <div className="text-sm font-black text-white mb-1">
                        Surface : {popupContent.m2} m²
                     </div>
                     <div className="text-xs font-mono text-emerald-400 font-bold">
                        {popupContent.ha}
                     </div>
                 </div>
             )}
          </div>
      </div>
  );
});

export default MapComponent;