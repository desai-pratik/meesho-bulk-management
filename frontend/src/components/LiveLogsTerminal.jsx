import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

function LiveLogsTerminal({ logs }) {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '1.2rem' }}>
        <Terminal size={20} /> Live Output Terminal
      </h3>
      <div className="terminal-container" ref={terminalRef}>
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Waiting for script output...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`log-entry log-${log.type}`}>
              <span style={{ color: '#569cd6', marginRight: '8px' }}>[{log.script}]</span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LiveLogsTerminal;
