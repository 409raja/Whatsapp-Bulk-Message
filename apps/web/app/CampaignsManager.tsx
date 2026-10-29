
'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Campaign = {
  id: string;
  name: string;
  templateName: string;
  status: string;
  createdAt: string;
};

export default function CampaignsManager({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCampaigns = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API}/api/v1/campaigns`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load campaigns');
      }

      if (!Array.isArray(data)) {
        throw new Error('Invalid campaigns response');
      }

      if (!signal?.aborted) {
        setCampaigns(data);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(
          err instanceof Error ? err.message : 'Unable to load campaigns'
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    loadCampaigns(controller.signal);

    return () => controller.abort();
  }, [loadCampaigns]);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const campaignName = name.trim();
    const template = templateName.trim();

    if (campaignName.length < 2 || !template) {
      setError('Enter a campaign name and template name');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/v1/campaigns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: campaignName,
          templateName: template,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create campaign');
      }

      setName('');
      setTemplateName('');
      setMessage('Campaign created successfully as DRAFT');
      await loadCampaigns();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to create campaign'
      );
    } finally {
      setSaving(false);
    }
  }


  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const visibleCampaigns = campaigns.filter((campaign) =>
    [campaign.name, campaign.templateName, campaign.status].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase())
    )
  );
  const drafts = campaigns.filter((campaign) => campaign.status.toUpperCase() === 'DRAFT').length;

  return (
    <section className="campaign-dashboard">
      <div className="campaign-summary">
        <div className="campaign-summary-card">
          <span className="campaign-summary-icon">▤</span>
          <div><span>Total campaigns</span><strong>{loading ? '—' : campaigns.length}</strong><small>Saved in your workspace</small></div>
        </div>
        <div className="campaign-summary-card">
          <span className="campaign-summary-icon amber">◷</span>
          <div><span>Draft campaigns</span><strong>{loading ? '—' : drafts}</strong><small>Not scheduled or sent</small></div>
        </div>
        <div className="campaign-summary-card">
          <span className="campaign-summary-icon slate">◉</span>
          <div><span>Sending availability</span><strong className="campaign-summary-text">Not enabled</strong><small>Activation is still pending</small></div>
        </div>
      </div>

      <div className="campaign-panel">
        <div className="campaign-panel-header">
          <div><span className="panel-kicker">CAMPAIGN LIBRARY</span><h2>All campaigns <span className="campaign-count">{campaigns.length}</span></h2><p>Organize and prepare your WhatsApp message campaigns.</p></div>
          <button type="button" className="primary-button campaign-create" onClick={() => setShowForm((value) => !value)}>
            <span aria-hidden="true">{showForm ? '×' : '+'}</span> {showForm ? 'Close form' : 'New campaign'}
          </button>
        </div>

        {showForm && (
          <form className="campaign-create-form" onSubmit={async (event) => { await createCampaign(event); }}>
            <div className="campaign-form-heading"><div><h3>Create a new campaign</h3><p>New campaigns are saved as drafts. No messages will be sent.</p></div><span className="campaign-draft-pill">DRAFT ONLY</span></div>
            <div className="campaign-form-grid">
              <label>Campaign name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Diwali customer updates" minLength={2} required /></label>
              <label>WhatsApp template name<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="e.g. diwali_customer_update" required /></label>
            </div>
            <div className="campaign-form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save campaign draft'}</button><button type="button" className="campaign-secondary-button" onClick={() => setShowForm(false)}>Cancel</button></div>
          </form>
        )}

        {message && <div className="campaign-alert success" role="status">{message}</div>}
        {error && <div className="campaign-alert error" role="alert">{error}</div>}

        <div className="campaign-toolbar">
          <label className="campaign-search"><span aria-hidden="true">⌕</span><input aria-label="Search campaigns" placeholder="Search campaigns or templates…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="campaign-toolbar-right"><span className="campaign-filter-label">All statuses</span><button type="button" className="campaign-secondary-button" onClick={() => void loadCampaigns()} disabled={loading}><span aria-hidden="true">↻</span> {loading ? 'Refreshing…' : 'Refresh'}</button></div>
        </div>

        <div className="campaign-table-scroll">
          <table className="campaign-table">
            <thead><tr><th>CAMPAIGN</th><th>TEMPLATE</th><th>STATUS</th><th>CREATED</th></tr></thead>
            <tbody>
              {visibleCampaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td><div className="campaign-name-cell"><span className="campaign-name-icon">▤</span><div><strong>{campaign.name}</strong><small>WhatsApp campaign</small></div></div></td>
                  <td><span className="campaign-template">{campaign.templateName}</span></td>
                  <td><span className={campaign.status.toUpperCase() === 'DRAFT' ? 'campaign-status draft' : 'campaign-status'}><span />{campaign.status}</span></td>
                  <td className="campaign-date">{new Date(campaign.createdAt).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'})}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && visibleCampaigns.length === 0 && (
            <div className="campaign-empty"><div className="campaign-empty-icon">▤</div><h3>{search ? 'No matching campaigns' : 'No campaigns yet'}</h3><p>{search ? 'Try another search term.' : 'Create your first campaign draft to get started.'}</p>{!search && <button className="campaign-secondary-button" type="button" onClick={() => setShowForm(true)}>+ Create a draft</button>}</div>
          )}
          {loading && campaigns.length === 0 && <div className="campaign-empty"><p>Loading your campaigns…</p></div>}
        </div>
        <div className="campaign-panel-footer"><span>Showing {visibleCampaigns.length} of {campaigns.length} campaigns</span><span>Campaigns are drafts · Sending disabled</span></div>
      </div>
      <div className="campaign-information"><span aria-hidden="true">ⓘ</span><p><strong>Sending is not yet available.</strong> Campaigns are saved as drafts until official Meta onboarding, template validation, opt-out handling and a durable delivery queue are configured.</p></div>
    </section>
  );
}
