
'use client';

import ContactsManager from './ContactsManager';
import { useEffect, useState, type CSSProperties } from 'react';
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

  const cardStyle: CSSProperties = {
    background: 'white',
    padding: 24,
    borderRadius: 12,
    boxShadow: '0 3px 16px #ddd',
  };

  const buttonStyle: CSSProperties = {
    padding: '12px 18px',
    background: '#1769aa',
    color: 'white',
    border: 0,
    borderRadius: 6,
    cursor: 'pointer',
  };

  // Prevent login screen flashing during refresh
  if (!sessionChecked) {
    return (
      <main style={{ padding: 32 }}>
        <h2>WhatsApp Bulk Message</h2>
        <p>Checking session...</p>
      </main>
    );
  }

  // Professional dashboard after login
  if (token) {
    const navigation = [
      { id: 'overview', label: 'Overview', symbol: '◫' },
      { id: 'contacts', label: 'Contacts', symbol: '♙' },
      { id: 'campaigns', label: 'Campaigns', symbol: '▤' },
      { id: 'whatsapp', label: 'WhatsApp Accounts', symbol: '◉' },
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
            <span className="saas-brand-icon">✦</span>
            <span>
              Bulk Message
              <small>Business Messaging Platform</small>
            </span>
          </div>

          <nav className="saas-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeSection === item.id ? 'active' : ''}
                aria-current={activeSection === item.id ? 'page' : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                <span aria-hidden="true" style={{ marginRight: 12 }}>
                  {item.symbol}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="saas-sidebar-footer">
            Official Meta Cloud API integration
            <p>Message sending is currently disabled.</p>
          </div>
        </aside>

        <main className="saas-main">
          <header className="saas-topbar">
            <div className="saas-topbar-title">
              {titles[activeSection]}
            </div>

            <div className="saas-user">
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
                <h1 className="saas-heading">
                  Welcome to your workspace
                </h1>
                <p className="saas-subheading">
                  Manage your businesses and messaging operations
                  from one place.
                </p>

                <div className="saas-stats">
                  <div className="saas-card">
                    <div className="saas-stat-label">
                      Total Companies
                    </div>
                    <div className="saas-stat-value">
                      {companiesLoading ? '...' : companiesError ? '—' : companies.length}
                    </div>
                    <div className="saas-stat-note">
                      Companies linked to your account
                    </div>
                  </div>

                  <div className="saas-card">
                    <div className="saas-stat-label">
                      Messaging Status
                    </div>
                    <div className="saas-stat-value" style={{ fontSize: 22 }}>
                      Disabled
                    </div>
                    <div className="saas-stat-note">
                      Campaign sending not yet enabled
                    </div>
                  </div>

                  <div className="saas-card">
                    <div className="saas-stat-label">
                      WhatsApp Setup
                    </div>
                    <div className="saas-stat-value" style={{ fontSize: 22 }}>
                      In progress
                    </div>
                    <div className="saas-stat-note">
                      Complete Meta onboarding to connect
                    </div>
                  </div>
                </div>

                <section className="saas-card">
                  <h2 className="saas-section-title">
                    Your Companies
                  </h2>

                  {companiesLoading && <p>Loading companies...</p>}

                  {companiesError && (
                    <p role="alert" style={{ color: '#dc2626' }}>
                      {companiesError}
                    </p>
                  )}

                  {!companiesLoading &&
                    !companiesError &&
                    companies.length === 0 && (
                      <p className="saas-muted">
                        No companies found.
                      </p>
                    )}

                  {companies.map((company) => (
                    <div className="saas-company" key={company.id}>
                      <strong>{company.name}</strong>
                      <div className="saas-company-role">
                        Role: {company.role}
                      </div>
                    </div>
                  ))}
                </section>

                <section className="saas-card" style={{ marginTop: 20 }}>
                  <h2 className="saas-section-title">
                    Quick Actions
                  </h2>
                  <p className="saas-muted">
                    Open a workspace to manage your data.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <button
                      className="saas-action"
                      onClick={() => setActiveSection('contacts')}
                    >
                      Manage Contacts
                    </button>
                    <button
                      className="saas-action"
                      onClick={() => setActiveSection('campaigns')}
                    >
                      View Campaigns
                    </button>
                    <button
                      className="saas-action"
                      onClick={() => setActiveSection('whatsapp')}
                    >
                      WhatsApp Accounts
                    </button>
                  </div>
                </section>
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
    <main style={{ maxWidth: 920, margin: '64px auto', padding: 24 }}>
      <h1>WhatsApp Bulk Message</h1>
      <p>Multi-business messaging dashboard</p>

      <section style={{ ...cardStyle, maxWidth: 440 }}>
        <h2>
          {mode === 'login' ? 'Sign in' : 'Create business account'}
        </h2>

        {mode === 'register' && (
          <input
            aria-label="Business name"
            placeholder="Business name"
            value={business}
            onChange={(event) => setBusiness(event.target.value)}
            style={{
              padding: 12,
              width: '90%',
              marginBottom: 12,
            }}
          />
        )}

        <input
          aria-label="Email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{
            padding: 12,
            width: '90%',
            marginBottom: 12,
          }}
        />

        <input
          aria-label="Password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{
            padding: 12,
            width: '90%',
            marginBottom: 12,
          }}
        />

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={submit}
            disabled={loading}
            style={buttonStyle}
          >
            {loading ? 'Please wait...' : 'Continue'}
          </button>

          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setResult('');
            }}
            style={{
              padding: 12,
              cursor: 'pointer',
            }}
          >
            Switch to {mode === 'login' ? 'register' : 'login'}
          </button>
        </div>

        <p role="status">{result}</p>
      </section>
    </main>
  );
}

