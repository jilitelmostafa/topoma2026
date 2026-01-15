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
  { code: 'EPSG:26191', label: 'Nord Maroc (Zone 1) - EPSG:26191' },
  { code: 'EPSG:26192', label: 'Sud Maroc (Zone 2) - EPSG:26192' },
  { code: 'EPSG:26194', label: 'Sahara Nord (Zone 3) - EPSG:26194' },
  { code: 'EPSG:26195', label: 'Sahara Sud (Zone 4) - EPSG:26195' },
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
  
  const mapComponentRef = useRef<MapComponentRef>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);
  const shpInputRef = useRef<HTMLInputElement>(null);
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
  };

  return (
    <div className="w-screen h-screen flex bg-slate-950 text-white font-sans overflow-hidden">
      {/* Sidebar - Left Side */}
      <div className="w-96 bg-slate-900/80 backdrop-blur-3xl border-r border-white/10 flex flex-col p-6 z-20 shadow-[20px_0_60px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 bg-indigo-600 rounded-[22px] flex items-center justify-center text-3xl shadow-2xl shadow-indigo-500/30 border border-indigo-400/20">
            <i className="fas fa-satellite-dish"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase leading-none">GeoMapper</h1>
            <p className="text-[9px] text-indigo-400 font-black tracking-[0.4em] mt-1">SIG CLIPPING PRO</p>
          </div>
        </div>

        <div className="space-y-6 flex-grow overflow-y-auto no-scrollbar">
          {/* Map Layer Settings */}
          <div className="bg-slate-800/40 p-5 rounded-3xl border border-white/5 space-y-4">
             <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Fond de Plan</label>
             <div className="flex bg-slate-950 p-1.5 rounded-2xl border border-white/5">
                <button 
                  onClick={() => setMapType('satellite')}
                  className={`flex-1 py-3 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-2 ${mapType === 'satellite' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}
                >
                  <i className="fas fa-globe"></i>
                  Satellite
                </button>
                <button 
                  onClick={() => setMapType('hybrid')}
                  className={`flex-1 py-3 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-2 ${mapType === 'hybrid' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}
                >
                  <i className="fas fa-map-marked-alt"></i>
                  Hybride
                </button>
             </div>
          </div>

          {/* Drawing Tools */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4 border-b border-white/5 pb-2">Outils de Sélection</label>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => toggleTool('Rectangle')}
                className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${activeTool === 'Rectangle' ? 'bg-red-600 border-red-400 shadow-xl' : 'bg-slate-800/40 border-white/5 hover:bg-slate-800'}`}
              >
                <i className="fas fa-square-full text-xl"></i>
                <span className="text-[11px] font-bold">Rectangle</span>
              </button>
              <button 
                onClick={() => toggleTool('Polygon')}
                className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${activeTool === 'Polygon' ? 'bg-red-600 border-red-400 shadow-xl' : 'bg-slate-800/40 border-white/5 hover:bg-slate-800'}`}
              >
                <i className="fas fa-draw-polygon text-xl"></i>
                <span className="text-[11px] font-bold">Polygone</span>
              </button>
            </div>
          </div>

          {/* File Uploads (KML, SHP, Excel) */}
          <div className="space-y-3 pt-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Importation</label>
            
            {/* KML */}
            <input type="file" accept=".kml,.kmz" className="hidden" ref={kmlInputRef} onChange={handleKMLUpload} />
            <button 
              onClick={() => kmlInputRef.current?.click()}
              className="w-full bg-slate-800/50 hover:bg-slate-700 text-white border border-white/10 py-3 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 mb-2"
            >
              <i className="fas fa-file-code text-lg text-amber-500"></i>
              <span className="text-[11px]">Importer KML / KMZ</span>
            </button>

            {/* SHP (ZIP) */}
            <input type="file" accept=".zip" className="hidden" ref={shpInputRef} onChange={handleShapefileUpload} />
            <button 
              onClick={() => shpInputRef.current?.click()}
              className="w-full bg-slate-800/50 hover:bg-slate-700 text-white border border-white/10 py-3 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 mb-2"
            >
              <i className="fas fa-file-archive text-lg text-green-500"></i>
              <span className="text-[11px]">Importer Shapefile (ZIP)</span>
            </button>

            {/* Excel Section (Updated) */}
            <div className="bg-slate-800/30 rounded-2xl p-3 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-blue-400 uppercase">Points (Excel)</label>
                    <i className="fas fa-table text-blue-500"></i>
                </div>
                
                {/* Zone Selection with EPSG Link */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center px-1">
                        <span className="text-[9px] text-slate-400">Système de Coordonnées</span>
                        <a href="https://epsg.io/?q=Morocco" target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:text-blue-300 hover:underline">
                            epsg.io <i className="fas fa-external-link-alt text-[8px]"></i>
                        </a>
                    </div>
                    <select 
                        value={selectedZone}
                        onChange={(e) => setSelectedZone(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 text-white text-[10px] p-2 rounded-lg outline-none focus:border-blue-500 font-mono"
                    >
                        {ZONES.map(z => (
                            <option key={z.code} value={z.code}>{z.label}</option>
                        ))}
                    </select>
                </div>

                {/* Step 1: File Selection Button */}
                <input type="file" accept=".xlsx, .xls" className="hidden" ref={excelInputRef} onChange={onExcelFileSelect} />
                <div className="flex flex-col gap-2">
                    <button 
                        onClick={() => excelInputRef.current?.click()}
                        className={`w-full py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-[11px] border border-dashed ${
                            selectedExcelFile 
                            ? 'bg-slate-700/50 text-white border-white/30' 
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-white/10'
                        }`}
                    >
                        <i className={`fas ${selectedExcelFile ? 'fa-check-circle text-emerald-400' : 'fa-folder-open'}`}></i>
                        <span>{selectedExcelFile ? 'Fichier Sélectionné' : '1. Choisir un fichier Excel'}</span>
                    </button>
                    {selectedExcelFile && (
                        <div className="text-[10px] text-slate-400 text-center truncate px-2 bg-slate-900/50 py-1 rounded">
                            {selectedExcelFile.name}
                        </div>
                    )}
                </div>

                {/* Step 2: Upload Action Button */}
                <button 
                  onClick={processExcelFile}
                  disabled={!selectedExcelFile}
                  className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-[11px] shadow-lg ${
                      selectedExcelFile 
                      ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20 cursor-pointer' 
                      : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-white/5 opacity-50'
                  }`}
                >
                  <i className="fas fa-cloud-upload-alt"></i>
                  <span>2. Charger & Traiter</span>
                </button>
            </div>
          </div>

          {/* Scale Selection & Map Zoom Control */}
          <div className="pt-4 p-5 bg-indigo-500/5 rounded-3xl border border-indigo-500/10 animate-in fade-in duration-700">
            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-4">Échelle et Exportation</label>
            <div className="relative group">
              <select 
                value={selectedScale}
                onChange={(e) => handleScaleChange(Number(e.target.value))}
                className="w-full bg-slate-900 border border-white/10 p-5 rounded-2xl text-white font-black appearance-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer group-hover:border-indigo-500/50"
              >
                {SCALES.map(s => <option key={s.value} value={s.value} className="bg-slate-900 text-white">{s.label}</option>)}
              </select>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-400">
                <i className="fas fa-search-location"></i>
              </div>
            </div>
          </div>

          {/* Workflow Controller */}
          <div className="pt-6 border-t border-white/10">
            {step === 'IDLE' && (
              <div className="bg-slate-800/20 rounded-3xl p-6 text-center border border-white/5">
                <p className="text-slate-400 text-xs font-bold leading-relaxed">En attente de dessin ou d'importation...</p>
              </div>
            )}

            {step === 'SELECTED' && exportData && (
              <div className="space-y-5 animate-in slide-in-from-bottom duration-500">
                <div className="bg-indigo-600/10 rounded-3xl p-6 border border-indigo-500/20 shadow-inner">
                  <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-wider mb-4 flex items-center gap-2">
                    <i className="fas fa-info-circle"></i>
                    Données de la Zone
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-[11px]">
                    <div className="bg-slate-950 p-3 rounded-xl border border-white/5">
                      <span className="text-slate-500 block mb-1 uppercase text-[9px]">Lat</span>
                      <span className="font-mono text-white">{exportData.lat}</span>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-xl border border-white/5">
                      <span className="text-slate-500 block mb-1 uppercase text-[9px]">Lng</span>
                      <span className="font-mono text-white">{exportData.lng}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={startClipping}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 py-6 rounded-3xl font-black text-lg shadow-2xl shadow-indigo-600/40 flex items-center justify-center gap-4 transition-all active:scale-95 group"
                >
                  <i className="fas fa-scissors group-hover:-rotate-45 transition-transform"></i>
                  <span>Exporter SIG (GeoTIFF)</span>
                </button>
              </div>
            )}

            {step === 'PROCESSING' && (
              <div className="text-center py-12 space-y-6 bg-slate-800/10 rounded-3xl border border-white/5">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute inset-0 border-4 border-indigo-600/10 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center text-indigo-400">
                    <i className="fas fa-satellite-dish text-2xl animate-pulse"></i>
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold">Traitement en cours</h3>
                  <p className="text-slate-400 text-sm mt-2">Extraction à l'échelle 1:{selectedScale}</p>
                </div>
              </div>
            )}

            {step === 'DONE' && (
              <div className="space-y-6 animate-in zoom-in duration-500">
                <div className="bg-emerald-500/10 rounded-3xl p-8 text-center border border-emerald-500/20 shadow-2xl shadow-emerald-500/10">
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                     <i className="fas fa-check-circle text-3xl text-emerald-500"></i>
                  </div>
                  <h3 className="text-xl font-black text-white uppercase">Package Prêt</h3>
                  <p className="text-slate-400 text-xs mt-2 font-medium">1:{selectedScale} | TIF + TFW + PRJ</p>
                </div>
                <button 
                  onClick={downloadFile}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 py-6 rounded-3xl font-black text-lg shadow-2xl shadow-emerald-600/40 flex items-center justify-center gap-4 transition-all active:scale-95"
                >
                  <i className="fas fa-download text-xl"></i>
                  <span>Télécharger (ZIP)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="pt-6 border-t border-white/5">
           <button 
            onClick={resetAll}
            className="w-full text-slate-500 hover:text-red-400 py-4 text-[10px] font-black uppercase tracking-[0.3em] transition-colors flex items-center justify-center gap-2"
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
        
        {/* Indicators Overlay */}
        <div className="absolute bottom-8 left-8 bg-slate-900/90 backdrop-blur-2xl p-6 rounded-[32px] border border-white/10 pointer-events-none flex items-center gap-8 shadow-2xl">
          <div className="flex items-center gap-4">
             <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]"></div>
             <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Système Prêt</span>
               <span className="text-[8px] text-slate-500 font-bold">{mapType === 'satellite' ? 'Vue Satellite' : 'Vue Hybride'}</span>
             </div>
          </div>
          <div className="h-6 w-px bg-white/10"></div>
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-indigo-600/20 rounded-xl flex items-center justify-center text-indigo-400 border border-indigo-400/20">
               <i className="fas fa-expand text-sm"></i>
             </div>
             <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-widest text-white">Échelle Cible</span>
               <span className="text-[10px] text-indigo-400 font-black">1:{selectedScale}</span>
             </div>
          </div>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        option { padding: 12px; background: #0f172a; font-weight: bold; }
      `}</style>
    </div>
  );
};

export default App;