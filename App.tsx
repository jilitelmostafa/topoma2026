import React, { useState, useRef, useEffect } from 'react';
import MapComponent, { MapComponentRef } from './components/MapComponent';
import { projectFromZone } from './services/geoService';

declare const UTIF: any;
declare const JSZip: any;
declare const XLSX: any;

interface ExportData {
  lat: string;
  lng: string;
  scale: string;
  bounds: number[];
}

type WorkflowStep = 'IDLE' | 'SELECTED' | 'PROCESSING' | 'DONE';
type ToolType = 'Rectangle' | 'Polygon' | 'Pan' | 'MeasureLength' | 'MeasureArea' | null;
type MapType = 'satellite' | 'hybrid';

// Custom Export Resolutions/Scales as requested
const EXPORT_SCALES = [
  { label: '10000 km', value: 1000000000 },
  { label: '5000 km', value: 500000000 },
  { label: '2000 km', value: 200000000 },
  { label: '1000 km', value: 100000000 },
  { label: '500 km', value: 50000000 },
  { label: '200 km', value: 20000000 },
  { label: '100 km', value: 10000000 },
  { label: '50 km', value: 5000000 },
  { label: '25 km', value: 2500000 },
  { label: '20 km', value: 2000000 },
  { label: '10 km', value: 1000000 },
  { label: '5 km', value: 500000 },
  { label: '2 km', value: 200000 },
  { label: '1 km', value: 100000 },
  { label: '500 m', value: 50000 },
  { label: '250 m', value: 25000 },
  { label: '200 m', value: 20000 },
  { label: '100 m', value: 10000 },
  { label: '50 m', value: 5000 },
  { label: '20 m', value: 2000 },
  { label: '10 m', value: 1000 },
  { label: '5 m', value: 500 }
];

const MAP_SCALES = [
    { label: '1:500', value: 500 },
    { label: '1:1000', value: 1000 },
    { label: '1:2000', value: 2000 },
    { label: '1:2500', value: 2500 },
    { label: '1:5000', value: 5000 },
    { label: '1:10000', value: 10000 },
    { label: '1:25000', value: 25000 },
    { label: '1:50000', value: 50000 },
    { label: '1:100000', value: 100000 },
    { label: '1:250000', value: 250000 }
];

const ZONES = [
  { code: 'EPSG:4326', label: 'WGS 84' },
  { code: 'EPSG:26191', label: 'Merchich Zone 1' },
  { code: 'EPSG:26192', label: 'Merchich Zone 2' },
  { code: 'EPSG:26194', label: 'Merchich Zone 3' },
  { code: 'EPSG:26195', label: 'Merchich Zone 4' },
];

const LENGTH_UNITS = [
    { value: 'm', label: 'Mètres (m)' },
    { value: 'km', label: 'Kilomètres (km)' },
    { value: 'ft', label: 'Feet (ft)' },
    { value: 'mi', label: 'Miles (mi)' },
];

const AREA_UNITS = [
    { value: 'sqm', label: 'Mètres carrés (m²)' },
    { value: 'ha', label: 'Hectares (ha)' },
    { value: 'sqkm', label: 'Kilomètres carrés (km²)' },
    { value: 'ac', label: 'Acres (ac)' },
];

const App: React.FC = () => {
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [step, setStep] = useState<WorkflowStep>('IDLE');
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedScale, setSelectedScale] = useState<number>(1000);
  const [mapType, setMapType] = useState<MapType>('satellite');
  
  // Measurement State
  const [measureUnit, setMeasureUnit] = useState<string>('m');

  // UI Layout State
  const [tocOpen, setTocOpen] = useState(true); // Table of Contents (Right)
  const [toolboxOpen, setToolboxOpen] = useState(false); // Export Tools (Left)
  const [showGoToPanel, setShowGoToPanel] = useState(false); // Floating "Go To XY" Panel
  const [showExcelPanel, setShowExcelPanel] = useState(false); // Floating "Excel Import" Panel
  
  // Configuration State
  const [selectedZone, setSelectedZone] = useState<string>('EPSG:26191'); 
  const [selectedExcelFile, setSelectedExcelFile] = useState<File | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);
  
  // Mouse Coordinates
  const [mouseCoords, setMouseCoords] = useState({ x: '0.00', y: '0.00' });
  
  // Manual Input State (Go To XY)
  const [manualX, setManualX] = useState<string>('');
  const [manualY, setManualY] = useState<string>('');
  const [pointCounter, setPointCounter] = useState<number>(1);
  
  // Processing State
  const [countdown, setCountdown] = useState<number>(0);
  
  const mapComponentRef = useRef<MapComponentRef>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);
  const shpInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const handleScaleChange = (newScale: number) => {
    setSelectedScale(newScale);
    mapComponentRef.current?.setMapScale(newScale);
  };

  const toggleTool = (tool: ToolType) => {
    const newTool = activeTool === tool ? null : tool;
    setActiveTool(newTool);
    
    // Set default units when switching tools if necessary
    if (newTool === 'MeasureLength' && !LENGTH_UNITS.find(u => u.value === measureUnit)) {
        setMeasureUnit('m');
    } else if (newTool === 'MeasureArea' && !AREA_UNITS.find(u => u.value === measureUnit)) {
        setMeasureUnit('sqm');
    }

    // Pass the tool and current unit to map component
    if (newTool === 'MeasureLength' || newTool === 'MeasureArea') {
        mapComponentRef.current?.setMeasureTool(newTool, measureUnit);
    } else {
        mapComponentRef.current?.setDrawTool(newTool === 'Pan' ? null : newTool);
    }

    if (newTool && newTool !== 'Pan' && newTool !== 'MeasureLength' && newTool !== 'MeasureArea') {
        setStep('IDLE');
        setExportData(null);
        setZipBlob(null);
    }
  };

  const handleUnitChange = (unit: string) => {
      setMeasureUnit(unit);
      // Trigger map to update existing measurement labels
      mapComponentRef.current?.updateMeasureUnit(unit);
      // If tool is currently active, ensure it keeps measuring with new unit
      if (activeTool === 'MeasureLength' || activeTool === 'MeasureArea') {
          mapComponentRef.current?.setMeasureTool(activeTool, unit);
      }
  };

  const handleFileClick = (ref: React.RefObject<HTMLInputElement>) => {
      ref.current?.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'KML' | 'SHP' | 'DXF' | 'XLS') => {
      const file = e.target.files?.[0];
      if (!file || !mapComponentRef.current) return;

      if (type !== 'XLS') {
          setActiveTool('Pan'); // Reset to pan
          mapComponentRef.current.setDrawTool(null);
      }

      if (type === 'KML') mapComponentRef.current.loadKML(file);
      if (type === 'SHP') mapComponentRef.current.loadShapefile(file);
      if (type === 'DXF') mapComponentRef.current.loadDXF(file, selectedZone);
      if (type === 'XLS') setSelectedExcelFile(file);

      if (type !== 'XLS') {
          setLoadedFiles(prev => [...prev, `${type}: ${file.name}`]);
      }

      e.target.value = '';
  };

  const parseCoordinateValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return NaN;
    let strVal = String(val).trim();
    strVal = strVal.replace(/\s/g, '').replace(/\u00A0/g, '');
    strVal = strVal.replace(',', '.');
    const parsed = parseFloat(strVal);
    return isNaN(parsed) ? NaN : parsed;
  };

  const processExcelFile = () => {
    if (!selectedExcelFile || !mapComponentRef.current) {
        alert("Veuillez sélectionner un fichier Excel.");
        return;
    }
    setActiveTool(null);
    mapComponentRef.current.setDrawTool(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = e.target?.result;
        if (!data) return;
        try {
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            const validPoints: Array<{x: number, y: number, label?: string}> = [];
            
            jsonData.forEach((row: any) => {
                const xKey = Object.keys(row).find(k => /^(x|lng|lon|longitude|easting)$/i.test(k));
                const yKey = Object.keys(row).find(k => /^(y|lat|latitude|northing)$/i.test(k));
                const labelKey = Object.keys(row).find(k => /^(id|name|nom|label|point)$/i.test(k));

                if (xKey && yKey) {
                    const rawX = parseCoordinateValue(row[xKey]);
                    const rawY = parseCoordinateValue(row[yKey]);

                    if (!isNaN(rawX) && !isNaN(rawY)) {
                        const wgs84 = projectFromZone(rawX, rawY, selectedZone);
                        if (wgs84) {
                            validPoints.push({
                                x: wgs84[0],
                                y: wgs84[1],
                                label: labelKey ? String(row[labelKey]) : undefined
                            });
                        }
                    }
                }
            });

            if (validPoints.length > 0) {
                mapComponentRef.current?.loadExcelPoints(validPoints);
                setLoadedFiles(prev => [...prev, `Points: ${selectedExcelFile.name}`]);
                setSelectedExcelFile(null); // Clear after load
                setShowExcelPanel(false); // Close panel
            } else {
                alert("Aucun point valide trouvé. Vérifiez les noms de colonnes (X, Y).");
            }
        } catch (err) {
            console.error(err);
            alert("Erreur lors de la lecture du fichier Excel.");
        }
    };
    reader.readAsArrayBuffer(selectedExcelFile);
  };

  const handleManualAddPoint = () => {
    if (!manualX || !manualY) return;
    const x = parseCoordinateValue(manualX);
    const y = parseCoordinateValue(manualY);
    
    if (isNaN(x) || isNaN(y)) {
        alert("Coordonnées invalides.");
        return;
    }

    const wgs84 = projectFromZone(x, y, selectedZone); 
    if (!wgs84) {
        alert("Hors zone ou erreur de projection.");
        return;
    }

    const label = `pt ${pointCounter.toString().padStart(2, '0')}`;
    mapComponentRef.current?.addManualPoint(wgs84[0], wgs84[1], label);
    setPointCounter(prev => prev + 1);
    setManualX("");
    setManualY("");
  };

  const startClipping = async () => {
    if (!mapComponentRef.current || !exportData) return;
    
    setStep('PROCESSING');
    setCountdown(5);

    const timer = setInterval(() => {
        setCountdown((prev) => {
            if (prev <= 1) {
                clearInterval(timer);
                return 0;
            }
            return prev - 1;
        });
    }, 1000);

    setTimeout(async () => {
        try {
            const result = await mapComponentRef.current!.getMapCanvas(selectedScale);
            clearInterval(timer); 

            if (!result) throw new Error("Empty Canvas");

            const { canvas, extent } = result;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const tiffBuffer = UTIF.encodeImage(imgData.data, canvas.width, canvas.height);
            
            const proj4lib = (await import('proj4')).default; 
            const minCorner = proj4lib('EPSG:3857', 'EPSG:4326', [extent[0], extent[1]]);
            const maxCorner = proj4lib('EPSG:3857', 'EPSG:4326', [extent[2], extent[3]]);
            
            const pixelWidthX = (maxCorner[0] - minCorner[0]) / canvas.width;
            const pixelHeightY = (maxCorner[1] - minCorner[1]) / canvas.height;

            const tfw = [
                pixelWidthX.toFixed(12), "0.000000000000", "0.000000000000", 
                (-pixelHeightY).toFixed(12), minCorner[0].toFixed(12), maxCorner[1].toFixed(12)
            ].join('\n');
            
            const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

            const zip = new JSZip();
            const baseName = `SIG_CLIP_${selectedScale}_${Date.now()}`;
            zip.file(`${baseName}.tif`, tiffBuffer);
            zip.file(`${baseName}.tfw`, tfw);
            zip.file(`${baseName}.prj`, prj);

            const blob = await zip.generateAsync({ type: 'blob' });
            setZipBlob(blob);
            setFileName(`${baseName}.zip`);
            setStep('DONE');
        } catch (e) {
            setStep('IDLE');
            clearInterval(timer);
            console.error(e);
            alert("Erreur lors du traitement.");
        }
    }, 1000);
  };

  const downloadFile = () => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    setStep('IDLE');
    setExportData(null);
  };

  const resetAll = () => {
    mapComponentRef.current?.clearAll();
    mapComponentRef.current?.setDrawTool(null);
    setExportData(null);
    setStep('IDLE');
    setActiveTool(null);
    setZipBlob(null);
    setSelectedExcelFile(null);
    setLoadedFiles([]);
    setPointCounter(1);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-200 overflow-hidden font-sans text-neutral-800">
      
      {/* --- HIDDEN INPUTS --- */}
      <input type="file" accept=".kml,.kmz" className="hidden" ref={kmlInputRef} onChange={(e) => handleFileUpload(e, 'KML')} />
      <input type="file" accept=".zip" className="hidden" ref={shpInputRef} onChange={(e) => handleFileUpload(e, 'SHP')} />
      <input type="file" accept=".dxf" className="hidden" ref={dxfInputRef} onChange={(e) => handleFileUpload(e, 'DXF')} />
      <input type="file" accept=".xlsx, .xls" className="hidden" ref={excelInputRef} onChange={(e) => handleFileUpload(e, 'XLS')} />

      {/* --- 1. MAIN TOOLBAR (Compact) --- */}
      <div className="bg-neutral-100 border-b border-neutral-300 p-1 flex items-center gap-1 shadow-sm shrink-0 h-10">
          
          {/* LEFT: GeoTIFF Toggle (Was ArcToolbox) */}
          <button 
            onClick={() => setToolboxOpen(!toolboxOpen)}
            className={`h-8 px-3 flex items-center gap-2 rounded border mr-2 ${toolboxOpen ? 'bg-neutral-300 border-neutral-400' : 'hover:bg-neutral-200 border-transparent'}`}
            title="Export GeoTIFF"
          >
              <i className="fas fa-file-image text-green-700"></i> <span className="text-xs font-bold hidden md:inline">GeoTIFF</span>
          </button>

          {/* File Operations */}
          <div className="flex items-center px-2 border-r border-neutral-300 gap-1">
              <button onClick={resetAll} className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300" title="Nouveau Projet">
                  <i className="fas fa-file text-neutral-600"></i>
              </button>
               {/* Add Data Button */}
               <div className="relative group">
                   <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300 bg-yellow-50" title="Add Data">
                      <i className="fas fa-plus text-black font-bold text-xs absolute top-1.5 left-2"></i>
                      <i className="fas fa-layer-group text-yellow-600"></i>
                   </button>
                   <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-400 shadow-lg rounded-none w-48 hidden group-hover:block z-50">
                       <button onClick={() => handleFileClick(kmlInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-globe text-blue-500"></i> Add KML/KMZ</button>
                       <button onClick={() => handleFileClick(shpInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-shapes text-green-500"></i> Add Shapefile (ZIP)</button>
                       <button onClick={() => handleFileClick(dxfInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-pencil-ruler text-purple-500"></i> Add DXF</button>
                   </div>
               </div>
          </div>

          {/* Basic Navigation & Measurement */}
          <div className="flex items-center px-2 border-r border-neutral-300 gap-1">
              <button 
                onClick={() => toggleTool('Pan')} 
                className={`w-8 h-8 flex items-center justify-center rounded border ${!activeTool || activeTool === 'Pan' ? 'bg-neutral-300 border-neutral-400 inner-shadow' : 'hover:bg-neutral-200 border-transparent'}`} 
                title="Pan"
              >
                  <i className="fas fa-hand-paper text-neutral-700"></i>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300" title="Zoom In" onClick={() => mapComponentRef.current?.setMapScale(selectedScale / 2)}>
                  <i className="fas fa-search-plus text-neutral-700"></i>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300" title="Zoom Out" onClick={() => mapComponentRef.current?.setMapScale(selectedScale * 2)}>
                  <i className="fas fa-search-minus text-neutral-700"></i>
              </button>

              {/* Measurement Section (Dark Yellow Rulers) */}
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-neutral-300 bg-yellow-50/50 rounded px-1">
                  <button 
                    onClick={() => toggleTool('MeasureLength')} 
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${activeTool === 'MeasureLength' ? 'bg-yellow-200 border-yellow-400' : 'hover:bg-yellow-100 border-transparent'}`} 
                    title="Mesurer une Distance"
                  >
                      <i className="fas fa-ruler text-yellow-700"></i>
                  </button>
                  <button 
                    onClick={() => toggleTool('MeasureArea')} 
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${activeTool === 'MeasureArea' ? 'bg-yellow-200 border-yellow-400' : 'hover:bg-yellow-100 border-transparent'}`} 
                    title="Mesurer une Surface"
                  >
                      <i className="fas fa-ruler-combined text-yellow-700"></i>
                  </button>
                  
                  {/* Integrated Unit Selector */}
                  <select 
                      value={measureUnit}
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="h-6 text-xs border border-yellow-300 rounded px-1 bg-white focus:outline-none ml-1 text-neutral-700"
                      title="Unités de mesure"
                  >
                      {(activeTool === 'MeasureArea' || (!activeTool && measureUnit.includes('sq'))) // Simple check to show area units if last used or default
                        ? AREA_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)
                        : LENGTH_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)
                      }
                      {/* Note: Logic to swap unit list based on tool is handled in toggleTool state, here we render based on current state */}
                  </select>
              </div>
          </div>

          {/* RIGHT: Table of Contents Toggle */}
          <div className="flex items-center px-2 gap-1 ml-auto">
               <button 
                onClick={() => setTocOpen(!tocOpen)}
                className={`h-8 px-3 flex items-center gap-2 rounded border ${tocOpen ? 'bg-neutral-300 border-neutral-400' : 'hover:bg-neutral-200 border-transparent'}`}
               >
                   <i className="fas fa-list"></i> <span className="text-xs font-bold hidden md:inline">Table of Contents</span>
               </button>
          </div>
      </div>

      {/* --- 2. MAIN WORKSPACE --- */}
      <div className="flex-grow flex relative overflow-hidden">
          
          {/* LEFT PANEL: Export Tools (GeoTIFF) */}
          <div className={`${toolboxOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full opacity-0'} transition-all duration-300 bg-white border-r border-neutral-300 flex flex-col shrink-0 overflow-hidden absolute left-0 top-0 h-full z-20 shadow-lg md:shadow-none`}>
               <div className="bg-neutral-100 p-2 border-b border-neutral-300 font-bold text-xs text-green-800 flex justify-between items-center">
                  <span><i className="fas fa-file-image mr-1"></i> Export GeoTIFF</span>
                  <button onClick={() => setToolboxOpen(false)} className="text-neutral-500 hover:text-green-600"><i className="fas fa-times"></i></button>
              </div>
              
              <div className="flex-grow overflow-y-auto p-3 bg-neutral-50">
                   <div className="border border-neutral-300 bg-white mb-2 shadow-sm rounded-sm">
                       <div className="bg-neutral-200 px-2 py-1.5 text-xs font-bold border-b border-neutral-300 flex items-center gap-2 text-neutral-700">
                           <i className="fas fa-crop-alt text-neutral-500"></i> Clip Raster
                       </div>
                       <div className="p-3 text-xs space-y-4">
                           <div>
                               <label className="block text-neutral-600 mb-1.5 font-medium">Output Scale / Resolution:</label>
                               <div className="relative">
                                   <select 
                                      value={selectedScale}
                                      onChange={(e) => handleScaleChange(Number(e.target.value))}
                                      className="w-full border border-neutral-300 p-1.5 rounded bg-white text-neutral-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none"
                                   >
                                      {EXPORT_SCALES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                   </select>
                                   <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-neutral-600">
                                       <i className="fas fa-chevron-down text-[10px]"></i>
                                   </div>
                               </div>
                           </div>

                           <div className="border border-neutral-200 p-3 bg-neutral-50 h-32 flex flex-col items-center justify-center text-center rounded">
                               {step === 'IDLE' && <span className="text-neutral-400 italic">Select area on map...</span>}
                               
                               {step === 'SELECTED' && exportData && (
                                   <>
                                     <div className="text-green-600 font-bold mb-2 flex items-center gap-1"><i className="fas fa-check-circle"></i> Geometry Defined</div>
                                     <button onClick={startClipping} className="bg-neutral-100 border border-neutral-300 px-4 py-1.5 rounded hover:bg-white hover:border-blue-400 hover:text-blue-600 shadow-sm transition-all font-medium">
                                         OK (Run)
                                     </button>
                                   </>
                               )}

                               {step === 'PROCESSING' && (
                                   <div className="flex flex-col items-center text-blue-600">
                                     <i className="fas fa-cog fa-spin text-2xl mb-2"></i>
                                     <span>Processing... {countdown}</span>
                                   </div>
                               )}

                               {step === 'DONE' && (
                                   <button onClick={downloadFile} className="bg-green-50 border border-green-500 text-green-700 px-3 py-1.5 rounded hover:bg-green-100 flex items-center gap-2 font-medium">
                                       <i className="fas fa-download"></i> Save Result
                                   </button>
                               )}
                           </div>
                       </div>
                   </div>

                   <div className="text-[10px] text-neutral-400 text-center mt-6 leading-tight">
                       GeoMapper Pro v1.4 <br/> Compatible with ArcGIS / QGIS
                   </div>
              </div>
          </div>

          {/* CENTER: MAP CANVAS */}
          <div className="flex-grow relative bg-white">
              {/* Floating Tools Container */}
              <div className="absolute top-2 right-2 z-30 flex flex-col items-end pointer-events-none gap-2">
                  
                  {/* Tool: Go To XY */}
                  <div className="relative flex flex-col items-end">
                      <button 
                        onClick={() => { setShowGoToPanel(!showGoToPanel); setShowExcelPanel(false); }}
                        className="pointer-events-auto w-10 h-10 bg-white rounded-lg shadow-md border border-neutral-300 hover:bg-neutral-50 flex items-center justify-center text-neutral-700 transition-colors"
                        title="Go To XY"
                      >
                          <i className="fas fa-map-marker-alt text-lg text-red-600"></i>
                      </button>
                      {/* Go To Panel Content */}
                      <div className={`pointer-events-auto mt-2 bg-white rounded-lg shadow-xl border border-neutral-300 p-3 w-64 transition-all duration-200 origin-top-right absolute top-full right-0 ${showGoToPanel ? 'scale-100 opacity-100' : 'scale-90 opacity-0 hidden'}`}>
                          <div className="flex justify-between items-center mb-2 border-b border-neutral-100 pb-1">
                              <span className="text-xs font-bold text-neutral-700">Aller à XY</span>
                              <button onClick={() => setShowGoToPanel(false)} className="text-neutral-400 hover:text-neutral-600"><i className="fas fa-times"></i></button>
                          </div>
                          <div className="space-y-2">
                              <div>
                                  <label className="block text-[10px] text-neutral-500 mb-0.5">Projection</label>
                                  <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)} className="w-full text-xs border border-neutral-300 rounded p-1 bg-neutral-50 focus:outline-none focus:border-blue-400">
                                     {ZONES.map(z => <option key={z.code} value={z.code}>{z.label}</option>)}
                                  </select>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                  <div>
                                      <label className="block text-[10px] text-neutral-500 mb-0.5">X (Easting)</label>
                                      <input type="text" value={manualX} onChange={(e) => setManualX(e.target.value)} className="w-full text-xs border border-neutral-300 rounded p-1 focus:outline-none focus:border-blue-400" placeholder="000000" />
                                  </div>
                                  <div>
                                      <label className="block text-[10px] text-neutral-500 mb-0.5">Y (Northing)</label>
                                      <input type="text" value={manualY} onChange={(e) => setManualY(e.target.value)} className="w-full text-xs border border-neutral-300 rounded p-1 focus:outline-none focus:border-blue-400" placeholder="000000" />
                                  </div>
                              </div>
                              <button onClick={handleManualAddPoint} className="w-full bg-blue-600 text-white text-xs py-1.5 rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 font-medium"><i className="fas fa-location-arrow text-[10px]"></i> Localiser</button>
                          </div>
                      </div>
                  </div>

                  {/* Tool: Excel Import */}
                  <div className="relative flex flex-col items-end">
                      <button 
                        onClick={() => { setShowExcelPanel(!showExcelPanel); setShowGoToPanel(false); }}
                        className="pointer-events-auto w-10 h-10 bg-white rounded-lg shadow-md border border-neutral-300 hover:bg-neutral-50 flex items-center justify-center text-neutral-700 transition-colors"
                        title="Import Excel XY"
                      >
                          <i className="fas fa-file-excel text-lg text-green-600"></i>
                      </button>
                      {/* Excel Panel Content */}
                      <div className={`pointer-events-auto mt-2 bg-white rounded-lg shadow-xl border border-neutral-300 p-3 w-64 transition-all duration-200 origin-top-right absolute top-full right-0 ${showExcelPanel ? 'scale-100 opacity-100' : 'scale-90 opacity-0 hidden'}`}>
                          <div className="flex justify-between items-center mb-2 border-b border-neutral-100 pb-1">
                              <span className="text-xs font-bold text-neutral-700">Import Excel XY</span>
                              <button onClick={() => setShowExcelPanel(false)} className="text-neutral-400 hover:text-neutral-600"><i className="fas fa-times"></i></button>
                          </div>
                          <div className="space-y-3">
                              <div>
                                  <label className="block text-[10px] text-neutral-500 mb-0.5">Projection (Zone)</label>
                                  <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)} className="w-full text-xs border border-neutral-300 rounded p-1 bg-neutral-50 focus:outline-none focus:border-blue-400">
                                     {ZONES.map(z => <option key={z.code} value={z.code}>{z.label}</option>)}
                                  </select>
                              </div>
                              <div className="border border-dashed border-neutral-300 rounded bg-neutral-50 p-2 text-center">
                                  <button onClick={() => handleFileClick(excelInputRef)} className="text-xs text-blue-600 hover:underline font-medium mb-1"><i className="fas fa-folder-open mr-1"></i> Choisir un fichier</button>
                                  <div className="text-[10px] text-neutral-500 truncate px-1">{selectedExcelFile ? selectedExcelFile.name : "Aucun fichier sélectionné"}</div>
                              </div>
                              <button onClick={processExcelFile} disabled={!selectedExcelFile} className={`w-full text-white text-xs py-1.5 rounded transition-colors flex items-center justify-center gap-1 font-medium ${selectedExcelFile ? 'bg-green-600 hover:bg-green-700' : 'bg-neutral-300 cursor-not-allowed'}`}><i className="fas fa-upload text-[10px]"></i> Charger les points</button>
                          </div>
                      </div>
                  </div>

                  {/* Tool: Select Rectangle */}
                  <button 
                    onClick={() => toggleTool('Rectangle')} 
                    className={`pointer-events-auto w-10 h-10 rounded-lg shadow-md border flex items-center justify-center transition-colors ${activeTool === 'Rectangle' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`} 
                    title="Select Rectangle"
                  >
                      <i className="far fa-square text-lg"></i>
                  </button>

                  {/* Tool: Select Polygon */}
                  <button 
                    onClick={() => toggleTool('Polygon')} 
                    className={`pointer-events-auto w-10 h-10 rounded-lg shadow-md border flex items-center justify-center transition-colors ${activeTool === 'Polygon' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`} 
                    title="Select Polygon"
                  >
                      <i className="fas fa-draw-polygon text-lg"></i>
                  </button>

              </div>

              {/* My Position Button - Simplified & Moved */}
              <button 
                onClick={() => mapComponentRef.current?.locateUser()}
                className="absolute bottom-2 right-2 z-30 w-8 h-8 bg-white/90 rounded shadow border border-neutral-300 flex items-center justify-center text-neutral-600 hover:text-blue-600 hover:bg-white transition-colors"
                title="Ma position"
              >
                  <i className="fas fa-crosshairs text-sm"></i>
              </button>

              <MapComponent 
                ref={mapComponentRef} 
                mapType={mapType}
                selectedZone={selectedZone}
                onMouseMove={(x, y) => setMouseCoords({x, y})}
                onSelectionComplete={(data) => {
                  setExportData(data);
                  setStep('SELECTED');
                  setActiveTool(null);
                  setToolboxOpen(true);
                }} 
              />
          </div>

          {/* RIGHT PANEL: TABLE OF CONTENTS */}
          <div className={`${tocOpen ? 'w-64 md:w-72 translate-x-0' : 'w-0 translate-x-full opacity-0'} transition-all duration-300 bg-white border-l border-neutral-300 flex flex-col shrink-0 overflow-hidden absolute right-0 md:static z-20 h-full shadow-lg md:shadow-none order-last`}>
              <div className="bg-neutral-100 p-2 border-b border-neutral-300 font-bold text-xs text-neutral-700 flex justify-between items-center">
                  <span>Layers</span>
                  <button onClick={() => setTocOpen(false)} className="md:hidden text-neutral-500"><i className="fas fa-times"></i></button>
              </div>
              <div className="flex-grow overflow-y-auto p-2">
                  <div className="text-xs select-none">
                      <div className="flex items-center gap-1 mb-1 font-bold text-neutral-800">
                           <i className="fas fa-layer-group text-yellow-600"></i> <span>Layers</span>
                      </div>
                      <div className="ml-4 border-l border-neutral-300 pl-2 space-y-2">
                          <div>
                              <div className="flex items-center gap-2">
                                  <input type="checkbox" checked={mapType === 'satellite'} onChange={() => setMapType('satellite')} className="cursor-pointer" />
                                  <span className="text-neutral-700">Imagery (Satellite)</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                  <input type="checkbox" checked={mapType === 'hybrid'} onChange={() => setMapType('hybrid')} className="cursor-pointer" />
                                  <span className="text-neutral-700">Hybrid Labels</span>
                              </div>
                          </div>
                          {loadedFiles.map((file, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                  <input type="checkbox" checked readOnly className="cursor-pointer accent-blue-600" />
                                  <span className="truncate" title={file}>{file}</span>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
              <div className="bg-neutral-50 p-1 border-t border-neutral-300 text-[10px] flex justify-between text-neutral-500">
                  <span>List By Drawing Order</span>
                  <i className="fas fa-sort-amount-down"></i>
              </div>
          </div>

      </div>

      {/* --- 3. STATUS BAR --- */}
      <div className="bg-neutral-200 border-t border-neutral-300 h-6 flex items-center px-2 text-[10px] text-neutral-600 justify-between shrink-0 select-none">
          <div className="flex gap-6 items-center">
              {/* Coordinates */}
              <div className="flex gap-3 font-mono text-neutral-700">
                  <span className="w-20 text-right">{mouseCoords.x} x</span>
                  <span className="w-20 text-left">y {mouseCoords.y}</span>
              </div>
              
              <div className="flex items-center gap-1 border-l border-neutral-300 pl-4">
                  <span>Scale:</span>
                  <select 
                     value={selectedScale}
                     onChange={(e) => handleScaleChange(Number(e.target.value))}
                     className="bg-neutral-200 border-none focus:ring-0 p-0 text-[10px] h-4 cursor-pointer hover:bg-neutral-300 rounded font-medium"
                  >
                     {MAP_SCALES.map(s => <option key={s.value} value={s.value}>1:{s.value}</option>)}
                  </select>
              </div>
          </div>
          <div>
              <span>Prj: <span className="font-bold text-neutral-700">{ZONES.find(z => z.code === selectedZone)?.label}</span></span>
          </div>
      </div>
    </div>
  );
};

export default App;