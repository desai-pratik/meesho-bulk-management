import { useState } from 'react';
import { Mail, Lock, User, KeyRound, AlertTriangle, CheckCircle, ArrowLeft } from 'lucide-react';
import { BACKEND_URL } from '../config';

function LoginRegister({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState('login'); // 'login' | 'register' | 'otp' | 'forgot' | 'resetConfirm'
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Register State
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  
  // OTP State
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpPurpose, setOtpPurpose] = useState('verify'); // 'verify' | 'reset'
  
  // Forgot / Reset Password State
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');

  // General Loading & Feedback State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [fallbackMsg, setFallbackMsg] = useState(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setFallbackMsg(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;

    setLoading(true);
    clearMessages();

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg('Logged in successfully!');
        setTimeout(() => {
          onLoginSuccess(data.token, data.user);
        }, 1000);
      } else {
        setErrorMsg(data.error || 'Login failed. Please check credentials.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!registerName || !registerEmail || !registerPassword || !registerConfirmPassword) return;
    
    if (registerPassword !== registerConfirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: registerName, email: registerEmail, password: registerPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(data.message);
        setOtpEmail(registerEmail);
        setOtpPurpose('verify');
        if (data.fallback) {
          setFallbackMsg('SMTP server is not configured in the backend. In development mode, the OTP code has been printed to the backend server terminal console.');
        }
        setTimeout(() => {
          setActiveTab('otp');
        }, 1500);
      } else {
        setErrorMsg(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otpCode || !otpEmail) return;

    setLoading(true);
    clearMessages();

    try {
      // If it's registration verification
      if (otpPurpose === 'verify') {
        const res = await fetch(`${BACKEND_URL}/api/auth/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: otpEmail, otp: otpCode })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          setSuccessMsg('Email verified successfully!');
          setTimeout(() => {
            onLoginSuccess(data.token, data.user);
          }, 1500);
        } else {
          setErrorMsg(data.error || 'Invalid or expired OTP');
        }
      } else {
        // If it's for password reset confirm tab redirection
        setActiveTab('resetConfirm');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpEmail) return;
    setLoading(true);
    clearMessages();

    try {
      const endpoint = otpPurpose === 'verify' ? '/api/auth/resend-otp' : '/api/auth/reset-password-request';
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg('OTP code has been resent to your email');
        if (data.fallback) {
          setFallbackMsg('SMTP is not configured. OTP printed to server terminal.');
        }
      } else {
        setErrorMsg(data.error || 'Failed to resend OTP');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail) return;

    setLoading(true);
    clearMessages();

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-password-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(data.message);
        setOtpEmail(forgotEmail);
        setOtpPurpose('reset');
        if (data.fallback) {
          setFallbackMsg('SMTP is not configured. OTP printed to server terminal.');
        }
        setTimeout(() => {
          setActiveTab('otp');
        }, 1500);
      } else {
        setErrorMsg(data.error || 'Password reset request failed');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordConfirm = async (e) => {
    e.preventDefault();
    if (!otpEmail || !otpCode || !resetNewPassword) return;

    setLoading(true);
    clearMessages();

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-password-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail, otp: otpCode, newPassword: resetNewPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(data.message);
        setTimeout(() => {
          setActiveTab('login');
          // Clear reset forms
          setOtpCode('');
          setResetNewPassword('');
        }, 2000);
      } else {
        setErrorMsg(data.error || 'Password reset confirmation failed');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card glass-panel">
        <h1 className="login-title">Meesho Sync Hub</h1>
        
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

        {fallbackMsg && (
          <div className="alert-box alert-info">
            <CheckCircle size={18} />
            <span>{fallbackMsg}</span>
          </div>
        )}

        {activeTab === 'login' && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="login-subtitle">Sign in to manage your meesho sync systems</div>
            
            <div className="input-group">
              <label>Email Address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  className="input-field"
                  placeholder="your-email@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Password</label>
                <button type="button" className="text-link" onClick={() => { setActiveTab('forgot'); clearMessages(); }}>
                  Forgot Password?
                </button>
              </div>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="auth-footer">
              Don't have an account?{' '}
              <button type="button" className="text-link" onClick={() => { setActiveTab('register'); clearMessages(); }}>
                Create Account
              </button>
            </div>
          </form>
        )}

        {activeTab === 'register' && (
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="login-subtitle">Create a secure system user account</div>

            <div className="input-group">
              <label>Full Name</label>
              <div className="input-with-icon">
                <User size={18} />
                <input
                  type="text"
                  className="input-field"
                  placeholder="John Doe"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <label>Email Address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  className="input-field"
                  placeholder="email@example.com"
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <label>Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  className="input-field"
                  placeholder="Minimum 6 characters"
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <label>Confirm Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Creating Account...' : 'Register'}
            </button>

            <div className="auth-footer">
              Already have an account?{' '}
              <button type="button" className="text-link" onClick={() => { setActiveTab('login'); clearMessages(); }}>
                Sign In
              </button>
            </div>
          </form>
        )}

        {activeTab === 'otp' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="login-subtitle">
              We have sent a verification code to <strong>{otpEmail}</strong>
            </div>

            <div className="input-group">
              <label>6-Digit Verification Code</label>
              <div className="input-with-icon">
                <KeyRound size={18} />
                <input
                  type="text"
                  className="input-field"
                  style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem' }}
                  placeholder="000000"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {otpPurpose === 'verify' ? (loading ? 'Verifying...' : 'Verify & Log In') : 'Proceed to Reset Password'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-text" onClick={() => { setActiveTab(otpPurpose === 'verify' ? 'register' : 'forgot'); clearMessages(); }} style={{ padding: 0, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <ArrowLeft size={16} /> Back
              </button>
              <button type="button" className="text-link" onClick={handleResendOtp} disabled={loading}>
                Resend Code
              </button>
            </div>
          </form>
        )}

        {activeTab === 'forgot' && (
          <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="login-subtitle">Enter your email and we'll send you an OTP to reset your password</div>

            <div className="input-group">
              <label>Email Address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  className="input-field"
                  placeholder="your-email@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Sending Code...' : 'Send Verification Code'}
            </button>

            <button type="button" className="btn btn-text" onClick={() => { setActiveTab('login'); clearMessages(); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', width: '100%' }}>
              <ArrowLeft size={16} /> Back to Login
            </button>
          </form>
        )}

        {activeTab === 'resetConfirm' && (
          <form onSubmit={handleResetPasswordConfirm} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="login-subtitle">Reset your account password</div>

            <div className="input-group">
              <label>Email Address</label>
              <input
                type="email"
                className="input-field"
                value={otpEmail}
                disabled
              />
            </div>

            <div className="input-group">
              <label>New Password</label>
              <div className="input-with-icon">
                <Lock size={18} />
                <input
                  type="password"
                  className="input-field"
                  placeholder="Minimum 6 characters"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Resetting Password...' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoginRegister;
