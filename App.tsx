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
type ToolType = 'Rectangle' | 'Polygon' | null;
type MapType = 'satellite' | 'hybrid';

const SCALES = [
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
  { code: 'EPSG:4326', label: 'WGS 84 (GPS Global)' },
  { code: 'EPSG:26191', label: 'Nord Maroc (Zone 1)' },
  { code: 'EPSG:26192', label: 'Sud Maroc (Zone 2)' },
  { code: 'EPSG:26194', label: 'Sahara Nord (Zone 3)' },
  { code: 'EPSG:26195', label: 'Sahara Sud (Zone 4)' },
];

const App: React.FC = () => {
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [step, setStep] = useState<WorkflowStep>('IDLE');
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedScale, setSelectedScale] = useState<number>(1000);
  const [mapType, setMapType] = useState<MapType>('satellite');
  
  // UI Panels State
  const [configPanelOpen, setConfigPanelOpen] = useState(false); // Left Settings
  const [filesPanelOpen, setFilesPanelOpen] = useState(false); // Geometric Files
  const [exportPanelOpen, setExportPanelOpen] = useState(false); // Right Export Panel
  const [manualInputOpen, setManualInputOpen] = useState(false); // Top HUD

  // Configuration State
  const [selectedZone, setSelectedZone] = useState<string>('EPSG:26191'); 
  const [selectedExcelFile, setSelectedExcelFile] = useState<File | null>(null);
  
  // Manual Input State
  const [manualZone, setManualZone] = useState<string>('EPSG:26191');
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
    mapComponentRef.current?.setDrawTool(newTool);
    if (newTool) {
        setStep('IDLE');
        setExportData(null);
        setZipBlob(null);
    }
  };

  const handleKMLUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && mapComponentRef.current) {
      setActiveTool(null);
      mapComponentRef.current.setDrawTool(null);
      mapComponentRef.current.loadKML(file);
      setFilesPanelOpen(false);
    }
  };

  const handleShapefileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && mapComponentRef.current) {
      setActiveTool(null);
      mapComponentRef.current.setDrawTool(null);
      mapComponentRef.current.loadShapefile(file);
      setFilesPanelOpen(false);
    }
  };

  const handleDXFUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && mapComponentRef.current) {
      setActiveTool(null);
      mapComponentRef.current.setDrawTool(null);
      mapComponentRef.current.loadDXF(file, selectedZone);
      setFilesPanelOpen(false);
    }
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

  const onExcelFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        setSelectedExcelFile(file);
    }
  };

  const processExcelFile = () => {
    if (!selectedExcelFile || !mapComponentRef.current) return;
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
                setConfigPanelOpen(false); // Close panel on success
                setSelectedExcelFile(null);
            } else {
                alert("Aucun point valide trouvé.");
            }
        } catch (err) {
            console.error(err);
            alert("Erreur Excel.");
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

    const wgs84 = projectFromZone(x, y, manualZone);
    if (!wgs84) {
        alert("Hors zone.");
        return;
    }

    const label = `pt ${pointCounter.toString().padStart(2, '0')}`;
    mapComponentRef.current?.addManualPoint(wgs84[0], wgs84[1], label);
    setPointCounter(prev => prev + 1);
    
    setManualX("");
    setManualY("");
    setManualInputOpen(false);
  };

  const startClipping = async () => {
    if (!mapComponentRef.current || !exportData) return;
    
    // Start Processing Sequence
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
            const baseName = `SIG_CLIP_1-${selectedScale}_${Date.now()}`;
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
    setManualX("");
    setManualY("");
    setPointCounter(1);
    setConfigPanelOpen(false);
    setFilesPanelOpen(false);
    setExportPanelOpen(false);
  };

  return (
    <div className="relative w-screen h-screen bg-slate-900 overflow-hidden font-sans text-slate-800">
      
      {/* 1. LEFT FLOATING DOCK (Navigation) */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-30">
        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 p-2 rounded-full shadow-2xl flex flex-col gap-2">
            
            {/* Logo */}
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white mb-2 shadow-lg">
                <i className="fas fa-satellite-dish text-xl"></i>
            </div>

            {/* Config Toggle */}
            <button 
                onClick={() => setConfigPanelOpen(!configPanelOpen)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 group relative ${configPanelOpen ? 'bg-white text-indigo-600' : 'text-white hover:bg-white/20'}`}
            >
                <i className="fas fa-database text-lg"></i>
                <span className="absolute left-14 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Base de données</span>
            </button>

             {/* Files Toggle */}
            <button 
                onClick={() => setFilesPanelOpen(!filesPanelOpen)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 group relative ${filesPanelOpen ? 'bg-white text-emerald-600' : 'text-white hover:bg-white/20'}`}
            >
                <i className="fas fa-folder-open text-lg"></i>
                <span className="absolute left-14 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Fichiers Géométriques</span>
            </button>

            {/* Reset */}
            <button 
                onClick={resetAll}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:bg-red-500/80 hover:text-white transition-all duration-300 mt-2"
            >
                <i className="fas fa-redo-alt text-lg"></i>
            </button>
        </div>
      </div>

      {/* 2. FLOATING CONFIG PANEL (Left) */}
      <div className={`absolute top-24 left-24 w-80 bg-white/90 backdrop-blur-xl border border-white/40 rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 origin-top-left transform ${configPanelOpen ? 'scale-100 opacity-100' : 'scale-90 opacity-0 pointer-events-none'}`}>
          <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-black uppercase text-slate-800 tracking-wider">Configuration</h2>
              <button onClick={() => setConfigPanelOpen(false)} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times"></i></button>
          </div>
          
          <div className="space-y-4">
              <div className="bg-white/50 p-4 rounded-2xl border border-white/50">
                   <label className="text-[10px] text-indigo-500 font-bold uppercase mb-2 block">Projection (Source)</label>
                   <select 
                      value={selectedZone}
                      onChange={(e) => setSelectedZone(e.target.value)}
                      className="w-full bg-transparent text-xs font-bold p-2 outline-none cursor-pointer"
                   >
                      {ZONES.map(z => <option key={z.code} value={z.code}>{z.label}</option>)}
                   </select>
              </div>

              <div className="relative group cursor-pointer" onClick={() => excelInputRef.current?.click()}>
                  <input type="file" accept=".xlsx, .xls" className="hidden" ref={excelInputRef} onChange={onExcelFileSelect} />
                  <div className={`h-32 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 transition-all ${selectedExcelFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                      {selectedExcelFile ? (
                          <>
                            <i className="fas fa-file-excel text-2xl text-emerald-500"></i>
                            <span className="text-xs font-bold text-emerald-700">{selectedExcelFile.name}</span>
                          </>
                      ) : (
                          <>
                            <i className="fas fa-cloud-upload-alt text-2xl text-slate-400 group-hover:text-indigo-500"></i>
                            <span className="text-xs font-bold text-slate-400 group-hover:text-indigo-500">Importer Excel</span>
                          </>
                      )}
                  </div>
              </div>

              {selectedExcelFile && (
                  <button onClick={processExcelFile} className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-3 rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-all">
                      Charger les points
                  </button>
              )}
          </div>
      </div>

      {/* 3. FLOATING FILES PANEL (Left) - REIMAGINED AS GRID */}
      <div className={`absolute top-48 left-24 w-[300px] bg-white/90 backdrop-blur-xl border border-white/40 rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 origin-center-left transform ${filesPanelOpen ? 'scale-100 opacity-100' : 'scale-90 opacity-0 pointer-events-none'}`}>
           <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black uppercase text-slate-800 tracking-wider">Fichiers</h2>
              <button onClick={() => setFilesPanelOpen(false)} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times"></i></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
              {/* KML */}
              <input type="file" accept=".kml,.kmz" className="hidden" ref={kmlInputRef} onChange={handleKMLUpload} />
              <button onClick={() => kmlInputRef.current?.click()} className="aspect-square bg-gradient-to-br from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 rounded-2xl border border-amber-100 flex flex-col items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md group">
                  <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm text-amber-500 group-hover:scale-110 transition-transform">
                      <i className="fas fa-map-marked-alt text-lg"></i>
                  </div>
                  <span className="text-[10px] font-black text-amber-800 uppercase">KML / KMZ</span>
              </button>

              {/* SHP */}
              <input type="file" accept=".zip" className="hidden" ref={shpInputRef} onChange={handleShapefileUpload} />
              <button onClick={() => shpInputRef.current?.click()} className="aspect-square bg-gradient-to-br from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 rounded-2xl border border-emerald-100 flex flex-col items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md group">
                  <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm text-emerald-500 group-hover:scale-110 transition-transform">
                      <i className="fas fa-layer-group text-lg"></i>
                  </div>
                  <span className="text-[10px] font-black text-emerald-800 uppercase">SHP (ZIP)</span>
              </button>

              {/* DXF */}
              <input type="file" accept=".dxf" className="hidden" ref={dxfInputRef} onChange={handleDXFUpload} />
              <button onClick={() => dxfInputRef.current?.click()} className="col-span-2 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 rounded-2xl border border-purple-100 flex items-center justify-center gap-3 transition-all shadow-sm hover:shadow-md group">
                  <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm text-purple-500 group-hover:scale-110 transition-transform">
                      <i className="fas fa-drafting-compass"></i>
                  </div>
                  <span className="text-[10px] font-black text-purple-800 uppercase">DXF AutoCAD</span>
              </button>
          </div>
      </div>

      {/* 4. TOP HUD (Saisie Manuelle) - ELEGANT PILL */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center">
         <div className={`bg-white/90 backdrop-blur-xl border border-white/50 shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${manualInputOpen ? 'w-[340px] rounded-3xl p-1' : 'w-auto rounded-full p-1'}`}>
             
             {/* Header / Toggle */}
             <div 
                onClick={() => setManualInputOpen(!manualInputOpen)} 
                className="flex items-center gap-3 cursor-pointer px-4 py-2 hover:bg-black/5 rounded-full transition-colors"
             >
                 <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs shadow-lg transition-colors ${manualInputOpen ? 'bg-slate-800' : 'bg-orange-500'}`}>
                     <i className="fas fa-map-pin"></i>
                 </div>
                 
                 <div className="flex flex-col">
                     <span className="text-[11px] font-black uppercase tracking-wider text-slate-800">Saisie Manuelle</span>
                     {!manualInputOpen && <span className="text-[9px] text-slate-500 font-bold">{ZONES.find(z => z.code === manualZone)?.label.split('(')[0]}</span>}
                 </div>
                 
                 <div className={`ml-2 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 transition-transform duration-300 ${manualInputOpen ? 'rotate-180' : ''}`}>
                     <i className="fas fa-chevron-down text-[10px]"></i>
                 </div>
             </div>

             {/* Expanded Content */}
             <div className={`transition-all duration-500 ${manualInputOpen ? 'max-h-[300px] opacity-100 mt-2 px-3 pb-3' : 'max-h-0 opacity-0'}`}>
                 <div className="space-y-3">
                     <div className="bg-slate-100 p-2 rounded-xl">
                         <select 
                            value={manualZone}
                            onChange={(e) => setManualZone(e.target.value)}
                            className="w-full bg-transparent text-[10px] font-bold text-slate-700 outline-none cursor-pointer"
                         >
                            {ZONES.map(z => <option key={z.code} value={z.code}>{z.label}</option>)}
                         </select>
                     </div>
                     
                     <div className="flex gap-2">
                         <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-1 relative group focus-within:border-orange-400 focus-within:bg-white transition-all">
                             <label className="text-[8px] font-bold text-slate-400 absolute top-1 left-3 uppercase">X (East)</label>
                             <input 
                                 type="text" 
                                 value={manualX}
                                 onChange={(e) => setManualX(e.target.value)}
                                 className="w-full bg-transparent pt-3 text-xs font-mono font-bold text-slate-800 outline-none"
                                 placeholder="000000.00"
                             />
                         </div>
                         <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-1 relative group focus-within:border-orange-400 focus-within:bg-white transition-all">
                             <label className="text-[8px] font-bold text-slate-400 absolute top-1 left-3 uppercase">Y (North)</label>
                             <input 
                                 type="text" 
                                 value={manualY}
                                 onChange={(e) => setManualY(e.target.value)}
                                 className="w-full bg-transparent pt-3 text-xs font-mono font-bold text-slate-800 outline-none"
                                 placeholder="000000.00"
                             />
                         </div>
                     </div>

                     <button 
                        onClick={handleManualAddPoint}
                        className="w-full bg-slate-800 hover:bg-black text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                     >
                        <i className="fas fa-plus"></i>
                        <span>Ajouter pt {pointCounter.toString().padStart(2, '0')}</span>
                     </button>
                 </div>
             </div>
         </div>
      </div>

      {/* 5. DRAWING TOOLS - Floating Capsule (Top Left) */}
      <div className="absolute top-6 left-24 bg-white/90 backdrop-blur-xl border border-white/40 rounded-full p-1 shadow-xl flex gap-1 z-30">
          <button 
            onClick={() => toggleTool('Rectangle')}
            className={`px-4 py-2 rounded-full flex items-center gap-2 transition-all ${
              activeTool === 'Rectangle' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
            }`}
          >
            <i className="far fa-square"></i>
            <span className="text-[10px] font-bold uppercase tracking-wider">Rect</span>
          </button>
          
          <div className="w-px bg-slate-200 my-1"></div>

          <button 
            onClick={() => toggleTool('Polygon')}
            className={`px-4 py-2 rounded-full flex items-center gap-2 transition-all ${
              activeTool === 'Polygon' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
            }`}
          >
            <i className="fas fa-draw-polygon"></i>
            <span className="text-[10px] font-bold uppercase tracking-wider">Poly</span>
          </button>
      </div>

      {/* 6. RIGHT EXPORT PANEL - Floating Card */}
      <div className={`absolute top-6 bottom-6 right-6 w-80 z-30 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${exportPanelOpen ? 'translate-x-0' : 'translate-x-[calc(100%+2rem)]'}`}>
         <div className="h-full bg-white/90 backdrop-blur-2xl border border-white/40 rounded-[32px] shadow-2xl flex flex-col overflow-hidden relative">
             
             {/* Toggle Handle (Visible when closed) */}
             {!exportPanelOpen && (
                 <button 
                    onClick={() => setExportPanelOpen(true)}
                    className="absolute top-1/2 -left-16 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-indigo-600 hover:scale-110 transition-transform pointer-events-auto"
                 >
                    <i className="fas fa-chevron-left"></i>
                 </button>
             )}

             {/* Close Button */}
             <button 
                onClick={() => setExportPanelOpen(false)}
                className="absolute top-4 right-4 w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors z-10"
             >
                <i className="fas fa-times"></i>
             </button>

             <div className="p-8 flex flex-col h-full">
                 <div className="mb-6">
                     <h2 className="text-xl font-black text-slate-800 leading-none">Exportation</h2>
                     <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">GeoTIFF Generator</p>
                 </div>

                 <div className="space-y-6 flex-grow">
                     <div>
                         <label className="text-[9px] font-black text-slate-400 uppercase mb-2 block">Échelle</label>
                         <div className="relative">
                            <select 
                                value={selectedScale}
                                onChange={(e) => handleScaleChange(Number(e.target.value))}
                                className="w-full bg-slate-50 border border-slate-200 text-slate-800 font-black text-lg p-4 rounded-2xl appearance-none outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                            >
                                {SCALES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                <i className="fas fa-chevron-down"></i>
                            </div>
                         </div>
                     </div>

                     {/* Status & Action Area */}
                     <div className="flex-grow flex flex-col justify-center">
                         {step === 'IDLE' && !exportData && (
                             <div className="text-center p-6 border-2 border-dashed border-slate-200 rounded-3xl">
                                 <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                                    <i className="fas fa-crosshairs text-xl"></i>
                                 </div>
                                 <p className="text-xs font-bold text-slate-400">Sélectionnez une zone sur la carte</p>
                             </div>
                         )}

                         {step === 'SELECTED' && exportData && (
                             <div className="animate-in slide-in-from-bottom duration-500">
                                 <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-3xl mb-4">
                                     <div className="flex justify-between items-center mb-2">
                                         <span className="text-[9px] font-black uppercase text-indigo-400">Coordonnées Centre</span>
                                         <i className="fas fa-check-circle text-indigo-500"></i>
                                     </div>
                                     <div className="text-xs font-mono font-bold text-indigo-900">
                                         {exportData.lat}<br/>{exportData.lng}
                                     </div>
                                 </div>
                                 <button 
                                    onClick={startClipping}
                                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-5 rounded-2xl text-sm font-black shadow-xl shadow-indigo-600/30 transition-transform active:scale-95 flex items-center justify-center gap-3"
                                 >
                                    <span>Générer GeoTIFF</span>
                                    <i className="fas fa-bolt"></i>
                                 </button>
                             </div>
                         )}

                         {step === 'PROCESSING' && (
                             <div className="flex flex-col items-center">
                                 {/* Custom Countdown Circle */}
                                 <div className="relative w-24 h-24 mb-6">
                                     <svg className="w-full h-full transform -rotate-90">
                                         <circle cx="48" cy="48" r="40" stroke="#f1f5f9" strokeWidth="6" fill="none" />
                                         <circle cx="48" cy="48" r="40" stroke="#4f46e5" strokeWidth="6" fill="none" strokeDasharray="251" strokeDashoffset={251 - (251 * (5 - countdown) / 5)} className="transition-all duration-1000 ease-linear" strokeLinecap="round" />
                                     </svg>
                                     <div className="absolute inset-0 flex items-center justify-center">
                                         <span className="text-2xl font-black text-indigo-600">{countdown}</span>
                                     </div>
                                 </div>
                                 <p className="text-xs font-bold text-slate-500 uppercase tracking-widest animate-pulse">Traitement en cours...</p>
                             </div>
                         )}

                         {step === 'DONE' && (
                             <div className="text-center animate-in zoom-in">
                                 <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
                                     <i className="fas fa-check text-3xl"></i>
                                 </div>
                                 <button 
                                    onClick={downloadFile}
                                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-5 rounded-2xl text-sm font-black shadow-xl shadow-emerald-500/30 transition-transform active:scale-95 flex items-center justify-center gap-3"
                                 >
                                    <i className="fas fa-download"></i>
                                    <span>Télécharger ZIP</span>
                                 </button>
                             </div>
                         )}
                     </div>
                 </div>

                 <div className="mt-auto pt-6 text-center border-t border-slate-100">
                      <button onClick={() => setExportPanelOpen(false)} className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 uppercase tracking-wider">Masquer</button>
                 </div>
             </div>
         </div>
      </div>

      {/* Manual Open Trigger for Right Panel (If export data is ready) */}
      {!exportPanelOpen && exportData && step === 'SELECTED' && (
           <button 
              onClick={() => setExportPanelOpen(true)}
              className="absolute top-1/2 right-6 -translate-y-1/2 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-2xl shadow-indigo-600/40 flex items-center justify-center animate-bounce z-30"
           >
              <i className="fas fa-file-export text-xl"></i>
           </button>
      )}

      {/* Map Type Toggle (Top Right) */}
      <div className="absolute top-6 right-6 z-30 flex gap-2">
          <button 
            onClick={() => setMapType('satellite')} 
            className={`w-10 h-10 rounded-full border border-white/20 shadow-lg flex items-center justify-center transition-all ${mapType === 'satellite' ? 'bg-white text-indigo-600' : 'bg-black/40 text-white hover:bg-black/60 backdrop-blur-md'}`}
          >
             <i className="fas fa-globe-americas"></i>
          </button>
          <button 
            onClick={() => setMapType('hybrid')} 
            className={`w-10 h-10 rounded-full border border-white/20 shadow-lg flex items-center justify-center transition-all ${mapType === 'hybrid' ? 'bg-white text-indigo-600' : 'bg-black/40 text-white hover:bg-black/60 backdrop-blur-md'}`}
          >
             <i className="fas fa-road"></i>
          </button>
      </div>

      {/* MAP COMPONENT */}
      <div className="absolute inset-0 z-0 bg-slate-900">
        <MapComponent 
          ref={mapComponentRef} 
          mapType={mapType}
          onSelectionComplete={(data) => {
            setExportData(data);
            setStep('SELECTED');
            setActiveTool(null);
            setExportPanelOpen(true); // Auto open panel
          }} 
        />
      </div>

    </div>
  );
};

export default App;