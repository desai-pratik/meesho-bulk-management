import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Tags } from 'lucide-react';

function InventoryUpdatesManager() {
  const [mode, setMode] = useState('price'); // 'price' or 'stock'
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const endpoint = mode === 'price' ? '/api/inventory-updates' : '/api/inventory-stock-updates';
    fetch(`http://localhost:3001${endpoint}`)
      .then(res => res.json())
      .then(data => {
        // Normalize the data so it always uses 'value' for the input field
        const normalizedData = data.map(item => ({
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
    setUpdates([...updates, { sku: '', value: '' }]);
  };

  const updateItem = (index, field, value) => {
    const newUpdates = [...updates];
    newUpdates[index][field] = value;
    setUpdates(newUpdates);
  };

  const removeUpdate = (index) => {
    const newUpdates = updates.filter((_, i) => i !== index);
    setUpdates(newUpdates);
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
        <button 
          className={`btn ${mode === 'price' ? 'btn-primary' : 'glass-panel'}`}
          style={mode !== 'price' ? { border: 'none', color: 'var(--text-muted)' } : {}}
          onClick={() => setMode('price')}
        >
          Price Updates
        </button>
        <button 
          className={`btn ${mode === 'stock' ? 'btn-primary' : 'glass-panel'}`}
          style={mode !== 'stock' ? { border: 'none', color: 'var(--text-muted)' } : {}}
          onClick={() => setMode('stock')}
        >
          Stock Updates
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
            <h2 style={{ fontSize: '1.4rem' }}>{mode === 'price' ? 'Inventory Price Updates' : 'Inventory Stock Updates'}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Set the SKU and new {mode === 'price' ? 'prices' : 'stock quantities'} for the "{mode === 'price' ? 'Inventory Price Update' : 'Inventory Stock Update'}" bot.
            </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-primary" onClick={addUpdate}>
            <Plus size={16} /> Add SKU
          </button>
          <button className="btn" style={{ background: 'var(--success)', color: 'white' }} onClick={saveUpdates}>
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>

      <table className="accounts-table">
        <thead>
          <tr>
            <th style={{ width: '50%' }}>SKU (Style ID)</th>
            <th style={{ width: '30%' }}>{mode === 'price' ? 'New Meesho Price (₹)' : 'New Stock Quantity'}</th>
            <th style={{ width: '20%', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {updates.map((update, idx) => (
            <tr key={idx}>
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
          ))}
          {updates.length === 0 && (
            <tr>
              <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                No SKUs added yet. Add one to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default InventoryUpdatesManager;
