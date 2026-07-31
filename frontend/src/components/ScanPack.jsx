import { useState, useEffect, useRef } from 'react';
import { Search, Trash2, Upload, Image, FileText, Volume2, VolumeX, Settings } from 'lucide-react';
import { BACKEND_URL } from '../config';

function ScanPack() {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan', 'images', 'mappings', 'pdfs'
  
  // --- STATE FOR BARCODE SCANNER ---
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanResult, setScanResult] = useState(null); // { order, skuImage }
  const [scanError, setScanError] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [autoFocus, setAutoFocus] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanHistory, setScanHistory] = useState([]); // Array of recent scans
  const scanInputRef = useRef(null);

  // --- STATE FOR SKU DESIGN IMAGES ---
  const [skuImages, setSkuImages] = useState([]);
  const [imageSearch, setImageSearch] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);

  // --- STATE FOR SKU MAPPINGS EXCEL ---
  const [mappingStats, setMappingStats] = useState({ totalMappings: 0, lastImport: null });
  const [mappings, setMappings] = useState([]);
  const [mappingSearch, setMappingSearch] = useState('');
  const [uploadingMappings, setUploadingMappings] = useState(false);
  const [mappingUploadError, setMappingUploadError] = useState(null);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingPage, setMappingPage] = useState(1);
  const [mappingTotal, setMappingTotal] = useState(0);

  // --- STATE FOR ORDER PDFS ---
  const [orderPdfs, setOrderPdfs] = useState([]);
  const [parsedOrders, setParsedOrders] = useState([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfUploadError, setPdfUploadError] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    fetchSkuImages();
    fetchOrderPdfs();
    fetchParsedOrders();
    fetchMappingStats();
  }, []);

  // Auto-focus logic for barcode scanning
  useEffect(() => {
    if (activeTab === 'scan' && autoFocus) {
      const interval = setInterval(() => {
        if (document.activeElement !== scanInputRef.current) {
          scanInputRef.current?.focus();
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [activeTab, autoFocus]);

  // Load mappings when search or tab active
  useEffect(() => {
    if (activeTab === 'mappings') {
      const delay = setTimeout(() => {
        fetchMappings(mappingSearch, 1);
      }, 400);
      return () => clearTimeout(delay);
    }
  }, [mappingSearch, activeTab]);

  useEffect(() => {
    if (activeTab === 'mappings') {
      fetchMappingStats();
    }
  }, [activeTab]);

  // Synthesize audio feedback via Web Audio API
  const playAudioFeedback = (type) => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      if (type === 'success') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.stop(ctx.currentTime + 0.4);
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(130.81, ctx.currentTime); // C3
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.stop(ctx.currentTime + 0.55);
      }
    } catch (e) {
      console.error("Audio feedback error:", e);
    }
  };

  // --- API HANDLERS ---

  const fetchSkuImages = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-images`);
      const data = await res.json();
      setSkuImages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching SKU images:", err);
    }
  };

  const fetchOrderPdfs = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/order-pdfs`);
      const data = await res.json();
      setOrderPdfs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching PDFs:", err);
    }
  };

  const fetchParsedOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/parsed-orders`);
      const data = await res.json();
      setParsedOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching parsed orders:", err);
    } finally {
      setOrdersLoading(false);
    }
  };

  const fetchMappingStats = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-mappings/stats`);
      const data = await res.json();
      setMappingStats(data);
    } catch (err) {
      console.error("Error fetching SKU mapping stats:", err);
    }
  };

  const fetchMappings = async (query = '', page = 1) => {
    setMappingsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-mappings/search?q=${encodeURIComponent(query)}&page=${page}&limit=15`);
      const data = await res.json();
      setMappings(data.mappings || []);
      setMappingTotal(data.total || 0);
      setMappingPage(data.page || 1);
    } catch (err) {
      console.error("Error searching SKU mappings:", err);
    } finally {
      setMappingsLoading(false);
    }
  };

  const handleImageUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingImages(true);
    const formData = new FormData();
    for (let file of files) {
      formData.append('files', file);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-images`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        fetchSkuImages();
        alert(`Successfully uploaded ${data.files.length} Product Design Photos!`);
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (err) {
      console.error("Error uploading images:", err);
      alert("Upload failed");
    } finally {
      setUploadingImages(false);
      e.target.value = ''; // Reset input
    }
  };

  const deleteSkuImage = async (sku) => {
    if (!confirm(`Are you sure you want to delete the image for design group "${sku}"?`)) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-images/${sku}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchSkuImages();
      } else {
        alert("Delete failed: " + data.error);
      }
    } catch (err) {
      console.error("Error deleting image:", err);
    }
  };

  const handleMappingUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingMappings(true);
    setMappingUploadError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/sku-mappings`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchMappingStats();
        fetchMappings(mappingSearch, 1);
      } else {
        setMappingUploadError(data.error || "Failed to parse Excel mapping file");
      }
    } catch (err) {
      console.error("Error uploading mapping Excel:", err);
      setMappingUploadError("Failed to connect to server");
    } finally {
      setUploadingMappings(false);
      e.target.value = ''; // Reset input
    }
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingPdf(true);
    setPdfUploadError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/order-pdfs`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        fetchOrderPdfs();
        fetchParsedOrders();
        alert(data.message);
      } else {
        setPdfUploadError(data.error || "Failed to parse PDF");
      }
    } catch (err) {
      console.error("Error uploading PDF:", err);
      setPdfUploadError("Failed to connect to server");
    } finally {
      setUploadingPdf(false);
      e.target.value = ''; // Reset input
    }
  };

  const deletePdf = async (filename) => {
    if (!confirm(`Are you sure you want to delete this PDF and all associated parsed orders?`)) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/order-pdfs/${filename}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchOrderPdfs();
        fetchParsedOrders();
      } else {
        alert("Delete failed: " + data.error);
      }
    } catch (err) {
      console.error("Error deleting PDF:", err);
    }
  };

  // --- BARCODE SCANNING LOOKUP ---

  const handleScanSubmit = async (e) => {
    if (e) e.preventDefault();
    const barcode = barcodeInput.trim();
    if (!barcode) return;

    setScanLoading(true);
    setScanError(null);
    setScanResult(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/lookup-barcode?barcode=${encodeURIComponent(barcode)}`);
      if (res.status === 404) {
        setScanError(`Barcode "${barcode}" not found in uploaded PDFs.`);
        playAudioFeedback('error');
        setScanHistory(prev => [
          { barcode, status: 'failed', time: new Date().toLocaleTimeString(), error: 'Not Found' },
          ...prev
        ].slice(0, 10));
      } else {
        const data = await res.json();
        if (data.success) {
          setScanResult(data);
          
          if (!data.skuImage) {
            const displayDesign = data.order.designName || data.order.sku;
            setScanError(`Order found! But no photo uploaded for design: ${displayDesign}`);
            playAudioFeedback('error');
            setScanHistory(prev => [
              { barcode, sku: data.order.sku, customer: data.order.customerName, status: 'warning', time: new Date().toLocaleTimeString() },
              ...prev
            ].slice(0, 10));
          } else {
            playAudioFeedback('success');
            setScanHistory(prev => [
              { barcode, sku: data.order.sku, customer: data.order.customerName, status: 'success', time: new Date().toLocaleTimeString() },
              ...prev
            ].slice(0, 10));
          }
        } else {
          setScanError("Lookup failed: " + data.error);
          playAudioFeedback('error');
        }
      }
    } catch (err) {
      console.error("Scan lookup error:", err);
      setScanError("Failed to contact the server.");
      playAudioFeedback('error');
    } finally {
      setScanLoading(false);
      setBarcodeInput('');
    }
  };

  const handleHistoryClick = async (barcode) => {
    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/lookup-barcode?barcode=${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);
        if (!data.skuImage) {
          const displayDesign = data.order.designName || data.order.sku;
          setScanError(`Order found! But no photo uploaded for design: ${displayDesign}`);
        }
      } else {
        setScanError(`Barcode "${barcode}" is no longer available.`);
      }
    } catch (err) {
      setScanError("Error recalling historical record.");
    } finally {
      setScanLoading(false);
    }
  };

  const filteredSkuImages = skuImages.filter(img => 
    img.sku.toLowerCase().includes(imageSearch.toLowerCase())
  );

  const filteredOrders = parsedOrders.filter(order => 
    order.orderId.toLowerCase().includes(orderSearch.toLowerCase()) ||
    order.awb.toLowerCase().includes(orderSearch.toLowerCase()) ||
    order.sku.toLowerCase().includes(orderSearch.toLowerCase()) ||
    order.customerName.toLowerCase().includes(orderSearch.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: 'calc(100vh - 85px)', overflow: 'hidden' }}>
      
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <h2 style={{ fontSize: '1.3rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={20} style={{ color: 'var(--primary)' }} /> Scan & Pack Station
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '3px', borderRadius: '8px' }}>
            <button 
              className={`btn ${activeTab === 'scan' ? 'btn-primary' : ''}`}
              style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', border: 'none', background: activeTab === 'scan' ? undefined : 'transparent' }}
              onClick={() => setActiveTab('scan')}
            >
              Barcode Scanner
            </button>
            <button 
              className={`btn ${activeTab === 'images' ? 'btn-primary' : ''}`}
              style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', border: 'none', background: activeTab === 'images' ? undefined : 'transparent' }}
              onClick={() => setActiveTab('images')}
            >
              Design Photos ({skuImages.length})
            </button>
            <button 
              className={`btn ${activeTab === 'mappings' ? 'btn-primary' : ''}`}
              style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', border: 'none', background: activeTab === 'mappings' ? undefined : 'transparent' }}
              onClick={() => setActiveTab('mappings')}
            >
              SKU Mappings (Excel)
            </button>
            <button 
              className={`btn ${activeTab === 'pdfs' ? 'btn-primary' : ''}`}
              style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', border: 'none', background: activeTab === 'pdfs' ? undefined : 'transparent' }}
              onClick={() => setActiveTab('pdfs')}
            >
              Meesho PDFs ({orderPdfs.length})
            </button>
          </div>
        </div>

        {activeTab === 'scan' && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button 
              className="btn" 
              style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: soundEnabled ? 'var(--success)' : 'var(--text-muted)' }}
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Disable Sounds" : "Enable Sounds"}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={autoFocus} 
                onChange={(e) => setAutoFocus(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              /> Auto-Focus Scanner
            </label>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>

        {/* ================= BARCODE SCANNING TAB ================= */}
        {activeTab === 'scan' && (
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1rem', height: '100%', overflow: 'hidden' }}>
            
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Recent Scans</h3>
              
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {scanHistory.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 1rem', fontSize: '0.85rem' }}>
                    No scanned barcodes in this session. Start scanning labels!
                  </div>
                ) : (
                  scanHistory.map((item, index) => (
                    <div 
                      key={index} 
                      onClick={() => handleHistoryClick(item.barcode)}
                      style={{ 
                        background: 'rgba(0,0,0,0.15)', 
                        padding: '0.6rem', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        borderLeft: `4px solid ${
                          item.status === 'success' ? 'var(--success)' : 
                          item.status === 'warning' ? 'orange' : 'var(--danger)'
                        }`,
                        transition: 'transform 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 'bold' }}>
                        <span>{item.barcode}</span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.7rem' }}>{item.time}</span>
                      </div>
                      {item.sku && (
                        <div style={{ fontSize: '0.75rem', marginTop: '3px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--primary)' }}>SKU: {item.sku}</span>
                          <span style={{ color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.customer}</span>
                        </div>
                      )}
                      {item.error && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: '2px' }}>{item.error}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              <form onSubmit={handleScanSubmit} style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', flexShrink: 0 }}>
                <div style={{ position: 'relative', width: '100%', maxWidth: '600px' }}>
                  <input
                    ref={scanInputRef}
                    type="text"
                    className="input-field"
                    placeholder="Scan Barcode of printed PDF (AWB or Order ID)..."
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '1.2rem 1.5rem',
                      fontSize: '1.2rem',
                      textAlign: 'center',
                      letterSpacing: '1px',
                      borderRadius: '12px',
                      border: '2px solid rgba(99, 102, 241, 0.25)',
                      boxShadow: '0 0 15px rgba(99, 102, 241, 0.05)',
                      background: 'rgba(0,0,0,0.3)',
                      outline: 'none',
                      transition: 'all 0.3s'
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)'}
                    disabled={scanLoading}
                  />
                  {scanLoading && (
                    <div style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary)' }}>
                      Loading...
                    </div>
                  )}
                </div>
              </form>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                
                {!scanResult && !scanError && !scanLoading && (
                  <div style={{ textAlign: 'center', maxWidth: '450px', padding: '2rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
                    <h3 style={{ color: 'white', marginBottom: '0.5rem', fontSize: '1.2rem' }}>Ready for Verification</h3>
                    <p style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
                      Scan the barcode on the Meesho shipping label. The system will resolve the SKU name from mappings and display the product design photo instantly.
                    </p>
                  </div>
                )}

                {scanLoading && !scanResult && (
                  <div style={{ textAlign: 'center', color: 'var(--primary)' }}>
                    <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite', marginBottom: '1rem' }}>🔄</div>
                    <h3>Searching Database...</h3>
                  </div>
                )}

                {scanError && !scanResult && (
                  <div style={{ 
                    textAlign: 'center', 
                    maxWidth: '550px', 
                    padding: '2rem', 
                    background: 'rgba(239, 68, 68, 0.08)', 
                    border: '1px solid rgba(239, 68, 68, 0.3)', 
                    borderRadius: '12px' 
                  }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
                    <h3 style={{ color: 'var(--danger)', marginBottom: '0.8rem', fontSize: '1.2rem' }}>Lookup Failed</h3>
                    <p style={{ color: 'white', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>{scanError}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Tip: Ensure you have uploaded the product design image matching this design/SKU name under the <b>Design Photos</b> tab.
                    </p>
                  </div>
                )}

                {scanResult && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', width: '100%', height: '100%', padding: '1rem' }}>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1rem', borderRight: '1px solid var(--border-color)', paddingRight: '2rem' }}>
                      
                      <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '0.8rem 1.2rem', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', textTransform: 'uppercase', fontWeight: 'bold' }}>SKU Code</span>
                        <div style={{ fontSize: '2.3rem', fontWeight: '900', color: 'white', letterSpacing: '0.5px', marginTop: '3px' }}>
                          {scanResult.order.sku}
                        </div>
                        {scanResult.order.designName && (
                          <div style={{ marginTop: '0.4rem', fontSize: '1.1rem', color: 'var(--secondary)', fontWeight: 'bold' }}>
                            Design: {scanResult.order.designName}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.95rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.8rem' }}>Customer Name</span>
                          <strong style={{ fontSize: '1.1rem' }}>{scanResult.order.customerName}</strong>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.8rem' }}>AWB / Barcode</span>
                            <code>{scanResult.order.awb}</code>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.8rem' }}>Quantity</span>
                            <strong>1 Unit</strong>
                          </div>
                        </div>
                        <div style={{ marginTop: '0.5rem' }}>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.8rem' }}>Order Number</span>
                          <code>{scanResult.order.orderId}</code>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                      {scanResult.skuImage ? (
                        <div style={{ 
                          width: '100%', 
                          maxHeight: '320px', 
                          borderRadius: '12px', 
                          overflow: 'hidden', 
                          border: '2px solid rgba(255,255,255,0.1)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          background: '#000',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                        }}>
                          <img 
                            src={`${BACKEND_URL}${scanResult.skuImage.url}`} 
                            alt={scanResult.order.sku}
                            style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain' }}
                          />
                        </div>
                      ) : (
                        <div style={{ 
                          width: '100%', 
                          height: '250px', 
                          borderRadius: '12px', 
                          border: '2px dashed rgba(239, 68, 68, 0.4)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          background: 'rgba(239, 68, 68, 0.05)',
                          padding: '1.5rem',
                          textAlign: 'center',
                          color: 'var(--danger)'
                        }}>
                          <Image size={40} style={{ marginBottom: '1rem', opacity: 0.7 }} />
                          <h4 style={{ marginBottom: '0.5rem' }}>No Photo Uploaded</h4>
                          <p style={{ fontSize: '0.8rem', color: 'white', lineHeight: '1.4' }}>
                            We found the SKU mapping to design <b>{scanResult.order.designName || scanResult.order.sku}</b>, but no matching product image was found.
                          </p>
                        </div>
                      )}
                      
                      {scanResult.skuImage && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}>
                          ✓ Product Verification Successful
                        </div>
                      )}
                    </div>

                  </div>
                )}

              </div>
            </div>

          </div>
        )}

        {/* ================= PRODUCT DESIGN PHOTOS TAB ================= */}
        {activeTab === 'images' && (
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Design Image Database</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Filenames must match the Product Design name from mappings (e.g. <code>sapdo.png</code> maps to group <code>sapdo</code>)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="search"
                    className="input-field"
                    placeholder="Search Design Name..."
                    value={imageSearch}
                    onChange={(e) => setImageSearch(e.target.value)}
                    style={{ paddingLeft: '32px', width: '220px', paddingTop: '8px', paddingBottom: '8px' }}
                  />
                </div>
                <label className="btn btn-primary" style={{ padding: '0.5rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Upload size={16} /> Upload Design Photos
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    onChange={handleImageUpload} 
                    style={{ display: 'none' }} 
                    disabled={uploadingImages}
                  />
                </label>
              </div>
            </div>

            {uploadingImages && (
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '0.8rem', borderRadius: '8px', color: 'var(--primary)', textAlign: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                Uploading and mapping design photos, please wait...
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
              {filteredSkuImages.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '4rem 1rem' }}>
                  <Image size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                  <p>No design photos found. Start uploading product photos named after their design names.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                  {filteredSkuImages.map((img) => (
                    <div 
                      key={img.sku} 
                      className="glass-panel" 
                      style={{ 
                        padding: '0.6rem', 
                        position: 'relative', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border-color)',
                        transition: 'transform 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      <button 
                        onClick={() => deleteSkuImage(img.sku)}
                        style={{ 
                          position: 'absolute', 
                          top: '8px', 
                          right: '8px', 
                          background: 'rgba(239, 68, 68, 0.8)', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '4px', 
                          padding: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0.8,
                          transition: 'opacity 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                        title="Delete Design Photo"
                      >
                        <Trash2 size={12} />
                      </button>

                      <div style={{ 
                        width: '100%', 
                        height: '140px', 
                        borderRadius: '8px', 
                        overflow: 'hidden', 
                        display: 'flex', 
                        justifyContent: 'center', 
                        alignItems: 'center',
                        background: '#0f111a',
                        marginBottom: '0.6rem'
                      }}>
                        <img 
                          src={`${BACKEND_URL}${img.url}`} 
                          alt={img.sku} 
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          loading="lazy"
                        />
                      </div>

                      <div style={{ width: '100%', textAlign: 'center', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem', display: 'block', color: 'white' }}>
                          {img.sku}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {img.filename.split('.').pop().toUpperCase()} file
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ================= SKU EXCEL MAPPINGS TAB ================= */}
        {activeTab === 'mappings' && (
          <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '1rem', height: '100%', overflow: 'hidden' }}>
            
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '1rem' }}>
              <div style={{ marginBottom: '1.2rem', flexShrink: 0 }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>Upload Mappings Excel</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1rem' }}>
                  Upload an Excel sheet (.xlsx) to map SKUs to product design names.
                </span>

                <label className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', cursor: 'pointer', padding: '0.7rem' }}>
                  <Upload size={16} /> {uploadingMappings ? "Parsing Excel..." : "Upload Spreadsheet"}
                  <input 
                    type="file" 
                    accept=".xlsx" 
                    onChange={handleMappingUpload} 
                    style={{ display: 'none' }} 
                    disabled={uploadingMappings}
                  />
                </label>

                {mappingUploadError && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    Error: {mappingUploadError}
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '0.8rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.3rem', flexShrink: 0 }}>
                Mapping Database Stats
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Total SKU Mappings</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'white', marginTop: '3px' }}>
                    {mappingStats.totalMappings.toLocaleString()} SKUs
                  </div>
                </div>

                {mappingStats.lastImport && (
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '5px' }}>Last Import Details</div>
                    <div style={{ fontWeight: 'bold', color: 'white', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={mappingStats.lastImport.filename}>
                      {mappingStats.lastImport.filename}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '3px' }}>
                      Imported: <strong>{mappingStats.lastImport.importedCount.toLocaleString()}</strong> rows
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      Date: {new Date(mappingStats.lastImport.uploadDate).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', margin: 0 }}>SKU to Product Design Directory</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Search SKU codes to see what Design Group and image they map to.
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="search"
                    className="input-field"
                    placeholder="Search SKU or Design Name..."
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    style={{ paddingLeft: '32px', width: '320px', paddingTop: '8px', paddingBottom: '8px' }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                {mappingsLoading ? (
                  <div style={{ color: 'var(--primary)', textAlign: 'center', padding: '4rem' }}>
                    Searching mappings database...
                  </div>
                ) : mappings.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '4rem 1rem' }}>
                    <FileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p>No mapping records found. Upload an Excel spreadsheet to map inventory.</p>
                  </div>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '0.6rem 0.5rem' }}>SKU Code (From Label)</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Mapped Product Design / Photo Name</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Last Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((m, index) => (
                          <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', height: '36px' }}>
                            <td style={{ padding: '0.5rem', fontWeight: 'bold' }}><code>{m.sku}</code></td>
                            <td style={{ padding: '0.5rem', color: 'var(--primary)', fontWeight: 'bold' }}>{m.designName}</td>
                            <td style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>
                              {m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Showing {mappings.length} of {mappingTotal.toLocaleString()} mappings
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          className="btn" 
                          disabled={mappingPage <= 1}
                          onClick={() => fetchMappings(mappingSearch, mappingPage - 1)}
                          style={{ padding: '0.3rem 0.6rem' }}
                        >
                          Prev
                        </button>
                        <span style={{ alignSelf: 'center', color: 'white', padding: '0 0.5rem' }}>
                          Page {mappingPage} of {Math.ceil(mappingTotal / 15) || 1}
                        </span>
                        <button 
                          className="btn" 
                          disabled={mappingPage >= Math.ceil(mappingTotal / 15)}
                          onClick={() => fetchMappings(mappingSearch, mappingPage + 1)}
                          style={{ padding: '0.3rem 0.6rem' }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

            </div>

          </div>
        )}

        {/* ================= MEESHO ORDER PDFS TAB ================= */}
        {activeTab === 'pdfs' && (
          <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '1rem', height: '100%', overflow: 'hidden' }}>
            
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '1rem' }}>
              <div style={{ marginBottom: '1.2rem', flexShrink: 0 }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>Upload Order PDF</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1rem' }}>
                  Upload printed shipping labels/invoice PDFs here to extract barcodes.
                </span>

                <label className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', cursor: 'pointer', padding: '0.7rem' }}>
                  <Upload size={16} /> {uploadingPdf ? "Parsing Label PDF..." : "Upload Label PDF"}
                  <input 
                    type="file" 
                    accept=".pdf" 
                    onChange={handlePdfUpload} 
                    style={{ display: 'none' }} 
                    disabled={uploadingPdf}
                  />
                </label>

                {pdfUploadError && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    Error: {pdfUploadError}
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.3rem', flexShrink: 0 }}>
                Uploaded PDF History ({orderPdfs.length})
              </h3>
              
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {orderPdfs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 1rem', fontSize: '0.85rem' }}>
                    No PDFs uploaded yet. Upload a Meesho order label PDF to begin.
                  </div>
                ) : (
                  orderPdfs.map((pdf, idx) => (
                    <div 
                      key={idx}
                      style={{ 
                        background: 'rgba(0,0,0,0.15)', 
                        padding: '0.7rem', 
                        borderRadius: '8px', 
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ maxWidth: '220px', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'white' }} title={pdf.name}>
                          {pdf.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Parsed: <strong style={{ color: 'var(--success)' }}>{pdf.ordersCount} orders</strong> | {(pdf.size / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                      <button 
                        onClick={() => deletePdf(pdf.name)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                        title="Delete PDF & parsed orders"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Imported Label Records</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Total active mappings in scanner database: <strong>{parsedOrders.length} barcodes</strong>
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="search"
                    className="input-field"
                    placeholder="Search Order No / AWB / SKU / Customer..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    style={{ paddingLeft: '32px', width: '320px', paddingTop: '8px', paddingBottom: '8px' }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                {ordersLoading ? (
                  <div style={{ color: 'var(--primary)', textAlign: 'center', padding: '4rem' }}>
                    Loading parsed orders database...
                  </div>
                ) : filteredOrders.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '4rem 1rem' }}>
                    <FileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p>No label records found. Upload Meesho PDFs to parse labels.</p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Order Number</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>AWB / Barcode</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>SKU</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Customer Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((order, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', height: '36px' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 'bold' }}><code>{order.orderId}</code></td>
                          <td style={{ padding: '0.5rem' }}><code>{order.awb}</code></td>
                          <td style={{ padding: '0.5rem', color: 'var(--primary)', fontWeight: 'bold' }}>{order.sku}</td>
                          <td style={{ padding: '0.5rem', color: 'white' }}>{order.customerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}

export default ScanPack;
