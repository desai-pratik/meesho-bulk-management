import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Save,
  FileSpreadsheet,
  Download,
  UploadCloud,
  Search,
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Layers,
  FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { BACKEND_URL } from '../config';

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

  // Excel Modal State
  const [excelModal, setExcelModal] = useState(null); // { filename, items: [], importMode: 'replace', autoSave: false }
  const fileInputRef = useRef(null);

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
        const normalizedData = (Array.isArray(data) ? data : []).map((item, idx) => ({
          id: `db-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sku: item.sku || '',
          value: isPrice ? (item.price !== undefined ? String(item.price) : '') : (item.stock !== undefined ? String(item.stock) : '')
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

  const updateItem = (id, field, value) => {
    setUpdates(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const removeUpdate = (id) => {
    setSelectedIds(prev => prev.filter(selId => selId !== id));
    setUpdates(prev => prev.filter(item => item.id !== id));
  };

  const toggleSelectUpdate = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(filteredUpdates.map(u => u.id));
    } else {
      setSelectedIds([]);
    }
  };

  const deleteSelected = () => {
    if (!window.confirm(`Are you sure you want to delete the ${selectedIds.length} selected items?`)) return;
    setUpdates(prev => prev.filter(u => !selectedIds.includes(u.id)));
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
      setSaving(true);
      const targetUpdates = overrideUpdates || updates;
      const endpoint = isPrice ? '/api/inventory-updates' : '/api/inventory-stock-updates';
      const payload = targetUpdates
        .filter(u => u.sku && u.value)
        .map(u => isPrice ? { sku: u.sku.trim(), price: u.value.trim() } : { sku: u.sku.trim(), stock: u.value.trim() });

      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: payload })
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`${isPrice ? 'Price' : 'Stock'} updates (${payload.length} items) saved successfully!`);
      } else {
        showNotification(data.error || "Failed to save", "error");
      }
    } catch (e) {
      console.error(e);
      showNotification("Failed to save inventory updates", "error");
    } finally {
      setSaving(false);
    }
  };

  // --- EXCEL PARSING LOGIC ---
  const parseExcel = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) {
            return reject(new Error("No sheet found in Excel file"));
          }

          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!rows || rows.length === 0) {
            return reject(new Error("Excel sheet is empty"));
          }

          let skuColIdx = -1;
          let valColIdx = -1;
          let startRowIdx = 0;

          // Check top 5 rows for header names
          for (let r = 0; r < Math.min(5, rows.length); r++) {
            const row = rows[r];
            if (!Array.isArray(row)) continue;

            for (let c = 0; c < row.length; c++) {
              const cellStr = String(row[c] || '').trim().toLowerCase();
              if (
                skuColIdx === -1 &&
                (cellStr.includes('sku') || cellStr.includes('style') || cellStr.includes('item') || cellStr.includes('product') || cellStr.includes('code') || cellStr === 'id')
              ) {
                skuColIdx = c;
              }
              if (valColIdx === -1) {
                if (isPrice) {
                  if (cellStr.includes('price') || cellStr.includes('mrp') || cellStr.includes('rate') || cellStr.includes('cost') || cellStr.includes('amount') || cellStr.includes('₹')) {
                    valColIdx = c;
                  }
                } else {
                  if (cellStr.includes('stock') || cellStr.includes('qty') || cellStr.includes('quantity') || cellStr.includes('count') || cellStr.includes('unit') || cellStr.includes('inventory')) {
                    valColIdx = c;
                  }
                }
              }
            }

            if (skuColIdx !== -1 && valColIdx !== -1) {
              startRowIdx = r + 1;
              break;
            }
          }

          if (skuColIdx === -1) skuColIdx = 0;
          if (valColIdx === -1) valColIdx = (skuColIdx === 0 ? 1 : 0);

          const parsedItems = [];
          const seenSkus = new Set();

          for (let r = startRowIdx; r < rows.length; r++) {
            const row = rows[r];
            if (!Array.isArray(row) || row.length === 0) continue;

            let rawSku = String(row[skuColIdx] || '').trim();
            let rawVal = row[valColIdx];

            if (!rawSku) continue;

            // Skip header if header was accidentally treated as data
            const lowerSku = rawSku.toLowerCase();
            if (lowerSku === 'sku' || lowerSku === 'style id' || lowerSku === 'style_id' || lowerSku === 'item' || lowerSku === 'product sku') {
              continue;
            }

            let cleanedVal = String(rawVal !== undefined && rawVal !== null ? rawVal : '').trim();
            cleanedVal = cleanedVal.replace(/[₹$,\s]/g, '');
            if (cleanedVal === '' || isNaN(Number(cleanedVal))) {
              continue;
            }

            const numVal = Math.round(Number(cleanedVal));
            if (numVal < 0) continue;

            if (!seenSkus.has(rawSku)) {
              seenSkus.add(rawSku);
              parsedItems.push({
                id: `upload-${r}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                sku: rawSku,
                value: String(numVal)
              });
            }
          }

          resolve(parsedItems);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsedItems = await parseExcel(file);
      if (parsedItems.length === 0) {
        alert("No valid SKU rows found in the selected Excel file. Please ensure columns include SKU and " + (isPrice ? "Price" : "Stock Quantity") + ".");
        return;
      }

      setExcelModal({
        filename: file.name,
        fileSize: (file.size / 1024).toFixed(1) + ' KB',
        items: parsedItems,
        importMode: updates.length > 0 ? 'replace' : 'replace',
        autoSave: false
      });
    } catch (err) {
      console.error(err);
      alert("Failed to parse Excel file: " + err.message);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmImport = async () => {
    if (!excelModal || !excelModal.items.length) return;

    let finalUpdates = [];
    if (excelModal.importMode === 'replace') {
      finalUpdates = excelModal.items;
    } else {
      // Append / Merge: update existing SKUs, append new SKUs
      const existingMap = new Map();
      updates.forEach(u => {
        if (u.sku) existingMap.set(u.sku.trim().toLowerCase(), u);
      });

      excelModal.items.forEach(newItem => {
        const key = newItem.sku.trim().toLowerCase();
        if (existingMap.has(key)) {
          const old = existingMap.get(key);
          existingMap.set(key, { ...old, value: newItem.value });
        } else {
          existingMap.set(key, newItem);
        }
      });

      finalUpdates = Array.from(existingMap.values());
    }

    setUpdates(finalUpdates);
    setSelectedIds([]);

    if (excelModal.autoSave) {
      await saveUpdates(finalUpdates);
    } else {
      showNotification(`Imported ${excelModal.items.length} items into table. Click "Save Changes" to store permanently.`);
    }

    setExcelModal(null);
  };

  // --- DOWNLOAD SAMPLE TEMPLATE ---
  const handleDownloadTemplate = () => {
    const sampleHeaders = isPrice
      ? [['SKU (Style ID)', 'New Meesho Price (₹)'], ['isr_2917', 449], ['isr_2921', 449], ['isr_2887', 399], ['isr_2890', 449], ['isr_2902', 499]]
      : [['SKU (Style ID)', 'New Stock Quantity'], ['isr_2917', 50], ['isr_2921', 100], ['isr_2887', 0], ['isr_2890', 25], ['isr_2902', 10]];

    const ws = XLSX.utils.aoa_to_sheet(sampleHeaders);
    ws['!cols'] = [{ wch: 25 }, { wch: 25 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isPrice ? 'Price_Updates' : 'Stock_Updates');
    XLSX.writeFile(wb, `meesho_${mode}_sample_template.xlsx`);
  };

  // --- EXPORT TO EXCEL ---
  const handleExportExcel = () => {
    if (updates.length === 0) {
      alert("No data available to export.");
      return;
    }

    const exportData = updates
      .filter(u => u.sku)
      .map(u => ({
        'SKU (Style ID)': u.sku,
        [isPrice ? 'New Meesho Price (₹)' : 'New Stock Quantity']: Number(u.value) || u.value
      }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [{ wch: 25 }, { wch: 25 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isPrice ? 'Price_Updates' : 'Stock_Updates');
    XLSX.writeFile(wb, `meesho_${mode}_updates_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Filter updates by search term
  const filteredUpdates = useMemo(() => {
    if (!searchTerm.trim()) return updates;
    const term = searchTerm.toLowerCase();
    return updates.filter(u => u.sku.toLowerCase().includes(term) || String(u.value).includes(term));
  }, [updates, searchTerm]);

  if (loading) {
    return (
      <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '0.75rem' }}>
        <RefreshCw size={24} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
        <span>Loading {mode} inventory updates...</span>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ position: 'relative' }}>
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx, .xls, .csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            background: notification.type === 'error' ? 'var(--danger)' : 'var(--success)',
            color: 'white',
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 500,
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          {notification.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
          {notification.msg}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <NavLink
          to="/inventory-updates/price"
          className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
          style={!isPrice ? { border: 'none', color: 'var(--text-muted)' } : {}}
        >
          Price Updates
        </NavLink>
        <NavLink
          to="/inventory-updates/stock"
          className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
          style={isPrice ? { border: 'none', color: 'var(--text-muted)' } : {}}
        >
          Stock Updates
        </NavLink>
      </div>

      {/* Header and Action Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600 }}>
              {isPrice ? 'Inventory Price Updates' : 'Inventory Stock Updates'}
            </h2>
            <span
              style={{
                background: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                padding: '0.2rem 0.6rem',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: 600
              }}
            >
              {updates.length} SKUs
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
            Set the SKU and new {isPrice ? 'prices' : 'stock quantities'} for the "{isPrice ? 'Inventory Price Update' : 'Inventory Stock Update'}" bot, or upload via Excel.
          </p>
        </div>

        {/* Top Actions */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Upload Excel Button */}
          <button
            className="btn"
            style={{
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: 'white',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
              padding: '0.65rem 1.1rem'
            }}
            onClick={() => fileInputRef.current?.click()}
            title="Upload Excel or CSV file"
          >
            <FileSpreadsheet size={16} /> Upload Excel
          </button>

          {/* Sample Template */}
          <button
            className="btn glass-panel"
            style={{ padding: '0.65rem 0.9rem', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
            onClick={handleDownloadTemplate}
            title="Download Sample Excel Template"
          >
            <Download size={15} /> Sample Template
          </button>

          {/* Export Excel */}
          {updates.length > 0 && (
            <button
              className="btn glass-panel"
              style={{ padding: '0.65rem 0.9rem', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
              onClick={handleExportExcel}
              title="Export Current List to Excel"
            >
              <FileText size={15} /> Export
            </button>
          )}

          {/* Add SKU */}
          <button className="btn btn-primary" style={{ padding: '0.65rem 1.1rem' }} onClick={addUpdate}>
            <Plus size={16} /> Add SKU
          </button>

          {/* Save Changes */}
          <button
            className="btn"
            style={{ background: 'var(--success)', color: 'white', padding: '0.65rem 1.25rem', opacity: saving ? 0.7 : 1 }}
            onClick={() => saveUpdates()}
            disabled={saving}
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Sub-bar: Search Filter & Batch Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="input-field"
            placeholder={`Search ${updates.length} SKUs or values...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', paddingLeft: '36px', paddingRight: searchTerm ? '32px' : '12px', paddingTop: '8px', paddingBottom: '8px' }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          {selectedIds.length > 0 && (
            <button
              className="btn btn-danger"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
              onClick={deleteSelected}
            >
              <Trash2 size={15} /> Delete Selected ({selectedIds.length})
            </button>
          )}

          {updates.length > 0 && (
            <button
              className="btn"
              style={{ background: 'rgba(239, 68, 68, 0.08)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
              onClick={clearAll}
              title="Clear all SKUs from table"
            >
              Clear All
            </button>
          )}

          {searchTerm && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Showing {filteredUpdates.length} of {updates.length}
            </span>
          )}
        </div>
      </div>

      {/* Table Container */}
      <div style={{ maxHeight: '580px', overflowY: 'auto', paddingRight: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <table className="accounts-table" style={{ marginTop: 0 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                  checked={filteredUpdates.length > 0 && filteredUpdates.every(u => selectedIds.includes(u.id))}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  title="Select all visible"
                />
              </th>
              <th style={{ width: '45%' }}>SKU (Style ID)</th>
              <th style={{ width: '35%' }}>{isPrice ? 'New Meesho Price (₹)' : 'New Stock Quantity'}</th>
              <th style={{ width: '15%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUpdates.map((update, idx) => {
              const isSelected = selectedIds.includes(update.id);
              return (
                <tr key={update.id || idx} style={{ background: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'transparent' }}>
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
                      onChange={(e) => updateItem(update.id, 'sku', e.target.value)}
                      placeholder="e.g. SKU-12345"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '100%' }}
                      value={update.value}
                      onChange={(e) => updateItem(update.id, 'value', e.target.value)}
                      placeholder={isPrice ? 'e.g. 299' : 'e.g. 50'}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '0.45rem', display: 'inline-flex' }}
                      onClick={() => removeUpdate(update.id)}
                      title="Remove Item"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredUpdates.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                    <FileSpreadsheet size={36} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                    <p style={{ fontSize: '1rem', fontWeight: 500 }}>
                      {searchTerm ? 'No matching SKUs found for your search.' : 'No SKUs configured yet.'}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Click <strong>"Upload Excel"</strong> to import in bulk, or <strong>"+ Add SKU"</strong> to add manually.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }} onClick={() => fileInputRef.current?.click()}>
                        <UploadCloud size={16} /> Upload Excel
                      </button>
                      <button className="btn glass-panel" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }} onClick={handleDownloadTemplate}>
                        <Download size={16} /> Download Template
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* EXCEL IMPORT CONFIRMATION & PREVIEW MODAL */}
      {excelModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '650px',
              background: '#151824',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              padding: '1.75rem',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', padding: '0.5rem', borderRadius: '8px' }}>
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Excel Import Preview</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {excelModal.filename} ({excelModal.fileSize})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setExcelModal(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.4rem' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.25rem' }}>
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  padding: '0.85rem 1rem',
                  borderRadius: '10px',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong style={{ color: 'var(--primary)', fontSize: '0.95rem' }}>
                    Successfully parsed {excelModal.items.length} {isPrice ? 'prices' : 'stock records'}
                  </strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    Target: {isPrice ? 'Inventory Price Update' : 'Inventory Stock Update'}
                  </div>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {excelModal.items.length} Rows
                </span>
              </div>

              {/* Import Mode Selector */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Import Mode:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div
                    onClick={() => setExcelModal({ ...excelModal, importMode: 'replace' })}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      border: excelModal.importMode === 'replace' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                      background: excelModal.importMode === 'replace' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem' }}>
                      <input
                        type="radio"
                        checked={excelModal.importMode === 'replace'}
                        onChange={() => {}}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      Replace All
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem', paddingLeft: '1.4rem' }}>
                      Clears current table ({updates.length} items) and sets only the {excelModal.items.length} Excel items.
                    </p>
                  </div>

                  <div
                    onClick={() => setExcelModal({ ...excelModal, importMode: 'append' })}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      border: excelModal.importMode === 'append' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                      background: excelModal.importMode === 'append' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem' }}>
                      <input
                        type="radio"
                        checked={excelModal.importMode === 'append'}
                        onChange={() => {}}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      Append & Merge
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem', paddingLeft: '1.4rem' }}>
                      Updates matching SKUs and adds new ones into the current list.
                    </p>
                  </div>
                </div>
              </div>

              {/* Sample Preview Table */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Data Preview (First {Math.min(5, excelModal.items.length)} of {excelModal.items.length} rows):
                </div>
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <table className="accounts-table" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                    <thead style={{ background: 'var(--bg-dark)' }}>
                      <tr>
                        <th style={{ width: '10%', padding: '0.35rem 0.6rem' }}>#</th>
                        <th style={{ width: '55%', padding: '0.35rem 0.6rem' }}>SKU (Style ID)</th>
                        <th style={{ width: '35%', padding: '0.35rem 0.6rem' }}>{isPrice ? 'Price (₹)' : 'Stock Quantity'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelModal.items.slice(0, 5).map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ color: 'var(--text-muted)', padding: '0.35rem 0.6rem' }}>{idx + 1}</td>
                          <td style={{ fontFamily: 'monospace', padding: '0.35rem 0.6rem' }}>{item.sku}</td>
                          <td style={{ fontWeight: 600, color: 'var(--success)', padding: '0.35rem 0.6rem' }}>
                            {isPrice ? `₹${item.value}` : item.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Auto Save Option */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={excelModal.autoSave}
                  onChange={(e) => setExcelModal({ ...excelModal, autoSave: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <span>Save directly to database on import (Skip clicking "Save Changes")</span>
              </label>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn glass-panel" onClick={() => setExcelModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', padding: '0.7rem 1.5rem' }}
                onClick={handleConfirmImport}
              >
                <Check size={16} /> Confirm Import ({excelModal.items.length} Items)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryUpdatesManager;
