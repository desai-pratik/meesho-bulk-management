import { Play, Square } from 'lucide-react';

function BotCard({ script, onTrigger }) {
  return (
    <div className="glass-panel bot-card">
      <div className="bot-card-header">
        <div className={`bot-icon ${script.isRunning ? 'status-running' : 'status-stopped'}`}>
          <Play size={24} />
        </div>
        {/* <div className={`bot-status ${script.isRunning ? 'status-running' : 'status-stopped'}`}>
          {script.isRunning ? 'Running' : 'Ready'}
        </div> */}
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
