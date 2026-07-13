import { useState, useEffect, useRef } from 'react';
import { Globe, Lock, Tv, Loader2, Terminal, ChevronDown, ChevronUp } from 'lucide-react';

function LiveBrowserFeed({ socket, scripts, logs }) {
  const [screencast, setScreencast] = useState(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [activeScriptName, setActiveScriptName] = useState('');
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false);

  const terminalEndRef = useRef(null);

  // Check if any script is currently running
  const runningScript = scripts?.find(s => s.isRunning);
  const filteredLogs = logs?.filter(log => !runningScript || log.script === runningScript.filename) || [];

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollTop = terminalEndRef.current.scrollHeight;
    }
  }, [logs, isTerminalCollapsed]);

  useEffect(() => {
    if (!socket) return;

    const handleScreencast = (data) => {
      // Find the display name for the script
      const scriptInfo = scripts?.find(s => s.filename === data.script);
      const displayName = scriptInfo ? scriptInfo.name : data.script;

      setScreencast(data.image);
      setCurrentUrl(data.url || 'https://supplier.meesho.com/');
      setActiveScriptName(displayName);
    };

    socket.on('screencast', handleScreencast);

    return () => {
      socket.off('screencast', handleScreencast);
    };
  }, [socket, scripts]);

  // Reset the feed if no script is running
  useEffect(() => {
    if (!runningScript) {
      setScreencast(null);
      setCurrentUrl('');
      setActiveScriptName('');
    }
  }, [runningScript]);

  return (
    <div className="glass-panel" style={{ marginTop: '2rem', padding: '1.5rem' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '1.2rem' }}>
        <Tv size={20} className={runningScript ? 'text-primary' : ''} />
        Live Browser Feed
        {runningScript && (
          <span style={{
            fontSize: '0.75rem',
            background: 'rgba(235, 94, 40, 0.2)',
            color: 'var(--primary)',
            padding: '2px 8px',
            borderRadius: '12px',
            marginLeft: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: '600',
            letterSpacing: '0.05em'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--primary)',
              animation: 'pulse 1.5s infinite'
            }} />
            LIVESTREAM
          </span>
        )}
      </h3>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        @keyframes rotate {
          100% { transform: rotate(360deg); }
        }
        .browser-mockup {
          background: #151824;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
          transition: all 0.3s ease;
        }
        .browser-header {
          background: #1e2230;
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          border-bottom: 1px solid var(--border-color);
        }
        .browser-dots {
          display: flex;
          gap: 6px;
        }
        .browser-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .browser-address-bar {
          background: #0f111a;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          flex-grow: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          color: var(--text-muted);
          font-size: 0.8rem;
          font-family: monospace;
          max-width: 60%;
          margin: 0 auto;
        }
        .browser-viewport {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          max-height: 550px;
          min-height: 350px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0d0e15;
          overflow: hidden;
        }
        .browser-image {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
        }
        .browser-empty-state {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }
        .browser-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          color: var(--text-muted);
        }
        .spinner-icon {
          animation: rotate 1.5s linear infinite;
          color: var(--primary);
        }

        /* Premium Overlay Terminal UI */
        .overlay-terminal {
          position: absolute;
          bottom: 16px;
          left: 16px;
          width: 480px;
          max-width: calc(100% - 32px);
          z-index: 100;
          background: rgba(10, 12, 22, 0.6);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .overlay-terminal.collapsed {
          height: 38px;
        }
        .overlay-terminal.expanded {
          height: 440px;
        }
        .overlay-terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.02);
          cursor: pointer;
          user-select: none;
        }
        .overlay-terminal.collapsed .overlay-terminal-header {
          border-bottom: none;
        }
        .overlay-terminal-logs {
          flex-grow: 1;
          padding: 12px 16px;
          overflow-y: auto;
          font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
          font-size: 11px;
          line-height: 1.5;
          color: #f1f5f9;
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: left;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%);
          mask-image: linear-gradient(to bottom, transparent 0%, black 15%);
        }
        .overlay-terminal-logs::-webkit-scrollbar {
          width: 4px;
        }
        .overlay-terminal-logs::-webkit-scrollbar-track {
          background: transparent;
        }
        .overlay-terminal-logs::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 4px;
        }
        .overlay-terminal-logs::-webkit-scrollbar-thumb:hover {
          background: var(--primary);
        }
        .log-badge {
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.2);
          color: #a5b4fc;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-right: 8px;
          display: inline-flex;
          align-items: center;
        }
      `}</style>

      <div className="browser-mockup">
        {/* Browser Header Bar */}
        <div className="browser-header">
          <div className="browser-dots">
            <div className="browser-dot" style={{ background: '#ff5f56' }} />
            <div className="browser-dot" style={{ background: '#ffbd2e' }} />
            <div className="browser-dot" style={{ background: '#27c93f' }} />
          </div>

          <div className="browser-address-bar">
            <Lock size={12} className="text-primary" />
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: currentUrl ? '#dcdcdc' : 'var(--text-muted)'
            }}>
              {currentUrl || 'supplier.meesho.com (Disconnected)'}
            </span>
          </div>

          <div style={{ width: '48px', fontSize: '0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
            {activeScriptName ? 'Active' : 'Offline'}
          </div>
        </div>

        {/* Browser Page Viewport */}
        <div className="browser-viewport">
          {runningScript ? (
            screencast ? (
              <img
                src={screencast}
                alt="Automated browser feed"
                className="browser-image"
              />
            ) : (
              <div className="browser-loading">
                <Loader2 size={40} className="spinner-icon" />
                <div style={{ fontWeight: '500' }}>Initializing Live Stream...</div>
                <div style={{ fontSize: '0.8rem' }}>Running bot: <strong style={{ color: 'white' }}>{runningScript.name}</strong></div>
              </div>
            )
          ) : (
            <div className="browser-empty-state">
              <Tv size={64} style={{ color: 'rgba(255,255,255,0.05)', transform: 'rotateX(180deg)' }} />
              <h4 style={{ color: '#fff', margin: 0, fontSize: '1.1rem' }}>No Active Browser Feed</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: '360px', lineHeight: '1.4' }}>
                When you trigger a bot, the automated headless browser view will stream live in this box.
              </p>
            </div>
          )}

          {/* Absolute overlay terminal */}
          {runningScript && (
            <div className={`overlay-terminal ${isTerminalCollapsed ? 'collapsed' : 'expanded'}`}>
              {/* Header */}
              <div className="overlay-terminal-header" onClick={() => setIsTerminalCollapsed(!isTerminalCollapsed)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: '600', color: '#f1f5f9' }}>
                  <span className="live-status-dot" style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 8px #10b981',
                    animation: 'pulse 1.5s infinite'
                  }} />
                  <Terminal size={12} style={{ color: 'var(--primary)' }} />
                  <span>Terminal Output</span>
                  {runningScript && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.7rem' }}>
                      — {runningScript.name}
                    </span>
                  )}
                </div>
                <button style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                  pointerEvents: 'none'
                }}>
                  {isTerminalCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {/* Logs */}
              {!isTerminalCollapsed && (
                <div ref={terminalEndRef} className="overlay-terminal-logs">
                  {filteredLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)' }}>Waiting for terminal output...</div>
                  ) : (
                    filteredLogs.map((log, i) => {
                      const scriptNameClean = log.script.replace('meesho_', '').replace('.js', '').replace(/_/g, ' ');

                      let text = log.message;
                      let emailBadge = null;
                      let badgeType = 'normal'; // 'success', 'error', 'step', 'section', 'normal'

                      // 1. Check if the line is a section header (e.g. === Starting Account: ... ===)
                      if (text.startsWith('===') && text.endsWith('===')) {
                        text = text.replace(/===/g, '').trim();
                        badgeType = 'section';
                      } else {
                        // 2. Extract account email prefix like [email@domain.com]
                        const emailRegex = /^\[([^\]]+@[^\]]+)\]\s*(.*)$/i;
                        const emailMatch = text.match(emailRegex);
                        if (emailMatch) {
                          emailBadge = emailMatch[1].split('@')[0]; // only username part
                          text = emailMatch[2];
                        }

                        // 3. Determine semantic highlights
                        if (text.startsWith('>') || text.startsWith('➜')) {
                          badgeType = 'step';
                          text = text.replace(/^[>➜]\s*/, '').trim();
                        } else if (text.includes('SUCCESS') || text.includes('successfully') || text.includes('Successfully')) {
                          badgeType = 'success';
                        } else if (text.includes('Error') || text.includes('failed') || text.includes('Timeout') || text.includes('Command failed')) {
                          badgeType = 'error';
                        }
                      }

                      const timeStyle = {
                        color: 'rgba(255, 255, 255, 0.25)',
                        marginRight: '8px',
                        fontSize: '9px',
                        fontFamily: 'monospace'
                      };

                      const emailBadgeStyle = {
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: '#cbd5e1',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '9px',
                        fontFamily: 'monospace',
                        marginRight: '6px',
                        display: 'inline-flex',
                        alignItems: 'center'
                      };

                      if (badgeType === 'section') {
                        return (
                          <div key={i} style={{
                            margin: '10px 0 6px 0',
                            paddingBottom: '4px',
                            borderBottom: '1px dashed rgba(255, 255, 255, 0.1)',
                            color: '#a5b4fc',
                            fontWeight: '600',
                            fontSize: '11px',
                            letterSpacing: '0.5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <span style={{ color: 'var(--primary)', fontSize: '10px' }}>✦</span>
                            <span>{text}</span>
                          </div>
                        );
                      }

                      let textElement = <span>{text}</span>;
                      if (badgeType === 'success') {
                        textElement = (
                          <span style={{ color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '10px' }}>●</span> {text}
                          </span>
                        );
                      } else if (badgeType === 'error') {
                        textElement = (
                          <span style={{ color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '10px' }}>■</span> {text}
                          </span>
                        );
                      } else if (badgeType === 'step') {
                        textElement = (
                          <span style={{ color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--primary)', marginRight: '4px' }}>›</span> {text}
                          </span>
                        );
                      }

                      return (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          flexWrap: 'wrap',
                          lineHeight: '1.5',
                          fontSize: '11px',
                          color: log.type === 'error' ? '#ef4444' : '#f1f5f9',
                          textAlign: 'left'
                        }}>
                          {/* {log.timestamp && <span style={timeStyle}>{log.timestamp}</span>} */}

                          {/* <span className="log-badge" style={{ fontSize: '9px', padding: '1px 4px', background: 'rgba(99, 102, 241, 0.08)' }}>
                            {scriptNameClean}
                          </span> */}

                          {emailBadge && (
                            <span style={emailBadgeStyle}>
                              {emailBadge}
                            </span>
                          )}

                          {textElement}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveBrowserFeed;
