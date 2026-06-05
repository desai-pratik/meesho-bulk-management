import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Terminal, Users, PlayCircle } from 'lucide-react';
import Dashboard from './components/Dashboard';
import AccountsManager from './components/AccountsManager';
import LiveLogsTerminal from './components/LiveLogsTerminal';
import FileManager from './components/FileManager';
import ReturnOTPs from './components/ReturnOTPs';
import InventoryUpdatesManager from './components/InventoryUpdatesManager';
import SingleCatalogSetup from './components/SingleCatalogSetup';
import Notifications from './components/Notifications';
import { FolderUp, KeyRound, Tags, Settings, Menu, X, UserCircle, Bell } from 'lucide-react';

// Connect to backend server on port 3001
const socket = io('http://localhost:3001');

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [fileCount, setFileCount] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const fetchErrorsCount = () => {
    fetch('http://localhost:3001/api/errors')
      .then(res => res.json())
      .then(data => setErrorCount(data ? data.length : 0))
      .catch(err => console.error("Error fetching notifications:", err));
  };

  useEffect(() => {
    // Fetch initial scripts
    fetch('http://localhost:3001/api/scripts')
      .then(res => res.json())
      .then(data => setScripts(data))
      .catch(err => console.error("Error fetching scripts:", err));

    // Fetch initial file count
    fetch('http://localhost:3001/api/files')
      .then(res => res.json())
      .then(data => setFileCount(data.length))
      .catch(err => console.error("Error fetching files:", err));

    fetch('http://localhost:3001/api/accounts')
      .then(res => res.json())
      .then(data => setAccountCount(data.filter(a => a.isActive !== false).length))
      .catch(err => console.error("Error fetching accounts:", err));

    fetchErrorsCount();
    const errorInterval = setInterval(fetchErrorsCount, 5000);

    // Listen for logs
    socket.on('log', (data) => {
      setLogs(prev => [...prev, data].slice(-200)); // keep last 200 logs
    });

    // Listen for status changes
    socket.on('processStatus', (data) => {
      setScripts(prev => prev.map(s =>
        s.filename === data.script ? { ...s, isRunning: data.status === 'running' } : s
      ));
    });

    return () => {
      socket.off('log');
      socket.off('processStatus');
      clearInterval(errorInterval);
    };
  }, []);

  const triggerScript = async (filename, action = 'start') => {
    try {
      const isStop = action === 'stop';
      const endpoint = isStop ? `/api/stop/${filename}` : `/api/run/${filename}`;
      // Check if we passed a specific account
      let bodyData = undefined;
      if (typeof action === 'object' && action.account) {
        bodyData = JSON.stringify({ account: action.account });
      }

      const res = await fetch(`http://localhost:3001${endpoint}`, {
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
            to="/accounts"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Users size={18} /> Accounts {accountCount > 0 && <span style={{ background: 'rgb(248, 0, 0)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', position: 'absolute', top: '14px', right: '14px' }}>{accountCount}</span>}
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
            to="/notifications"
            className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Bell size={18} /> Notifications {errorCount > 0 && <span style={{ background: 'var(--danger)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', position: 'absolute', top: '14px', right: '14px', color: 'white' }}>{errorCount}</span>}
          </NavLink>
        </nav>
      </aside>

      <div className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <h2 className="mobile-only-title">Sync Hub</h2>
          </div>
          <div className="header-right">
            <div className="user-profile">
              <UserCircle size={20} />
              <span className="user-name">Admin</span>
            </div>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            
            <Route path="/dashboard" element={
              <>
                <Dashboard scripts={scripts} onTrigger={triggerScript} />
                <LiveLogsTerminal logs={logs} />
              </>
            } />

            <Route path="/accounts" element={
              <AccountsManager scripts={scripts} onTrigger={triggerScript} />
            } />

            <Route path="/files" element={
              <FileManager onUpdateFileCount={setFileCount} />
            } />

            <Route path="/return-otps" element={
              <ReturnOTPs scripts={scripts} onTrigger={triggerScript} />
            } />

            <Route path="/inventory-updates" element={
              <InventoryUpdatesManager />
            } />

            <Route path="/single-catalog" element={<Navigate to="/single-catalog/jewellery-set" replace />} />
            <Route path="/single-catalog/:category" element={
              <SingleCatalogSetup socket={socket} />
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
