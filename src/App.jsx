import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_PATH = '/api/v1/form_template_library';
const FORWARD_PREFIX = '/forward';
const BASE_URL_KEY = 'ftl-uploader-base-url';
const TOKENS_KEY = 'ftl-uploader-tokens';
const DEFAULT_BASE_URL = 'http://localhost:8080';
// lumberfi-services hosts (REACT_APP_PLATFORM_API_URL in lumberfi-web), not the *-api.lumberfi.com Django service
const SUGGESTED_BASE_URLS = [
  'http://localhost:8080',
  'https://dev-platform.lumberfi.com',
  'https://qa-platform.lumberfi.com',
  'https://stage-platform.lumberfi.com',
  'https://qa-enterprise-platform.lumberfi.com',
  'https://stage-enterprise-platform.lumberfi.com',
];
const FORM_NAME_PATTERN = /^[A-Za-z0-9 ]+$/;

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private window); the value just isn't remembered
  }
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/+$/, '');
}

function isValidBaseUrl(baseUrl) {
  return /^https?:\/\/[^/\s]+/.test(baseUrl);
}

function hostOf(baseUrl) {
  return baseUrl.replace(/^https?:\/\//, '');
}

// Same rule as FormTemplateLibraryService.generateSlug and the form builder's getFormioPathWithCompanyId
function toFormioSlug(name) {
  return name
    .split(' ')
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

function compactName(name) {
  return name.replace(/ /g, '').toLowerCase();
}

// Accepts either a components array or a whole Form.io form export ({ ..., components: [...] })
function parseComponents(text) {
  if (!text.trim()) {
    return { empty: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `This isn't valid JSON: ${e.message}` };
  }
  const components = Array.isArray(parsed) ? parsed : parsed?.components;
  if (!Array.isArray(components)) {
    return { error: 'Expected a components array, or a Form.io form with a "components" array.' };
  }
  if (components.length === 0) {
    return { error: 'The form has no components.' };
  }
  return { components, title: Array.isArray(parsed) ? null : parsed.title };
}

// Parses a JSON body, or throws a readable error when the server answered with something else (e.g. an HTML page)
async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(
      `${response.status}: expected JSON but got ${response.headers.get('content-type') || 'no content type'}. ` +
        'Check that the server is lumberfi-services (the platform API). ' +
        (snippet ? `Response: "${snippet}"` : ''),
    );
  }
}

async function readError(response) {
  try {
    const body = await readJson(response);
    return `${response.status}: ${body.message || body.detail_message || JSON.stringify(body)}`;
  } catch (e) {
    return e.message;
  }
}

export default function App() {
  const [baseUrlInput, setBaseUrlInput] = useState(() => readStored(BASE_URL_KEY, DEFAULT_BASE_URL));
  const [tokens, setTokens] = useState(() => readStored(TOKENS_KEY, {}));
  const [templates, setTemplates] = useState([]);
  const [listState, setListState] = useState({ loading: false, error: null, loaded: false });

  const [name, setName] = useState('');
  const [componentsText, setComponentsText] = useState('');
  const [fileName, setFileName] = useState('');
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [submit, setSubmit] = useState({ busy: false, error: null, created: null });
  const fileInput = useRef(null);

  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const baseUrlValid = isValidBaseUrl(baseUrl);
  const token = tokens[baseUrl] || '';
  const ready = Boolean(baseUrlValid && token.trim());
  // Nothing is requested until the user connects; a reload with a saved server and token reconnects
  const [connected, setConnected] = useState(ready);
  const live = connected && ready;

  const requestHeaders = useMemo(
    () => ({
      'x-api-base-url': baseUrl,
      Authorization: `Bearer ${token.trim().replace(/^Bearer\s+/i, '')}`,
    }),
    [baseUrl, token],
  );

  const loadTemplates = useCallback(async () => {
    if (!live) {
      setTemplates([]);
      setListState({ loading: false, error: null, loaded: false });
      return;
    }
    setListState((state) => ({ ...state, loading: true, error: null }));
    try {
      const response = await fetch(FORWARD_PREFIX + API_PATH, { headers: requestHeaders });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setTemplates(await readJson(response));
      setListState({ loading: false, error: null, loaded: true });
    } catch (e) {
      setTemplates([]);
      setListState({ loading: false, error: e.message, loaded: false });
    }
  }, [live, requestHeaders]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const trimmedName = name.trim();
  const parsed = useMemo(() => parseComponents(componentsText), [componentsText]);

  const nameError = useMemo(() => {
    if (!trimmedName) return null;
    if (!FORM_NAME_PATTERN.test(trimmedName)) return 'Use letters, digits and spaces only, as in the form builder.';
    if (templates.some((t) => compactName(t.name) === compactName(trimmedName))) {
      return 'The library already has a form with this name.';
    }
    return null;
  }, [trimmedName, templates]);

  const canSubmit = live && trimmedName && !nameError && parsed.components && !submit.busy;

  function disconnect() {
    setConnected(false);
    setSubmit({ busy: false, error: null, created: null });
  }

  function handleBaseUrlChange(value) {
    setBaseUrlInput(value);
    writeStored(BASE_URL_KEY, value);
    disconnect();
  }

  function handleTokenChange(value) {
    const next = { ...tokens, [baseUrl]: value };
    setTokens(next);
    writeStored(TOKENS_KEY, next);
    disconnect();
  }

  async function loadFile(file) {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setComponentsText(text);
    setPasting(false);
    const result = parseComponents(text);
    if (!trimmedName && result.title) {
      setName(result.title.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim());
    }
  }

  function clearComponents() {
    setComponentsText('');
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmit({ busy: true, error: null, created: null });
    try {
      const response = await fetch(FORWARD_PREFIX + API_PATH, {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, components: parsed.components }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const created = await readJson(response);
      setSubmit({ busy: false, error: null, created });
      setName('');
      clearComponents();
      loadTemplates();
    } catch (e) {
      setSubmit({ busy: false, error: e.message, created: null });
    }
  }

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  );

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Form template library</h1>
        <p className="lede">Forms added here are copied to every company that turns on the form builder.</p>
      </header>

      <section className="connection" aria-label="Server connection">
        {!live ? (
          <form
            className="connection-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) setConnected(true);
            }}
          >
            <div className="field">
              <label htmlFor="base-url">Server</label>
              <input
                id="base-url"
                type="text"
                list="base-url-options"
                placeholder={DEFAULT_BASE_URL}
                value={baseUrlInput}
                onChange={(e) => handleBaseUrlChange(e.target.value)}
                spellCheck={false}
              />
              <datalist id="base-url-options">
                {SUGGESTED_BASE_URLS.map((url) => (
                  <option key={url} value={url} />
                ))}
              </datalist>
              {baseUrlInput.trim() && !baseUrlValid && (
                <p className="note error-text">Enter a full URL, such as https://dev-platform.lumberfi.com.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="token">Super admin token</label>
              <input
                id="token"
                type="password"
                placeholder="Paste from the Authorization header"
                value={token}
                onChange={(e) => handleTokenChange(e.target.value)}
                autoComplete="off"
              />
              <p className="note">Saved for this server, in this browser only.</p>
            </div>
            <button type="submit" className="button" disabled={!ready}>
              Connect
            </button>
          </form>
        ) : (
          <div className="connection-line">
            <span className={listState.error ? 'status status-off' : 'status status-on'} aria-hidden="true" />
            <span>
              {listState.error ? 'Could not reach ' : 'Connected to '}
              <strong>{hostOf(baseUrl)}</strong>
            </span>
            <button type="button" className="link" onClick={disconnect}>
              Change
            </button>
          </div>
        )}
      </section>

      <main className="columns">
        <section className="compose" aria-labelledby="compose-title">
          <h2 id="compose-title">Add a form</h2>

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                placeholder="Weekly Safety Inspection"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(nameError)}
              />
              {nameError ? (
                <p className="note error-text">{nameError}</p>
              ) : trimmedName ? (
                <p className="note">
                  Each company gets it at <code>…-{toFormioSlug(trimmedName)}</code>
                </p>
              ) : null}
            </div>

            <div className="field">
              <span className="label">Form.io components</span>
              {fileName && parsed.components ? (
                <div className="file-chip">
                  <div>
                    <strong>{fileName}</strong>
                    <span className="note">{parsed.components.length} top-level components</span>
                  </div>
                  <button type="button" className="link" onClick={clearComponents}>
                    Remove
                  </button>
                </div>
              ) : pasting ? (
                <textarea
                  rows={10}
                  spellCheck={false}
                  aria-label="Components JSON"
                  placeholder='[{ "type": "textfield", "key": "employeeName", "label": "Employee name" }]'
                  value={componentsText}
                  onChange={(e) => setComponentsText(e.target.value)}
                  autoFocus
                />
              ) : (
                <label
                  className={dragging ? 'dropzone dropzone-active' : 'dropzone'}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".json,application/json"
                    className="visually-hidden"
                    onChange={(e) => loadFile(e.target.files?.[0])}
                  />
                  <span className="dropzone-title">Drop the form's JSON file here</span>
                  <span className="note">A Form.io export or a components array. Click to choose a file.</span>
                </label>
              )}

              {parsed.error && <p className="note error-text">{parsed.error}</p>}
              {pasting && parsed.components && (
                <p className="note">{parsed.components.length} top-level components</p>
              )}
              {!fileName && (
                <button
                  type="button"
                  className="link link-small"
                  onClick={() => {
                    setPasting(!pasting);
                    setComponentsText('');
                  }}
                >
                  {pasting ? 'Choose a file instead' : 'Paste JSON instead'}
                </button>
              )}
            </div>

            <button type="submit" className="button" disabled={!canSubmit}>
              {submit.busy ? 'Adding…' : 'Add form'}
            </button>
            {!live && <p className="note">Connect to a server first.</p>}
          </form>

          {submit.error && (
            <p className="message message-error" role="alert">
              {submit.error}
            </p>
          )}
          {submit.created && (
            <p className="message message-ok" role="status">
              Added {submit.created.name}.
            </p>
          )}
        </section>

        <section className="library" aria-labelledby="library-title">
          <div className="library-head">
            <h2 id="library-title">
              In the library
              {listState.loaded && <span className="count">{templates.length}</span>}
            </h2>
            <button type="button" className="link" onClick={loadTemplates} disabled={!live || listState.loading}>
              {listState.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {listState.error && <p className="message message-error">{listState.error}</p>}
          {!listState.error && !live && <p className="empty">Connect to a server to see its library.</p>}
          {!listState.error && live && listState.loaded && templates.length === 0 && (
            <p className="empty">Nothing here yet. Add the first form.</p>
          )}

          {sortedTemplates.length > 0 && (
            <ul className="index">
              {sortedTemplates.map((t) => (
                <li key={t.id} className={submit.created?.id === t.id ? 'index-row index-row-new' : 'index-row'}>
                  <div className="index-main">
                    <span className="index-name">{t.name}</span>
                    <span className={t.active ? 'state' : 'state state-off'}>{t.active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <code className="index-path" title={t.s3_path}>
                    {t.s3_path}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
