
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

  return (
    <section
      className="saas-manager"
      style={{
        background: 'white',
        padding: 24,
        borderRadius: 12,
        boxShadow: '0 3px 16px #ddd',
        marginTop: 24,
      }}
    >
      <h2>WhatsApp Connection Management</h2>

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
          onClick={() => void connectWhatsApp()}
          disabled={connecting}
          style={{
            padding: '12px 18px',
            background: connecting ? '#9ca3af' : '#16a34a',
            color: 'white',
            border: 0,
            borderRadius: 6,
            cursor: connecting ? 'wait' : 'pointer',
          }}
        >
          {connecting ? 'Connecting...' : 'Connect WhatsApp'}
        </button>

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
