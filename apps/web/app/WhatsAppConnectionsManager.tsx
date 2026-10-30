
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type WhatsAppConnection = {
  id: string;
  label: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  status: string;
  createdAt: string;
};

type SignupConfig = {
  state: string;
  expiresAt: string;
  appId: string;
  configId: string;
  graphVersion: string;
};

type SignupFinish = {
  wabaId: string;
  phoneNumberId: string;
};

type FacebookLoginResponse = {
  authResponse?: {
    code?: string;
  };
  status?: string;
};

type FacebookSDK = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}

type SignupAttempt = {
  state: string;
  code?: string;
  finish?: SignupFinish;
  completing: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
};

export default function WhatsAppConnectionsManager({
  token,
}: {
  token: string;
}) {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [showExisting, setShowExisting] = useState(false);
  const [existingWabaId, setExistingWabaId] = useState('');
  const [existingPhoneId, setExistingPhoneId] = useState('');
  const [existingToken, setExistingToken] = useState('');
  const [savingExisting, setSavingExisting] = useState(false);
  const [healthById, setHealthById] = useState<Record<string, { health: string; note?: string; wabaAccess?: boolean; phoneAccess?: boolean }>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const attemptRef = useRef<SignupAttempt | null>(null);
  const tokenRef = useRef(token);
  const mountedRef = useRef(true);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const loadConnections = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);

      try {
        const response = await fetch(
          `${API}/api/v1/whatsapp/connections`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to load WhatsApp connections (${response.status})`
          );
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error('Invalid connections response');
        }

        if (!signal?.aborted && mountedRef.current) {
          setConnections(data as WhatsAppConnection[]);
        }
      } catch (err) {
        if (!signal?.aborted && mountedRef.current) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load connections'
          );
        }
      } finally {
        if (!signal?.aborted && mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    void loadConnections(controller.signal);

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [loadConnections]);

  function clearAttempt() {
    const attempt = attemptRef.current;

    if (attempt?.timeoutId) {
      clearTimeout(attempt.timeoutId);
    }

    attemptRef.current = null;
  }

  const completeIfReady = useCallback(async () => {
    const attempt = attemptRef.current;

    if (
      !attempt ||
      !attempt.code ||
      !attempt.finish ||
      attempt.completing
    ) {
      return;
    }

    attempt.completing = true;

    try {
      const response = await fetch(
        `${API}/api/v1/whatsapp/signup/complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({
            state: attempt.state,
            code: attempt.code,
            wabaId: attempt.finish.wabaId,
            phoneNumberId: attempt.finish.phoneNumberId,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'WhatsApp connection failed'
        );
      }

      if (mountedRef.current) {
        setMessage(
          'WhatsApp connection saved. Activation is pending verification.'
        );
        setError('');
      }

      await loadConnections();
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to complete WhatsApp signup'
        );
      }
    } finally {
      clearAttempt();

      if (mountedRef.current) {
        setConnecting(false);
      }
    }
  }, [loadConnections]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }

      const attempt = attemptRef.current;

      if (!attempt) {
        return;
      }

      let data: unknown = event.data;

      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (!data || typeof data !== 'object') {
        return;
      }

      const payload = data as {
        type?: unknown;
        event?: unknown;
        data?: {
          waba_id?: unknown;
          phone_number_id?: unknown;
        };
      };

      if (payload.type !== 'WA_EMBEDDED_SIGNUP') {
        return;
      }

      if (payload.event === 'FINISH') {
        const wabaId = payload.data?.waba_id;
        const phoneNumberId = payload.data?.phone_number_id;

        if (
          typeof wabaId === 'string' &&
          /^\d+$/.test(wabaId) &&
          typeof phoneNumberId === 'string' &&
          /^\d+$/.test(phoneNumberId)
        ) {
          attempt.finish = { wabaId, phoneNumberId };
          void completeIfReady();
        } else {
          setError('Meta did not return valid WhatsApp account details.');
        }
      }

      if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        clearAttempt();
        setConnecting(false);
        setMessage('');
        setError(
          payload.event === 'CANCEL'
            ? 'WhatsApp signup was cancelled.'
            : 'Meta reported a signup error.'
        );
      }
    };

    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [completeIfReady]);

  useEffect(() => {
    return () => {
      clearAttempt();
    };
  }, []);

  async function loadFacebookSDK(appId: string, version: string) {
    if (window.FB) {
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version,
      });

      setSdkReady(true);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const existing = document.getElementById('facebook-jssdk');

      const timeout = window.setTimeout(() => {
        reject(new Error('Facebook SDK loading timed out'));
      }, 15000);

      window.fbAsyncInit = () => {
        window.FB?.init({
          appId,
          cookie: true,
          xfbml: false,
          version,
        });

        window.clearTimeout(timeout);
        setSdkReady(true);
        resolve();
      };

      if (existing) {
        return;
      }

      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;

      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Unable to load Facebook SDK'));
      };

      document.body.appendChild(script);
    });
  }

  async function connectWhatsApp() {
    if (connecting) {
      return;
    }

    setConnecting(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${API}/api/v1/whatsapp/signup/start`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const config: SignupConfig = await response.json();

      if (!response.ok) {
        throw new Error('Unable to create WhatsApp signup session');
      }

      if (
        !config.state ||
        !config.appId ||
        !config.configId ||
        !config.graphVersion
      ) {
        throw new Error('Incomplete Meta signup configuration');
      }

      await loadFacebookSDK(config.appId, config.graphVersion);

      if (!window.FB) {
        throw new Error('Facebook SDK is unavailable');
      }

      const attempt: SignupAttempt = {
        state: config.state,
        completing: false,
      };

      attemptRef.current = attempt;

      attempt.timeoutId = setTimeout(() => {
        if (attemptRef.current === attempt) {
          clearAttempt();
          setConnecting(false);
          setError('Signup session expired. Please try again.');
        }
      }, 10 * 60 * 1000);

      window.FB.login(
        (result) => {
          if (attemptRef.current !== attempt) {
            return;
          }

          const code = result.authResponse?.code;

          if (typeof code === 'string' && code.length > 0) {
            attempt.code = code;
            void completeIfReady();
          } else if (!attempt.finish) {
            clearAttempt();
            setConnecting(false);
            setError('Meta login did not return an authorization code.');
          }
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_embedded_signup',
            sessionInfoVersion: '3',
          },
        }
      );
    } catch (err) {
      clearAttempt();
      setConnecting(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to start WhatsApp signup'
      );
    }
  }

  async function checkConnectionHealth(id: string) {
    setCheckingId(id);
    setError('');
    try {
      const response = await fetch(`${API}/api/v1/whatsapp/signup/${encodeURIComponent(id)}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Health check failed');
      setHealthById((previous) => ({ ...previous, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setCheckingId(null);
    }
  }

  async function addExistingAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingExisting) return;
    setSavingExisting(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API}/api/v1/whatsapp/signup/existing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ wabaId: existingWabaId.trim(), phoneNumberId: existingPhoneId.trim(), accessToken: existingToken.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Could not verify account');
      setExistingToken('');
      setShowExisting(false);
      setMessage('Existing WhatsApp account verified and saved. Activation checks are pending.');
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setSavingExisting(false);
    }
  }

  return (
    <section
      style={{
        background: 'white',
        padding: 24,
        borderRadius: 12,
        boxShadow: '0 3px 16px #ddd',
        marginTop: 24,
      }}
    >
      <h2>WhatsApp Integrations</h2>
      <p style={{ color: '#64748b' }}>Connect new or existing official Meta Cloud API accounts.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ border: '1px solid #e2e8f0', padding: 16, borderRadius: 12 }}>
          <h3>Connect New Account</h3>
          <p>Connect through official Meta Embedded Signup.</p>
          <button type="button" onClick={() => void connectWhatsApp()} disabled={connecting} style={{ padding: 12, background: '#16a34a', color: 'white', border: 0, borderRadius: 8 }}>{connecting ? 'Connecting...' : 'Connect WhatsApp'}</button>
        </div>
        <div style={{ border: '1px solid #e2e8f0', padding: 16, borderRadius: 12 }}>
          <h3>Add Existing Account</h3>
          <p>Connect an already registered Meta Cloud API number without migration.</p>
          <button type="button" onClick={() => setShowExisting((value) => !value)} style={{ padding: 12, background: '#2563eb', color: 'white', border: 0, borderRadius: 8 }}>{showExisting ? 'Close form' : 'Add Existing Account'}</button>
        </div>
      </div>
      {showExisting && (
        <form onSubmit={(event) => void addExistingAccount(event)} style={{ display: 'grid', gap: 10, maxWidth: 520, marginBottom: 20, border: '1px solid #cbd5e1', borderRadius: 12, padding: 16 }}>
          <h3>Existing Meta Cloud API account</h3>
          <label>WhatsApp Business Account ID<input required pattern="[0-9]+" autoComplete="off" value={existingWabaId} onChange={(event) => setExistingWabaId(event.target.value)} style={{ display: 'block', width: '100%', padding: 10 }} /></label>
          <label>Phone Number ID<input required pattern="[0-9]+" autoComplete="off" value={existingPhoneId} onChange={(event) => setExistingPhoneId(event.target.value)} style={{ display: 'block', width: '100%', padding: 10 }} /></label>
          <label>System User Access Token<input required type="password" autoComplete="off" value={existingToken} onChange={(event) => setExistingToken(event.target.value)} style={{ display: 'block', width: '100%', padding: 10 }} /></label>
          <p style={{ fontSize: 12, color: '#64748b' }}>Token is verified server-side and encrypted at rest. Never share it in chat or commit it to Git. This does not change your existing CRM webhook.</p>
          <button type="submit" disabled={savingExisting} style={{ padding: 12, background: '#2563eb', color: 'white', border: 0, borderRadius: 8 }}>{savingExisting ? 'Verifying...' : 'Verify & Save Connection'}</button>
        </form>
      )}

      <p>
        Manage official Meta WhatsApp Business connections
        for your company.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >


        <button
          onClick={() => void loadConnections()}
          disabled={loading}
          style={{
            padding: '12px 18px',
            borderRadius: 6,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Loading...' : 'Refresh Connections'}
        </button>
      </div>

      {sdkReady && (
        <p style={{ color: '#666', fontSize: 12 }}>
          Meta Facebook SDK loaded.
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      {message && (
        <p role="status" style={{ color: '#166534' }}>
          {message}
        </p>
      )}

      <h3>Saved Connections ({connections.length})</h3>

      {!loading && !error && connections.length === 0 && (
        <p>No WhatsApp Business Account connected yet.</p>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {connections.map((connection) => (
          <div
            key={connection.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: 16,
            }}
          >
            <h3>{connection.label || 'WhatsApp Business'}</h3>

            <p>
              <strong>Status:</strong> {connection.status}
            </p>
            <button type="button" disabled={checkingId === connection.id} onClick={() => void checkConnectionHealth(connection.id)} style={{ padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' }}>
              {checkingId === connection.id ? 'Checking...' : 'Check API Health'}
            </button>
            {healthById[connection.id] && (
              <div role="status" style={{ marginTop: 10, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <strong>API Health: {healthById[connection.id].health}</strong>
                <p>WABA access: {healthById[connection.id].wabaAccess ? 'Verified' : 'Not verified'}</p>
                <p>Phone access: {healthById[connection.id].phoneAccess ? 'Verified' : 'Not verified'}</p>
                <p>{healthById[connection.id].note}</p>
              </div>
            )}

            <p>
              <strong>Business Account ID:</strong>{' '}
              {connection.wabaId || 'Not available'}
            </p>

            <p>
              <strong>Phone Number ID:</strong>{' '}
              {connection.phoneNumberId || 'Not available'}
            </p>

            <p>
              <strong>WhatsApp Number:</strong>{' '}
              {connection.displayPhoneNumber || 'Not available'}
            </p>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 20, color: '#666', fontSize: 13 }}>
        Connections are saved as PENDING until onboarding
        and activation checks are completed.
      </p>
    </section>
  );
}
