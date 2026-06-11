import { useState, useEffect } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { Plus, Trash2, Save, Tags } from 'lucide-react';

function InventoryUpdatesManager() {
  const { type } = useParams();
  const mode = type === 'stock' ? 'stock' : 'price';
  const [updates, setUpdates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setSelectedIds([]);
    const endpoint = mode === 'price' ? '/api/inventory-updates' : '/api/inventory-stock-updates';
    fetch(`http://localhost:3001${endpoint}`)
      .then(res => res.json())
      .then(data => {
        // Normalize the data so it always uses 'value' for the input field
        const normalizedData = data.map((item, idx) => ({
          id: `db-${idx}-${Date.now()}-${Math.random()}`,
          sku: item.sku,
          value: mode === 'price' ? item.price : item.stock
        }));
        setUpdates(normalizedData);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [mode]);

  const addUpdate = () => {
    setUpdates([...updates, { id: `new-${Date.now()}-${Math.random()}`, sku: '', value: '' }]);
  };

  const updateItem = (index, field, value) => {
    const newUpdates = [...updates];
    newUpdates[index][field] = value;
    setUpdates(newUpdates);
  };

  const removeUpdate = (index) => {
    const target = updates[index];
    if (target) {
      setSelectedIds(prev => prev.filter(id => id !== target.id));
    }
    const newUpdates = updates.filter((_, i) => i !== index);
    setUpdates(newUpdates);
  };

  const toggleSelectUpdate = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(updates.map(u => u.id));
    } else {
      setSelectedIds([]);
    }
  };

  const deleteSelected = () => {
    if (!window.confirm(`Are you sure you want to delete the ${selectedIds.length} selected items?`)) return;
    const newUpdates = updates.filter(u => !selectedIds.includes(u.id));
    setUpdates(newUpdates);
    setSelectedIds([]);
  };

  const saveUpdates = async () => {
    try {
      const endpoint = mode === 'price' ? '/api/inventory-updates' : '/api/inventory-stock-updates';
      // Map 'value' back to 'price' or 'stock'
      const payload = updates
        .filter(u => u.sku && u.value)
        .map(u => mode === 'price' ? { sku: u.sku, price: u.value } : { sku: u.sku, stock: u.value });

      const res = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: payload })
      });
      const data = await res.json();
      if (data.success) {
        alert(`${mode === 'price' ? 'Price' : 'Stock'} updates saved successfully!`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save inventory updates");
    }
  };

  if (loading) return <div className="glass-panel">Loading inventory updates...</div>;

  return (
    <div className="glass-panel">
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>{mode === 'price' ? 'Inventory Price Updates' : 'Inventory Stock Updates'}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Set the SKU and new {mode === 'price' ? 'prices' : 'stock quantities'} for the "{mode === 'price' ? 'Inventory Price Update' : 'Inventory Stock Update'}" bot.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {selectedIds.length > 0 && (
            <button
              className="btn btn-danger"
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.75rem 1.5rem' }}
              onClick={deleteSelected}
            >
              <Trash2 size={16} /> Delete Selected ({selectedIds.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={addUpdate}>
            <Plus size={16} /> Add SKU
          </button>
          <button className="btn" style={{ background: 'var(--success)', color: 'white' }} onClick={saveUpdates}>
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>

      <div style={{ maxHeight: '608px', overflowY: 'auto', paddingRight: '0.5rem' }}>
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
                  No SKUs added yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default InventoryUpdatesManager;
