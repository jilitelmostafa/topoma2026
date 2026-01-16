import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import Draw, { createBox } from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Select from 'ol/interaction/Select';
import Snap from 'ol/interaction/Snap';
import { click } from 'ol/events/condition';
import { Style, Stroke, Fill, Circle as CircleStyle, Text, Icon } from 'ol/style';
import { ScaleLine, Zoom } from 'ol/control';
import Overlay from 'ol/Overlay';
import { getArea, getLength } from 'ol/sphere';
import KML from 'ol/format/KML';
import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import MultiPoint from 'ol/geom/MultiPoint';
import Feature from 'ol/Feature';
import proj4 from 'proj4'; 
import { convertToWGS84, calculateScale, getResolutionFromScale, projectFromZone, projectToZone, formatArea, fetchElevation, createPointDXF, createPointText, createPointKML } from '../services/geoService';
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
    featureId?: string; // Added to track selection
}

interface ManualFeatureInfo {
    id: string;
    label: string;
    type: 'Polygon' | 'Rectangle' | 'Line' | 'Point';
}

interface MapComponentProps {
  onSelectionComplete: (data: SelectionData) => void;
  onMouseMove?: (x: string, y: string) => void;
  onManualFeaturesChange?: (features: ManualFeatureInfo[]) => void;
  selectedZone: string;
  mapType: 'satellite' | 'hybrid';
}

export interface MapComponentRef {
  getMapCanvas: (targetScale?: number, layerId?: string) => Promise<{ canvas: HTMLCanvasElement, extent: number[] } | null>;
  loadKML: (file: File, layerId: string) => void;
  loadShapefile: (file: File, layerId: string) => void;
  loadDXF: (file: File, zoneCode: string, layerId: string) => void;
  loadExcelPoints: (points: Array<{x: number, y: number, label?: string}>) => void;
  addManualPoint: (x: number, y: number, label: string) => void;
  setDrawTool: (type: 'Rectangle' | 'Polygon' | 'Point' | 'Line' | 'Edit' | null) => void;
  setMeasureTool: (type: 'MeasureLength' | 'MeasureArea', unit: string) => void;
  updateMeasureUnit: (unit: string) => void;
  clearAll: () => void;
  undoLastDraw: () => void;
  deleteSelectedFeature: () => void;
  setMapScale: (scale: number, centerOnSelection?: boolean) => void;
  locateUser: () => void;
  selectLayer: (layerId: string) => void;
  flyToLocation: (lon: number, lat: number, zoom?: number) => void;
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

// SVG for Blue Marker
const blueMarkerSvg = `<svg xmlns="http://www.w3.org/2000/svg" height="30" viewBox="0 0 24 24" width="30"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" stroke="#ffffff" stroke-width="1"/></svg>`;

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({ onSelectionComplete, onMouseMove, onManualFeaturesChange, selectedZone, mapType }, ref) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource>(new VectorSource()); // Clip Boundary (Manual Drawing)
  const kmlSourceRef = useRef<VectorSource>(new VectorSource()); // Imported Data (Layers)
  const pointsSourceRef = useRef<VectorSource>(new VectorSource()); // Points
  const measureSourceRef = useRef<VectorSource>(new VectorSource()); // Measurements
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  
  // Interaction Refs
  const drawInteractionRef = useRef<Draw | null>(null);
  const modifyInteractionRef = useRef<Modify | null>(null);
  const selectInteractionRef = useRef<Select | null>(null);
  const snapInteractionRef = useRef<Snap | null>(null);

  // Counters for auto-naming
  const featureCounters = useRef({ Polygon: 1, Line: 1, Point: 1, Rectangle: 1 });

  // Refs for Popup Overlay
  const popupRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const [popupContent, setPopupContent] = useState<PopupContent>(null);
  const selectedZoneRef = useRef(selectedZone); 

  // Measurement References
  const sketchRef = useRef<any>(null);
  const helpTooltipElementRef = useRef<HTMLElement | null>(null);
  const helpTooltipRef = useRef<Overlay | null>(null);
  const measureTooltipElementRef = useRef<HTMLElement | null>(null);
  const measureTooltipRef = useRef<Overlay | null>(null);
  const pointerMoveListenerRef = useRef<any>(null);
  const currentMeasureUnitRef = useRef<string>('m');

  const activeMeasurementsRef = useRef<Array<{ feature: Feature, overlay: Overlay, type: 'Length' | 'Area' }>>([]);

  // DYNAMIC STYLE FUNCTION FOR MANUAL DRAWINGS
  const manualStyleFunction = (feature: any) => {
    const geometry = feature.getGeometry();
    const type = geometry.getType();
    const label = feature.get('label') || '';
    const isSelected = feature.get('selected'); 

    // Text Style
    const textStyle = new Text({
        text: label,
        font: 'bold 12px Roboto, sans-serif',
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#166534', width: 3 }), // Dark Green outline for Polygons
        overflow: true,
        offsetY: type === 'Point' ? -25 : -10,
        placement: type === 'LineString' ? 'line' : 'point',
    });

    // POINT STYLE (Blue Marker Icon)
    if (type === 'Point') {
        textStyle.getStroke().setColor('#000000'); // Black outline for point text
        return new Style({
            image: new Icon({
                src: 'data:image/svg+xml;utf8,' + encodeURIComponent(blueMarkerSvg),
                anchor: [0.5, 1],
                scale: 1
            }),
            text: textStyle
        });
    }

    // POLYGON STYLE (Green Stroke, Transparent Fill, Permanent Vertices)
    if (type === 'Polygon' || type === 'MultiPolygon' || type === 'Circle') {
        const styles = [
            new Style({
                stroke: new Stroke({ color: '#22c55e', width: 2 }), // Green Stroke
                fill: new Fill({ color: 'rgba(255, 255, 255, 0)' }), // Transparent Fill
                text: textStyle
            })
        ];

        // Add Vertices (Points at corners)
        // We create a MultiPoint geometry from the Polygon coordinates to render dots
        if (type === 'Polygon') {
            styles.push(new Style({
                image: new CircleStyle({
                    radius: 3,
                    fill: new Fill({ color: '#22c55e' }), // Green dots
                    stroke: new Stroke({ color: '#fff', width: 1 })
                }),
                geometry: function(feature) {
                    const geom = feature.getGeometry();
                    if(geom instanceof Polygon) {
                        const coordinates = geom.getCoordinates()[0]; // Outer ring
                        return new MultiPoint(coordinates);
                    }
                    return geom;
                }
            }));
        }
        return styles;
    }

    // LINE STYLE
    return new Style({
        stroke: new Stroke({ color: '#22c55e', width: 2 }),
        text: textStyle
    });
  };

  const selectedStyleFunction = (feature: any) => {
      // When selected, keep the look but maybe thicken stroke or change color slightly
      const baseStyles = manualStyleFunction(feature);
      const styles = Array.isArray(baseStyles) ? baseStyles : [baseStyles];
      
      styles.forEach(s => {
          const stroke = s.getStroke();
          if (stroke) {
              stroke.setColor('#3b82f6'); // Blue selection
              stroke.setWidth(3);
          }
      });
      return styles;
  };

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
    // Style for loaded points (Excel, etc.) - SAME AS MANUAL POINT
    return new Style({
      image: new Icon({
          src: 'data:image/svg+xml;utf8,' + encodeURIComponent(blueMarkerSvg),
          anchor: [0.5, 1],
          scale: 1
      }),
      text: new Text({
        text: feature.get('label') || '',
        offsetY: -25,
        font: '11px Roboto, sans-serif',
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

  // Notification helper to update App.tsx state
  const notifyManualFeatures = () => {
      if (onManualFeaturesChange) {
          const features = sourceRef.current.getFeatures().map(f => ({
              id: f.getId() as string,
              label: f.get('label'),
              type: f.get('type')
          }));
          onManualFeaturesChange(features);
      }
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

  const downloadPointKML = () => {
    if (popupContent && popupContent.type === 'POINT') {
        const content = createPointKML(popupContent.lat, popupContent.lon, popupContent.label);
        const blob = new Blob([content], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${popupContent.label}.kml`;
        a.click();
    }
  };

  const calculateExtentAndNotify = (features: Feature[], sourceExtent: number[], featureId?: string) => {
       if (features.length > 0 && mapRef.current) {
           mapRef.current.getView().fit(sourceExtent, { padding: [50, 50, 50, 50], duration: 800 });
           const center = [(sourceExtent[0] + sourceExtent[2]) / 2, (sourceExtent[1] + sourceExtent[3]) / 2];
           const wgs = convertToWGS84(center[0], center[1]);
           const currentRes = mapRef.current.getView().getResolution() || 1;
           const scale = calculateScale(currentRes, parseFloat(wgs.lat));
           
           // Calculate total area/perimeter (approx for first feature or sum)
           const mainFeature = features[0];
           const geom = mainFeature.getGeometry();
           let area = "";
           let perimeter = "";
           
           if (geom instanceof Polygon) {
               area = formatAreaMetric(geom, 'sqm');
               perimeter = formatLength(geom, 'm');
           } else if (geom instanceof LineString) {
               perimeter = formatLength(geom, 'm');
           }

           onSelectionComplete({ 
               lat: wgs.lat, 
               lng: wgs.lng, 
               scale: scale, 
               bounds: sourceExtent, 
               area: area, 
               perimeter: perimeter,
               featureId: featureId
           });
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
    flyToLocation: (lon, lat, zoom) => {
        if (mapRef.current) {
            const coords = fromLonLat([lon, lat]);
            mapRef.current.getView().animate({ 
                center: coords, 
                zoom: zoom || 16, 
                duration: 1200 
            });
        }
    },
    setMapScale: (scale, centerOnSelection) => {
      if (!mapRef.current) return;
      const view = mapRef.current.getView();
      let center = view.getCenter();
      if (centerOnSelection) {
          // If we have a selected feature, center on it, otherwise fit source
          const selected = selectInteractionRef.current?.getFeatures();
          if (selected && selected.getLength() > 0) {
              const extent = selected.item(0).getGeometry()?.getExtent();
              if (extent) center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
          } else {
             const extent = sourceRef.current.getFeatures().length > 0 
                ? sourceRef.current.getExtent() 
                : (kmlSourceRef.current.getFeatures().length > 0 ? kmlSourceRef.current.getExtent() : null);
             if (extent) center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
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
    selectLayer: (layerId) => {
        if (!mapRef.current) return;
        
        // Manual feature selected by ID?
        const manualFeature = sourceRef.current.getFeatureById(layerId);
        if (manualFeature) {
            const extent = manualFeature.getGeometry()?.getExtent();
            if (extent) calculateExtentAndNotify([manualFeature], extent, layerId);
            // Highlight it
            selectInteractionRef.current?.getFeatures().clear();
            selectInteractionRef.current?.getFeatures().push(manualFeature);
            return;
        }

        let targetFeatures: Feature[] = [];
        let extent: number[] | null = null;

        if (layerId === 'manual') {
            // Select ALL manual features
            targetFeatures = sourceRef.current.getFeatures();
            if (targetFeatures.length > 0) extent = sourceRef.current.getExtent();
        } else {
            targetFeatures = kmlSourceRef.current.getFeatures().filter(f => f.get('layerId') === layerId);
            if (targetFeatures.length > 0) {
                 const firstExtent = targetFeatures[0].getGeometry()?.getExtent();
                 if (firstExtent) {
                    extent = [...firstExtent];
                    for (let i = 1; i < targetFeatures.length; i++) {
                        const geom = targetFeatures[i].getGeometry();
                        if (geom) {
                            const e = geom.getExtent();
                            if (e[0] < extent[0]) extent[0] = e[0];
                            if (e[1] < extent[1]) extent[1] = e[1];
                            if (e[2] > extent[2]) extent[2] = e[2];
                            if (e[3] > extent[3]) extent[3] = e[3];
                        }
                    }
                 }
            }
        }

        if (extent) {
             calculateExtentAndNotify(targetFeatures, extent);
        }
    },
    loadKML: (file, layerId) => { /* Same */
      overlayRef.current?.setPosition(undefined);
      const processFeatures = (features: any[]) => {
         features.forEach(f => f.set('layerId', layerId));
         kmlSourceRef.current.addFeatures(features);
         if (features.length > 0 && mapRef.current) {
           let extent = features[0].getGeometry()?.getExtent();
           if(extent) {
               features.forEach(f => {
                   const g = f.getGeometry();
                   if(g) {
                       const e = g.getExtent();
                       extent[0] = Math.min(extent[0], e[0]);
                       extent[1] = Math.min(extent[1], e[1]);
                       extent[2] = Math.max(extent[2], e[2]);
                       extent[3] = Math.max(extent[3], e[3]);
                   }
               });
               calculateExtentAndNotify(features, extent);
           }
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
    loadShapefile: (file, layerId) => { /* Same */
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
            features.forEach(f => f.set('layerId', layerId));
            kmlSourceRef.current.addFeatures(features);
            if (features.length > 0 && mapRef.current) {
                let extent = features[0].getGeometry()?.getExtent();
                if(extent) {
                    features.forEach(f => {
                        const g = f.getGeometry();
                        if(g) {
                            const e = g.getExtent();
                            extent[0] = Math.min(extent[0], e[0]);
                            extent[1] = Math.min(extent[1], e[1]);
                            extent[2] = Math.max(extent[2], e[2]);
                            extent[3] = Math.max(extent[3], e[3]);
                        }
                    });
                    calculateExtentAndNotify(features, extent);
                }
            }
          } catch (error: any) {}
        }
      };
      reader.readAsArrayBuffer(file);
    },
    loadDXF: (file, zoneCode, layerId) => { /* Same */
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
            features.forEach(f => f.set('layerId', layerId));
            kmlSourceRef.current.addFeatures(features);
            if (features.length > 0 && mapRef.current) {
                let extent = features[0].getGeometry()?.getExtent();
                if(extent) {
                   features.forEach(f => {
                       const g = f.getGeometry();
                       if(g) {
                           const e = g.getExtent();
                           extent[0] = Math.min(extent[0], e[0]);
                           extent[1] = Math.min(extent[1], e[1]);
                           extent[2] = Math.max(extent[2], e[2]);
                           extent[3] = Math.max(extent[3], e[3]);
                       }
                   });
                   calculateExtentAndNotify(features, extent);
                }
            }
        } catch (err) {}
      };
      reader.readAsText(file);
    },
    loadExcelPoints: (points) => { /* Same */
        overlayRef.current?.setPosition(undefined); 
        pointsSourceRef.current.clear();
        const features = points.map((pt, index) => new Feature({ geometry: new Point(fromLonLat([pt.x, pt.y])), label: pt.label || `P${index + 1}`, type: 'Point' }));
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
    addManualPoint: (x, y, label) => { /* Same */
        const feature = new Feature({ geometry: new Point(fromLonLat([x, y])), label: label, type: 'Point' });
        pointsSourceRef.current.addFeature(feature);
        if (mapRef.current) {
            mapRef.current.getView().animate({ center: fromLonLat([x, y]), zoom: 16, duration: 800 });
        }
    },
    setMeasureTool: (type, unit) => { /* Same */
        // Disable other interactions
        if (drawInteractionRef.current) mapRef.current?.removeInteraction(drawInteractionRef.current);
        if (modifyInteractionRef.current) modifyInteractionRef.current.setActive(false);
        if (selectInteractionRef.current) selectInteractionRef.current.setActive(false);

        if (!mapRef.current) return;
        currentMeasureUnitRef.current = unit;
        
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
        drawInteractionRef.current = draw;
    },
    setDrawTool: (type) => {
      if (!mapRef.current) return;
      
      // Cleanup previous interactions
      if (drawInteractionRef.current) {
          mapRef.current.removeInteraction(drawInteractionRef.current);
          drawInteractionRef.current = null;
      }
      if (pointerMoveListenerRef.current) {
          unByKey(pointerMoveListenerRef.current);
          pointerMoveListenerRef.current = null;
      }
      overlayRef.current?.setPosition(undefined);

      // Handle "Edit" Mode
      if (type === 'Edit') {
          if (modifyInteractionRef.current) modifyInteractionRef.current.setActive(true);
          if (selectInteractionRef.current) selectInteractionRef.current.setActive(true);
          if (snapInteractionRef.current) snapInteractionRef.current.setActive(true);
          return;
      } else {
          // Disable modify during drawing to avoid confusion, or keep it enabled for fine-tuning others
          // Usually disable modify while drawing new shape
          if (modifyInteractionRef.current) modifyInteractionRef.current.setActive(false);
          // Keep select active or deactive? Deactivate to avoid selecting while drawing
          if (selectInteractionRef.current) selectInteractionRef.current.setActive(false);
      }

      if (!type) return;

      const drawType = type === 'Rectangle' ? 'Circle' : (type === 'Line' ? 'LineString' : (type === 'Point' ? 'Point' : 'Polygon'));
      
      const draw = new Draw({
        source: type === 'Point' ? pointsSourceRef.current : sourceRef.current,
        type: drawType,
        geometryFunction: type === 'Rectangle' ? createBox() : undefined,
      });

      draw.on('drawstart', () => { 
         // Removed sourceRef.current.clear() to allow multiple manual features
         overlayRef.current?.setPosition(undefined); 
      });

      draw.on('drawend', (event) => {
        const feature = event.feature;
        const geometry = feature.getGeometry();
        if (!geometry) return;
        
        // AUTO GENERATE ID & LABEL
        const id = `${type}_${Date.now()}`;
        feature.setId(id);

        let label = '';
        if (type === 'Polygon') {
             label = `Polygone ${featureCounters.current.Polygon++}`;
        } else if (type === 'Rectangle') {
             label = `Rectangle ${featureCounters.current.Rectangle++}`;
        } else if (type === 'Line') {
             label = `Ligne ${featureCounters.current.Line++}`;
        } else if (type === 'Point') {
             label = `P${featureCounters.current.Point++}`;
        }
        
        feature.set('label', label);
        feature.set('type', type);

        // Notify App component
        setTimeout(notifyManualFeatures, 100);

        // HANDLE POINT
        if (type === 'Point' && geometry instanceof Point) {
             const coords = geometry.getCoordinates();
             showPointPopup(feature, coords);
             return;
        }
        
        // Calculate info for the notification
        const extent = geometry.getExtent();
        calculateExtentAndNotify([feature], extent, id);
      });

      mapRef.current.addInteraction(draw);
      drawInteractionRef.current = draw;
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
        featureCounters.current = { Polygon: 1, Line: 1, Point: 1, Rectangle: 1 };
        notifyManualFeatures();
    },
    undoLastDraw: () => {
        const features = sourceRef.current.getFeatures();
        if (features.length > 0) {
            const lastFeature = features[features.length - 1];
            sourceRef.current.removeFeature(lastFeature);
            overlayRef.current?.setPosition(undefined);
            notifyManualFeatures();
        }
    },
    deleteSelectedFeature: () => {
        const selectedFeatures = selectInteractionRef.current?.getFeatures();
        if (selectedFeatures && selectedFeatures.getLength() > 0) {
            selectedFeatures.forEach((feature) => {
                sourceRef.current.removeFeature(feature);
                // Also check points source if we allow selecting points
                pointsSourceRef.current.removeFeature(feature);
            });
            selectedFeatures.clear();
            overlayRef.current?.setPosition(undefined);
            notifyManualFeatures();
        }
    },
    getMapCanvas: async (targetScale, layerId) => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      
      let exportFeatures: Feature[] = [];
      let extent: number[] | null = null;
      const idToExport = layerId || 'manual'; // 'manual' implies ALL, specific ID implies ONE

      if (idToExport === 'manual') {
          exportFeatures = sourceRef.current.getFeatures();
          if (exportFeatures.length > 0) extent = sourceRef.current.getExtent();
      } else {
          // Check if it's a specific Manual Feature
          const manualFeat = sourceRef.current.getFeatureById(idToExport);
          if (manualFeat) {
              exportFeatures = [manualFeat];
              extent = manualFeat.getGeometry()?.getExtent() || null;
          } else {
              // It is a specific uploaded layer (KML/SHP)
              const allKmlFeatures = kmlSourceRef.current.getFeatures();
              exportFeatures = allKmlFeatures.filter(f => f.get('layerId') === idToExport);
              
              if (exportFeatures.length > 0) {
                    const firstExtent = exportFeatures[0].getGeometry()?.getExtent();
                    if (firstExtent) {
                    extent = [...firstExtent];
                    for (let i = 1; i < exportFeatures.length; i++) {
                        const geom = exportFeatures[i].getGeometry();
                        if (geom) {
                            const e = geom.getExtent();
                            if (e[0] < extent[0]) extent[0] = e[0];
                            if (e[1] < extent[1]) extent[1] = e[1];
                            if (e[2] > extent[2]) extent[2] = e[2];
                            if (e[3] > extent[3]) extent[3] = e[3];
                        }
                    }
                    }
              }
          }
      }

      if (!extent || exportFeatures.length === 0) {
          alert("La couche sélectionnée est vide ou invalide.");
          return null;
      }

      // Add points and measurements to context regardless of clipping layer
      const otherFeatures = [...pointsSourceRef.current.getFeatures(), ...measureSourceRef.current.getFeatures()];
      const allFeaturesToRender = [...exportFeatures, ...otherFeatures];

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
          
          // Draw Manual Features (Lines/Polygons)
          mapContext.beginPath();
          allFeaturesToRender.forEach(feature => {
            // Re-implement basic styling for canvas export to match the new dynamic style
            // Note: Canvas export of styles is manual in OpenLayers usually, this is a simplified version
            // that tries to mimic the map appearance.
            
            const geom = feature.getGeometry();
             if (geom instanceof LineString) {
                const lineCoords = geom.getCoordinates();
                mapContext.beginPath();
                lineCoords.forEach((coord, idx) => {
                    const px = (coord[0] - extent![0]) / exportRes;
                    const py = (extent![3] - coord[1]) / exportRes;
                    if (idx === 0) mapContext.moveTo(px, py);
                    else mapContext.lineTo(px, py);
                });
                mapContext.strokeStyle = measureSourceRef.current.hasFeature(feature) ? "#3b82f6" : "#22c55e"; // Blue measure, Green manual
                mapContext.lineWidth = 2;
                if(measureSourceRef.current.hasFeature(feature)) mapContext.setLineDash([10, 10]);
                mapContext.stroke();
                mapContext.setLineDash([]);
            }
            if (geom instanceof Polygon || geom instanceof MultiPolygon) {
                 const polys = geom instanceof Polygon ? [geom.getCoordinates()] : geom.getCoordinates();
                 polys.forEach(polyCoords => {
                    mapContext.beginPath();
                    polyCoords.forEach((ring: any[]) => {
                        ring.forEach((coord, idx) => {
                            const px = (coord[0] - extent![0]) / exportRes;
                            const py = (extent![3] - coord[1]) / exportRes;
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
                    } else if (exportFeatures.includes(feature)) {
                         // Clipping Feature
                         mapContext.strokeStyle = "#f59e0b"; // Orange/Yellowish for boundary
                         mapContext.lineWidth = 3;
                         mapContext.stroke();
                    } else {
                         // Other manual feature - Transparent Green
                         mapContext.strokeStyle = "#22c55e";
                         mapContext.lineWidth = 2;
                         mapContext.stroke();
                    }
                 });
            }
          });

          // Clip logic
          if (exportFeatures.length > 0) {
              mapContext.beginPath();
               exportFeatures.forEach(feature => {
                 const geom = feature.getGeometry();
                 if (geom instanceof Polygon || geom instanceof MultiPolygon) {
                     const polys = geom instanceof Polygon ? [geom.getCoordinates()] : geom.getCoordinates();
                     polys.forEach(polyCoords => {
                        polyCoords.forEach((ring: any[]) => {
                            ring.forEach((coord, idx) => {
                                const px = (coord[0] - extent![0]) / exportRes;
                                const py = (extent![3] - coord[1]) / exportRes;
                                if (idx === 0) mapContext.moveTo(px, py);
                                else mapContext.lineTo(px, py);
                            });
                            mapContext.closePath();
                        });
                     });
                 }
               });
               mapContext.clip();
          }

          // Draw Raster Layers (Satellite)
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

          // Draw Points on top
          otherFeatures.forEach(feature => {
             const geom = feature.getGeometry();
             if (geom instanceof Point) {
                 const coord = geom.getCoordinates();
                 const px = (coord[0] - extent![0]) / exportRes;
                 const py = (extent![3] - coord[1]) / exportRes;
                 
                 // Draw the Marker Icon (Simplified to Circle/Pin for Canvas)
                 mapContext.beginPath();
                 mapContext.arc(px, py, 6, 0, 2 * Math.PI);
                 mapContext.fillStyle = "#2563eb";
                 mapContext.fill();
                 mapContext.strokeStyle = "#ffffff";
                 mapContext.lineWidth = 2;
                 mapContext.stroke();
             }
          });

          map.setSize(originalSize);
          view.setResolution(originalRes);
          view.setCenter(originalCenter);
          resolve({ canvas: mapCanvas, extent: extent! });
        });
        map.renderSync();
      });
    }
  }));

  useEffect(() => {
    selectedZoneRef.current = selectedZone;
  }, [selectedZone]);

  // Init Map
  useEffect(() => {
    if (!mapElement.current) return;
    const overlay = new Overlay({
        element: popupRef.current!,
        autoPan: true,
        positioning: 'bottom-center',
        stopEvent: true, // Prevents map interaction through popup
        offset: [0, -35], // Higher offset for marker
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

    // Interactions
    const select = new Select({
        layers: [
            new VectorLayer({ source: sourceRef.current }), // Manual Drawings
            new VectorLayer({ source: pointsSourceRef.current }) // Points
        ],
        style: selectedStyleFunction
    });
    select.on('select', (e) => {
        // Optional: Notify app that selection changed
    });
    selectInteractionRef.current = select;

    const modify = new Modify({ 
        source: sourceRef.current,
        style: new Style({
             image: new CircleStyle({
                 radius: 6,
                 fill: new Fill({ color: '#22c55e' }), // Green handles for Edit
                 stroke: new Stroke({ color: '#fff', width: 2 })
             })
        })
    });
    modify.setActive(false); // Inactive by default
    modifyInteractionRef.current = modify;

    const snap = new Snap({ source: sourceRef.current });
    snap.setActive(false);
    snapInteractionRef.current = snap;

    const map = new Map({
      target: mapElement.current,
      layers: [
        baseLayer,
        new VectorLayer({ source: kmlSourceRef.current, style: new Style({ stroke: new Stroke({ color: '#f59e0b', width: 2.5 }), fill: new Fill({ color: 'rgba(245, 158, 11, 0.05)' }) }) }),
        new VectorLayer({ source: pointsSourceRef.current, style: pointStyle }),
        new VectorLayer({ source: measureSourceRef.current, style: measureStyle }),
        new VectorLayer({ source: sourceRef.current, style: manualStyleFunction })
      ],
      view: new View({ center: fromLonLat([-7.5898, 33.5731]), zoom: 6, maxZoom: 22 }),
      controls: [new Zoom(), new ScaleLine({ units: 'metric' })],
      overlays: [overlay],
    });

    map.addInteraction(select);
    map.addInteraction(modify);
    map.addInteraction(snap);
    
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
        
        const pixel = map.getEventPixel(evt.originalEvent);
        const hit = map.hasFeatureAtPixel(pixel, { layerFilter: (l) => l.getSource() === pointsSourceRef.current || l.getSource() === sourceRef.current });
        mapElement.current!.style.cursor = hit ? 'pointer' : '';
    });

    map.on('click', (evt) => {
        // PREVENT POPUP IF DRAWING IS ACTIVE
        if (drawInteractionRef.current) return;

        const pixel = map.getEventPixel(evt.originalEvent);
        const feature = map.forEachFeatureAtPixel(pixel, (feat) => feat, { 
             layerFilter: (l) => l.getSource() === pointsSourceRef.current 
        });

        if (feature && feature instanceof Feature) {
             const geom = feature.getGeometry();
             if (geom instanceof Point) {
                 showPointPopup(feature, geom.getCoordinates());
             }
        }
    });

    // Notify initial empty state
    notifyManualFeatures();

    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, []); 

  // Handle ESC key to cancel draw
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
             if (drawInteractionRef.current && mapRef.current) {
                 mapRef.current.removeInteraction(drawInteractionRef.current);
                 drawInteractionRef.current = null;
                 // Note: App state 'activeTool' won't update here, but interaction stops.
             }
        }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

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

  return (
      <div ref={mapElement} className="w-full h-full bg-slate-50 relative">
          <div ref={popupRef} className="absolute bg-white/95 backdrop-blur border border-slate-300 rounded-lg p-0 shadow-2xl min-w-[180px] max-w-[220px] text-slate-800 z-50">
             {popupContent && popupContent.type === 'AREA' && (
                 <div className="p-2 text-center">
                     <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Surface Calculée</div>
                     <div className="text-sm font-black text-slate-900 mb-1">
                        {popupContent.m2} m²
                     </div>
                     <div className="text-xs font-mono text-emerald-600 font-bold">
                        {popupContent.ha}
                     </div>
                 </div>
             )}
             {popupContent && popupContent.type === 'POINT' && (
                 <div className="flex flex-col w-full">
                     <div className="p-2 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-lg">
                         <span className="font-bold text-xs text-slate-800">{popupContent.label}</span>
                         <button 
                            onClick={(e) => {
                                e.stopPropagation(); 
                                overlayRef.current?.setPosition(undefined);
                            }} 
                            className="text-slate-400 hover:text-red-500 px-1"
                         >
                             <i className="fas fa-times text-sm"></i>
                         </button>
                     </div>
                     <div className="p-2 text-[10px] space-y-2">
                         <div>
                             <div className="font-bold text-blue-600 mb-0.5">{popupContent.zone}</div>
                             <div className="grid grid-cols-[15px_1fr] gap-x-1 items-center">
                                 <span className="font-bold text-slate-500">X:</span> <span className="font-mono">{popupContent.x.toFixed(2)} m</span>
                                 <span className="font-bold text-slate-500">Y:</span> <span className="font-mono">{popupContent.y.toFixed(2)} m</span>
                                 <span className="font-bold text-slate-500">Z:</span> <span className="font-mono font-bold text-emerald-600">{popupContent.z} m</span>
                             </div>
                         </div>
                         <div className="border-t border-slate-100 pt-1">
                             <div className="font-bold text-slate-500 mb-0.5">WGS 84</div>
                             <div className="grid grid-cols-[25px_1fr] gap-x-1 items-center text-[9px]">
                                 <span className="font-bold text-slate-400">Lat:</span> <span className="font-mono">{popupContent.lat.toFixed(6)}°</span>
                                 <span className="font-bold text-slate-400">Lon:</span> <span className="font-mono">{popupContent.lon.toFixed(6)}°</span>
                             </div>
                         </div>
                     </div>
                     <div className="bg-slate-100 p-1.5 border-t border-slate-200 rounded-b-lg grid grid-cols-4 gap-1">
                         <button onClick={downloadPointTXT} className="flex flex-col items-center justify-center p-1 rounded bg-white border border-slate-300 hover:bg-slate-50 transition-colors" title="Text Report">
                             <i className="fas fa-file-alt text-[10px] text-slate-600 mb-0.5"></i>
                             <span className="text-[8px] font-bold">TXT</span>
                         </button>
                         <button onClick={downloadPointDXF} className="flex flex-col items-center justify-center p-1 rounded bg-white border border-slate-300 hover:bg-slate-50 transition-colors" title="DXF File">
                             <i className="fas fa-file-code text-[10px] text-blue-600 mb-0.5"></i>
                             <span className="text-[8px] font-bold">DXF</span>
                         </button>
                         <button onClick={downloadPointGeoJSON} className="flex flex-col items-center justify-center p-1 rounded bg-white border border-slate-300 hover:bg-slate-50 transition-colors" title="GeoJSON">
                             <i className="fas fa-code text-[10px] text-green-600 mb-0.5"></i>
                             <span className="text-[8px] font-bold">JSON</span>
                         </button>
                         <button onClick={downloadPointKML} className="flex flex-col items-center justify-center p-1 rounded bg-white border border-slate-300 hover:bg-slate-50 transition-colors" title="KML Google Earth">
                             <i className="fas fa-globe text-[10px] text-yellow-600 mb-0.5"></i>
                             <span className="text-[8px] font-bold">KML</span>
                         </button>
                     </div>
                 </div>
             )}
          </div>
      </div>
  );
});

export default MapComponent;