import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Search, CheckCircle2 } from 'lucide-react';
import { BACKEND_URL } from '../config';

const LOCAL_STORAGE_KEY = 'selected_accounts';

function AccountsManager({ scripts, onTrigger }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  const syncLocalSelectionToServer = (selectionMap) => {
    try {
      fetch(`${BACKEND_URL}/api/local-account-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: selectionMap })
      }).catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/accounts`)
      .then(res => res.json())
      .then(async data => {
        let localSelection = null;
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              localSelection = parsed;
            }
          } else {
            const selRes = await fetch(`${BACKEND_URL}/api/local-account-selection`);
            const selJson = await selRes.json();
            if (selJson && selJson.selection && Object.keys(selJson.selection).length > 0) {
              localSelection = selJson.selection;
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localSelection));
            }
          }
        } catch (e) {
          console.error("Error reading localStorage selection:", e);
        }

        const merged = Array.isArray(data) ? data.map(acc => {
          const isSelected = (localSelection && typeof localSelection[acc.username] === 'boolean')
            ? localSelection[acc.username]
            : true;
          return {
            ...acc,
            isActive: isSelected
          };
        }) : [];

        setAccounts(merged);
        setLoading(false);

        // Keep localStorage and server updated with current selection map
        const initialMap = {};
        merged.forEach(a => { if (a.username) initialMap[a.username] = a.isActive !== false; });
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initialMap));
          syncLocalSelectionToServer(initialMap);
          window.dispatchEvent(new Event('selected-accounts-updated'));
        } catch (e) {}
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const addAccount = () => {
    setAccounts([...accounts, { username: '', password: '', name: '', isActive: true }]);
  };

  const updateAccount = (index, field, value) => {
    const newAccounts = [...accounts];
    newAccounts[index][field] = value;
    setAccounts(newAccounts);

    if (field === 'isActive') {
      const selectionMap = {};
      newAccounts.forEach(a => { if (a.username) selectionMap[a.username] = a.isActive !== false; });
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(selectionMap));
        syncLocalSelectionToServer(selectionMap);
        window.dispatchEvent(new Event('selected-accounts-updated'));
      } catch (e) {}
      setSyncStatus('Selection saved in local storage');
      setTimeout(() => setSyncStatus(''), 2500);
    }
  };

  const toggleAllAccounts = (checked) => {
    const newAccounts = accounts.map(acc => ({ ...acc, isActive: checked }));
    setAccounts(newAccounts);

    const selectionMap = {};
    newAccounts.forEach(a => { if (a.username) selectionMap[a.username] = checked; });
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(selectionMap));
      syncLocalSelectionToServer(selectionMap);
      window.dispatchEvent(new Event('selected-accounts-updated'));
    } catch (e) {}
    setSyncStatus('Selection saved in local storage');
    setTimeout(() => setSyncStatus(''), 2500);
  };

  const removeAccount = (index) => {
    const removedAcc = accounts[index];
    const newAccounts = accounts.filter((_, i) => i !== index);
    setAccounts(newAccounts);

    if (removedAcc && removedAcc.username) {
      const selectionMap = {};
      newAccounts.forEach(a => { if (a.username) selectionMap[a.username] = a.isActive !== false; });
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(selectionMap));
        syncLocalSelectionToServer(selectionMap);
        window.dispatchEvent(new Event('selected-accounts-updated'));
      } catch (e) {}
    }
  };

  const saveAccounts = async () => {
    try {
      const validAccounts = accounts.filter(a => a.username && a.password);
      const res = await fetch(`${BACKEND_URL}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: validAccounts })
      });
      const data = await res.json();
      if (data.success) {
        const selectionMap = {};
        validAccounts.forEach(a => { if (a.username) selectionMap[a.username] = a.isActive !== false; });
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(selectionMap));
          syncLocalSelectionToServer(selectionMap);
          window.dispatchEvent(new Event('selected-accounts-updated'));
        } catch (e) {}
        alert("Accounts saved successfully!");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save accounts");
    }
  };

  if (loading) return <div className="glass-panel">Loading accounts...</div>;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 85px)', overflow: 'hidden', paddingRight: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>Manage Meesho Accounts</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Account selection is saved in browser local storage</span>
            {syncStatus && (
              <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                • {syncStatus}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="search"
              className="input-field"
              placeholder="Search Email / Company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '32px', minWidth: '250px', paddingTop: '9px', paddingBottom: '9px' }}
            />
          </div>
          <button className="btn btn-primary" style={{ padding: '0.6rem 1rem' }} onClick={addAccount}>
            <Plus size={16} /> Add Account
          </button>
          <button className="btn" style={{ background: 'var(--success)', color: 'white', padding: '0.6rem 1rem' }} onClick={saveAccounts}>
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem', paddingBottom: '1rem' }}>
        <table className="accounts-table" style={{ marginTop: 0 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                  checked={accounts.length > 0 && accounts.every(a => a.isActive !== false)}
                  onChange={(e) => toggleAllAccounts(e.target.checked)}
                  title="Toggle all accounts (saved in local storage)"
                />
              </th>
              <th>Email / Phone</th>
              <th>Company Name (Optional)</th>
              <th>Password</th>
              <th style={{ width: '50px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts
              .map((acc, index) => ({ ...acc, originalIndex: index }))
              .filter(acc => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (acc.username && acc.username.toLowerCase().includes(q)) ||
                  (acc.name && acc.name.toLowerCase().includes(q));
              })
              .map((acc) => {
                const idx = acc.originalIndex;
                return (
                  <tr key={idx}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                        checked={acc.isActive !== false}
                        onChange={(e) => updateAccount(idx, 'isActive', e.target.checked)}
                        title="Include this account when running bots (saved in local storage)"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="input-field"
                        style={{ width: '100%' }}
                        value={acc.username}
                        onChange={(e) => updateAccount(idx, 'username', e.target.value)}
                        placeholder="email@example.com"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="input-field"
                        style={{ width: '100%' }}
                        value={acc.name || ''}
                        onChange={(e) => updateAccount(idx, 'name', e.target.value)}
                        placeholder="e.g. SHREEJI NEW"
                      />
                    </td>
                    <td>
                      <input
                        type="password"
                        className="input-field"
                        style={{ width: '100%' }}
                        value={acc.password}
                        onChange={(e) => updateAccount(idx, 'password', e.target.value)}
                        placeholder="••••••••"
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '0.5rem', display: 'inline-flex' }}
                        onClick={() => removeAccount(idx)}
                        title="Delete Account"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  No accounts found. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AccountsManager;
