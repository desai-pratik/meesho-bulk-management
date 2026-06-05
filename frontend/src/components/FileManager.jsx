import { useState, useEffect, useRef } from 'react';
import { UploadCloud, File, Trash2 } from 'lucide-react';

function FileManager({ onUpdateFileCount }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchFiles = () => {
    fetch('http://localhost:3001/api/files')
      .then(res => res.json())
      .then(data => {
        setFiles(data);
        if (onUpdateFileCount) onUpdateFileCount(data.length);
      })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleUpload = async (event) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append('files', selectedFiles[i]);
    }

    setUploading(true);
    try {
      const res = await fetch('http://localhost:3001/api/files', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        fetchFiles();
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to connect to backend for upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (filename) => {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

    try {
      const res = await fetch(`http://localhost:3001/api/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchFiles();
      } else {
        alert("Failed to delete: " + data.error);
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting file.");
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="glass-panel">
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem' }}>Uploaded Files Manager</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Upload your .xlsx or catalog files here. Bots like "Jewellery Set Catalog Uploads" will automatically process files placed in this folder.
        </p>

        <div 
          style={{
            border: '2px dashed var(--border-color)',
            borderRadius: '12px',
            padding: '2.5rem',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.3s'
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>Click to Upload Files</h3>
          <p style={{ color: 'var(--text-muted)' }}>or drag and drop them here</p>
          <input 
            type="file" 
            multiple 
            ref={fileInputRef} 
            onChange={handleUpload} 
            style={{ display: 'none' }} 
          />
        </div>
        {uploading && <div style={{ marginTop: '1rem', color: 'var(--primary)', textAlign: 'center' }}>Uploading files...</div>}
      </div>

      <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Current Files in Folder</h3>
      <table className="accounts-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Filename</th>
            <th>Size</th>
            <th style={{ width: '100px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file, idx) => (
            <tr key={idx}>
              <td style={{ color: 'var(--primary)', width: '50px' }}>{idx + 1}</td>
              <td>
                <File size={16} color="var(--text-muted)" /> {file.name}
              </td>
              <td style={{ color: 'var(--text-muted)' }}>{formatSize(file.size)}</td>
              <td style={{ textAlign: 'right' }}>
                <button 
                  className="btn btn-danger" 
                  style={{ padding: '0.5rem', display: 'inline-flex' }}
                  onClick={() => handleDelete(file.name)}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {files.length === 0 && (
            <tr>
              <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                No files found in the uploaded-files directory.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default FileManager;
