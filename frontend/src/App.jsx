import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Terminal, Users, PlayCircle } from 'lucide-react';
import { BACKEND_URL } from './config';
import Dashboard from './components/Dashboard';
import AccountsManager from './components/AccountsManager';
import LiveLogsTerminal from './components/LiveLogsTerminal';
import LiveBrowserFeed from './components/LiveBrowserFeed';
import FileManager from './components/FileManager';
import ReturnOTPs from './components/ReturnOTPs';
import InventoryUpdatesManager from './components/InventoryUpdatesManager';
import SingleCatalogSetup from './components/SingleCatalogSetup';
import Notifications from './components/Notifications';
import ScanPack from './components/ScanPack';
import LoginRegister from './components/LoginRegister';
import UserProfile from './components/UserProfile';
import { FolderUp, KeyRound, Tags, Settings, Menu, X, UserCircle, Bell, Scan, LogOut } from 'lucide-react';

// Connect to backend server on port 3001
const socket = io(BACKEND_URL);

// Monkeypatch fetch globally to inject JWT Authorization header
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  const token = localStorage.getItem('token');
  if (token && (url.startsWith(BACKEND_URL) || url.startsWith('/api') || url.includes('/api/'))) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }
  return originalFetch(url, options);
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [fileCount, setFileCount] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const handleLoginSuccess = (newToken, newUser) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
  };

  const fetchErrorsCount = () => {
    fetch(`${BACKEND_URL}/api/errors`)
      .then(res => res.json())
      .then(data => setErrorCount(Array.isArray(data) ? data.length : 0))
      .catch(err => console.error("Error fetching notifications:", err));
  };

  useEffect(() => {
    if (!token) return;

    // Fetch initial scripts
    fetch(`${BACKEND_URL}/api/scripts`)
      .then(res => res.json())
      .then(data => setScripts(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching scripts:", err));

    // Fetch initial file count
    fetch(`${BACKEND_URL}/api/files`)
      .then(res => res.json())
      .then(data => setFileCount(Array.isArray(data) ? data.length : 0))
      .catch(err => console.error("Error fetching files:", err));

    fetch(`${BACKEND_URL}/api/accounts`)
      .then(res => res.json())
      .then(data => setAccountCount(Array.isArray(data) ? data.filter(a => a.isActive !== false).length : 0))
      .catch(err => console.error("Error fetching accounts:", err));

    fetchErrorsCount();

    // Listen for logs
    socket.on('log', (data) => {
      if (data && typeof data.message === 'string') {
        const lines = data.message.split('\n');
        const formattedLogs = lines
          .map(line => line.trimEnd())
          .filter(line => line.trim().length > 0)
          .map(line => ({
            script: data.script,
            type: data.type,
            message: line,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          }));

        if (formattedLogs.length > 0) {
          setLogs(prev => [...prev, ...formattedLogs].slice(-300)); // keep last 300 logs
        }
      }
    });

    // Listen for status changes
    socket.on('processStatus', (data) => {
      setScripts(prev => prev.map(s =>
        s.filename === data.script ? {
          ...s,
          isRunning: data.status === 'running',
          startTime: data.startTime,
          estimatedTime: data.estimatedTime || s.estimatedTime,
          estimatedSeconds: data.estimatedSeconds || s.estimatedSeconds
        } : s
      ));
    });

    return () => {
      socket.off('log');
      socket.off('processStatus');
    };
  }, [token]);

  const triggerScript = async (filename, action = 'start') => {
    try {
      const isStop = action === 'stop';
      const endpoint = isStop ? `/api/stop/${filename}` : `/api/run/${filename}`;
      // Check if we passed a specific account
      let bodyData = undefined;
      if (typeof action === 'object' && action.account) {
        bodyData = JSON.stringify({ account: action.account });
      }

      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: bodyData ? { 'Content-Type': 'application/json' } : undefined,
        body: bodyData
      });
      const data = await res.json();
      if (data.error) {
        alert(`Error: ${data.error}`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to connect to backend");
    }
  };

  if (!token) {
    return <LoginRegister onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>Meesho Sync Hub</h1>
          <button className="mobile-close-btn" onClick={() => setIsSidebarOpen(false)}>
            <X size={24} />
          </button>
        </div>
        <nav>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <PlayCircle size={18} /> Dashboard
          </NavLink>
          <NavLink
            to="/meesho-accounts"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Users size={18} /> Meesho Account {accountCount > 0 && <span style={{ background: 'rgb(248, 0, 0)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', position: 'absolute', top: '14px', right: '14px' }}>{accountCount}</span>}
          </NavLink>
          <NavLink
            to="/files"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <FolderUp size={18} /> File Manager {fileCount > 0 && <span style={{ background: 'rgb(248, 0, 0)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', position: 'absolute', top: '14px', right: '14px' }}>{fileCount}</span>}
          </NavLink>
          <NavLink
            to="/return-otps"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <KeyRound size={18} /> Return OTPs
          </NavLink>
          <NavLink
            to="/inventory-updates"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Tags size={18} /> Inventory Updates
          </NavLink>
          <NavLink
            to="/single-catalog"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Settings size={18} /> Single Catalog Setup
          </NavLink>
          <NavLink
            to="/scan-pack"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Scan size={18} /> Scan & Pack
          </NavLink>
          <NavLink
            to="/notifications"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Bell size={18} /> Notifications {errorCount > 0 && <span style={{ background: 'var(--danger)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', position: 'absolute', top: '14px', right: '14px', color: 'white' }}>{errorCount}</span>}
          </NavLink>
        </nav>

        <div style={{ padding: '1rem', fontSize: "12px", color: "#888", marginTop: "auto", textAlign: "center" }}>
          © 2026 BY Pratik Desai.
        </div>
      </aside>

      <div className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <h2 className="mobile-only-title">Sync Hub</h2>
          </div>
          <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <NavLink to="/profile" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="user-profile">
                <UserCircle size={20} />
                <span className="user-name">{user?.name || 'Admin'}</span>
              </div>
            </NavLink>
            {/* <button className="btn btn-danger" onClick={handleLogout} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
              <LogOut size={14} /> Logout
            </button> */}
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/dashboard" element={
              <>
                <Dashboard scripts={scripts} onTrigger={triggerScript} />
                <LiveBrowserFeed socket={socket} scripts={scripts} logs={logs} />
              </>
            } />

            <Route path="/meesho-accounts" element={
              <AccountsManager scripts={scripts} onTrigger={triggerScript} />
            } />

            <Route path="/accounts" element={<Navigate to="/meesho-accounts" replace />} />

            <Route path="/profile" element={
              <UserProfile onProfileUpdate={handleLoginSuccess} onLogout={handleLogout} />
            } />

            <Route path="/files" element={
              <FileManager onUpdateFileCount={setFileCount} />
            } />

            <Route path="/return-otps" element={
              <ReturnOTPs scripts={scripts} onTrigger={triggerScript} />
            } />

            <Route path="/inventory-updates" element={<Navigate to="/inventory-updates/price" replace />} />
            <Route path="/inventory-updates/:type" element={
              <InventoryUpdatesManager />
            } />

            <Route path="/single-catalog" element={<Navigate to="/single-catalog/jewellery-set" replace />} />
            <Route path="/single-catalog/:category" element={
              <SingleCatalogSetup socket={socket} />
            } />

            <Route path="/scan-pack" element={
              <ScanPack />
            } />

            <Route path="/notifications" element={
              <Notifications />
            } />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
