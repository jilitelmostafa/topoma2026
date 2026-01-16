import React, { useState, useRef, useEffect } from 'react';
import MapComponent, { MapComponentRef } from './components/MapComponent';
import { projectFromZone, fetchLocationName, searchPlaces, SearchResult } from './services/geoService';

declare const UTIF: any;
declare const JSZip: any;
declare const XLSX: any;

interface ExportData {
  lat: string;
  lng: string;
  scale: string;
  bounds: number[];
  area?: string;
  perimeter?: string;
  projection?: string;
}

interface ExportResult {
    name: string;
    date: string;
    size: string;
    coords: string;
}

interface LayerInfo {
    id: string;
    name: string;
    type: 'KML' | 'SHP' | 'DXF' | 'MANUAL';
}

type WorkflowStep = 'IDLE' | 'SELECTED' | 'PROCESSING' | 'DONE';
type ToolType = 'Rectangle' | 'Polygon' | 'Point' | 'Pan' | 'MeasureLength' | 'MeasureArea' | null;
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
  { code: 'EPSG:26191', label: 'Zone 1 (Nord Maroc)' },
  { code: 'EPSG:26192', label: 'Zone 2 (Sud Maroc)' },
  { code: 'EPSG:26194', label: 'Zone 3 (Sahara Nord)' },
  { code: 'EPSG:26195', label: 'Zone 4 (Sahara Sud)' },
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
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [step, setStep] = useState<WorkflowStep>('IDLE');
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedScale, setSelectedScale] = useState<number>(1000);
  const [mapType, setMapType] = useState<MapType>('satellite');
  
  // Measurement State
  const [measureUnit, setMeasureUnit] = useState<string>('m');
  const [showMobileMeasureMenu, setShowMobileMeasureMenu] = useState(false); // Mobile Only

  // UI Layout State
  const [tocOpen, setTocOpen] = useState(true); // Table of Contents (Right)
  const [toolboxOpen, setToolboxOpen] = useState(false); // Export Tools (Left)
  const [showGoToPanel, setShowGoToPanel] = useState(false); // Floating "Go To XY" Panel (Now Dropdown from Top)
  const [showExcelPanel, setShowExcelPanel] = useState(false); // Floating "Excel Import" Panel
  const [showExcelHelp, setShowExcelHelp] = useState(false); // Lightbox for Excel Help
  
  // Search State
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  // Contact State
  const [showContactInfo, setShowContactInfo] = useState(false);

  // Configuration State
  const [selectedZone, setSelectedZone] = useState<string>('EPSG:26191'); 
  const [selectedExcelFile, setSelectedExcelFile] = useState<File | null>(null);
  
  // Layer Management
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>('manual');

  const [locationName, setLocationName] = useState<string>("location");
  
  // Mouse Coordinates
  const [mouseCoords, setMouseCoords] = useState({ x: 'E0.0000', y: 'N0.0000' });
  
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

  // Auto-fetch location name when selection occurs
  useEffect(() => {
    if (exportData) {
        fetchLocationName(parseFloat(exportData.lat), parseFloat(exportData.lng))
            .then(name => setLocationName(name));
    }
  }, [exportData]);

  const handleScaleChange = (newScale: number) => {
    setSelectedScale(newScale);
    mapComponentRef.current?.setMapScale(newScale, true);

    // Auto-Generate if we have a selection
    if (exportData) {
        startClipping(newScale);
    }
  };

  const handleLayerSelect = (layerId: string) => {
      setSelectedLayerId(layerId);
      mapComponentRef.current?.selectLayer(layerId);
      // If manual is selected, verify if there is data, if not set IDLE
      if (layerId === 'manual' && (!exportData || !exportData.area)) {
          setStep('IDLE');
      }
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

    // If we select a drawing tool, switch to manual layer
    if (newTool === 'Rectangle' || newTool === 'Polygon') {
        setSelectedLayerId('manual');
        mapComponentRef.current?.selectLayer('manual');
    }

    if (newTool && newTool !== 'Pan' && newTool !== 'MeasureLength' && newTool !== 'MeasureArea' && newTool !== 'Point') {
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
          
          // Generate unique ID for the layer
          const layerId = `layer_${Date.now()}`;
          const newLayer: LayerInfo = { id: layerId, name: file.name, type };
          
          setLayers(prev => [...prev, newLayer]);
          setSelectedLayerId(layerId); // Select the new layer
          setToolboxOpen(true); // Open export toolbox

          if (type === 'KML') mapComponentRef.current.loadKML(file, layerId);
          if (type === 'SHP') mapComponentRef.current.loadShapefile(file, layerId);
          if (type === 'DXF') mapComponentRef.current.loadDXF(file, selectedZone, layerId);
      }

      if (type === 'XLS') setSelectedExcelFile(file);

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

  // Search Logic
  const handleSearchInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchQuery(val);
      if (val.length > 2) {
          const results = await searchPlaces(val);
          setSearchResults(results);
      } else {
          setSearchResults([]);
      }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
      if (mapComponentRef.current) {
          mapComponentRef.current.flyToLocation(parseFloat(result.lon), parseFloat(result.lat), 16);
      }
      setSearchResults([]);
      setSearchQuery("");
      setShowSearchPanel(false);
  };

  const startClipping = async (scaleOverride?: number) => {
    if (!mapComponentRef.current || !exportData) return;
    
    // Use override if provided (for auto-generation), otherwise use state
    const currentScale = scaleOverride || selectedScale;

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
            // PASS THE SELECTED LAYER ID HERE
            const result = await mapComponentRef.current!.getMapCanvas(currentScale, selectedLayerId);
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
            
            // Format Date: MM.YY
            const date = new Date();
            const dateStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear().toString().slice(-2)}`;
            const fullDateStr = date.toLocaleDateString('fr-FR');

            // Format Coordinates: n30_w010
            const lat = parseFloat(exportData.lat);
            const lng = parseFloat(exportData.lng);
            const latDir = lat >= 0 ? 'n' : 's';
            const lonDir = lng >= 0 ? 'e' : 'w';
            const coordStr = `${latDir}${Math.floor(Math.abs(lat))}_${lonDir}${Math.floor(Math.abs(lng)).toString().padStart(3, '0')}`;
            
            // Scale String (e.g., 500m or 1000)
            const scaleObj = EXPORT_SCALES.find(s => s.value === currentScale);
            const scaleStr = scaleObj ? scaleObj.label.replace(/\s+/g, '') : currentScale.toString();

            const baseName = `${locationName}_${scaleStr}_${coordStr}_${dateStr}_topoma`;

            const zip = new JSZip();
            zip.file(`${baseName}.tif`, tiffBuffer);
            zip.file(`${baseName}.tfw`, tfw);
            zip.file(`${baseName}.prj`, prj);

            const blob = await zip.generateAsync({ type: 'blob' });
            const sizeInMB = (blob.size / (1024 * 1024)).toFixed(2);
            const sizeStr = parseFloat(sizeInMB) < 1 ? `${(blob.size / 1024).toFixed(0)} KB` : `${sizeInMB} MB`;

            setZipBlob(blob);
            setFileName(`${baseName}.zip`);
            
            // Set Result Data for Table
            setExportResult({
                name: `${baseName}.tif`,
                date: fullDateStr,
                size: sizeStr,
                coords: `Lat:${lat.toFixed(4)}, Lon:${lng.toFixed(4)}`
            });

            setStep('DONE');
        } catch (e) {
            setStep('IDLE');
            clearInterval(timer);
            console.error(e);
            alert("Erreur lors du traitement. Vérifiez que la couche sélectionnée est visible.");
        }
    }, 1000);
  };

  const downloadFile = () => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    setStep('DONE'); 
  };

  const resetAll = () => {
    mapComponentRef.current?.clearAll();
    mapComponentRef.current?.setDrawTool(null);
    setExportData(null);
    setExportResult(null);
    setStep('IDLE');
    setActiveTool(null);
    setZipBlob(null);
    setSelectedExcelFile(null);
    setLayers([]);
    setSelectedLayerId('manual');
    setPointCounter(1);
    setLocationName("location");
    setSearchQuery("");
    setSearchResults([]);
    setShowContactInfo(false);
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
          
          {/* SITE BRANDING / LOGO */}
          <div className="flex items-center px-2 mr-1 border-r border-neutral-300 gap-1.5">
             <span className="text-xs font-black text-neutral-700 hidden sm:block">topoma</span>
          </div>

          {/* LEFT: GeoTIFF Toggle */}
          <button 
            onClick={() => setToolboxOpen(!toolboxOpen)}
            className={`h-8 px-3 flex items-center gap-2 rounded border mr-2 ${toolboxOpen ? 'bg-neutral-300 border-neutral-400' : 'hover:bg-neutral-200 border-transparent'}`}
            title="Export GeoTIFF"
          >
              <i className="fas fa-file-image text-green-700"></i> <span className="text-xs font-bold hidden md:inline">Exporter GeoTIFF</span>
          </button>

          {/* File Operations */}
          <div className="flex items-center px-2 border-r border-neutral-300 gap-1">
              <button onClick={resetAll} className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300" title="Effacer tout">
                  <i className="fas fa-eraser text-red-600"></i>
              </button>
               {/* Add Data Button */}
               <div className="relative group">
                   <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-200 border border-transparent hover:border-neutral-300 bg-yellow-50" title="Ajouter Données">
                      <i className="fas fa-plus text-black font-bold text-xs absolute top-1.5 left-2"></i>
                      <i className="fas fa-layer-group text-yellow-600"></i>
                   </button>
                   <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-400 shadow-lg rounded-none w-48 hidden group-hover:block z-50">
                       <button onClick={() => handleFileClick(kmlInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-globe text-blue-500"></i> Ajouter KML/KMZ</button>
                       <button onClick={() => handleFileClick(shpInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-shapes text-green-500"></i> Ajouter Shapefile (ZIP)</button>
                       <button onClick={() => handleFileClick(dxfInputRef)} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-100 flex items-center gap-2"><i className="fas fa-pencil-ruler text-purple-500"></i> Ajouter DXF</button>
                   </div>
               </div>
          </div>

          {/* Basic Navigation & Go To XY */}
          <div className="flex items-center px-2 border-r border-neutral-300 gap-1">
              <button 
                onClick={() => toggleTool('Pan')} 
                className={`w-8 h-8 flex items-center justify-center rounded border ${!activeTool || activeTool === 'Pan' ? 'bg-neutral-300 border-neutral-400 inner-shadow' : 'hover:bg-neutral-200 border-transparent'}`} 
                title="Pan"
              >
                  <i className="fas fa-hand-paper text-neutral-700"></i>
              </button>
              
              {/* Go To XY Tool */}
              <div className="relative">
                  <button 
                    onClick={() => { setShowGoToPanel(!showGoToPanel); setShowExcelPanel(false); setShowSearchPanel(false); }}
                    className={`h-8 px-2 flex items-center justify-center rounded border transition-colors ${showGoToPanel ? 'bg-neutral-200 border-neutral-400' : 'hover:bg-neutral-200 border-transparent hover:border-neutral-300'}`}
                    title="Go To XY"
                  >
                      <i className="fas fa-map-marker-alt text-red-600 mr-1"></i> <span className="text-xs font-bold text-neutral-700">Go To XY</span>
                  </button>
                  {showGoToPanel && (
                      <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-neutral-300 p-3 w-64 z-50">
                          <div className="flex justify-between items-center mb-2 border-b border-neutral-100 pb-1">
                              <span className="text-xs font-bold text-neutral-700">Go To XY</span>
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
                  )}
               </div>

              {/* Measurement Section - DESKTOP (Hidden on Mobile) */}
              <div className="hidden md:flex items-center gap-1 ml-2 pl-2 border-l border-neutral-300 bg-yellow-50/50 rounded px-1">
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
                  
                  <select 
                      value={measureUnit}
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="h-6 text-xs border border-yellow-300 rounded px-1 bg-white focus:outline-none ml-1 text-neutral-700"
                      title="Unités de mesure"
                  >
                      {(activeTool === 'MeasureArea' || (!activeTool && measureUnit.includes('sq')))
                        ? AREA_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)
                        : LENGTH_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)
                      }
                  </select>
              </div>

              {/* Measurement Section - MOBILE (Single Icon with Dropdown) */}
              <div className="md:hidden relative ml-1">
                  <button 
                    onClick={() => { setShowMobileMeasureMenu(!showMobileMeasureMenu); setShowGoToPanel(false); setShowSearchPanel(false); }}
                    className={`h-8 px-2 flex items-center justify-center rounded border transition-colors bg-yellow-50/50 ${(activeTool === 'MeasureLength' || activeTool === 'MeasureArea' || showMobileMeasureMenu) ? 'bg-yellow-200 border-yellow-400' : 'hover:bg-yellow-100 border-transparent'}`}
                    title="Mesures"
                  >
                       <i className="fas fa-ruler-combined text-yellow-700 text-lg"></i>
                  </button>
                  {showMobileMeasureMenu && (
                      <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-neutral-300 p-2 w-48 z-50">
                          <div className="flex justify-between items-center mb-2 border-b border-neutral-100 pb-1">
                              <span className="text-xs font-bold text-neutral-700">Outils de mesure</span>
                              <button onClick={() => setShowMobileMeasureMenu(false)} className="text-neutral-400 hover:text-neutral-600"><i className="fas fa-times"></i></button>
                          </div>
                          <div className="space-y-2">
                             <button onClick={() => toggleTool('MeasureLength')} className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 ${activeTool === 'MeasureLength' ? 'bg-yellow-100 text-yellow-800 font-bold' : 'hover:bg-neutral-50 text-neutral-700'}`}>
                                 <i className="fas fa-ruler w-5 text-center"></i> Distance
                             </button>
                             <button onClick={() => toggleTool('MeasureArea')} className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 ${activeTool === 'MeasureArea' ? 'bg-yellow-100 text-yellow-800 font-bold' : 'hover:bg-neutral-50 text-neutral-700'}`}>
                                 <i className="fas fa-ruler-combined w-5 text-center"></i> Surface
                             </button>
                             <div className="border-t border-neutral-200 pt-2 mt-1">
                                 <label className="block text-[10px] text-neutral-500 mb-1">Unités:</label>
                                 <select 
                                      value={measureUnit}
                                      onChange={(e) => handleUnitChange(e.target.value)}
                                      className="w-full h-7 text-xs border border-neutral-300 rounded px-1 bg-neutral-50"
                                  >
                                      {/* Show all units in mobile dropdown or context aware */}
                                      {LENGTH_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                      {AREA_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                  </select>
                             </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>

          {/* RIGHT: Table of Contents Toggle (Desktop) & Map Layer Switch (Mobile) */}
          <div className="flex items-center px-2 gap-1 ml-auto">
               
               {/* SEARCH WIDGET (Placed before Layer Switcher) */}
               <div className="relative">
                  <button 
                    onClick={() => { setShowSearchPanel(!showSearchPanel); setShowGoToPanel(false); setShowMobileMeasureMenu(false); }}
                    className={`h-8 w-8 flex items-center justify-center rounded border transition-colors ${showSearchPanel ? 'bg-blue-100 border-blue-300 text-blue-700' : 'hover:bg-neutral-200 border-transparent text-neutral-600'}`}
                    title="Rechercher"
                  >
                      <i className="fas fa-search"></i>
                  </button>

                  {showSearchPanel && (
                      <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-neutral-300 w-64 z-50 overflow-hidden">
                          <div className="p-2 border-b border-neutral-100 bg-neutral-50 flex items-center gap-2">
                              <i className="fas fa-search text-neutral-400 text-xs"></i>
                              <input 
                                autoFocus 
                                type="text" 
                                className="w-full bg-transparent text-xs outline-none text-neutral-700 placeholder-neutral-400" 
                                placeholder="Rechercher un lieu (OSM)..." 
                                value={searchQuery}
                                onChange={handleSearchInput}
                              />
                              {searchQuery && (
                                <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="text-neutral-400 hover:text-red-500">
                                    <i className="fas fa-times text-xs"></i>
                                </button>
                              )}
                          </div>
                          {searchResults.length > 0 ? (
                              <ul className="max-h-60 overflow-y-auto">
                                  {searchResults.map((result) => (
                                      <li key={result.place_id}>
                                          <button 
                                            onClick={() => handleSelectSearchResult(result)}
                                            className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-neutral-100 last:border-0 flex flex-col gap-0.5"
                                          >
                                              <span className="font-bold text-neutral-700 truncate w-full">{result.display_name.split(',')[0]}</span>
                                              <span className="text-[10px] text-neutral-500 truncate w-full">{result.display_name}</span>
                                          </button>
                                      </li>
                                  ))}
                              </ul>
                          ) : (
                              searchQuery.length > 2 && <div className="p-3 text-center text-xs text-neutral-400 italic">Aucun résultat trouvé.</div>
                          )}
                      </div>
                  )}
               </div>

               {/* Desktop TOC Button */}
               <button 
                onClick={() => setTocOpen(!tocOpen)}
                className={`hidden md:flex h-8 px-3 items-center gap-2 rounded border ml-1 ${tocOpen ? 'bg-neutral-300 border-neutral-400' : 'hover:bg-neutral-200 border-transparent'}`}
               >
                   <i className="fas fa-list"></i> <span className="text-xs font-bold">Couches</span>
               </button>

               {/* Mobile Layer Switcher (Simple Toggle) */}
               <button 
                  onClick={() => setMapType(prev => prev === 'satellite' ? 'hybrid' : 'satellite')}
                  className="md:hidden h-8 w-8 flex items-center justify-center rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 shadow-sm ml-1"
                  title="Switch Map Layer"
               >
                   <i className={`fas ${mapType === 'satellite' ? 'fa-globe-americas' : 'fa-map'}`}></i>
               </button>
          </div>
      </div>

      {/* --- 2. MAIN WORKSPACE --- */}
      <div className="flex-grow flex relative overflow-hidden">
          
          {/* LEFT PANEL: Export Tools (GeoTIFF) */}
          <div className={`${toolboxOpen ? 'w-80 translate-x-0' : 'w-0 -translate-x-full opacity-0'} transition-all duration-300 bg-white border-r border-neutral-300 flex flex-col shrink-0 overflow-hidden absolute left-0 top-0 h-full z-20 shadow-lg md:shadow-none`}>
               <div className="bg-neutral-100 p-2 border-b border-neutral-300 font-bold text-xs text-green-800 flex justify-between items-center">
                  <span><i className="fas fa-file-image mr-1"></i> Exporter GeoTIFF</span>
                  <button onClick={() => setToolboxOpen(false)} className="text-neutral-500 hover:text-green-600"><i className="fas fa-times"></i></button>
              </div>
              
              <div className="flex-grow overflow-y-auto p-3 bg-neutral-50">
                   <div className="border border-neutral-300 bg-white mb-2 shadow-sm rounded-sm">
                       <div className="bg-neutral-200 px-2 py-1.5 text-xs font-bold border-b border-neutral-300 flex items-center gap-2 text-neutral-700">
                           <i className="fas fa-crop-alt text-neutral-500"></i> Extraction Raster
                       </div>
                       <div className="p-3 text-xs space-y-4">
                           
                           {/* LAYER SELECTION DROPDOWN */}
                           <div>
                               <label className="block text-neutral-600 mb-1.5 font-medium">Source de données (Zone):</label>
                               <div className="relative">
                                   <select 
                                      value={selectedLayerId}
                                      onChange={(e) => handleLayerSelect(e.target.value)}
                                      className="w-full border border-neutral-300 p-1.5 rounded bg-white text-neutral-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none font-medium"
                                   >
                                      <option value="manual">✎ Dessin manuel</option>
                                      {layers.map(layer => (
                                          <option key={layer.id} value={layer.id}>
                                              {layer.type}: {layer.name}
                                          </option>
                                      ))}
                                   </select>
                                   <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-neutral-600">
                                       <i className="fas fa-chevron-down text-[10px]"></i>
                                   </div>
                               </div>
                           </div>

                           {/* --- INFO PANEL FOR SELECTED GEOMETRY --- */}
                           {(step === 'SELECTED' || (step === 'IDLE' && selectedLayerId !== 'manual')) && exportData && (
                               <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-900 space-y-1">
                                   <div className="font-bold flex items-center gap-1 border-b border-blue-200 pb-1 mb-1">
                                       <i className="fas fa-info-circle"></i> Info Élément
                                   </div>
                                   {exportData.area && (
                                       <div className="flex justify-between">
                                            <span className="text-blue-700">Area:</span>
                                            <span className="font-mono font-bold">{exportData.area}</span>
                                       </div>
                                   )}
                                   {exportData.perimeter && (
                                       <div className="flex justify-between">
                                            <span className="text-blue-700">Perim:</span>
                                            <span className="font-mono">{exportData.perimeter}</span>
                                       </div>
                                   )}
                                   <div className="flex justify-between">
                                       <span className="text-blue-700">Bounds:</span>
                                       <span className="font-mono truncate w-24 text-right" title={exportData.bounds.join(', ')}>Defined</span>
                                   </div>
                               </div>
                           )}

                           <div>
                               <label className="block text-neutral-600 mb-1.5 font-medium">Échelle / Résolution:</label>
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

                           <div className="border border-neutral-200 p-3 bg-neutral-50 min-h-[160px] flex flex-col items-center justify-center text-center rounded relative overflow-hidden">
                               {step === 'IDLE' && <span className="text-neutral-400 italic">Sélectionnez une zone...</span>}
                               
                               {(step === 'SELECTED' || (selectedLayerId !== 'manual' && exportData)) && (
                                   <>
                                     <div className="text-green-600 font-bold mb-3 flex items-center gap-1"><i className="fas fa-check-circle"></i> Prêt pour le traitement</div>
                                     <button onClick={() => startClipping()} className="bg-blue-600 border border-blue-700 text-white px-6 py-2 rounded hover:bg-blue-700 shadow-md transition-all font-bold flex items-center gap-2">
                                         <i className="fas fa-play text-[10px]"></i> GÉNÉRER
                                     </button>
                                   </>
                               )}

                               {step === 'PROCESSING' && (
                                   <div className="flex flex-col items-center justify-center w-full h-full">
                                      <div className="relative w-16 h-16 mb-2">
                                          {/* Visual Raster Formation Effect */}
                                          <div className="absolute inset-0 border-4 border-t-blue-500 border-r-transparent border-b-blue-500 border-l-transparent rounded-full animate-spin"></div>
                                          <div className="absolute inset-0 flex items-center justify-center">
                                              <i className="fas fa-layer-group text-blue-400 text-2xl animate-pulse"></i>
                                          </div>
                                      </div>
                                     <span className="text-blue-700 font-bold text-xs animate-pulse">Traitement en cours... {countdown}%</span>
                                     <div className="w-full bg-neutral-200 h-1.5 mt-2 rounded-full overflow-hidden">
                                         <div className="bg-blue-500 h-full transition-all duration-1000 ease-linear" style={{width: `${(5-countdown)*20}%`}}></div>
                                     </div>
                                   </div>
                               )}

                               {step === 'DONE' && exportResult && (
                                   <div className="flex flex-col items-center w-full">
                                       <div className="text-green-600 font-bold mb-2">Terminé !</div>
                                       
                                       {/* Result Table */}
                                       <div className="w-full bg-white border border-neutral-300 rounded mb-3 text-[10px] text-left overflow-hidden">
                                           <div className="grid grid-cols-[60px_1fr] border-b border-neutral-200">
                                               <div className="bg-neutral-100 p-1 font-bold text-neutral-600">Nom</div>
                                               <div className="p-1 truncate" title={exportResult.name}>{exportResult.name}</div>
                                           </div>
                                           <div className="grid grid-cols-[60px_1fr] border-b border-neutral-200">
                                               <div className="bg-neutral-100 p-1 font-bold text-neutral-600">Date</div>
                                               <div className="p-1">{exportResult.date}</div>
                                           </div>
                                            <div className="grid grid-cols-[60px_1fr] border-b border-neutral-200">
                                               <div className="bg-neutral-100 p-1 font-bold text-neutral-600">Taille</div>
                                               <div className="p-1 font-mono text-blue-600 font-bold">{exportResult.size}</div>
                                           </div>
                                           <div className="grid grid-cols-[60px_1fr]">
                                               <div className="bg-neutral-100 p-1 font-bold text-neutral-600">Coord</div>
                                               <div className="p-1">{exportResult.coords}</div>
                                           </div>
                                       </div>

                                       <button onClick={downloadFile} className="bg-green-600 border border-green-700 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center gap-2 font-bold shadow-md w-full justify-center">
                                           <i className="fas fa-download"></i> Télécharger ZIP
                                       </button>
                                   </div>
                               )}
                           </div>
                       </div>
                   </div>

                   <div className="mt-6 border-t border-neutral-200 pt-4 text-center pb-4">
                       <div className="text-[11px] text-neutral-600 font-bold mb-3 leading-relaxed">
                           réalisé par Jilit Mostafa <br/>
                           jilitsig@gmail.com | +212 668 09 02 85 📞
                       </div>
                       
                       <div className="flex justify-center gap-4 text-lg mb-3">
                           <a href="https://facebook.com/Jilitelmostafa" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:scale-110 transition-transform"><i className="fab fa-facebook"></i></a>
                           <a href="https://instagram.com/jilitsig" target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:scale-110 transition-transform"><i className="fab fa-instagram"></i></a>
                           <a href="https://www.linkedin.com/in/Jilitelmostafa" target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:scale-110 transition-transform"><i className="fab fa-linkedin"></i></a>
                           <a href="https://x.com/jilitmostafa" target="_blank" rel="noopener noreferrer" className="text-black hover:scale-110 transition-transform"><i className="fab fa-x-twitter"></i></a>
                           <a href="https://wa.me/212668090285" target="_blank" rel="noopener noreferrer" className="text-green-500 hover:scale-110 transition-transform"><i className="fab fa-whatsapp"></i></a>
                       </div>

                       <div className="text-[10px] text-neutral-400">
                           Version 1.0 | © 2026 Tous droits réservés
                       </div>
                       <div className="mt-2 flex justify-center">
                           <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEj9eIul_VMdvnyDZGj8fRCDeWCSfK0mIYjYGYXDrCg5GI09syk3U6OMO7jlUZV10DYdpoG2Fyf7O7xcckf99GynWdKAQMmlS_st1s1Cumn-Ov-3fYw8M87_H_234Q0HvkZaHjhEUVefckQ/s0-rw/Flag_of_Morocco.gif" alt="Maroc" className="h-4 w-auto" />
                       </div>
                   </div>
              </div>
          </div>

          {/* CENTER: MAP CANVAS */}
          <div className="flex-grow relative bg-white">
              {/* Floating Tools Container */}
              <div className="absolute top-2 right-2 z-30 flex flex-col items-end pointer-events-none gap-2">
                  
                  {/* Tool: Excel Import */}
                  <div className="relative flex flex-col items-end">
                      <button 
                        onClick={() => { setShowExcelPanel(!showExcelPanel); setShowGoToPanel(false); setShowSearchPanel(false); }}
                        className="pointer-events-auto w-10 h-10 bg-white rounded-lg shadow-md border border-neutral-300 hover:bg-neutral-50 flex items-center justify-center text-neutral-700 transition-colors"
                        title="Import Excel XY"
                      >
                          <i className="fas fa-file-excel text-lg text-green-600"></i>
                      </button>
                      {/* Excel Panel Content */}
                      <div className={`pointer-events-auto mt-2 bg-white rounded-lg shadow-xl border border-neutral-300 p-3 w-64 transition-all duration-200 origin-top-right absolute top-full right-0 ${showExcelPanel ? 'scale-100 opacity-100' : 'scale-90 opacity-0 hidden'}`}>
                          <div className="flex justify-between items-center mb-2 border-b border-neutral-100 pb-1">
                              <div className="flex items-center gap-1">
                                  <span className="text-xs font-bold text-neutral-700">Import Excel XY</span>
                                  <button onClick={() => setShowExcelHelp(true)} className="text-blue-500 hover:text-blue-700 ml-1" title="Voir un exemple">
                                      <i className="fas fa-info-circle"></i>
                                  </button>
                              </div>
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

                  {/* Tool: Create Point */}
                  <button 
                    onClick={() => toggleTool('Point')} 
                    className={`pointer-events-auto w-10 h-10 rounded-lg shadow-md border flex items-center justify-center transition-colors ${activeTool === 'Point' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`} 
                    title="Ajouter un Point"
                  >
                      <i className="fas fa-map-marker-alt text-lg"></i>
                  </button>

              </div>

              {/* Contact Button */}
              <div className="absolute bottom-12 right-2 z-30 flex flex-col items-end">
                   {showContactInfo && (
                       <div className="mb-2 bg-white rounded-lg shadow-xl border border-neutral-300 p-3 w-52 animate-fade-in text-xs z-40">
                           <div className="flex justify-between items-center border-b pb-1 mb-2">
                               <span className="font-bold text-neutral-700">Contact</span>
                               <button onClick={() => setShowContactInfo(false)} className="text-neutral-400 hover:text-red-500"><i className="fas fa-times"></i></button>
                           </div>
                           <div className="flex items-center gap-2 mb-2">
                               <i className="fas fa-envelope text-red-500 w-4 text-center"></i>
                               <a href="mailto:jilitsig@gmail.com" className="text-blue-600 hover:underline truncate">jilitsig@gmail.com</a>
                           </div>
                           <div className="flex items-center gap-2">
                               <i className="fab fa-whatsapp text-green-500 text-lg w-4 text-center"></i>
                               <a href="https://wa.me/212668090285" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-bold">+212 668 09 02 85</a>
                           </div>
                       </div>
                   )}
                   <button 
                    onClick={() => setShowContactInfo(!showContactInfo)}
                    className={`w-8 h-8 rounded shadow border flex items-center justify-center transition-colors ${showContactInfo ? 'bg-blue-100 text-blue-600 border-blue-300' : 'bg-white/90 text-neutral-600 border-neutral-300 hover:text-blue-600 hover:bg-white'}`}
                    title="Contact / Support"
                  >
                      <i className="fas fa-headset text-sm"></i>
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
                  setExportData({ ...data, projection: selectedZone }); 
                  setStep('SELECTED');
                  setActiveTool(null);
                  if (selectedLayerId === 'manual') setToolboxOpen(true);
                }} 
              />
          </div>

          {/* RIGHT PANEL: TABLE OF CONTENTS (Desktop Only) */}
          <div className={`${tocOpen ? 'w-64 md:w-72 translate-x-0' : 'w-0 translate-x-full opacity-0'} hidden md:flex transition-all duration-300 bg-white border-l border-neutral-300 flex-col shrink-0 overflow-hidden absolute right-0 md:static z-20 h-full shadow-lg md:shadow-none order-last`}>
              <div className="bg-neutral-100 p-2 border-b border-neutral-300 font-bold text-xs text-neutral-700 flex justify-between items-center">
                  <span>Couches</span>
                  <button onClick={() => setTocOpen(false)} className="md:hidden text-neutral-500"><i className="fas fa-times"></i></button>
              </div>
              <div className="flex-grow overflow-y-auto p-2">
                  <div className="text-xs select-none">
                      <div className="flex items-center gap-1 mb-1 font-bold text-neutral-800">
                           <i className="fas fa-layer-group text-yellow-600"></i> <span>Couches</span>
                      </div>
                      <div className="ml-4 border-l border-neutral-300 pl-2 space-y-2">
                          <div>
                              <div className="flex items-center gap-2">
                                  <input type="checkbox" checked={mapType === 'satellite'} onChange={() => setMapType('satellite')} className="cursor-pointer" />
                                  <span className="text-neutral-700">Imagerie Sat (Google)</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                  <input type="checkbox" checked={mapType === 'hybrid'} onChange={() => setMapType('hybrid')} className="cursor-pointer" />
                                  <span className="text-neutral-700">Etiquettes</span>
                              </div>
                          </div>
                          {layers.map((layer) => (
                              <div key={layer.id} className="flex items-center gap-2">
                                  <input type="checkbox" checked readOnly className="cursor-pointer accent-blue-600" />
                                  <span className={`truncate cursor-pointer ${selectedLayerId === layer.id ? 'font-bold text-blue-700' : ''}`} onClick={() => handleLayerSelect(layer.id)} title={layer.name}>
                                    {layer.type}: {layer.name}
                                  </span>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
              <div className="bg-neutral-50 p-1 border-t border-neutral-300 text-[10px] flex justify-between text-neutral-500">
                  <span>Ordre d'affichage</span>
                  <i className="fas fa-sort-amount-down"></i>
              </div>
          </div>

      </div>

      {/* --- 3. STATUS BAR --- */}
      <div className="bg-neutral-200 border-t border-neutral-300 h-6 flex items-center px-2 text-[10px] text-neutral-600 justify-between shrink-0 select-none">
          <div className="flex gap-6 items-center">
              {/* Coordinates (Degrees) */}
              <div className="flex gap-3 font-mono text-neutral-700">
                  <span className="w-20 text-right">{mouseCoords.y}</span>
                  <span className="w-20 text-left">{mouseCoords.x}</span>
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
          <div className="flex items-center gap-1">
              <span>Prj:</span>
              <select 
                  value={selectedZone}
                  onChange={(e) => setSelectedZone(e.target.value)}
                  className="bg-neutral-200 border-none focus:ring-0 p-0 text-[10px] h-4 cursor-pointer hover:bg-neutral-300 rounded font-bold text-neutral-700 max-w-[120px] truncate"
                  title="Changer la projection"
              >
                  {ZONES.map(z => <option key={z.code} value={z.code}>{z.label}</option>)}
              </select>
          </div>
      </div>
      
      {/* Lightbox for Excel Help */}
      {showExcelHelp && (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowExcelHelp(false)}>
              <div className="bg-white p-1 rounded-lg shadow-2xl relative max-w-4xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                   <div className="flex justify-between items-center p-2 border-b mb-1">
                       <h3 className="font-bold text-neutral-700">Modèle Excel (Exemple)</h3>
                       <button onClick={() => setShowExcelHelp(false)} className="text-red-500 hover:text-red-700 text-lg"><i className="fas fa-times"></i></button>
                   </div>
                   <div className="p-1 overflow-auto max-h-[80vh]">
                       <img 
                           src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjAiQ74Mm4A2CTb1tujt7NK7glGaiJSZdGGaAFFXN15QA7mkLtAfft5LRiu-j5DTfkff8TKmonvXUr-NVBzmj01cxu4djYo7VwiBQMBnZQurh9wEaQHu52xpkRHyQ5KB-R8IDL3Fy32mT4FSB6eIX6tGDRF8vCWEO2LgeVTUMO9U7Lt6OtsKXAGLVjAeg/s1600/xy.png" 
                           alt="Exemple Format Excel" 
                           className="max-w-full h-auto object-contain" 
                       />
                   </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;