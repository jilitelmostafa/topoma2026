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
import proj4 from 'proj4'; 
import { convertToWGS84, calculateScale, getResolutionFromScale, projectFromZone, projectToZone, formatArea, fetchElevation, createPointDXF, createPointText } from '../services/geoService';
import { unByKey } from 'ol/Observable';

// تعريف المكتبات العالمية
declare const shp: any;
declare const JSZip: any;

interface SelectionData {
    lat: string;
    lng: string;
    scale: string;
    bounds: number[];
    area?: string;      
    perimeter?: string; 
    projection?: string;
}

interface MapComponentProps {
  onSelectionComplete: (data: SelectionData) => void;
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
  setDrawTool: (type: 'Rectangle' | 'Polygon' | 'Point' | null) => void;
  setMeasureTool: (type: 'MeasureLength' | 'MeasureArea', unit: string) => void;
  updateMeasureUnit: (unit: string) => void;
  clearAll: () => void;
  setMapScale: (scale: number, centerOnSelection?: boolean) => void;
  locateUser: () => void;
}

type PopupContent = 
  | { type: 'AREA', m2: string, ha: string }
  | { 
      type: 'POINT', 
      label: string, 
      x: number, 
      y: number, 
      z: number | '...', 
      lat: number, 
      lon: number,
      zone: string
    }
  | null;

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({ onSelectionComplete, onMouseMove, selectedZone, mapType }, ref) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource>(new VectorSource()); // Clip Boundary
  const kmlSourceRef = useRef<VectorSource>(new VectorSource()); // Imported Data
  const pointsSourceRef = useRef<VectorSource>(new VectorSource()); // Points
  const measureSourceRef = useRef<VectorSource>(new VectorSource()); // Measurements
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  
  // Refs for Popup Overlay
  const popupRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const [popupContent, setPopupContent] = useState<PopupContent>(null);
  const selectedZoneRef = useRef(selectedZone); // To access fresh state in callbacks

  // Measurement References
  const sketchRef = useRef<any>(null);
  const helpTooltipElementRef = useRef<HTMLElement | null>(null);
  const helpTooltipRef = useRef<Overlay | null>(null);
  const measureTooltipElementRef = useRef<HTMLElement | null>(null);
  const measureTooltipRef = useRef<Overlay | null>(null);
  const pointerMoveListenerRef = useRef<any>(null);
  const currentMeasureUnitRef = useRef<string>('m');

  const activeMeasurementsRef = useRef<Array<{ feature: Feature, overlay: Overlay, type: 'Length' | 'Area' }>>([]);

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

  const formatLength = (line: LineString | Polygon, unit: string) => {
    const length = getLength(line);
    let output;
    if (unit === 'km') output = (length / 1000).toFixed(2) + ' km';
    else if (unit === 'ft') output = (length * 3.28084).toFixed(2) + ' ft';
    else if (unit === 'mi') output = (length * 0.000621371).toFixed(3) + ' mi';
    else output = length.toFixed(2) + ' m';
    return output;
  };

  const formatAreaMetric = (polygon: Polygon, unit: string) => {
    const area = getArea(polygon);
    let output;
    if (unit === 'ha') output = (area / 10000).toFixed(2) + ' ha';
    else if (unit === 'sqkm') output = (area / 1000000).toFixed(2) + ' km²';
    else if (unit === 'ac') output = (area * 0.000247105).toFixed(2) + ' ac';
    else output = area.toFixed(2) + ' m²';
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

  const showPointPopup = async (feature: Feature, coordinate: number[]) => {
      const wgs84 = toLonLat(coordinate);
      const lon = wgs84[0];
      const lat = wgs84[1];
      const label = feature.get('label') || 'Pt';
      
      const zoneCode = selectedZoneRef.current;
      const proj = projectToZone(lon, lat, zoneCode);
      
      const zoneLabel = zoneCode === 'EPSG:4326' ? 'WGS 84' : 
                        zoneCode === 'EPSG:26191' ? 'Zone 1' :
                        zoneCode === 'EPSG:26192' ? 'Zone 2' :
                        zoneCode === 'EPSG:26194' ? 'Zone 3' : 'Zone 4';

      // Set Initial state with Loading Z
      setPopupContent({
          type: 'POINT',
          label: label,
          x: proj ? proj.x : 0,
          y: proj ? proj.y : 0,
          z: '...',
          lat: lat,
          lon: lon,
          zone: zoneLabel
      });
      overlayRef.current?.setPosition(coordinate);

      // Fetch Z asynchronously
      const z = await fetchElevation(lat, lon);
      
      setPopupContent(prev => {
          if (prev && prev.type === 'POINT' && prev.label === label) {
              return { ...prev, z: z };
          }
          return prev;
      });
  };

  // Download Handlers for Points
  const downloadPointDXF = () => {
      if (popupContent && popupContent.type === 'POINT') {
          const zVal = typeof popupContent.z === 'number' ? popupContent.z : 0;
          const content = createPointDXF(popupContent.x, popupContent.y, zVal, popupContent.label);
          const blob = new Blob([content], { type: 'application/dxf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${popupContent.label}_point.dxf`;
          a.click();
      }
  };

  const downloadPointTXT = () => {
      if (popupContent && popupContent.type === 'POINT') {
          const zVal = typeof popupContent.z === 'number' ? popupContent.z : 0;
          const content = createPointText(popupContent.x, popupContent.y, zVal, popupContent.lat, popupContent.lon, popupContent.label, popupContent.zone);
          const blob = new Blob([content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${popupContent.label}_data.txt`;
          a.click();
      }
  };

  const downloadPointGeoJSON = () => {
      if (popupContent && popupContent.type === 'POINT') {
          const zVal = typeof popupContent.z === 'number' ? popupContent.z : 0;
          const geojson = {
              type: "Feature",
              geometry: {
                  type: "Point",
                  coordinates: [popupContent.lon, popupContent.lat, zVal]
              },
              properties: {
                  name: popupContent.label,
                  X: popupContent.x,
                  Y: popupContent.y,
                  Z: zVal,
                  Zone: popupContent.zone
              }
          };
          const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${popupContent.label}.geojson`;
          a.click();
      }
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
    setMapScale: (scale, centerOnSelection) => { /* Same as before */
      if (!mapRef.current) return;
      const view = mapRef.current.getView();
      let center = view.getCenter();
      if (centerOnSelection) {
          const extent = sourceRef.current.getFeatures().length > 0 
          ? sourceRef.current.getExtent() 
          : (kmlSourceRef.current.getFeatures().length > 0 ? kmlSourceRef.current.getExtent() : null);
          if (extent) {
              center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
              view.setCenter(center);
          }
      }
      if (!center) return;
      const lonLat = toLonLat(center);
      const res = getResolutionFromScale(scale, lonLat[1]);
      view.animate({ resolution: res, center: center, duration: 600 });
    },
    updateMeasureUnit: (unit) => {
        currentMeasureUnitRef.current = unit;
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
    loadKML: (file) => { /* Unchanged */
      // ... same logic for KML
      overlayRef.current?.setPosition(undefined);
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
           const extentPoly = new Polygon([[
               [extent[0], extent[1]], [extent[0], extent[3]], [extent[2], extent[3]], [extent[2], extent[1]], [extent[0], extent[1]]
           ]]);
           const area = formatAreaMetric(extentPoly, 'sqm');
           const perimeter = formatLength(extentPoly, 'm');
           onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent, area: area, perimeter: perimeter });
         }
      };
      if (file.name.toLowerCase().endsWith('.kmz')) {
          const zip = new JSZip();
          zip.loadAsync(file).then((unzipped: any) => {
             const kmlFileName = Object.keys(unzipped.files).find(name => name.toLowerCase().endsWith('.kml'));
             if (kmlFileName) {
                 unzipped.files[kmlFileName].async("string").then((kmlText: string) => {
                     const features = new KML().readFeatures(kmlText, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
                     processFeatures(features);
                 });
             }
          });
      } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const kmlText = e.target?.result as string;
            const features = new KML().readFeatures(kmlText, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
            processFeatures(features);
          };
          reader.readAsText(file);
      }
    },
    loadShapefile: (file) => { /* Unchanged */
      // ... same logic for SHP
      overlayRef.current?.setPosition(undefined);
      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          try {
            const buffer = e.target.result as ArrayBuffer;
            const geojson = await shp(buffer);
            const format = new GeoJSON();
            let features: any[] = [];
            if (Array.isArray(geojson)) {
               geojson.forEach(g => { features = features.concat(format.readFeatures(g, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' })); });
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
              const extentPoly = new Polygon([[ [extent[0], extent[1]], [extent[0], extent[3]], [extent[2], extent[3]], [extent[2], extent[1]], [extent[0], extent[1]] ]]);
               onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent, area: formatAreaMetric(extentPoly, 'sqm'), perimeter: formatLength(extentPoly, 'm') });
            }
          } catch (error: any) {}
        }
      };
      reader.readAsArrayBuffer(file);
    },
    loadDXF: (file, zoneCode) => { /* Unchanged */
      // ... same logic for DXF
      overlayRef.current?.setPosition(undefined);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        try {
            const DxfParser = (window as any).DxfParser;
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
                         if (p1 && p2) features.push(new Feature(new LineString([p1, p2])));
                    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                        if (entity.vertices && entity.vertices.length > 1) {
                            const coords = entity.vertices.map((v: any) => transform(v.x, v.y)).filter((c: any) => c !== null);
                            if (coords.length > 1) features.push(new Feature(new LineString(coords)));
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
                const extentPoly = new Polygon([[ [extent[0], extent[1]], [extent[0], extent[3]], [extent[2], extent[3]], [extent[2], extent[1]], [extent[0], extent[1]] ]]);
                onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent, area: formatAreaMetric(extentPoly, 'sqm'), perimeter: formatLength(extentPoly, 'm') });
            }
        } catch (err) {}
      };
      reader.readAsText(file);
    },
    loadExcelPoints: (points) => { /* Unchanged */
        overlayRef.current?.setPosition(undefined); 
        pointsSourceRef.current.clear();
        const features = points.map((pt, index) => new Feature({ geometry: new Point(fromLonLat([pt.x, pt.y])), label: pt.label || `P${index + 1}` }));
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
        const feature = new Feature({ geometry: new Point(fromLonLat([x, y])), label: label });
        pointsSourceRef.current.addFeature(feature);
        if (mapRef.current) {
            mapRef.current.getView().animate({ center: fromLonLat([x, y]), zoom: 16, duration: 800 });
        }
    },
    setMeasureTool: (type, unit) => { /* Unchanged */
        // ... Measurement Logic
        if (!mapRef.current) return;
        currentMeasureUnitRef.current = unit;
        mapRef.current.getInteractions().forEach((i) => { if (i instanceof Draw) mapRef.current?.removeInteraction(i); });
        
        if (measureTooltipElementRef.current && !sketchRef.current) {
             measureTooltipElementRef.current.parentNode?.removeChild(measureTooltipElementRef.current);
             measureTooltipElementRef.current = null;
        }

        createMeasureTooltip();
        createHelpTooltip();

        const drawType = type === 'MeasureLength' ? 'LineString' : 'Polygon';
        const drawingStyle = new Style({
            fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
            stroke: new Stroke({ color: '#d97706', width: 3, lineDash: [10, 10] }),
            image: new CircleStyle({ radius: 5, stroke: new Stroke({ color: '#d97706' }), fill: new Fill({ color: '#fbbf24' }) })
        });

        const draw = new Draw({
            source: measureSourceRef.current,
            type: drawType,
            style: drawingStyle,
        });

        draw.on('drawstart', (evt) => {
            sketchRef.current = evt.feature;
            let tooltipCoord: any = (evt as any).coordinate;
            pointerMoveListenerRef.current = mapRef.current?.on('pointermove', (evt) => {
                if (evt.dragging) return;
                let helpMsg = 'Click to start';
                if (sketchRef.current) {
                    const geom = sketchRef.current.getGeometry();
                    if (geom instanceof Polygon) {
                        helpMsg = 'Double click to end';
                        const area = formatAreaMetric(geom, currentMeasureUnitRef.current);
                        if (measureTooltipElementRef.current) measureTooltipElementRef.current.innerHTML = area;
                        tooltipCoord = geom.getInteriorPoint().getCoordinates();
                    } else if (geom instanceof LineString) {
                        helpMsg = 'Click to continue';
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
                if (sketchRef.current && measureTooltipRef.current) {
                    activeMeasurementsRef.current.push({
                        feature: sketchRef.current,
                        overlay: measureTooltipRef.current,
                        type: type === 'MeasureLength' ? 'Length' : 'Area'
                    });
                }
            }
            sketchRef.current = null;
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
      overlayRef.current?.setPosition(undefined); // Close popup
      if (!type) return;
      
      const draw = new Draw({
        source: type === 'Point' ? pointsSourceRef.current : sourceRef.current,
        type: type === 'Rectangle' ? 'Circle' : (type === 'Point' ? 'Point' : 'Polygon'),
        geometryFunction: type === 'Rectangle' ? createBox() : undefined,
        style: type === 'Point' ? pointStyle : redBoundaryStyle,
      });

      draw.on('drawstart', () => { 
        if (type !== 'Point') {
            sourceRef.current.clear(); 
            kmlSourceRef.current.clear(); 
        }
        overlayRef.current?.setPosition(undefined); 
      });

      draw.on('drawend', (event) => {
        const geometry = event.feature.getGeometry();
        if (!geometry) return;

        // HANDLE POINT
        if (type === 'Point' && geometry instanceof Point) {
             const coords = geometry.getCoordinates();
             // Auto label
             const count = pointsSourceRef.current.getFeatures().length + 1;
             const label = `P${count}`;
             event.feature.set('label', label);
             showPointPopup(event.feature, coords);
             return;
        }
        
        // HANDLE AREA (Rectangle/Polygon)
        const areaVal = getArea(geometry);
        const { formattedM2, formattedHa } = formatArea(areaVal);
        setPopupContent({ type: 'AREA', m2: formattedM2, ha: formattedHa });

        // Calculate Perimeter
        const perimeterVal = getLength(geometry);
        const perimeterFormatted = (perimeterVal / 1000) > 1 
            ? `${(perimeterVal / 1000).toFixed(2)} km` 
            : `${perimeterVal.toFixed(2)} m`;
        
        const areaFormatted = `${formattedM2} m²`;

        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        const wgs = convertToWGS84(center[0], center[1]);
        const currentRes = mapRef.current?.getView().getResolution() || 1;
        const scale = calculateScale(currentRes, parseFloat(wgs.lat));
        
        if (overlayRef.current) {
             let position = center;
             if (geometry instanceof Polygon) position = geometry.getInteriorPoint().getCoordinates();
             overlayRef.current.setPosition(position);
        }

        onSelectionComplete({ 
            lat: wgs.lat, 
            lng: wgs.lng, 
            scale: scale, 
            bounds: extent,
            area: areaFormatted,
            perimeter: perimeterFormatted
        });
      });
      mapRef.current.addInteraction(draw);
    },
    clearAll: () => { 
        sourceRef.current.clear(); 
        kmlSourceRef.current.clear(); 
        pointsSourceRef.current.clear();
        measureSourceRef.current.clear();
        activeMeasurementsRef.current = [];
        overlayRef.current?.setPosition(undefined);
        document.querySelectorAll('.ol-overlay-container').forEach(el => {
             if (el.innerHTML.includes('bg-blue-600') || el.innerHTML.includes('bg-black/75')) el.remove();
        });
    },
    getMapCanvas: async (targetScale) => { /* Unchanged */
      if (!mapRef.current) return null;
      const map = mapRef.current;
      const allFeatures = [...kmlSourceRef.current.getFeatures(), ...sourceRef.current.getFeatures(), ...pointsSourceRef.current.getFeatures(), ...measureSourceRef.current.getFeatures()];
      if (allFeatures.length === 0) return null;
      const extent = sourceRef.current.getFeatures().length > 0 ? sourceRef.current.getExtent() : (kmlSourceRef.current.getFeatures().length > 0 ? kmlSourceRef.current.getExtent() : pointsSourceRef.current.getExtent());
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
      if (widthPx > 16384 || heightPx > 16384) { alert("La zone est trop grande."); return null; }
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
    selectedZoneRef.current = selectedZone;
  }, [selectedZone]);

  // ... (Effects remain mostly same)
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
        new VectorLayer({ source: kmlSourceRef.current, style: new Style({ stroke: new Stroke({ color: '#f59e0b', width: 2.5 }), fill: new Fill({ color: 'rgba(245, 158, 11, 0.05)' }) }) }),
        new VectorLayer({ source: pointsSourceRef.current, style: pointStyle }),
        new VectorLayer({ source: measureSourceRef.current, style: measureStyle }),
        new VectorLayer({ source: sourceRef.current, style: redBoundaryStyle })
      ],
      view: new View({ center: fromLonLat([-7.5898, 33.5731]), zoom: 6, maxZoom: 22 }),
      controls: [new Zoom(), new ScaleLine({ units: 'metric' })],
      overlays: [overlay],
    });
    
    // Updated Mouse Move logic
    map.on('pointermove', (evt) => {
        if (evt.dragging) return;
        const coords = toLonLat(evt.coordinate);
        const lon = coords[0];
        const lat = coords[1];
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        const latStr = `${latDir}${Math.abs(lat).toFixed(4)}`;
        const lonStr = `${lonDir}${Math.abs(lon).toFixed(4)}`;
        if (onMouseMove) onMouseMove(lonStr, latStr);
        
        // Change cursor over points
        const pixel = map.getEventPixel(evt.originalEvent);
        const hit = map.hasFeatureAtPixel(pixel, { layerFilter: (l) => l.getSource() === pointsSourceRef.current });
        mapElement.current!.style.cursor = hit ? 'pointer' : '';
    });

    // Click logic to select existing points
    map.on('click', (evt) => {
        const pixel = map.getEventPixel(evt.originalEvent);
        const feature = map.forEachFeatureAtPixel(pixel, (feat) => feat, { 
             layerFilter: (l) => l.getSource() === pointsSourceRef.current 
        });

        if (feature && feature instanceof Feature) {
             const geom = feature.getGeometry();
             if (geom instanceof Point) {
                 showPointPopup(feature, geom.getCoordinates());
             }
        } else {
             // If not clicking a point and not drawing, close popup? 
             // Only if not measuring or drawing area.
             // Rely on setDrawTool to clear overlay usually.
             // But if we just click map, we might want to close popup if open.
             if (!feature) {
                 // optional: overlayRef.current?.setPosition(undefined);
             }
        }
    });

    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, []); 
  
  return (
      <div ref={mapElement} className="w-full h-full bg-slate-50 relative">
          <div ref={popupRef} className="absolute bg-white/95 backdrop-blur border border-slate-200 rounded-xl p-0 shadow-xl min-w-[200px] max-w-[220px] text-slate-800 z-50">
             {popupContent && popupContent.type === 'AREA' && (
                 <div className="p-3 text-center">
                     <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Surface Calculée</div>
                     <div className="text-sm font-black text-slate-900 mb-1">
                        Surface : {popupContent.m2} m²
                     </div>
                     <div className="text-xs font-mono text-emerald-600 font-bold">
                        {popupContent.ha}
                     </div>
                 </div>
             )}
             {popupContent && popupContent.type === 'POINT' && (
                 <div className="flex flex-col w-full">
                     <div className="bg-slate-100 p-2 border-b border-slate-200 rounded-t-xl flex justify-between items-center">
                         <span className="font-bold text-sm text-slate-700">📌 {popupContent.label}</span>
                         <button onClick={() => overlayRef.current?.setPosition(undefined)} className="text-slate-400 hover:text-red-500"><i className="fas fa-times"></i></button>
                     </div>
                     <div className="p-3 text-[11px] space-y-2">
                         <div>
                             <div className="font-bold text-blue-600 border-b border-slate-100 mb-1 pb-1">{popupContent.zone} :</div>
                             <div className="grid grid-cols-[20px_1fr] gap-x-1">
                                 <span className="font-bold text-slate-500">X:</span> <span className="font-mono">{popupContent.x.toFixed(2)} m</span>
                                 <span className="font-bold text-slate-500">Y:</span> <span className="font-mono">{popupContent.y.toFixed(2)} m</span>
                                 <span className="font-bold text-slate-500">Z:</span> <span className="font-mono font-bold text-emerald-600">{popupContent.z} m</span>
                             </div>
                         </div>
                         <div>
                             <div className="font-bold text-blue-600 border-b border-slate-100 mb-1 pb-1">WGS84 :</div>
                             <div className="grid grid-cols-[30px_1fr] gap-x-1">
                                 <span className="font-bold text-slate-500">Lat:</span> <span className="font-mono">{popupContent.lat.toFixed(6)}</span>
                                 <span className="font-bold text-slate-500">Lon:</span> <span className="font-mono">{popupContent.lon.toFixed(6)}</span>
                             </div>
                         </div>
                     </div>
                     <div className="bg-slate-50 p-2 border-t border-slate-200 rounded-b-xl flex justify-between items-center gap-2">
                         <span className="text-[10px] font-bold text-slate-400 uppercase">Télécharger:</span>
                         <div className="flex gap-1">
                             <button onClick={downloadPointDXF} className="w-7 h-7 flex items-center justify-center rounded bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 hover:border-red-300 transition-colors" title="DXF">
                                 <i className="fas fa-file-code"></i>
                             </button>
                             <button onClick={downloadPointTXT} className="w-7 h-7 flex items-center justify-center rounded bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-colors" title="Text (Coords)">
                                 <i className="fas fa-file-alt"></i>
                             </button>
                             <button onClick={downloadPointGeoJSON} className="w-7 h-7 flex items-center justify-center rounded bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 hover:border-green-300 transition-colors" title="GeoJSON">
                                 <i className="fas fa-globe"></i>
                             </button>
                         </div>
                     </div>
                 </div>
             )}
          </div>
      </div>
  );
});

export default MapComponent;