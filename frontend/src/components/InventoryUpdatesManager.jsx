import { useState, useEffect, useRef } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { Plus, Trash2, Save, Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { BACKEND_URL } from '../config';

// ── Excel preview modal ─────────────────────────────────────────────────────
function ExcelPreviewModal({ rows, mode, onConfirm, onCancel }) {
  const [importMode, setImportMode] = useState('replace');
  const label = mode === 'price' ? 'Price (₹)' : 'Stock';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem'
    }}>
      <div style={{
        background: 'var(--bg-dark)',
        border: '1px solid rgba(99,102,241,0.35)',
        borderRadius: '18px',
        padding: '2rem',
        width: '100%', maxWidth: '620px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: '1.25rem',
        maxHeight: '85vh'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileSpreadsheet size={22} color="#10b981" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              Import Preview &nbsp;<span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.9rem' }}>({rows.length} rows)</span>
            </h3>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Import mode */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: '10px',
          padding: '0.85rem 1rem', display: 'flex', gap: '1.25rem', alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', flexShrink: 0 }}>Import mode:</span>
          {['replace', 'append'].map(m => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="importMode"
                value={m}
                checked={importMode === m}
                onChange={() => setImportMode(m)}
                style={{ accentColor: 'var(--primary)' }}
              />
              <span>{m === 'replace' ? '🔄 Replace all existing' : '➕ Append to existing'}</span>
            </label>
          ))}
        </div>

        {/* Table preview */}
        <div style={{ overflowY: 'auto', maxHeight: '320px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'rgba(99,102,241,0.15)', position: 'sticky', top: 0 }}>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>#</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>SKU</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td style={{ padding: '0.5rem 1rem', fontFamily: 'monospace' }}>{r.sku}</td>
                  <td style={{ padding: '0.5rem 1rem', color: 'var(--success)' }}>{mode === 'price' ? r.price : r.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            onClick={onCancel}
            className="btn glass-panel"
            style={{ border: 'none', color: 'var(--text-muted)', padding: '0.65rem 1.4rem' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(rows, importMode)}
            className="btn"
            style={{ background: 'var(--success)', color: '#fff', padding: '0.65rem 1.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <CheckCircle2 size={16} /> Import {rows.length} Rows
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
function InventoryUpdatesManager() {
  const { type } = useParams();
  const mode = type === 'stock' ? 'stock' : 'price';
  const isPrice = mode === 'price';

  const [updates, setUpdates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notification, setNotification] = useState(null);

  // Excel upload state
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewRows, setPreviewRows] = useState(null); // null = no modal

    const showNotification = (msg, type = 'success') => {
      setNotification({ msg, type });
      setTimeout(() => {
        setNotification(null);
      }, 4000);
    };

    const fetchUpdates = () => {
      setLoading(true);
      setSelectedIds([]);
      const endpoint = isPrice ? '/api/inventory-updates' : '/api/inventory-stock-updates';
      fetch(`${BACKEND_URL}${endpoint}`)
        .then(res => res.json())
        .then(data => {
            const list = Array.isArray(data) ? data : [];
            const normalizedData = list.map((item, idx) => ({
              id: `db-${idx}-${Date.now()}-${Math.random()}`,
              sku: item.sku,
              value: mode === 'price' ? item.price : item.stock
            }));
            setUpdates(normalizedData);
        setLoading(false);
          })
            .catch(err => {
              console.error(err);
              showNotification("Failed to fetch inventory updates from server", "error");
              setLoading(false);
            });
  };

  useEffect(() => {
    setSearchTerm('');
    fetchUpdates();
  }, [mode]);

  const addUpdate = () => {
    const newItem = { id: `new-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, sku: '', value: '' };
    setUpdates(prev => [newItem, ...prev]);
  };

  const updateItem = (idOrIdx, field, value) => {
    setUpdates(prev => prev.map((item, idx) => (item.id === idOrIdx || idx === idOrIdx) ? { ...item, [field]: value } : item));
  };

  const removeUpdate = (index) => {
    const target = updates[index];
    if (target) setSelectedIds(prev => prev.filter(id => id !== target.id));
    setUpdates(updates.filter((_, i) => i !== index));
  };

  const toggleSelectUpdate = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? updates.map(u => u.id) : []);
  };

  const deleteSelected = () => {
    if (!window.confirm(`Are you sure you want to delete the ${selectedIds.length} selected items?`)) return;
    setUpdates(updates.filter(u => !selectedIds.includes(u.id)));
    setSelectedIds([]);
    showNotification(`Deleted ${selectedIds.length} items`);
  };

  const clearAll = () => {
    if (updates.length === 0) return;
    if (!window.confirm(`Are you sure you want to clear all ${updates.length} items?`)) return;
    setUpdates([]);
    setSelectedIds([]);
    showNotification("All items cleared from table");
  };

  const saveUpdates = async (overrideUpdates = null) => {
    try {
      const endpoint = mode === 'price' ? '/api/inventory-updates' : '/api/inventory-stock-updates';
      const payload = updates
      .filter(u => u.sku && u.value !== '' && u.value !== undefined && u.value !== null)
    .map(u => isPrice ? { sku: String(u.sku).trim(), price: String(u.value).trim() } : { sku: String(u.sku).trim(), stock: String(u.value).trim() });

  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: payload })
  });
  const data = await res.json();
  if (data.success) alert(`${mode === 'price' ? 'Price' : 'Stock'} updates saved successfully!`);
} catch (e) {
  console.error(e);
  alert('Failed to save inventory updates');
}
};

// ── Excel upload handlers ─────────────────────────────────────────────────
const handleExcelFileChange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setUploadError('');
  setUploading(true);
  try {
    const formData = new FormData();
    formData.append('file', file);
    const endpoint = mode === 'price' ? '/api/inventory-updates/upload' : '/api/inventory-stock-updates/upload';
    const res = await fetch(`${BACKEND_URL}${endpoint}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
    if (data.rows.length === 0) {
      setUploadError('No valid rows found. Make sure your Excel has "SKU" and "' + (mode === 'price' ? 'Price' : 'Stock') + '" columns.');
    } else {
      setPreviewRows(data.rows);
    }
  } catch (err) {
    setUploadError(err.message);
  } finally {
    setUploading(false);
    // Reset the file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};

const handleImportConfirm = (rows, importMode) => {
  const normalized = rows.map(r => ({
    id: `xl-${Date.now()}-${Math.random()}`,
    sku: r.sku,
    value: mode === 'price' ? r.price : r.stock
  }));
  if (importMode === 'replace') {
    setUpdates(normalized);
    setSelectedIds([]);
  } else {
    setUpdates(prev => [...prev, ...normalized]);
  }
  setPreviewRows(null);
};

// ── Download template ─────────────────────────────────────────────────────
const downloadTemplate = () => {
  const valueCol = mode === 'price' ? 'Price' : 'Stock';
  const csv = `SKU,${valueCol}\nisr_001,299\nisr_002,399\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_${mode}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

if (loading) return <div className="glass-panel">Loading inventory updates...</div>;

return (
  <>
    {previewRows && (
      <ExcelPreviewModal
        rows={previewRows}
        mode={mode}
        onConfirm={handleImportConfirm}
        onCancel={() => setPreviewRows(null)}
      />
    )}

    <div className="glass-panel">
      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <NavLink
          to="/inventory-updates/price"
          className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
          style={mode !== 'price' ? { border: 'none', color: 'var(--text-muted)' } : {}}
        >
          Price Updates
        </NavLink>
        <NavLink
          to="/inventory-updates/stock"
          className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
          style={mode !== 'stock' ? { border: 'none', color: 'var(--text-muted)' } : {}}
        >
          Stock Updates
        </NavLink>
      </div>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>{mode === 'price' ? 'Inventory Price Updates' : 'Inventory Stock Updates'}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Set the SKU and new {mode === 'price' ? 'prices' : 'stock quantities'} for the &ldquo;{mode === 'price' ? 'Inventory Price Update' : 'Inventory Stock Update'}&rdquo; bot.
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedIds.length > 0 && (
            <button
              className="btn btn-danger"
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.75rem 1.5rem' }}
              onClick={deleteSelected}
            >
              <Trash2 size={16} /> Delete Selected ({selectedIds.length})
            </button>
          )}

          {/* Download template */}
          <button
            className="btn glass-panel"
            title="Download Excel template"
            onClick={downloadTemplate}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.7rem 1.1rem', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.88rem' }}
          >
            <Download size={15} /> Template
          </button>

          {/* Upload Excel */}
          <div style={{ position: 'relative' }}>
            <input
              ref={fileInputRef}
              id="excel-upload-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleExcelFileChange}
            />
            <button
              className="btn"
              id="excel-upload-btn"
              style={{
                background: uploading
                  ? 'rgba(16,185,129,0.25)'
                  : 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(16,185,129,0.45)',
                color: '#10b981',
                display: 'flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.7rem 1.25rem',
                transition: 'all 0.2s',
                opacity: uploading ? 0.7 : 1,
                cursor: uploading ? 'not-allowed' : 'pointer'
              }}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? <><span style={{ width: 14, height: 14, border: '2px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} /> Uploading…</>
                : <><Upload size={15} /> Upload Excel</>
              }
            </button>
          </div>

          <button className="btn btn-primary" onClick={addUpdate}>
            <Plus size={16} /> Add SKU
          </button>
          <button className="btn" style={{ background: 'var(--success)', color: 'white' }} onClick={saveUpdates}>
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>

      {/* Upload error banner */}
      {uploadError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.25rem',
          color: '#ef4444', fontSize: '0.9rem'
        }}>
          <AlertCircle size={16} /> {uploadError}
          <button onClick={() => setUploadError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Excel format hint */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: '10px', padding: '0.65rem 1rem', marginBottom: '1.25rem',
        color: 'var(--text-muted)', fontSize: '0.82rem'
      }}>
        <FileSpreadsheet size={14} color="var(--primary)" />
        Excel format: columns &nbsp;<code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', color: 'var(--text-main)' }}>SKU</code>
        &nbsp;and&nbsp;
        <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', color: 'var(--text-main)' }}>{mode === 'price' ? 'Price' : 'Stock'}</code>
        &nbsp;· Supports .xlsx / .xls / .csv
      </div>

      {/* Table */}
      <div style={{ maxHeight: '540px', overflowY: 'auto', paddingRight: '0.5rem' }}>
        <table className="accounts-table" style={{ marginTop: 0 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                  checked={updates.length > 0 && updates.every(u => selectedIds.includes(u.id))}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  title="Select all"
                />
              </th>
              <th style={{ width: '45%' }}>SKU (Style ID)</th>
              <th style={{ width: '35%' }}>{mode === 'price' ? 'New Meesho Price (₹)' : 'New Stock Quantity'}</th>
              <th style={{ width: '15%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {updates.map((update, idx) => {
              const isSelected = selectedIds.includes(update.id);
              return (
                <tr key={update.id || idx}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                      checked={isSelected}
                      onChange={() => toggleSelectUpdate(update.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input-field"
                      style={{ width: '100%', fontFamily: 'monospace' }}
                      value={update.sku}
                      onChange={(e) => updateItem(idx, 'sku', e.target.value)}
                      placeholder="e.g. SKU-12345"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '100%' }}
                      value={update.value}
                      onChange={(e) => updateItem(idx, 'value', e.target.value)}
                      placeholder={mode === 'price' ? 'e.g. 299' : 'e.g. 50'}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '0.5rem', display: 'inline-flex' }}
                      onClick={() => removeUpdate(idx)}
                      title="Remove Item"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {updates.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  No SKUs added yet. Add one manually or upload an Excel file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* Spinner keyframe */}
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </>
);
}

export default InventoryUpdatesManager;
