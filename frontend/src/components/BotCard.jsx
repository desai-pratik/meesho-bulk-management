import { useState, useEffect } from 'react';
import { Play, Square } from 'lucide-react';

function BotCard({ script, onTrigger }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!script.isRunning || !script.startTime) {
      setElapsed('');
      return;
    }

    const updateTimer = () => {
      const elapsedMs = Date.now() - script.startTime;
      const totalSec = Math.floor(elapsedMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      
      const parts = [];
      if (h > 0) parts.push(String(h).padStart(2, '0'));
      parts.push(String(m).padStart(2, '0'));
      parts.push(String(s).padStart(2, '0'));
      
      setElapsed(parts.join(':'));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [script.isRunning, script.startTime]);

  return (
    <div className="glass-panel bot-card">
      <div className="bot-card-header">
        <div className={`bot-icon ${script.isRunning ? 'status-running' : 'status-stopped'}`}>
          <Play size={24} />
        </div>
        
        {script.isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Est: {script.estimatedTime || '1 min'}</span>
            <span style={{ color: 'var(--danger)', fontWeight: '600', fontFamily: 'monospace', fontSize: '0.9rem', marginTop: '2px' }}>
              {elapsed || '00:00'}
            </span>
          </div>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div className="bot-title">{script.name}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{script.filename}</div>
      </div>
      
      <div>
        {script.isRunning ? (
          <button 
            className="btn btn-danger" 
            style={{ width: '100%' }}
            onClick={() => onTrigger(script.filename, 'stop')}
          >
            <Square size={16} /> Stop Bot
          </button>
        ) : (
          <button 
            className="btn btn-primary" 
            style={{ width: '100%' }}
            onClick={() => onTrigger(script.filename, 'start')}
          >
            <Play size={16} /> Run Bot
          </button>
        )}
      </div>
    </div>
  );
}

export default BotCard;
