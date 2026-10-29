
'use client';

import ContactsManager from './ContactsManager';
import { useEffect, useState } from 'react';
import CampaignsManager from './CampaignsManager';
import WhatsAppConnectionsManager from './WhatsAppConnectionsManager';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const TOKEN_KEY = 'bulk_auth_token';
const EMAIL_KEY = 'bulk_auth_email';

type Company = {
  id: string;
  name: string;
  role: string;
};

// Check JWT expiry for UI session restoration.
// Backend remains responsible for verifying JWT signatures.
function isTokenActive(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const payload = JSON.parse(atob(base64));

    return (
      typeof payload.exp === 'number' &&
      payload.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [business, setBusiness] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'overview' | 'contacts' | 'campaigns' | 'whatsapp'>('overview');

  // Session restoration
  const [sessionChecked, setSessionChecked] = useState(false);

  // Companies API states
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState('');

  // Restore session after refresh
  useEffect(() => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    const savedEmail = sessionStorage.getItem(EMAIL_KEY);

    if (savedToken && isTokenActive(savedToken)) {
      setToken(savedToken);
      setEmail(savedEmail || '');
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
    }

    setSessionChecked(true);
  }, []);

  // Fetch companies after login or session restoration
  useEffect(() => {
    if (!sessionChecked || !token) {
      setCompanies([]);
      setCompaniesError('');
      setCompaniesLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadCompanies() {
      setCompaniesLoading(true);
      setCompaniesError('');

      try {
        const response = await fetch(`${API}/api/v1/companies`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error('SESSION_EXPIRED');
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load companies');
        }

        if (!Array.isArray(data)) {
          throw new Error('Invalid companies response');
        }

        if (!controller.signal.aborted) {
          setCompanies(data);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        if (
          error instanceof Error &&
          error.message === 'SESSION_EXPIRED'
        ) {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(EMAIL_KEY);
          setToken('');
          setCompanies([]);
          setResult('Session expired. Please sign in again.');
          return;
        }

        setCompaniesError(
          error instanceof Error
            ? error.message
            : 'Unable to load companies'
        );
      } finally {
        if (!controller.signal.aborted) {
          setCompaniesLoading(false);
        }
      }
    }

    loadCompanies();

    return () => controller.abort();
  }, [token, sessionChecked]);

  // Login and registration
  async function submit() {
    if (loading) return;

    setLoading(true);
    setResult('');

    try {
      const response = await fetch(`${API}/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          ...(mode === 'register' ? { business } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      if (mode === 'register') {
        setMode('login');
        setResult('Account created. Please sign in.');
        setPassword('');
        return;
      }

      if (!data.token || !isTokenActive(data.token)) {
        throw new Error('Invalid login session received');
      }

      // Save login for refresh within this tab
      sessionStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(EMAIL_KEY, email);

      setToken(data.token);
      setPassword('');
      setResult('');
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : 'Something went wrong'
      );
    } finally {
      setLoading(false);
    }
  }

  // Logout
  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);

    setToken('');
    setPassword('');
    setCompanies([]);
    setCompaniesError('');
    setResult('');
    setMode('login');
  }

  // Prevent login screen flashing during refresh
  if (!sessionChecked) {
    return (
      <main style={{ padding: 32 }}>
        <h2>WhatsApp Bulk Message</h2>
        <p>Checking session...</p>
      </main>
    );
  }


  if (token) {
    const navigation = [
      { id: 'overview', label: 'Overview', icon: '◫' },
      { id: 'contacts', label: 'Contacts', icon: '◎' },
      { id: 'campaigns', label: 'Campaigns', icon: '▤' },
      { id: 'whatsapp', label: 'WhatsApp Accounts', icon: '◉' },
    ] as const;
    const pageNames = {
      overview: 'Overview',
      contacts: 'Contacts',
      campaigns: 'Campaigns',
      whatsapp: 'WhatsApp Accounts',
    };
    return (
      <div className="workspace">
        <aside className="workspace-sidebar">
          <div className="workspace-brand">
            <span className="brand-mark" aria-hidden="true"><span>↗</span></span>
            <div className="brand-name">bulk<span>message</span><small>BUSINESS PLATFORM</small></div>
          </div>
          <div className="workspace-switcher">
            <div className="workspace-switcher-icon">{(companies[0]?.name || 'W').slice(0,1).toUpperCase()}</div>
            <div className="workspace-switcher-text">
              <strong>{companies[0]?.name || 'My workspace'}</strong>
              <small>{companies.length > 1 ? `${companies.length} companies available` : 'Business workspace'}</small>
            </div>
          </div>
          <div className="nav-caption">WORKSPACE</div>
          <nav className="workspace-nav" aria-label="Workspace navigation">
            {navigation.map((item) => (
              <button key={item.id} type="button"
                className={activeSection === item.id ? 'nav-item selected' : 'nav-item'}
                aria-current={activeSection === item.id ? 'page' : undefined}
                onClick={() => setActiveSection(item.id)}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
                {activeSection === item.id && <span className="nav-active-dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>
          <div className="workspace-sidebar-bottom">
            <div className="sidebar-support">
              <span className="support-indicator" />
              <strong>Platform setup</strong>
              <p>Meta onboarding is in progress. Messaging remains disabled until setup is complete.</p>
              <button type="button" onClick={() => setActiveSection('whatsapp')}>View setup <span aria-hidden="true">↗</span></button>
            </div>
            <div className="sidebar-account"><span className="sidebar-avatar">{email.slice(0,1).toUpperCase()}</span><span className="sidebar-account-email" title={email}>{email}</span></div>
          </div>
        </aside>
        <div className="workspace-body">
          <header className="workspace-topbar">
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{pageNames[activeSection]}</strong></div>
            <div className="topbar-actions">
              <span className="environment-pill"><span /> Development</span>
              <button className="topbar-logout" type="button" onClick={logout}>Sign out <span aria-hidden="true">↗</span></button>
            </div>
          </header>
          <main className="workspace-content">
            {activeSection === 'overview' && (
              <>
                <div className="page-heading-row">
                  <div><div className="eyebrow">WORKSPACE OVERVIEW</div><h1>Good to see you.</h1><p>Here’s what’s happening across your business messaging workspace.</p></div>
                  <button className="primary-button" type="button" onClick={() => setActiveSection('whatsapp')}><span aria-hidden="true">＋</span> Connect WhatsApp</button>
                </div>
                <div className="overview-metrics">
                  <article className="metric-tile"><div className="metric-top"><span>Business workspaces</span><span className="metric-symbol">▦</span></div><strong>{companiesLoading ? '…' : companiesError ? '—' : companies.length}</strong><small>{companiesError ? 'Unable to load workspaces' : 'Linked to your account'}</small></article>
                  <article className="metric-tile"><div className="metric-top"><span>Campaign delivery</span><span className="metric-symbol">↗</span></div><strong className="metric-status">Not enabled</strong><small>Sending is disabled for now</small></article>
                  <article className="metric-tile"><div className="metric-top"><span>Meta integration</span><span className="metric-symbol">◉</span></div><strong className="metric-status">Setup pending</strong><small>Finish WhatsApp onboarding</small></article>
                </div>
                <div className="overview-columns">
                  <section className="panel">
                    <div className="panel-header"><div><span className="panel-kicker">GET STARTED</span><h2>Complete your setup</h2></div><span className="setup-chip">Action required</span></div>
                    <p className="panel-description">Follow these steps to prepare your workspace for official WhatsApp messaging.</p>
                    <div className="setup-steps">
                      <div className="setup-step"><span className="step-check">✓</span><div><strong>Workspace created</strong><p>Your business account is ready.</p></div><span className="step-done">Done</span></div>
                      <div className="setup-step"><span className="step-number">02</span><div><strong>Connect WhatsApp Business</strong><p>Finish Meta Embedded Signup and account verification.</p></div><button type="button" onClick={() => setActiveSection('whatsapp')}>Open ↗</button></div>
                      <div className="setup-step"><span className="step-number">03</span><div><strong>Prepare your first campaign</strong><p>Create a draft. Sending will stay disabled until activation.</p></div><button type="button" onClick={() => setActiveSection('campaigns')}>Open ↗</button></div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-header"><div><span className="panel-kicker">YOUR ORGANIZATION</span><h2>Workspaces</h2></div></div>
                    {companiesLoading && <p className="panel-description">Loading workspaces…</p>}
                    {companiesError && <p role="alert" className="form-error">{companiesError}</p>}
                    {!companiesLoading && !companiesError && companies.length === 0 && <p className="panel-description">No workspaces found.</p>}
                    <div className="company-list">{companies.map((company) => <div className="company-list-row" key={company.id}><span className="company-logo">{company.name.slice(0,1).toUpperCase()}</span><div><strong>{company.name}</strong><small>{company.role}</small></div><span className="company-chevron">↗</span></div>)}</div>
                    <div className="panel-footnote">Company data is loaded from your account.</div>
                  </section>
                </div>
                <div className="bottom-note"><span className="note-dot" /> Official Meta Cloud API integration · Campaign sending is not yet enabled.</div>
              </>
            )}
            <div className="manager-page" style={{display: activeSection === 'contacts' ? 'block' : 'none'}}>
              <div className="page-heading-row"><div><div className="eyebrow">AUDIENCE</div><h1>Contacts</h1><p>Manage your opted-in audience and contact records.</p></div></div>
              <ContactsManager token={token} />
            </div>
            <div className="manager-page" style={{display: activeSection === 'campaigns' ? 'block' : 'none'}}>
              <div className="page-heading-row"><div><div className="eyebrow">MESSAGING</div><h1>Campaigns</h1><p>Build and manage campaign drafts before sending is enabled.</p></div></div>
              <CampaignsManager token={token} />
            </div>
            <div className="manager-page" style={{display: activeSection === 'whatsapp' ? 'block' : 'none'}}>
              <div className="page-heading-row"><div><div className="eyebrow">INTEGRATIONS</div><h1>WhatsApp Accounts</h1><p>Manage official Meta WhatsApp Business connections.</p></div></div>
              <WhatsAppConnectionsManager token={token} />
            </div>
          </main>
        </div>
      </div>
    );
  }


  return (
    <main className="auth-layout">
      <div className="auth-story">
        <div className="auth-story-brand"><span className="brand-mark">↗</span><strong>bulk<span>message</span></strong></div>
        <div className="auth-story-content">
          <span className="auth-story-tag">BUSINESS MESSAGING, SIMPLIFIED</span>
          <h1>Connect your business.<br/><em>Start better conversations.</em></h1>
          <p>One thoughtful workspace to organize contacts, prepare campaigns and manage your official WhatsApp Business connections.</p>
          <div className="auth-story-feature"><span>✓</span> Built for multiple business workspaces</div>
          <div className="auth-story-feature"><span>✓</span> Official Meta Cloud API integration</div>
          <div className="auth-story-feature"><span>✓</span> Secure account-based access</div>
        </div>
        <div className="auth-story-footer">© {new Date().getFullYear()} Bulk Message · Business messaging platform</div>
      </div>
      <div className="auth-form-area">
        <div className="auth-form-container">
          <div className="auth-mobile-brand">bulk<span>message</span></div>
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your business account'}</h2>
          <p className="auth-description">{mode === 'login' ? 'Enter your details to continue to your dashboard.' : 'Get started with your business messaging workspace.'}</p>
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="auth-form">
            {mode === 'register' && <label>Business name<input autoComplete="organization" value={business} onChange={e => setBusiness(e.target.value)} placeholder="Your business name" required /></label>}
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required /></label>
            <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required /></label>
            {result && <p className="auth-result" role="status">{result}</p>}
            <button type="submit" className="primary-button auth-submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button>
          </form>
          <p className="auth-switch">{mode === 'login' ? "Don't have an account?" : 'Already have an account?'} <button type="button" onClick={() => {setMode(mode === 'login' ? 'register' : 'login');setResult('');}}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
          <div className="auth-security">Protected workspace · Official Meta integration</div>
        </div>
      </div>
    </main>
  );
}
