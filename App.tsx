import React, { useState, useRef } from 'react';
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
  const [selectedZone, setSelectedZone] = useState<string>('EPSG:26191'); // Default to Zone 1
  const [selectedExcelFile, setSelectedExcelFile] = useState<File | null>(null);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false);
  
  // Manual Input State
  const [manualZone, setManualZone] = useState<string>('EPSG:26191');
  const [manualX, setManualX] = useState<string>('');
  const [manualY, setManualY] = useState<string>('');
  
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
    }
  };

  const handleShapefileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && mapComponentRef.current) {
      setActiveTool(null);
      mapComponentRef.current.setDrawTool(null);
      mapComponentRef.current.loadShapefile(file);
    }
  };

  const handleDXFUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && mapComponentRef.current) {
      setActiveTool(null);
      mapComponentRef.current.setDrawTool(null);
      // استخدام النطاق المختار من القائمة السفلية
      mapComponentRef.current.loadDXF(file, selectedZone);
    }
  };

  // دالة مساعدة لتحويل القيم إلى أرقام عشرية سواء كانت بفاصلة أو نقطة
  const parseCoordinateValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return NaN;
    
    // تحويل القيمة إلى نص
    let strVal = String(val).trim();

    // حذف المسافات (العادية وغير المنكسرة) التي قد تستخدم كفواصل للآلاف
    strVal = strVal.replace(/\s/g, '').replace(/\u00A0/g, '');

    // استبدال الفاصلة بالنقطة لدعم الأرقام العشرية (مثلاً: 572478,0646 -> 572478.0646)
    strVal = strVal.replace(',', '.');
    
    const parsed = parseFloat(strVal);
    return isNaN(parsed) ? NaN : parsed;
  };

  // 1. اختيار الملف فقط وتخزينه في الحالة
  const onExcelFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        setSelectedExcelFile(file);
    }
  };

  // 2. معالجة الملف عند الضغط على زر "رفع"
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
            // قراءة البيانات خام لمعالجة النصوص يدوياً
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            const validPoints: Array<{x: number, y: number, label?: string}> = [];
            let successCount = 0;
            let failCount = 0;
            
            jsonData.forEach((row: any) => {
                // البحث عن الأعمدة المحتملة بغض النظر عن حالة الأحرف
                const xKey = Object.keys(row).find(k => /^(x|lng|lon|longitude|easting)$/i.test(k));
                const yKey = Object.keys(row).find(k => /^(y|lat|latitude|northing)$/i.test(k));
                const labelKey = Object.keys(row).find(k => /^(id|name|nom|label|point)$/i.test(k));

                if (xKey && yKey) {
                    // استخدام دالة التحليل التي تدعم الفاصلة والنقطة والمسافات
                    const rawX = parseCoordinateValue(row[xKey]);
                    const rawY = parseCoordinateValue(row[yKey]);

                    if (!isNaN(rawX) && !isNaN(rawY)) {
                        // التحويل المباشر باستخدام النطاق المختار
                        const wgs84 = projectFromZone(rawX, rawY, selectedZone);
                        
                        if (wgs84) {
                            validPoints.push({
                                x: wgs84[0],
                                y: wgs84[1],
                                label: labelKey ? String(row[labelKey]) : undefined
                            });
                            successCount++;
                        } else {
                            failCount++;
                        }
                    }
                }
            });

            if (validPoints.length > 0) {
                mapComponentRef.current?.loadExcelPoints(validPoints);
                if (failCount > 0) {
                    alert(`${validPoints.length} points chargés avec succès.\n${failCount} points ignorés (hors zone ou invalides).`);
                }
                setSelectedExcelFile(null); // Reset after load
            } else {
                alert("Aucun point valide trouvé. Vérifiez les colonnes (X, Y) et le système de coordonnées choisi.");
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
        alert("Veuillez entrer des coordonnées valides.");
        return;
    }

    const wgs84 = projectFromZone(x, y, manualZone);
    if (!wgs84) {
        alert("Coordonnées invalides ou hors zone.");
        return;
    }

    mapComponentRef.current?.addManualPoint(wgs84[0], wgs84[1], "Manuel");
    
    // Clear inputs for next point
    setManualX("");
    setManualY("");
  };

  const startClipping = async () => {
    if (!mapComponentRef.current || !exportData) return;
    setStep('PROCESSING');

     try {
      const result = await mapComponentRef.current.getMapCanvas(selectedScale);
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
        pixelWidthX.toFixed(12), 
        "0.000000000000", 
        "0.000000000000", 
        (-pixelHeightY).toFixed(12),
        minCorner[0].toFixed(12), 
        maxCorner[1].toFixed(12)
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
      console.error(e);
      alert("Une erreur s'est produite lors du traitement des données géospatiales.");
    }
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
  };

  return (
    <div className="w-screen h-screen flex bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Sidebar - Left Side */}
      <div className="w-96 bg-white/90 backdrop-blur-3xl border-r border-slate-200 flex flex-col p-6 z-20 shadow-[10px_0_40px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 bg-indigo-600 rounded-[22px] flex items-center justify-center text-3xl shadow-xl shadow-indigo-500/20 border border-indigo-400/20">
            <i className="fas fa-satellite-dish text-white"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase leading-none text-slate-900">GeoMapper</h1>
            <p className="text-[9px] text-indigo-600 font-black tracking-[0.4em] mt-1">SIG CLIPPING PRO</p>
          </div>
        </div>

        <div className="space-y-6 flex-grow overflow-y-auto no-scrollbar">
          
          {/* IMPORT SECTION - Organized per request */}
          <div className="pt-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3 flex items-center justify-between">
              <span>Importation & Données</span>
              <i className="fas fa-database text-slate-400"></i>
            </label>
            
            {/* TOP BLOCK: Configuration & Points (Projection + Excel) - ISOLATED */}
            <div className="bg-slate-50 rounded-3xl p-4 border border-slate-200 space-y-3 mb-4">
                <div className="flex items-center gap-2 mb-1 px-1">
                    <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Système & Points</span>
                </div>

                {/* 1. Projection System */}
                <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] text-indigo-600 font-bold uppercase">Projection (Zone)</span>
                        <a href="https://epsg.io/?q=Morocco" target="_blank" rel="noopener noreferrer" className="text-[9px] text-slate-400 hover:text-indigo-500"><i className="fas fa-info-circle"></i></a>
                    </div>
                    <select 
                        value={selectedZone}
                        onChange={(e) => setSelectedZone(e.target.value)}
                        className="w-full bg-slate-50 text-slate-700 text-[10px] p-2 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500/50 font-medium border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                        {ZONES.map(z => (
                            <option key={z.code} value={z.code}>{z.label}</option>
                        ))}
                    </select>
                </div>

                {/* 2. Excel Upload (Full Width) */}
                <input type="file" accept=".xlsx, .xls" className="hidden" ref={excelInputRef} onChange={onExcelFileSelect} />
                <button 
                  onClick={() => excelInputRef.current?.click()}
                  className={`w-full bg-white hover:bg-slate-50 border border-slate-200 p-3 rounded-2xl flex items-center justify-between gap-3 transition-all group active:scale-95 shadow-sm hover:shadow-md ${selectedExcelFile ? 'border-blue-500 bg-blue-50' : 'hover:border-blue-400'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${selectedExcelFile ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-500 group-hover:bg-blue-500 group-hover:text-white'}`}>
                        <i className="fas fa-table text-xs"></i>
                    </div>
                    <div className="flex flex-col items-start">
                        <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-800 uppercase tracking-wider">Excel Pts</span>
                        <span className="text-[8px] text-slate-400 font-medium">Importer des coordonnées</span>
                    </div>
                  </div>
                  <i className={`fas ${selectedExcelFile ? 'fa-check-circle text-blue-500' : 'fa-plus text-slate-300'} text-xs`}></i>
                </button>

                {/* Excel Processing Action Bar */}
                {selectedExcelFile && (
                  <div className="animate-in slide-in-from-top fade-in duration-300">
                      <button 
                        onClick={processExcelFile}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-[11px] font-bold shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                      >
                        <i className="fas fa-check-circle"></i>
                        <span>Charger : {selectedExcelFile.name.length > 15 ? selectedExcelFile.name.substring(0, 15) + '...' : selectedExcelFile.name}</span>
                      </button>
                  </div>
                )}
            </div>

            {/* NEW: Manual Input Block */}
            <div className="bg-slate-50 rounded-3xl p-4 border border-slate-200 space-y-3 mb-4">
               <div className="flex items-center gap-2 mb-1 px-1">
                   <div className="w-1 h-3 bg-orange-500 rounded-full"></div>
                   <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Saisie Manuelle</span>
               </div>
               
               <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  {/* Manual Zone Select */}
                  <div>
                    <label className="text-[9px] text-indigo-600 font-bold uppercase block mb-1">Zone Input</label>
                    <select 
                        value={manualZone}
                        onChange={(e) => setManualZone(e.target.value)}
                        className="w-full bg-slate-50 text-slate-700 text-[10px] p-2 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500/50 font-medium border border-slate-200 cursor-pointer"
                    >
                        {ZONES.map(z => (
                            <option key={z.code} value={z.code}>{z.label}</option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                     <div>
                       <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">X / Long</label>
                       <input 
                         type="text" 
                         value={manualX}
                         onChange={(e) => setManualX(e.target.value)}
                         placeholder="000000.00"
                         className="w-full bg-slate-50 text-slate-800 text-xs p-2 rounded-lg outline-none border border-slate-200 focus:border-indigo-400 font-mono"
                       />
                     </div>
                     <div>
                       <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Y / Lat</label>
                       <input 
                         type="text" 
                         value={manualY}
                         onChange={(e) => setManualY(e.target.value)}
                         placeholder="000000.00"
                         className="w-full bg-slate-50 text-slate-800 text-xs p-2 rounded-lg outline-none border border-slate-200 focus:border-indigo-400 font-mono"
                       />
                     </div>
                  </div>
                  
                  <button 
                    onClick={handleManualAddPoint}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-[10px] font-bold shadow-md shadow-orange-500/20 transition-all active:scale-95"
                  >
                    Ajouter le point
                  </button>
               </div>
            </div>

            {/* BOTTOM BLOCK: Files (KML, SHP, DXF) */}
            <div className="bg-slate-50 rounded-3xl p-4 border border-slate-200">
                <div className="flex items-center gap-2 mb-3 px-1">
                    <div className="w-1 h-3 bg-emerald-500 rounded-full"></div>
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Fichiers Géométriques</span>
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                    {/* KML */}
                    <input type="file" accept=".kml,.kmz" className="hidden" ref={kmlInputRef} onChange={handleKMLUpload} />
                    <button 
                      onClick={() => kmlInputRef.current?.click()}
                      className="aspect-square bg-white hover:bg-slate-50 border border-slate-200 hover:border-amber-400 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all group active:scale-95 shadow-sm hover:shadow-md"
                    >
                      <div className="w-8 h-8 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                        <i className="fas fa-map-marker-alt text-xs"></i>
                      </div>
                      <span className="text-[9px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider">KML</span>
                    </button>

                    {/* SHP */}
                    <input type="file" accept=".zip" className="hidden" ref={shpInputRef} onChange={handleShapefileUpload} />
                    <button 
                      onClick={() => shpInputRef.current?.click()}
                      className="aspect-square bg-white hover:bg-slate-50 border border-slate-200 hover:border-emerald-400 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all group active:scale-95 shadow-sm hover:shadow-md"
                    >
                      <div className="w-8 h-8 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                        <i className="fas fa-layer-group text-xs"></i>
                      </div>
                      <span className="text-[9px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider">SHP</span>
                    </button>

                    {/* DXF */}
                    <input type="file" accept=".dxf" className="hidden" ref={dxfInputRef} onChange={handleDXFUpload} />
                    <button 
                      onClick={() => dxfInputRef.current?.click()}
                      className="aspect-square bg-white hover:bg-slate-50 border border-slate-200 hover:border-purple-400 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all group active:scale-95 shadow-sm hover:shadow-md"
                    >
                      <div className="w-8 h-8 bg-purple-50 rounded-full flex items-center justify-center text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                        <i className="fas fa-drafting-compass text-xs"></i>
                      </div>
                      <span className="text-[9px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider">DXF</span>
                    </button>
                </div>
            </div>
          </div>

          {/* Scale Selection & Map Zoom Control */}
          <div className="pt-4 p-5 bg-indigo-50 rounded-3xl border border-indigo-100 animate-in fade-in duration-700">
            <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest block mb-4">Échelle et Exportation</label>
            <div className="relative group">
              <select 
                value={selectedScale}
                onChange={(e) => handleScaleChange(Number(e.target.value))}
                className="w-full bg-white border border-slate-200 p-5 rounded-2xl text-slate-900 font-black appearance-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer group-hover:border-indigo-400 shadow-sm"
              >
                {SCALES.map(s => <option key={s.value} value={s.value} className="bg-white text-slate-900">{s.label}</option>)}
              </select>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-500">
                <i className="fas fa-search-location"></i>
              </div>
            </div>
          </div>

          {/* Workflow Controller */}
          <div className="pt-6 border-t border-slate-200">
            {step === 'IDLE' && (
              <div className="bg-slate-100 rounded-3xl p-6 text-center border border-slate-200">
                <p className="text-slate-500 text-xs font-bold leading-relaxed">En attente de dessin ou d'importation...</p>
              </div>
            )}

            {step === 'SELECTED' && exportData && (
              <div className="space-y-5 animate-in slide-in-from-bottom duration-500">
                {/* Removed Données de la Zone block per request */}
                <button 
                  onClick={startClipping}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 py-6 rounded-3xl font-black text-lg shadow-2xl shadow-indigo-600/30 flex items-center justify-center gap-4 transition-all active:scale-95 group text-white"
                >
                  <i className="fas fa-scissors group-hover:-rotate-45 transition-transform"></i>
                  <span>Exporter SIG (GeoTIFF)</span>
                </button>
              </div>
            )}

            {step === 'PROCESSING' && (
              <div className="text-center py-12 space-y-6 bg-white rounded-3xl border border-slate-200 shadow-sm">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                    <i className="fas fa-satellite-dish text-2xl animate-pulse"></i>
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Traitement en cours</h3>
                  <p className="text-slate-500 text-sm mt-2">Extraction à l'échelle 1:{selectedScale}</p>
                </div>
              </div>
            )}

            {step === 'DONE' && (
              <div className="space-y-6 animate-in zoom-in duration-500">
                <div className="bg-emerald-50 rounded-3xl p-8 text-center border border-emerald-100 shadow-2xl shadow-emerald-500/10">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                     <i className="fas fa-check-circle text-3xl text-emerald-600"></i>
                  </div>
                  <h3 className="text-xl font-black text-slate-800 uppercase">Package Prêt</h3>
                  <p className="text-slate-500 text-xs mt-2 font-medium">1:{selectedScale} | TIF + TFW + PRJ</p>
                </div>
                <button 
                  onClick={downloadFile}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 py-6 rounded-3xl font-black text-lg shadow-2xl shadow-emerald-600/30 flex items-center justify-center gap-4 transition-all active:scale-95 text-white"
                >
                  <i className="fas fa-download text-xl"></i>
                  <span>Télécharger (ZIP)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="pt-6 border-t border-slate-200">
           <button 
            onClick={resetAll}
            className="w-full text-slate-400 hover:text-red-500 py-4 text-[10px] font-black uppercase tracking-[0.3em] transition-colors flex items-center justify-center gap-2"
           >
             <i className="fas fa-undo-alt"></i> Réinitialiser la carte
           </button>
        </div>
      </div>

      {/* Map Content */}
      <div className="flex-grow relative h-full">
        <MapComponent 
          ref={mapComponentRef} 
          mapType={mapType}
          onSelectionComplete={(data) => {
            setExportData(data);
            setStep('SELECTED');
            setActiveTool(null);
          }} 
        />

        {/* Floating Drawing Tools - Top Left */}
        <div className="absolute left-4 top-4 flex flex-col gap-2 z-10">
          <button 
            onClick={() => toggleTool('Rectangle')}
            className={`w-10 h-10 rounded-md flex items-center justify-center transition-all shadow-lg border relative group ${
              activeTool === 'Rectangle' 
                ? 'bg-indigo-600 border-indigo-400 text-white' 
                : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
            }`}
          >
            <img 
              src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNGFkZTgwIiBzdHJva2Utd2lkdGg9IjIiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIC8+PC9zdmc+" 
              className="w-5 h-5" 
              alt="Rectangle"
            />
            {/* Tooltip */}
            <div className="absolute left-full ml-3 px-3 py-1.5 bg-white text-slate-700 text-[10px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-200 pointer-events-none shadow-xl">
              Rectangle
            </div>
          </button>
          
          <button 
            onClick={() => toggleTool('Polygon')}
            className={`w-10 h-10 rounded-md flex items-center justify-center transition-all shadow-lg border relative group ${
              activeTool === 'Polygon' 
                ? 'bg-indigo-600 border-indigo-400 text-white' 
                : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
            }`}
          >
            <img 
              src="https://tool-online.com/Images/Polygone.png" 
              className="w-5 h-5 invert mix-blend-difference" 
              alt="Polygone"
            />
             {/* Tooltip */}
            <div className="absolute left-full ml-3 px-3 py-1.5 bg-white text-slate-700 text-[10px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-200 pointer-events-none shadow-xl">
              Polygone
            </div>
          </button>
        </div>

        {/* Map Layers Control - Top Right */}
        <div className="absolute right-4 top-4 z-10 flex flex-col items-end">
          <button
            onClick={() => setIsLayerMenuOpen(!isLayerMenuOpen)}
            className={`w-10 h-10 rounded-xl shadow-lg border border-slate-200 flex items-center justify-center transition-all ${isLayerMenuOpen ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <i className="fas fa-layer-group"></i>
          </button>

          {isLayerMenuOpen && (
            <div className="mt-2 bg-white/95 backdrop-blur-md p-2 rounded-xl border border-slate-200 shadow-xl flex flex-col gap-2 animate-in slide-in-from-top-2 fade-in duration-200 w-32">
              <button
                onClick={() => { setMapType('satellite'); setIsLayerMenuOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] font-bold transition-all ${mapType === 'satellite' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <i className="fas fa-globe w-4"></i>
                <span>Satellite</span>
              </button>
              <button
                onClick={() => { setMapType('hybrid'); setIsLayerMenuOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] font-bold transition-all ${mapType === 'hybrid' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <i className="fas fa-map-marked-alt w-4"></i>
                <span>Hybride</span>
              </button>
            </div>
          )}
        </div>
        
        {/* Indicators Overlay */}
        <div className="absolute bottom-8 left-8 bg-white/90 backdrop-blur-2xl p-6 rounded-[32px] border border-slate-200 pointer-events-none flex items-center gap-8 shadow-2xl">
          <div className="flex items-center gap-4">
             <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]"></div>
             <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Système Prêt</span>
               <span className="text-[8px] text-slate-500 font-bold">{mapType === 'satellite' ? 'Vue Satellite' : 'Vue Hybride'}</span>
             </div>
          </div>
          <div className="h-6 w-px bg-slate-200"></div>
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500 border border-indigo-100">
               <i className="fas fa-expand text-sm"></i>
             </div>
             <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-800">Échelle Cible</span>
               <span className="text-[10px] text-indigo-600 font-black">1:{selectedScale}</span>
             </div>
          </div>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        option { padding: 12px; background: white; color: #1e293b; font-weight: bold; }
      `}</style>
    </div>
  );
};

export default App;