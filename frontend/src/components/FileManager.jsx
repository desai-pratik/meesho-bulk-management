import { useState, useEffect, useRef } from 'react';
import { UploadCloud, File, Trash2 } from 'lucide-react';
import { BACKEND_URL } from '../config';

function FileManager({ onUpdateFileCount }) {
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchFiles = () => {
    fetch(`${BACKEND_URL}/api/files`)
      .then(res => res.json())
      .then(data => {
        setFiles(data);
        setSelectedFiles(prev => prev.filter(name => data.some(f => f.name === name)));
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
      const res = await fetch(`${BACKEND_URL}/api/files`, {
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
      const res = await fetch(`${BACKEND_URL}/api/files/${encodeURIComponent(filename)}`, {
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

  const toggleSelectFile = (filename) => {
    setSelectedFiles(prev =>
      prev.includes(filename)
        ? prev.filter(name => name !== filename)
        : [...prev, filename]
    );
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedFiles(files.map(f => f.name));
    } else {
      setSelectedFiles([]);
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Are you sure you want to delete the ${selectedFiles.length} selected files?`)) return;

    try {
      const deletePromises = selectedFiles.map(filename =>
        fetch(`${BACKEND_URL}/api/files/${encodeURIComponent(filename)}`, {
          method: 'DELETE'
        }).then(res => res.json())
      );

      const results = await Promise.all(deletePromises);
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        alert(`Failed to delete some files: ${failed.map(f => f.error).join(', ')}`);
      }
      setSelectedFiles([]);
      fetchFiles();
    } catch (e) {
      console.error(e);
      alert("Error deleting selected files.");
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Current Files in Folder</h3>
        {selectedFiles.length > 0 && (
          <button
            className="btn btn-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
            onClick={handleDeleteSelected}
          >
            <Trash2 size={16} /> Delete Selected ({selectedFiles.length})
          </button>
        )}
      </div>
      <div style={{ maxHeight: '397px', overflowY: 'auto', paddingRight: '0.5rem' }}>
        <table className="accounts-table" style={{ marginTop: 0 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-dark)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                  checked={files.length > 0 && files.every(f => selectedFiles.includes(f.name))}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  title="Select all files"
                />
              </th>
              {/* <th>No.</th> */}
              <th>Filename</th>
              <th>Size</th>
              <th style={{ width: '100px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file, idx) => (
              <tr key={idx}>
                <td style={{ textAlign: 'center' }}>
                  {/* <td style={{ color: 'var(--primary)', width: '50px' }}>{idx + 1}</td> */}
                  <input
                    type="checkbox"
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                    checked={selectedFiles.includes(file.name)}
                    onChange={() => toggleSelectFile(file.name)}
                  />
                </td>
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
                <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  No files found in the uploaded-files directory.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default FileManager;
