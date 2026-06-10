import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Search } from 'lucide-react';
import BotCard from './BotCard';

function Dashboard({ scripts, onTrigger }) {
  const [stats, setStats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Find the actual running state of the fetch stats script from the backend
  const fetchStatsScript = scripts?.find(s => s.filename === 'meesho_pending_orders_sync.js');
  const isSyncing = fetchStatsScript?.isRunning || false;

  const totalPending = stats.reduce((sum, item) => sum + (item.pendingOrders || 0), 0);

  const handleSync = async () => {
    try {
      await onTrigger('meesho_pending_orders_sync.js');
    } catch (e) { }
  };

  const fetchStats = () => {
    fetch('http://localhost:3001/api/stats')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setStats(data);
        } else {
          console.error("API returned non-array stats:", data);
        }
      })
      .catch(err => console.error("Error fetching stats:", err));
  };

  const fetchAccounts = () => {
    fetch('http://localhost:3001/api/accounts')
      .then(res => res.json())
      .then(data => setAccounts(data))
      .catch(err => console.error("Error fetching accounts:", err));
  };

  useEffect(() => {
    fetchAccounts();
    fetchStats();
    // Poll every 5 seconds for live updates while scripts are running
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const chartData = stats.map(stat => {
    const acc = accounts.find(a => a.username === stat.account);
    return {
      ...stat,
      displayName: acc && acc.name ? acc.name : stat.account.split('@')[0],
      fullEmail: stat.account
    };
  });

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{ backgroundColor: 'rgba(30, 33, 48, 0.9)', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'white', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: '600', marginBottom: '2px' }}>{data.displayName}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{data.fullEmail}</div>
          <div style={{ color: 'var(--primary)', fontWeight: '500' }}>
            Pending Orders : {data.pendingOrders}
          </div>
        </div>
      );
    }
    return null;
  };

  const filteredScripts = scripts?.filter(script => {
    const query = searchTerm.toLowerCase();
    return (
      script.name?.toLowerCase().includes(query) ||
      script.filename?.toLowerCase().includes(query)
    );
  }) || [];

  return (
    <div>
      {/* Chart Section */}
      <div className="glass-panel" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span>Pending Orders Overview <span style={{ color: 'var(--primary)', marginLeft: '8px', fontSize: '1.1rem' }}>{totalPending > 0 ? `(${totalPending})` : ''}</span></span>

            <style>{`
              @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
          </div>
          {/* <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
            Updates after an account is processed
          </span> */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            style={{
              background: isSyncing ? 'var(--bg-card)' : 'var(--primary)',
              color: 'white',
              border: isSyncing ? '1px solid var(--border-color)' : 'none',
              padding: '10px 16px',
              borderRadius: '4px',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
              opacity: isSyncing ? 0.7 : 1
            }}
            onMouseOver={e => !isSyncing && (e.currentTarget.style.opacity = 0.8)}
            onMouseOut={e => !isSyncing && (e.currentTarget.style.opacity = 1)}
          >
            {isSyncing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                <line x1="12" y1="2" x2="12" y2="6"></line>
                <line x1="12" y1="18" x2="12" y2="22"></line>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                <line x1="2" y1="12" x2="6" y2="12"></line>
                <line x1="18" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            )}
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
        </h2>
        {stats.length > 0 ? (
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="displayName" stroke="var(--text-muted)" fontSize={12} tickMargin={10} />
                <YAxis stroke="var(--text-muted)" fontSize={12} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="pendingOrders"
                  stroke="var(--primary)"
                  strokeWidth={3}
                  activeDot={{ r: 8, fill: 'var(--primary)', stroke: 'white', strokeWidth: 2 }}
                  name="Pending Orders"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            No order stats available yet. Run a bot to generate data.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Available Bots</h2>
        <div style={{ position: 'relative', width: '100%', maxWidth: '300px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search bots..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field"
            style={{ paddingLeft: '36px' }}
          />
        </div>
      </div>

      {(!scripts || scripts.length === 0) ? (
        <div className="glass-panel" style={{textAlign:"center"}}>No scripts found. Please check backend connection.</div>
      ) : filteredScripts.length === 0 ? (
        <div className="glass-panel" style={{textAlign:"center", color: 'var(--text-muted)'}}>No bots match your search term.</div>
      ) : (
        <div className="dashboard-grid">
          {filteredScripts.map(script => (
            <BotCard key={script.filename} script={script} onTrigger={onTrigger} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
