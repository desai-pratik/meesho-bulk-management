import { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, ExternalLink, Search, CheckCircle } from 'lucide-react';
import { BACKEND_URL } from '../config';

const LOCAL_STORAGE_KEY = 'meesho_notifications';

function Notifications({ socket }) {
  const [errors, setErrors] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { }
    return [];
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'error', 'success'

  const totalErrorsCount = errors.filter(e => e.type !== 'success').length;
  const totalSuccessCount = errors.filter(e => e.type === 'success').length;

  const filteredErrors = errors
    .filter(err => {
      if (activeTab === 'error') return err.type !== 'success';
      if (activeTab === 'success') return err.type === 'success';
      return true;
    })
    .filter(err => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const botMatch = err.bot?.toLowerCase().includes(query);
      const accountMatch = err.account?.toLowerCase().includes(query);
      const skuMatch = err.sku?.toLowerCase().includes(query);
      const fileMatch = err.file?.toLowerCase().includes(query);
      const messageMatch = err.message?.toLowerCase().includes(query);
      const dateString = err.timestamp ? new Date(err.timestamp).toLocaleString().toLowerCase() : '';
      const dateMatch = dateString.includes(query);
      return botMatch || accountMatch || skuMatch || fileMatch || messageMatch || dateMatch;
    });

  const saveToLocal = (newErrors) => {
    setErrors(newErrors);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newErrors));
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (e) {
      console.error("Failed to save notifications to localStorage:", e);
    }
  };

  const fetchBackendNotifications = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications`);
      const data = await res.json();
      if (Array.isArray(data)) {
        saveToLocal(data);
      }
    } catch (e) {
      console.error("Failed to fetch notifications from backend:", e);
    }
  };

  useEffect(() => {
    // Initial fetch on mount
    fetchBackendNotifications();

    // Re-fetch whenever tab becomes visible or window gains focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchBackendNotifications();
      }
    };
    const handleFocus = () => {
      fetchBackendNotifications();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen to real-time socket events for live incoming notifications
    if (socket) {
      const handleNewNotification = (notif) => {
        if (!notif || typeof notif !== 'object') return;
        setErrors(prev => {
          const updated = [notif, ...prev.filter(n => n.id !== notif.id)].slice(0, 500);
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
            window.dispatchEvent(new Event('notifications-updated'));
          } catch (e) { }
          return updated;
        });
      };

      const handleCleared = () => {
        setErrors([]);
        try {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          window.dispatchEvent(new Event('notifications-updated'));
        } catch (e) { }
      };

      const handleDeleted = (data) => {
        if (data && data.id) {
          setErrors(prev => {
            const updated = prev.filter(n => n.id !== data.id);
            try {
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
              window.dispatchEvent(new Event('notifications-updated'));
            } catch (e) { }
            return updated;
          });
        }
      };

      socket.on('notification', handleNewNotification);
      socket.on('notifications-cleared', handleCleared);
      socket.on('notification-deleted', handleDeleted);
      socket.on('connect', fetchBackendNotifications);

      return () => {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        socket.off('notification', handleNewNotification);
        socket.off('notifications-cleared', handleCleared);
        socket.off('notification-deleted', handleDeleted);
        socket.off('connect', fetchBackendNotifications);
      };
    }

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [socket]);

  // Sync with localStorage if updated in another tab or component
  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setErrors(parsed);
        } else {
          setErrors([]);
        }
      } catch (e) { }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('notifications-updated', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('notifications-updated', handleStorageChange);
    };
  }, []);

  const clearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all notifications?")) return;
    try {
      await fetch(`${BACKEND_URL}/api/notifications`, { method: 'DELETE' });
    } catch (e) {
      console.error("Failed to delete notifications on server:", e);
    }
    saveToLocal([]);
  };

  const deleteSingleError = async (err, originalIdx) => {
    if (err.id) {
      try {
        await fetch(`${BACKEND_URL}/api/notifications/${err.id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Failed to delete notification on server:", e);
      }
    }
    const updated = errors.filter((e, idx) => (err.id ? e.id !== err.id : idx !== originalIdx));
    saveToLocal(updated);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            Notifications
            {errors.length > 0 && (
              <span style={{
                background: totalErrorsCount > 0 ? 'var(--danger)' : 'var(--success)',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.9rem'
              }}>
                {errors.length}
              </span>
            )}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Persistently saved in Database & Synced Live
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: "center", gap: "12px", flexWrap: 'wrap' }}>
          {/* Tab Filter */}
          <div style={{ display: 'flex', background: 'var(--bg-dark)', borderRadius: '6px', padding: '3px', border: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setActiveTab('all')}
              style={{
                background: activeTab === 'all' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'all' ? 'white' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              All ({errors.length})
            </button>
            <button
              onClick={() => setActiveTab('error')}
              style={{
                background: activeTab === 'error' ? 'var(--danger)' : 'transparent',
                color: activeTab === 'error' ? 'white' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Errors ({totalErrorsCount})
            </button>
            <button
              onClick={() => setActiveTab('success')}
              style={{
                background: activeTab === 'success' ? 'var(--success)' : 'transparent',
                color: activeTab === 'success' ? 'white' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Success ({totalSuccessCount})
            </button>
          </div>

          {errors.length > 0 && (
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <Search size={16} />
              </span>
              <input
                type="text"
                className="input-field"
                placeholder="Search bot, account, SKU, file..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.5rem', paddingRight: searchQuery ? '2.5rem' : '1rem', width: '220px' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
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
          <h3>No notifications in local storage</h3>
          <p>Bot notifications will appear here live when bots run.</p>
        </div>
      ) : filteredErrors.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <Search size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3>No matching notifications found</h3>
          <p>Try switching tabs or refining your search query.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredErrors.map((err, idx) => {
            const isSuccess = err.type === 'success';
            const borderCol = isSuccess ? 'var(--success)' : 'var(--danger)';
            const msgBg = isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,50,50,0.1)';
            return (
              <div key={err.id || idx} className="glass-panel" style={{ borderLeft: `4px solid ${borderCol}`, display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{err.bot}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {new Date(err.timestamp).toLocaleString()}
                      </span>
                      <button
                        onClick={() => deleteSingleError(err, idx)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0', display: 'flex' }}
                        title="Delete this notification"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                      Account: <strong>{err.account}</strong>
                    </span>
                    {err.sku && (
                      <span style={{ background: 'rgba(255,165,0,0.1)', color: 'orange', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: '600' }}>
                        SKU: {err.sku}
                      </span>
                    )}
                    {err.file && (
                      <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: '600' }}>
                        File: {err.file}
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
                    gap: '8px',
                    margin: 0
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
                    style={{ width: '150px', height: '100px', cursor: 'pointer', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative', flexShrink: 0 }}
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
