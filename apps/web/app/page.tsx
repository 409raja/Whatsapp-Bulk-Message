
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
      <main className="session-loading">
        <span className="saas-brand-icon" aria-hidden="true">W</span>
        <p>Restoring your secure session...</p>
      </main>
    );
  }

  // Professional dashboard after login
  if (token) {
    const navigation = [
      { id: 'overview', label: 'Overview', symbol: '◫' },
      { id: 'contacts', label: 'Contacts', symbol: '♙' },
      { id: 'campaigns', label: 'Campaigns', symbol: '▤' },
      { id: 'whatsapp', label: 'WhatsApp accounts', symbol: '◉' },
    ] as const;

    const titles = {
      overview: 'Overview',
      contacts: 'Contacts',
      campaigns: 'Campaigns',
      whatsapp: 'WhatsApp Accounts',
    };

    return (
      <div className="saas-shell">
        <aside className="saas-sidebar">
          <div className="saas-brand">
            <span className="saas-brand-icon">W</span>
            <span>
              <span className="saas-brand-name">Bulk Message</span>
              <small>Business messaging</small>
            </span>
          </div>

          <div className="saas-nav-label">WORKSPACE</div>
          <nav className="saas-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeSection === item.id ? 'active' : ''}
                aria-current={activeSection === item.id ? 'page' : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="saas-nav-icon" aria-hidden="true">
                  {item.symbol}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="saas-sidebar-footer">
            <span className="saas-footer-status"><span /> Workspace protected</span>
            <p>Campaign sending is currently disabled.</p>
          </div>
        </aside>

        <main className="saas-main">
          <header className="saas-topbar">
            <div>
              <div className="saas-topbar-eyebrow">WORKSPACE</div>
              <div className="saas-topbar-title">{titles[activeSection]}</div>
            </div>

            <div className="saas-user">
              <span className="saas-workspace-badge"><span /> Secure workspace</span>
              <div className="saas-avatar" aria-hidden="true">
                {email.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="saas-user-email">{email}</span>
              <button
                type="button"
                className="saas-logout"
                onClick={logout}
              >
                Logout
              </button>
            </div>
          </header>

          <div className="saas-content">
            {activeSection === 'overview' && (
              <>
                <section className="saas-welcome">
                  <div>
                    <span className="saas-welcome-kicker">YOUR BUSINESS, IN ONE PLACE</span>
                    <h1 className="saas-heading">Welcome to your workspace</h1>
                    <p className="saas-subheading">
                      Manage your businesses, contacts, and WhatsApp campaigns from one place.
                    </p>
                  </div>
                  <button
                    className="saas-action"
                    onClick={() => setActiveSection('campaigns')}
                  >
                    Create a campaign <span aria-hidden="true">→</span>
                  </button>
                </section>

                <div className="saas-stats">
                  <div className="saas-card">
                    <div className="saas-stat-topline">
                      <div className="saas-stat-label">Businesses</div>
                      <span className="saas-stat-icon saas-icon-green" aria-hidden="true">⌂</span>
                    </div>
                    <div className="saas-stat-value">
                      {companiesLoading ? '...' : companiesError ? '—' : companies.length}
                    </div>
                    <div className="saas-stat-note">
                      Linked to your account
                    </div>
                  </div>

                  <div className="saas-card">
                    <div className="saas-stat-topline">
                      <div className="saas-stat-label">Messaging status</div>
                      <span className="saas-stat-icon saas-icon-amber" aria-hidden="true">!</span>
                    </div>
                    <div className="saas-stat-value saas-stat-value-text">
                      Paused
                    </div>
                    <div className="saas-stat-note">
                      Campaign sending is not enabled
                    </div>
                  </div>

                  <div className="saas-card">
                    <div className="saas-stat-topline">
                      <div className="saas-stat-label">WhatsApp setup</div>
                      <span className="saas-stat-icon saas-icon-blue" aria-hidden="true">↗</span>
                    </div>
                    <div className="saas-stat-value saas-stat-value-text">
                      Get started
                    </div>
                    <div className="saas-stat-note">
                      Connect a business account to continue
                    </div>
                  </div>
                </div>

                <div className="saas-overview-grid">
                  <section className="saas-card saas-companies-card">
                    <div className="saas-panel-heading">
                      <div>
                        <h2 className="saas-section-title">Your businesses</h2>
                        <p className="saas-panel-description">Businesses linked to your account</p>
                      </div>
                      <span className="saas-panel-count">
                        {companiesLoading ? '...' : companiesError ? '—' : companies.length}
                      </span>
                    </div>

                    {companiesLoading && <p className="saas-muted">Loading your businesses...</p>}

                    {companiesError && (
                      <p role="alert" className="saas-error">{companiesError}</p>
                    )}

                    {!companiesLoading && !companiesError && companies.length === 0 && (
                      <div className="saas-empty-state">
                        <span className="saas-empty-icon" aria-hidden="true">⌂</span>
                        <strong>No businesses yet</strong>
                        <p>Your linked businesses will appear here.</p>
                      </div>
                    )}

                    {companies.map((company) => (
                      <div className="saas-company" key={company.id}>
                        <span className="saas-company-icon" aria-hidden="true">
                          {company.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="saas-company-details">
                          <strong>{company.name}</strong>
                          <span>{company.role}</span>
                        </span>
                        <span className="saas-company-arrow" aria-hidden="true">→</span>
                      </div>
                    ))}
                  </section>

                  <section className="saas-card saas-actions-card">
                    <h2 className="saas-section-title">Get started</h2>
                    <p className="saas-panel-description">
                      Choose a workspace to continue setting up your messaging.
                    </p>
                    <button
                      className="saas-quick-link"
                      onClick={() => setActiveSection('whatsapp')}
                    >
                      <span className="saas-quick-link-icon saas-icon-green" aria-hidden="true">◉</span>
                      <span><strong>Connect WhatsApp</strong><small>Manage your business accounts</small></span>
                      <span className="saas-company-arrow" aria-hidden="true">→</span>
                    </button>
                    <button
                      className="saas-quick-link"
                      onClick={() => setActiveSection('contacts')}
                    >
                      <span className="saas-quick-link-icon saas-icon-blue" aria-hidden="true">♙</span>
                      <span><strong>Manage contacts</strong><small>Organize your opted-in audience</small></span>
                      <span className="saas-company-arrow" aria-hidden="true">→</span>
                    </button>
                    <button
                      className="saas-quick-link"
                      onClick={() => setActiveSection('campaigns')}
                    >
                      <span className="saas-quick-link-icon saas-icon-violet" aria-hidden="true">▤</span>
                      <span><strong>View campaigns</strong><small>Create and manage campaign drafts</small></span>
                      <span className="saas-company-arrow" aria-hidden="true">→</span>
                    </button>
                  </section>
                </div>

                <div className="saas-notice" role="note">
                  <span className="saas-notice-icon" aria-hidden="true">i</span>
                  <p><strong>Campaign sending is disabled.</strong> You can manage drafts and contacts; messages are not sent from this workspace.</p>
                </div>
              </>
            )}

            <div style={{ display: activeSection === 'contacts' ? 'block' : 'none' }}>
              <ContactsManager token={token} />
            </div>

            <div style={{ display: activeSection === 'campaigns' ? 'block' : 'none' }}>
              <CampaignsManager token={token} />
            </div>

            <div style={{ display: activeSection === 'whatsapp' ? 'block' : 'none' }}>
              <WhatsAppConnectionsManager token={token} />
            </div>
          </div>
        </main>
      </div>
    );
  }
  // Login and registration screen
  return (
    <main className="auth-layout">
      <section className="auth-showcase">
        <a className="auth-brand" href="/" aria-label="Bulk Message home">
          <span className="saas-brand-icon">W</span>
          <span>Bulk Message</span>
        </a>
        <div className="auth-showcase-copy">
          <span className="auth-kicker">BUSINESS MESSAGING, SIMPLIFIED</span>
          <h1>Conversations that move your business forward.</h1>
          <p>One calm, organized space to manage your businesses, contacts, and WhatsApp campaign drafts.</p>
          <div className="auth-feature-list">
            <div><span aria-hidden="true">✓</span> Keep opted-in contacts organized</div>
            <div><span aria-hidden="true">✓</span> Create and manage campaign drafts</div>
            <div><span aria-hidden="true">✓</span> Manage WhatsApp business connections</div>
          </div>
        </div>
        <p className="auth-showcase-footnote">A clearer view of your business messaging workspace.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="saas-brand-icon">W</span> Bulk Message
          </div>
          <span className="auth-kicker">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span>
          <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h2>
          <p className="auth-description">
            {mode === 'login'
              ? 'Enter your details below to access your workspace.'
              : 'Set up your business workspace in just a few steps.'}
          </p>

          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === 'register' && (
              <label>
                Business name
                <input
                  aria-label="Business name"
                  placeholder="Your business"
                  value={business}
                  onChange={(event) => setBusiness(event.target.value)}
                  autoComplete="organization"
                  required
                />
              </label>
            )}

            <label>
              Email address
              <input
                aria-label="Email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label>
              Password
              <input
                aria-label="Password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </label>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </form>

          {result && (
            <p className="auth-result" role="status">{result}</p>
          )}

          <p className="auth-switch">
            {mode === 'login' ? 'New to Bulk Message?' : 'Already have an account?'}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setResult('');
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <p className="auth-legal">By continuing, you agree to use this workspace in accordance with WhatsApp messaging policies.</p>
        </div>
      </section>
    </main>
  );
}
