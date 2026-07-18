import { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, ExternalLink, RefreshCw, Search, CheckCircle } from 'lucide-react';
import { BACKEND_URL } from '../config';

function Notifications() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredErrors = errors
    .map((err, idx) => ({ ...err, originalIndex: idx }))
    .filter(err => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const botMatch = err.bot?.toLowerCase().includes(query);
      const accountMatch = err.account?.toLowerCase().includes(query);
      const skuMatch = err.sku?.toLowerCase().includes(query);
      const messageMatch = err.message?.toLowerCase().includes(query);
      const dateString = err.timestamp ? new Date(err.timestamp).toLocaleString().toLowerCase() : '';
      const dateMatch = dateString.includes(query);
      return botMatch || accountMatch || skuMatch || messageMatch || dateMatch;
    });

  const fetchErrors = () => {
    fetch(`${BACKEND_URL}/api/errors`)
      .then(res => res.json())
      .then(data => {
        setErrors(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching notifications:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const clearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all notifications?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/errors`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) setErrors([]);
    } catch (e) {
      console.error(e);
      alert("Failed to clear notifications");
    }
  };

  const deleteSingleError = async (index) => {
    if (!window.confirm("Are you sure you want to delete this notification?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/errors/${index}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setErrors(prev => prev.filter((_, i) => i !== index));
      }
    } catch (e) {
      console.error(e);
      alert("Failed to delete notification");
    }
  };

  if (loading) return <div className="glass-panel">Loading notifications...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Notifications
          {errors.length > 0 && (
            <span style={{ 
              background: errors.some(e => e.type !== 'success') ? 'var(--danger)' : 'var(--success)', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '12px', 
              fontSize: '0.9rem' 
            }}>
              {errors.length}
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', alignItems: "center", gap: "20px" }}>
          {errors.length > 0 && (
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <Search size={18} />
              </span>
              <input
                type="text"
                className="input-field"
                placeholder="Search by bot, account, SKU, message, or timestamp..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.75rem', paddingRight: searchQuery ? '2.5rem' : '1rem' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    lineHeight: 1
                  }}
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          )}
          {errors.length > 0 && (
            <button className="btn btn-danger" onClick={clearAll} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Trash2 size={16} /> Clear All
            </button>
          )}
        </div>
      </div>



      {errors.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <CheckCircle size={48} style={{ margin: '0 auto 1rem', opacity: 0.5, color: 'var(--success)' }} />
          <h3>No notifications found!</h3>
          <p>Your bots are running smoothly.</p>
        </div>
      ) : filteredErrors.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <Search size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3>No matching notifications found</h3>
          <p>Try refining your search query.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredErrors.map((err) => {
            const isSuccess = err.type === 'success';
            const borderCol = isSuccess ? 'var(--success)' : 'var(--danger)';
            const msgBg = isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,50,50,0.1)';
            return (
              <div key={err.originalIndex} className="glass-panel" style={{ borderLeft: `4px solid ${borderCol}`, display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{err.bot}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {new Date(err.timestamp).toLocaleString()}
                      </span>
                      <button
                        onClick={() => deleteSingleError(err.originalIndex)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0', display: 'flex' }}
                        title="Delete this notification"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                      Account: <strong>{err.account}</strong>
                    </span>
                    {err.sku && (
                      <span style={{ background: 'rgba(255,165,0,0.1)', color: 'orange', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: '600' }}>
                        SKU: {err.sku}
                      </span>
                    )}
                  </div>
                  <p style={{ 
                    color: 'var(--text-color)', 
                    background: msgBg, 
                    padding: '10px', 
                    borderRadius: '6px', 
                    fontSize: '0.95rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    {isSuccess ? (
                      <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    ) : (
                      <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    )}
                    <span>{err.message}</span>
                  </p>
                </div>

                {err.screenshot && (
                  <div
                    style={{ width: '150px', height: '100px', cursor: 'pointer', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}
                    onClick={() => setSelectedImage(`${BACKEND_URL}/error_screenshots/${err.screenshot}`)}
                  >
                    <img
                      src={`${BACKEND_URL}/error_screenshots/${err.screenshot}`}
                      alt="Error Screenshot"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: '0.75rem', textAlign: 'center', padding: '2px' }}>
                      Click to Enlarge
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem' }}
          onClick={() => setSelectedImage(null)}
        >
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
            <img src={selectedImage} alt="Full Error Screenshot" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', border: '2px solid var(--border-color)', borderRadius: '8px' }} />
            <a
              href={selectedImage}
              target="_blank"
              rel="noreferrer"
              style={{ position: 'absolute', top: '-40px', right: '0', color: 'white', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', background: 'var(--primary)', padding: '6px 12px', borderRadius: '4px' }}
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink size={16} /> Open in New Tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default Notifications;
