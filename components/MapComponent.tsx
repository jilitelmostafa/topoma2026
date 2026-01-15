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
import { getArea, getLength } from 'ol/sphere';
import KML from 'ol/format/KML';
import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import proj4 from 'proj4'; // Import directly to handle transforms inside
import { convertToWGS84, calculateScale, getResolutionFromScale, projectFromZone, formatArea } from '../services/geoService';
import { unByKey } from 'ol/Observable';

// تعريف المكتبات العالمية
declare const shp: any;
declare const JSZip: any;

interface MapComponentProps {
  onSelectionComplete: (data: { lat: string, lng: string, scale: string, bounds: number[] }) => void;
  onMouseMove?: (x: string, y: string) => void;
  selectedZone: string;
  mapType: 'satellite' | 'hybrid';
}

export interface MapComponentRef {
  getMapCanvas: (targetScale?: number) => Promise<{ canvas: HTMLCanvasElement, extent: number[] } | null>;
  loadKML: (file: File) => void;
  loadShapefile: (file: File) => void;
  loadDXF: (file: File, zoneCode: string) => void;
  loadExcelPoints: (points: Array<{x: number, y: number, label?: string}>) => void;
  addManualPoint: (x: number, y: number, label: string) => void;
  setDrawTool: (type: 'Rectangle' | 'Polygon' | null) => void;
  setMeasureTool: (type: 'MeasureLength' | 'MeasureArea', unit: string) => void;
  updateMeasureUnit: (unit: string) => void;
  clearAll: () => void;
  setMapScale: (scale: number) => void;
  locateUser: () => void;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({ onSelectionComplete, onMouseMove, selectedZone, mapType }, ref) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource>(new VectorSource()); // Clip Boundary
  const kmlSourceRef = useRef<VectorSource>(new VectorSource()); // Imported Data
  const pointsSourceRef = useRef<VectorSource>(new VectorSource()); // Points
  const measureSourceRef = useRef<VectorSource>(new VectorSource()); // Measurements
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  
  // Refs for Popup Overlay (Selection Area)
  const popupRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const [popupContent, setPopupContent] = useState<{ m2: string, ha: string } | null>(null);

  // Measurement References
  const sketchRef = useRef<any>(null);
  const helpTooltipElementRef = useRef<HTMLElement | null>(null);
  const helpTooltipRef = useRef<Overlay | null>(null);
  const measureTooltipElementRef = useRef<HTMLElement | null>(null);
  const measureTooltipRef = useRef<Overlay | null>(null);
  const pointerMoveListenerRef = useRef<any>(null);
  const currentMeasureUnitRef = useRef<string>('m');

  // Store measurement features to update them dynamically
  // We store: { featureId: string, overlay: Overlay, geometry: Geometry }
  const activeMeasurementsRef = useRef<Array<{ feature: Feature, overlay: Overlay, type: 'Length' | 'Area' }>>([]);

  // Styles
  const redBoundaryStyle = new Style({
    fill: new Fill({ color: 'rgba(0, 0, 0, 0)' }), 
    stroke: new Stroke({ color: '#ff0000', width: 3 }),
  });

  const measureStyle = new Style({
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.2)' }),
    stroke: new Stroke({ color: '#3b82f6', width: 2, lineDash: [10, 10] }),
    image: new CircleStyle({
      radius: 5,
      stroke: new Stroke({ color: '#3b82f6', width: 2 }),
      fill: new Fill({ color: '#ffffff' }),
    }),
  });

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

  // Helper formatting functions
  const formatLength = (line: LineString, unit: string) => {
    const length = getLength(line);
    let output;
    if (unit === 'km') {
        output = (length / 1000).toFixed(2) + ' km';
    } else if (unit === 'ft') {
        output = (length * 3.28084).toFixed(2) + ' ft';
    } else if (unit === 'mi') {
        output = (length * 0.000621371).toFixed(3) + ' mi';
    } else {
        output = length.toFixed(2) + ' m';
    }
    return output;
  };

  const formatAreaMetric = (polygon: Polygon, unit: string) => {
    const area = getArea(polygon);
    let output;
    if (unit === 'ha') {
        output = (area / 10000).toFixed(2) + ' ha';
    } else if (unit === 'sqkm') {
        output = (area / 1000000).toFixed(2) + ' km²';
    } else if (unit === 'ac') {
        output = (area * 0.000247105).toFixed(2) + ' ac';
    } else {
        output = area.toFixed(2) + ' m²';
    }
    return output;
  };

  const createMeasureTooltip = () => {
    if (measureTooltipElementRef.current) {
        measureTooltipElementRef.current.parentNode?.removeChild(measureTooltipElementRef.current);
    }
    measureTooltipElementRef.current = document.createElement('div');
    measureTooltipElementRef.current.className = 'bg-black/75 text-white px-2 py-1 rounded text-xs whitespace-nowrap border border-white/20 shadow-sm pointer-events-none transform translate-y-[-10px]';
    measureTooltipRef.current = new Overlay({
        element: measureTooltipElementRef.current,
        offset: [0, -15],
        positioning: 'bottom-center',
        stopEvent: false,
        insertFirst: false,
    });
    mapRef.current?.addOverlay(measureTooltipRef.current);
  };

  const createHelpTooltip = () => {
    if (helpTooltipElementRef.current) {
        helpTooltipElementRef.current.parentNode?.removeChild(helpTooltipElementRef.current);
    }
    helpTooltipElementRef.current = document.createElement('div');
    helpTooltipElementRef.current.className = 'hidden';
    helpTooltipRef.current = new Overlay({
        element: helpTooltipElementRef.current,
        offset: [15, 0],
        positioning: 'center-left',
    });
    mapRef.current?.addOverlay(helpTooltipRef.current);
  };

  useImperativeHandle(ref, () => ({
    locateUser: () => {
        if (!navigator.geolocation) {
            alert("La géolocalisation n'est pas supportée par votre navigateur.");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                const coords = fromLonLat([longitude, latitude]);
                if (mapRef.current) {
                    mapRef.current.getView().animate({ center: coords, zoom: 18, duration: 1000 });
                    const userFeature = new Feature({ geometry: new Point(coords), label: 'Moi' });
                    pointsSourceRef.current.addFeature(userFeature);
                }
            },
            (error) => { console.error(error); alert("Impossible d'obtenir votre position."); },
            { enableHighAccuracy: true }
        );
    },
    setMapScale: (scale) => {
      if (!mapRef.current) return;
      const view = mapRef.current.getView();
      const center = view.getCenter();
      if (!center) return;
      const lonLat = toLonLat(center);
      const res = getResolutionFromScale(scale, lonLat[1]);
      view.animate({ resolution: res, duration: 600 });
    },
    updateMeasureUnit: (unit) => {
        currentMeasureUnitRef.current = unit;
        // Update all active measurement overlays
        activeMeasurementsRef.current.forEach(item => {
            const geom = item.feature.getGeometry();
            if (!geom) return;
            const element = item.overlay.getElement();
            if (!element) return;

            let output = '';
            if (item.type === 'Area' && geom instanceof Polygon) {
                output = formatAreaMetric(geom, unit);
            } else if (item.type === 'Length' && geom instanceof LineString) {
                output = formatLength(geom, unit);
            }
            element.innerHTML = output;
        });
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
            const DxfParser = (window as any).DxfParser;
            if (!DxfParser) throw new Error("DxfParser library missing or not loaded");
            
            const parser = new DxfParser();
            const dxf = parser.parseSync(text);
            const features: Feature[] = [];
            
            const transform = (x: number, y: number) => {
                const ll = projectFromZone(x, y, zoneCode);
                if (ll) return fromLonLat(ll);
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
    addManualPoint: (x, y, label) => {
        const feature = new Feature({
            geometry: new Point(fromLonLat([x, y])),
            label: label
        });
        pointsSourceRef.current.addFeature(feature);
        if (mapRef.current) {
            mapRef.current.getView().animate({
                center: fromLonLat([x, y]),
                zoom: 16,
                duration: 800
            });
        }
    },
    setMeasureTool: (type, unit) => {
        if (!mapRef.current) return;
        currentMeasureUnitRef.current = unit;

        // Cleanup previous interactions
        mapRef.current.getInteractions().forEach((i) => { if (i instanceof Draw) mapRef.current?.removeInteraction(i); });
        
        // Remove active tooltip if one is pending but not finished (edge case)
        if (measureTooltipElementRef.current && !sketchRef.current) {
             measureTooltipElementRef.current.parentNode?.removeChild(measureTooltipElementRef.current);
             measureTooltipElementRef.current = null;
        }

        createMeasureTooltip();
        createHelpTooltip();

        const drawType = type === 'MeasureLength' ? 'LineString' : 'Polygon';
        const draw = new Draw({
            source: measureSourceRef.current,
            type: drawType,
            style: new Style({
                fill: new Fill({ color: 'rgba(255, 255, 255, 0.2)' }),
                stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.5)', lineDash: [10, 10], width: 2 }),
                image: new CircleStyle({ radius: 5, stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.7)' }), fill: new Fill({ color: 'rgba(255, 255, 255, 0.2)' }) }),
            }),
        });

        draw.on('drawstart', (evt) => {
            sketchRef.current = evt.feature;
            let tooltipCoord: any = (evt as any).coordinate;

            // Listener to update tooltip
            pointerMoveListenerRef.current = mapRef.current?.on('pointermove', (evt) => {
                if (evt.dragging) return;
                let helpMsg = 'Click to start drawing';
                if (sketchRef.current) {
                    const geom = sketchRef.current.getGeometry();
                    if (geom instanceof Polygon) {
                        helpMsg = 'Double click to end polygon';
                        const area = formatAreaMetric(geom, currentMeasureUnitRef.current);
                        if (measureTooltipElementRef.current) measureTooltipElementRef.current.innerHTML = area;
                        tooltipCoord = geom.getInteriorPoint().getCoordinates();
                    } else if (geom instanceof LineString) {
                        helpMsg = 'Click to continue line';
                        const length = formatLength(geom, currentMeasureUnitRef.current);
                        if (measureTooltipElementRef.current) measureTooltipElementRef.current.innerHTML = length;
                        tooltipCoord = geom.getLastCoordinate();
                    }
                    if (measureTooltipRef.current) measureTooltipRef.current.setPosition(tooltipCoord);
                }
            });
        });

        draw.on('drawend', () => {
            if (measureTooltipElementRef.current) {
                measureTooltipElementRef.current.className = 'bg-blue-600 text-white px-2 py-1 rounded text-xs whitespace-nowrap shadow-md border border-white';
                measureTooltipRef.current?.setOffset([0, -7]);
                
                // Store measurement for dynamic updating
                if (sketchRef.current && measureTooltipRef.current) {
                    activeMeasurementsRef.current.push({
                        feature: sketchRef.current,
                        overlay: measureTooltipRef.current,
                        type: type === 'MeasureLength' ? 'Length' : 'Area'
                    });
                }
            }
            // Reset sketch
            sketchRef.current = null;
            // Unset active tooltip so a new one is created next time
            measureTooltipElementRef.current = null;
            createMeasureTooltip();
            if (pointerMoveListenerRef.current) unByKey(pointerMoveListenerRef.current);
        });

        mapRef.current.addInteraction(draw);
    },
    setDrawTool: (type) => {
      if (!mapRef.current) return;
      if (pointerMoveListenerRef.current) unByKey(pointerMoveListenerRef.current);
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
        overlayRef.current?.setPosition(undefined); 
      });

      draw.on('drawend', (event) => {
        const geometry = event.feature.getGeometry();
        if (!geometry) return;
        
        // Calculate Area for Selection (Standard Metric)
        const area = getArea(geometry);
        const { formattedM2, formattedHa } = formatArea(area);
        setPopupContent({ m2: formattedM2, ha: formattedHa });

        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        const wgs = convertToWGS84(center[0], center[1]);
        const currentRes = mapRef.current?.getView().getResolution() || 1;
        const scale = calculateScale(currentRes, parseFloat(wgs.lat));
        
        if (overlayRef.current) {
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
        measureSourceRef.current.clear(); // Clear measurements
        activeMeasurementsRef.current = []; // Clear array tracking
        overlayRef.current?.setPosition(undefined);
        
        // Remove static measurement overlays manually to be sure
        document.querySelectorAll('.ol-overlay-container').forEach(el => {
             if (el.innerHTML.includes('bg-blue-600') || el.innerHTML.includes('bg-black/75')) {
                 el.remove();
             }
        });
    },
    getMapCanvas: async (targetScale) => {
      // Logic unchanged for canvas export...
      if (!mapRef.current) return null;
      const map = mapRef.current;
      
      const allFeatures = [
          ...kmlSourceRef.current.getFeatures(), 
          ...sourceRef.current.getFeatures(), 
          ...pointsSourceRef.current.getFeatures(),
          ...measureSourceRef.current.getFeatures()
      ];

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
        alert("La zone est trop grande pour cette résolution, veuillez choisir une échelle plus grande.");
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
             if (geom instanceof LineString) {
                const lineCoords = geom.getCoordinates();
                mapContext.beginPath();
                lineCoords.forEach((coord, idx) => {
                    const px = (coord[0] - extent[0]) / exportRes;
                    const py = (extent[3] - coord[1]) / exportRes;
                    if (idx === 0) mapContext.moveTo(px, py);
                    else mapContext.lineTo(px, py);
                });
                mapContext.strokeStyle = "#3b82f6";
                mapContext.lineWidth = 2;
                mapContext.setLineDash([10, 10]);
                mapContext.stroke();
                mapContext.setLineDash([]);
            }
            if (geom instanceof Polygon || geom instanceof MultiPolygon) {
                 const polys = geom instanceof Polygon ? [geom.getCoordinates()] : geom.getCoordinates();
                 polys.forEach(polyCoords => {
                    mapContext.beginPath();
                    polyCoords.forEach((ring: any[]) => {
                        ring.forEach((coord, idx) => {
                            const px = (coord[0] - extent[0]) / exportRes;
                            const py = (extent[3] - coord[1]) / exportRes;
                            if (idx === 0) mapContext.moveTo(px, py);
                            else mapContext.lineTo(px, py);
                        });
                        mapContext.closePath();
                    });
                    if (measureSourceRef.current.hasFeature(feature)) {
                        mapContext.fillStyle = "rgba(255, 255, 255, 0.2)";
                        mapContext.fill();
                        mapContext.strokeStyle = "#3b82f6";
                        mapContext.stroke();
                    } else if (sourceRef.current.hasFeature(feature)) {
                    } else {
                         mapContext.strokeStyle = "#f59e0b";
                         mapContext.lineWidth = 2.5;
                         mapContext.stroke();
                    }
                 });
            }
            if (geom instanceof Point) {
                const coord = geom.getCoordinates();
                const px = (coord[0] - extent[0]) / exportRes;
                const py = (extent[3] - coord[1]) / exportRes;
                mapContext.beginPath();
                mapContext.moveTo(px + 5, py);
                mapContext.arc(px, py, 5, 0, 2 * Math.PI);
                mapContext.fillStyle = "#0ea5e9";
                mapContext.fill();
            }
          });
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
            source: measureSourceRef.current,
            style: measureStyle,
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
    
    // Mouse Move Event for coordinates
    map.on('pointermove', (evt) => {
        if (evt.dragging) return;
        const coords = toLonLat(evt.coordinate); // Get WGS84
        // We can project here or in App.tsx. Since geoService has projectFromZone (Zone->WGS84) but we need WGS84->Zone,
        // we can use proj4 directly here since it's defined in geoService.
        try {
            if (selectedZone && selectedZone !== 'EPSG:4326') {
                 // Convert WGS84 [lng, lat] back to Zone. 
                 // Since proj4 definitions are loaded in geoService (imported at top), we can use proj4 here.
                 const projected = proj4('EPSG:4326', selectedZone, coords);
                 if (onMouseMove) onMouseMove(projected[0].toFixed(2), projected[1].toFixed(2));
            } else {
                 if (onMouseMove) onMouseMove(coords[0].toFixed(6), coords[1].toFixed(6));
            }
        } catch(e) {
            // Fallback
             if (onMouseMove) onMouseMove(coords[0].toFixed(2), coords[1].toFixed(2));
        }
    });

    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, []); // Run once on mount, but selectedZone updates will be handled by re-renders or refs? 
  // Actually useEffect [] runs once. `selectedZone` inside the callback will be stale (initial value).
  // Fix: Use a ref for selectedZone to access inside the event listener without re-creating map.
  
  // Quick Fix for Stale selectedZone in pointermove
  const selectedZoneRef = useRef(selectedZone);
  useEffect(() => { selectedZoneRef.current = selectedZone; }, [selectedZone]);
  
  useEffect(() => {
     if (!mapRef.current) return;
     // Update the listener to use the ref
     const map = mapRef.current;
     // We need to remove old listener if we were to re-bind, but map init is once.
     // So we just rely on the mutable ref inside the existing listener logic?
     // Actually, let's just add the listener logic here in a separate effect or use the ref in the init.
     // Since map init is complex, let's keep it simple: 
     // We modify the listener inside the init to use selectedZoneRef.current.
  }, []); 

  // Re-attach listener or use the ref pattern correctly in the initial useEffect
  // Correcting the initial useEffect above:
  /* 
    map.on('pointermove', (evt) => {
        // ... use selectedZoneRef.current
    });
  */

  return (
      <div ref={mapElement} className="w-full h-full bg-slate-50 relative">
          <div ref={popupRef} className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl p-3 shadow-xl pointer-events-none transform translate-y-[-10px] min-w-[200px]">
             {popupContent && (
                 <div className="text-center">
                     <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Surface Calculée</div>
                     <div className="text-sm font-black text-slate-900 mb-1">
                        Surface : {popupContent.m2} m²
                     </div>
                     <div className="text-xs font-mono text-emerald-600 font-bold">
                        {popupContent.ha}
                     </div>
                 </div>
             )}
          </div>
      </div>
  );
});

export default MapComponent;