import { useState, useEffect } from 'react';
import { RefreshCw, Play, Search } from 'lucide-react';
import { BACKEND_URL } from '../config';

function ReturnOTPs({ scripts, onTrigger }) {
  const [otps, setOtps] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [syncingAccount, setSyncingAccount] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const returnOtpScript = scripts?.find(s => s.filename === 'meesho_return_otp.js');
  const isSyncing = returnOtpScript?.isRunning || false;

  useEffect(() => {
    if (!isSyncing) {
      setSyncingAccount(null);
    }
  }, [isSyncing]);

  const fetchOtps = () => {
    fetch(`${BACKEND_URL}/api/return-otps`)
      .then(res => res.json())
      .then(data => setOtps(data))
      .catch(err => console.error("Error fetching return OTPs:", err));
  };

  const fetchAccounts = () => {
    fetch(`${BACKEND_URL}/api/accounts`)
      .then(res => res.json())
      .then(data => setAccounts(data))
      .catch(err => console.error("Error fetching accounts:", err));
  };

  useEffect(() => {
    fetchOtps();
    fetchAccounts();
    const interval = setInterval(fetchOtps, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncAll = async () => {
    try {
      setSyncingAccount('ALL');
      await onTrigger('meesho_return_otp.js');
    } catch (e) {
      console.error(e);
      setSyncingAccount(null);
    }
  };

  const handleSyncSingle = async (username) => {
    if (!username) return;
    try {
      setSyncingAccount(username);
      if (onTrigger) {
        await onTrigger('meesho_return_otp.js', { account: username });
      }
    } catch (e) {
      console.error(e);
      setSyncingAccount(null);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 85px)', overflow: 'hidden', paddingRight: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.4rem' }}>Return OTPs</h2>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="search"
              className="input-field"
              placeholder="Search Email / Company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '32px', minWidth: '250px', paddingTop: '11px', paddingBottom: '11px' }}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSyncAll}
            disabled={isSyncing}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSyncing ? 0.7 : 1, cursor: isSyncing ? 'not-allowed' : 'pointer' }}
          >
            {isSyncing && syncingAccount === 'ALL' ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            {isSyncing && syncingAccount === 'ALL' ? 'Syncing All OTPs...' : 'Sync All Return OTPs'}
          </button>
        </div>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>

      {accounts.length > 0 ? (
        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem', paddingBottom: '1rem' }}>
          <table className="accounts-table" style={{ marginTop: 0 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <tr>
              <th>Account</th>
              <th>Courier OTPs</th>
              <th>Last Updated</th>
              <th style={{ width: '120px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts
              .filter(acc => acc.isActive !== false)
              .filter(acc => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (acc.username && acc.username.toLowerCase().includes(q)) ||
                  (acc.name && acc.name.toLowerCase().includes(q));
              })
              .map((acc, idx) => {
                const accountOtps = otps.filter(o => o.account === acc.username);
                const isThisSyncing = isSyncing && syncingAccount === acc.username;

                return (
                  <tr key={idx}>
                    <td>
                      <div style={{ fontWeight: acc.name ? '500' : 'normal' }}>{acc.name || acc.username}</div>
                      {acc.name && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{acc.username}</div>}
                    </td>
                    <td>
                      {accountOtps.length > 0 ? (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {accountOtps.map((otpObj, i) => (
                            <div key={i} style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              gap: '6px',
                              alignItems: 'center'
                            }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{otpObj.courier}:</span>
                              <span style={{ fontWeight: 'bold', color: 'var(--primary)', letterSpacing: '1px' }}>{otpObj.otp}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {accountOtps.length > 0 ? new Date(Math.max(...accountOtps.map(o => new Date(o.timestamp)))).toLocaleString() : '-'}
                    </td>
                    <td style={{ textAlign: 'right', width: '150px' }}>
                      <button
                        className="btn"
                        style={{
                          padding: '0.4rem 0.8rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'var(--primary)',
                          color: 'white',
                          opacity: isSyncing ? 0.7 : 1,
                          cursor: isSyncing ? 'not-allowed' : 'pointer',
                          fontSize: '0.85rem'
                        }}
                        onClick={() => handleSyncSingle(acc.username)}
                        disabled={isSyncing}
                        title="Sync Return OTP for this account"
                      >
                        {isThisSyncing && <RefreshCw size={14} className="spin" />}
                        {isThisSyncing ? 'Syncing...' : 'Sync OTP'}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No accounts found. Please add accounts in the Accounts tab first.
        </div>
      )}
    </div>
  );
}

export default ReturnOTPs;
