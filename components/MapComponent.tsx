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
import KML from 'ol/format/KML';
import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { convertToWGS84, calculateScale, getResolutionFromScale } from '../services/geoService';

// تعريف مكتبة shpjs العالمية
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
      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          try {
            const geojson = await shp(e.target.result);
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
          } catch (error) {
            console.error("Error parsing shapefile:", error);
            alert("Erreur lors de la lecture du fichier Shapefile.");
          }
        }
      };
      reader.readAsArrayBuffer(file);
    },
    loadExcelPoints: (points) => {
        pointsSourceRef.current.clear();
        const features = points.map((pt, index) => {
            // pt.x (lng), pt.y (lat) are already expected to be WGS84 here from the service
            const feature = new Feature({
                geometry: new Point(fromLonLat([pt.x, pt.y])),
                label: pt.label || `P${index + 1}`
            });
            return feature;
        });
        
        pointsSourceRef.current.addFeatures(features);
        
        if (features.length > 0 && mapRef.current) {
            const extent = pointsSourceRef.current.getExtent();
            // Zoom to points with some padding
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
      });

      draw.on('drawend', (event) => {
        const geometry = event.feature.getGeometry();
        if (!geometry) return;
        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        const wgs = convertToWGS84(center[0], center[1]);
        const currentRes = mapRef.current?.getView().getResolution() || 1;
        const scale = calculateScale(currentRes, parseFloat(wgs.lat));
        onSelectionComplete({ lat: wgs.lat, lng: wgs.lng, scale: scale, bounds: extent });
      });
      mapRef.current.addInteraction(draw);
    },
    clearAll: () => { 
        sourceRef.current.clear(); 
        kmlSourceRef.current.clear(); 
        pointsSourceRef.current.clear();
    },
    getMapCanvas: async (targetScale) => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      // تضمين نقاط Excel في الطباعة إذا وجدت
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
            // Handle Points (Simple rendering for export)
            if (geom instanceof Point) {
                const coord = geom.getCoordinates();
                const px = (coord[0] - extent[0]) / exportRes;
                const py = (extent[3] - coord[1]) / exportRes;
                mapContext.moveTo(px + 5, py);
                mapContext.arc(px, py, 5, 0, 2 * Math.PI);
            }
          });
          // Only clip/stroke if there are polygons drawn. If only points, we don't clip.
          if (sourceRef.current.getFeatures().length > 0) mapContext.clip();
          
          // Draw layers
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
          
          // Draw Vector overlay (The red lines or points) on top
          mapContext.setTransform(1, 0, 0, 1, 0, 0);
          mapContext.globalAlpha = 1;
          
          allFeatures.forEach(feature => {
             // Re-draw geometries on top for visibility in export
             const geom = feature.getGeometry();
             if (geom instanceof Polygon || geom instanceof MultiPolygon) {
                 // Logic repeated for stroke... simplified for now as main usage is clipping
             }
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
    });
    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, []);

  return <div ref={mapElement} className="w-full h-full bg-slate-900"></div>;
});

export default MapComponent;