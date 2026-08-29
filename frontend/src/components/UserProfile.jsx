import { useState, useEffect } from 'react';
import { User, Mail, Lock, Shield, CheckCircle, AlertTriangle, Calendar, LogOut, KeyRound, Save } from 'lucide-react';
import { BACKEND_URL } from '../config';

function UserProfile({ onProfileUpdate, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Forms state
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/profile`);
      const data = await res.json();
      if (res.ok && data.success) {
        setProfile(data.user);
        setName(data.user.name);
      } else {
        setErrorMsg(data.error || 'Failed to load user profile');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!name.trim() && !password) return;

    if (password && password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/profile/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(data.message);
        setPassword('');
        setConfirmPassword('');
        setProfile({ ...profile, name: data.user.name });
        if (onProfileUpdate) {
          onProfileUpdate(data.token, data.user);
        }
      } else {
        setErrorMsg(data.error || 'Failed to update profile');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setSubmitting(false);
    }
  };

  // Get Initials for Avatar
  const getInitials = (nameStr) => {
    if (!nameStr) return 'AD';
    return nameStr
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return <div className="glass-panel">Loading profile...</div>;
  }

  return (
    <div className="profile-container">
      {/* Top Banner Cover Card */}
      <div className="profile-card glass-panel">
        <div className="profile-cover"></div>
        <div className="profile-avatar-wrapper">
          <div className="profile-avatar">
            {getInitials(profile?.name)}
          </div>
          <div className="profile-info-header">
            <h1 className="profile-display-name">{profile?.name || 'Administrator'}</h1>
            <div className="profile-role-badge">
              <Shield size={14} />
              <span>System Owner</span>
            </div>
          </div>

          <button className="btn btn-danger btn-logout-large" onClick={onLogout}>
            <LogOut size={16} />
            <span>Logout Account</span>
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="profile-stats-grid">
          <div className="stat-card glass-panel">
            <span className="stat-label">System Node Status</span>
            <span className="stat-value text-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <CheckCircle size={16} /> Active & Secured
            </span>
          </div>
          <div className="stat-card glass-panel">
            <span className="stat-label">Email Node</span>
            <span className="stat-value">{profile?.email || 'N/A'}</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="stat-label">Registered On</span>
            <span className="stat-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Calendar size={16} />
              {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Settings Panel */}
      <div className="profile-settings-wrapper glass-panel">
        <div className="settings-header">
          <KeyRound size={20} className="header-icon" />
          <div>
            <h3>Security & Profile Configuration</h3>
            <p>Modify credentials and system access permissions</p>
          </div>
        </div>

        {errorMsg && (
          <div className="alert-box alert-danger">
            <AlertTriangle size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="alert-box alert-success">
            <CheckCircle size={18} />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleUpdate} className="profile-form">
          <div className="form-row">
            <div className="input-group">
              <label>System Email Address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  className="input-field disabled-field"
                  value={profile?.email || ''}
                  disabled
                />
              </div>
              <span className="input-help-text">Email address is locked and verified.</span>
            </div>

            <div className="input-group">
              <label>Full Display Name</label>
              <div className="input-with-icon">
                <User size={18} />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Administrator"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <span className="input-help-text">Visible to automated nodes and report headers.</span>
            </div>
          </div>

          {/* <div className="form-divider"></div> */}

          <div className="form-row">
            <div className="input-group">
              <label>Update Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  className="input-field"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <span className="input-help-text">Leave blank if you do not wish to change it.</span>
            </div>

            {password && (
              <div className="input-group animate-slide-up">
                <label>Confirm Password</label>
                <div className="input-with-icon">
                  <Lock size={18} />
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Re-type new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <span className="input-help-text">Must match the password entered above.</span>
              </div>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-save-profile" disabled={submitting}>
            <Save size={16} />
            <span>{submitting ? 'Saving changes...' : 'Save Profile Changes'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default UserProfile;
