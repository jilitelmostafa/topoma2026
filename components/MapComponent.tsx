
import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import Draw, { createBox } from 'ol/interaction/Draw';
import { Style, Stroke, Fill } from 'ol/style';
import { ScaleLine, Zoom } from 'ol/control';
import KML from 'ol/format/KML';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import { convertToWGS84, calculateScale, getResolutionFromScale } from '../services/geoService';

interface MapComponentProps {
  onSelectionComplete: (data: { lat: string, lng: string, scale: string, bounds: number[] }) => void;
  mapType: 'satellite' | 'hybrid';
}

export interface MapComponentRef {
  getMapCanvas: (targetScale?: number) => Promise<{ canvas: HTMLCanvasElement, extent: number[] } | null>;
  loadKML: (file: File) => void;
  setDrawTool: (type: 'Rectangle' | 'Polygon' | null) => void;
  clearAll: () => void;
  setMapScale: (scale: number) => void;
}

const MapComponent = forwardRef<MapComponentRef, MapComponentProps>(({ onSelectionComplete, mapType }, ref) => {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef<VectorSource>(new VectorSource());
  const kmlSourceRef = useRef<VectorSource>(new VectorSource());
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);

  // تعريف النمط الأحمر الشفاف
  const redBoundaryStyle = new Style({
    fill: new Fill({ color: 'rgba(0, 0, 0, 0)' }), // شفاف تماماً
    stroke: new Stroke({ 
      color: '#ff0000', // أحمر صريح
      width: 3, 
      lineDash: undefined 
    }),
  });

  useImperativeHandle(ref, () => ({
    setMapScale: (scale) => {
      if (!mapRef.current) return;
      const view = mapRef.current.getView();
      const center = view.getCenter();
      if (!center) return;
      
      const lonLat = toLonLat(center);
      const res = getResolutionFromScale(scale, lonLat[1]);
      
      view.animate({
        resolution: res,
        duration: 600
      });
    },
    loadKML: (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const kmlText = e.target?.result as string;
        const features = new KML().readFeatures(kmlText, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857'
        });
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
      reader.readAsText(file);
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
    clearAll: () => { sourceRef.current.clear(); kmlSourceRef.current.clear(); },
    getMapCanvas: async (targetScale) => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      const allFeatures = [...kmlSourceRef.current.getFeatures(), ...sourceRef.current.getFeatures()];
      if (allFeatures.length === 0) return null;

      const extent = allFeatures[0].getGeometry()?.getExtent();
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
        alert("المساحة كبيرة جداً بالنسبة لهذه الدقة، يرجى اختيار مقياس أكبر (مثلاً 1:2500).");
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
          });
          mapContext.clip();

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

          map.setSize(originalSize);
          view.setResolution(originalRes);
          view.setCenter(originalCenter);
          
          resolve({ canvas: mapCanvas, extent: extent });
        });
        map.renderSync();
      });
    }
  }));

  // مراقبة تغيير نوع الخريطة
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
