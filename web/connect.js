/* OAuth consent stays in this page; credentials and decisions go only to the API. */
(() => {
  const $ = (id) => document.getElementById(id);
  const status = $('auth-status');
  const error = $('auth-error');
  const form = $('oauth-consent');
  const buttons = [...form.querySelectorAll('button')];
  const params = new URLSearchParams(location.search);
  const allowed = new Set(['response_type', 'client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource']);
  for (const name of [...params.keys()]) if (!allowed.has(name)) params.delete(name);
  const returnTo = '/connect' + (params.size ? '?' + params.toString() : '');
  $('auth-retry').querySelector('a').href = returnTo;
  const signInUrl = '/sign-in?return_to=' + encodeURIComponent(returnTo);
  // Never a valid connection ID, so the picker cannot confuse it with one.
  const NEW = '+new';
  let consent;
  let busy = false;
  let nameEdited = false;

  function canCreate() {
    return !!consent && !consent.targetAgentId && Array.isArray(consent.platforms) && consent.platforms.length > 0;
  }
  function creating() {
    return canCreate() && (consent.agents.length === 0 || $('agent-id').value === NEW);
  }
  function selectedConnection() {
    return consent?.agents.find((agent) => agent.id === (consent.targetAgentId || $('agent-id').value));
  }
  function newPlatform() {
    return consent?.platforms?.find((platform) => platform.id === $('new-platform').value);
  }
  function defaultName(platform) {
    const taken = new Set(consent.agents.map((agent) => agent.name));
    let name = platform.label, n = 2;
    while (taken.has(name)) name = platform.label + ' ' + n++;
    return name;
  }
  // Same handle rules as the workspace's connection form.
  function uniqueHandle(base) {
    let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
    if (!/^[a-z]/.test(slug) || slug.length < 2 || ['owner', 'relay', 'all', 'any', 'admin', 'me'].includes(slug)) slug = 'agent' + (slug ? '-' + slug : '');
    slug = slug.slice(0, 28);
    let id = slug, n = 2;
    while (consent.agents.some((agent) => agent.id === id || agent.handle === id)) { const suffix = '-' + n++; id = slug.slice(0, 32 - suffix.length) + suffix; }
    return id;
  }

  const scopeLabels = {
    'relay:read': 'Read shared tasks, replies, and available assistants',
    'relay:send': 'Send work to your permitted assistants',
    'relay:work': 'Pick up requests and send results back',
    offline_access: 'Stay connected between visits',
  };
  // Mirrors the server: a connection's role limits what the app can use.
  function renderScopes(roles) {
    const scopes = consent.scopes.filter((scope) => !roles || ((scope !== 'relay:send' || roles.can_request) && (scope !== 'relay:work' || roles.can_work)));
    $('scope-list').replaceChildren(...scopes.map((scope) => {
      const item = document.createElement('li');
      item.textContent = scopeLabels[scope] || scope;
      return item;
    }));
  }

  function updateConnectionChoice() {
    const fixed = !!consent?.targetAgentId;
    const create = creating();
    const agent = create ? null : selectedConnection();
    $('agent-id').disabled = busy || fixed || !consent?.agents.length;
    $('agent-id').required = !fixed && !!consent?.agents.length;
    $('new-connection').hidden = !create;
    $('new-connection').disabled = busy || !create;
    $('new-name').required = create;
    $('consent-allow').disabled = busy || !(agent || create);
    $('consent-allow').textContent = create ? 'Create and connect' : agent ? 'Connect ' + agent.name : 'Connect';
    $('connection-selection').textContent = create
      ? 'Hitchhike will create this connection, then connect the app to it.'
      : agent
        ? 'This app will act as ' + agent.name + ' (' + agent.id + ') on Hitchhike.'
        : 'This app used the general Hitchhike address. Choose its connection to continue.';
    $('connection-id').textContent = agent ? agent.name + ' · ' + agent.id : create ? 'Created when you connect' : 'Choose a connection to see its ID';
    $('connection-purpose').textContent = agent ? 'Allow this app to use your ' + agent.name + ' connection on Hitchhike.' : '';
    if (consent) renderScopes(create ? { can_request: $('new-can-request').checked, can_work: $('new-can-work').checked } : agent || null);
  }
  function applyPlatform() {
    const platform = newPlatform();
    if (!platform) return;
    if (!nameEdited) $('new-name').value = defaultName(platform);
    $('new-can-request').checked = !!platform.can_request;
    $('new-can-work').checked = !!platform.can_work;
    updateConnectionChoice();
  }
  $('agent-id').addEventListener('change', updateConnectionChoice);
  $('new-platform').addEventListener('change', applyPlatform);
  $('new-name').addEventListener('input', () => { nameEdited = true; });
  $('new-can-request').addEventListener('change', updateConnectionChoice);
  $('new-can-work').addEventListener('change', updateConnectionChoice);

  function failure(problem) {
    status.hidden = true;
    error.hidden = false;
    error.textContent = problem.message || 'This connection could not be confirmed. Reload to try again.';
    $('auth-retry').hidden = false;
  }
  function invalid(message, field) {
    error.hidden = false;
    error.textContent = message;
    field.focus();
    updateConnectionChoice();
  }

  async function request(method, body, path = '/oauth/authorize') {
    const token = await window.AgentConnectAuth.getToken(true);
    if (!token) {
      location.replace(signInUrl);
      throw new Error('Sign in again to continue.');
    }
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    if (body) {
      headers['Content-Type'] = typeof body === 'string' ? 'application/json' : 'application/x-www-form-urlencoded';
      headers['X-CSRF-Token'] = consent.csrfToken;
    }
    const response = await fetch(window.AgentConnectAuth.apiUrl + path + (method === 'GET' ? '?' + params.toString() : ''), {
      method, credentials: 'omit', redirect: 'error', headers, body,
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) location.replace(signInUrl);
      const problem = new Error(payload.error?.message || payload.error_description || 'The connection request could not be verified.');
      problem.code = payload.error?.code;
      throw problem;
    }
    return payload;
  }

  function renderPicker(selected = '') {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a connection…';
    placeholder.disabled = true;
    placeholder.selected = true;
    const options = consent.agents.map((agent) => {
      const option = document.createElement('option');
      option.value = agent.id;
      const role = [agent.can_request ? 'send' : '', agent.can_work ? 'work' : ''].filter(Boolean).join(' and ');
      option.textContent = agent.name + ' — ' + (role || 'read only') + ' (' + agent.id + ')';
      return option;
    });
    if (canCreate() && consent.agents.length) {
      const option = document.createElement('option');
      option.value = NEW;
      option.textContent = 'Create a new connection…';
      options.push(option);
    }
    $('agent-id').replaceChildren(placeholder, ...options);
    $('agent-id').value = selected;
  }

  /** Uses the workspace's own connection API: the same CSRF check, limits and
   * platform defaults. The consent request is untouched until the decision. */
  async function createConnection() {
    const platform = newPlatform();
    const name = $('new-name').value.trim();
    const payload = { id: uniqueHandle(name), name, platform: platform.id, can_request: $('new-can-request').checked, can_work: $('new-can-work').checked };
    try {
      const out = await request('POST', JSON.stringify(payload), '/v1/admin/agents');
      const agent = out.agent;
      if (!agent || typeof agent.id !== 'string' || typeof agent.name !== 'string') throw new Error('The new connection could not be confirmed. Reload to choose it.');
      consent.agents.push({ id: agent.id, handle: agent.handle, name: agent.name, can_request: agent.can_request ? 1 : 0, can_work: agent.can_work ? 1 : 0 });
      return agent;
    } catch (problem) {
      // A connection saved by an earlier, interrupted attempt is chosen
      // explicitly rather than duplicated.
      if (problem.code === 'handle_taken') problem.message = 'A connection with this name already exists. Reload to choose it, or use a different name.';
      throw problem;
    }
  }

  async function load() {
    try {
      const clerk = await window.AgentConnectAuth.ready;
      if (!clerk.session) { location.replace(signInUrl); return; }
      history.replaceState(null, '', returnTo);
      consent = await request('GET');
      if (!['clientName', 'redirectOrigin', 'email', 'csrfToken', 'requestId'].every((key) => typeof consent[key] === 'string') || !Array.isArray(consent.scopes) || !Array.isArray(consent.agents)) {
        throw new Error('The connection request was incomplete. Reload to try again.');
      }
      if (consent.targetAgentId != null && (typeof consent.targetAgentId !== 'string' || !consent.targetAgentId || consent.agents.length !== 1 || consent.agents[0]?.id !== consent.targetAgentId)) {
        consent = null;
        throw new Error('The chosen connection could not be confirmed. Return to its setup page and try again.');
      }
      const fixed = !!consent.targetAgentId;
      $('connect-title').textContent = 'Connect ' + (fixed ? consent.agents[0].name : consent.clientName);
      $('client-name').textContent = consent.clientName;
      // A metadata-document client is identified by the host that published it.
      $('client-host').textContent = typeof consent.clientHost === 'string' ? consent.clientHost : '';
      $('client-host-row').hidden = typeof consent.clientHost !== 'string';
      $('signed-in').textContent = 'Signed in as ' + consent.email;
      $('scope-heading').textContent = (fixed ? consent.agents[0].name : consent.clientName) + ' will be able to';
      $('redirect-origin').textContent = consent.redirectOrigin;
      renderPicker();
      const noAgents = consent.agents.length === 0;
      if (canCreate()) {
        // Only a pre-filled suggestion. The owner confirms every field, and an
        // unrecognized app gets an explicit choice rather than a guess.
        const suggested = consent.platforms.find((platform) => platform.id === consent.suggestedPlatform);
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose an assistant…';
        placeholder.disabled = true;
        $('new-platform').replaceChildren(...(suggested ? [] : [placeholder]), ...consent.platforms.map((platform) => {
          const option = document.createElement('option');
          option.value = platform.id;
          option.textContent = platform.label;
          return option;
        }));
        $('new-platform').value = suggested ? suggested.id : '';
        $('new-can-request').checked = true;
        $('new-can-work').checked = true;
        // With a picker, its own hint already explains the new connection.
        $('new-connection-intro').textContent = 'You don’t have a connection yet. Hitchhike will create one for ' + consent.clientName + ' with these settings. You can change them later in your workspace.';
        $('new-connection-intro').hidden = !noAgents;
        applyPlatform();
      }
      $('agent-picker').hidden = noAgents || fixed;
      $('fixed-connection').hidden = !fixed;
      // An API without in-place creation still explains the way forward.
      $('no-agents').hidden = !noAgents || canCreate();
      $('consent-allow').hidden = noAgents && !canCreate();
      updateConnectionChoice();
      status.hidden = true;
      $('consent-details').hidden = false;
    } catch (problem) {
      failure(problem);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!consent || busy) return;
    const decision = event.submitter?.value || 'allow';
    if (!['allow', 'deny'].includes(decision)) return;
    const create = decision === 'allow' && creating();
    if (create) {
      if (!newPlatform()) return invalid('Choose which assistant this connection is for.', $('new-platform'));
      if (!$('new-name').value.trim()) return invalid('Give this connection a name.', $('new-name'));
      if (!$('new-can-request').checked && !$('new-can-work').checked) return invalid('Allow this connection to send tasks, receive tasks, or both.', $('new-can-request'));
    } else if (decision === 'allow' && !selectedConnection()) {
      return invalid('Choose which Hitchhike connection this app should use.', $('agent-id'));
    }
    busy = true;
    buttons.forEach((button) => { button.disabled = true; });
    updateConnectionChoice();
    error.hidden = true;
    status.hidden = false;
    status.textContent = create ? 'Creating your connection…' : 'Confirming your choice…';
    try {
      if (create) {
        const agent = await createConnection();
        // Saved before consent: a retry reuses this connection, never a copy.
        $('agent-picker').hidden = false;
        renderPicker(agent.id);
        status.textContent = 'Confirming your choice…';
      }
      const body = new URLSearchParams({ request_id: consent.requestId, csrf_token: consent.csrfToken, decision });
      if (decision === 'allow') body.set('agent_id', selectedConnection().id);
      const response = await request('POST', body);
      const callback = new URL(response.redirectUrl);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
      if (callback.origin !== consent.redirectOrigin || callback.username || callback.password || (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && loopback))) {
        throw new Error('The app returned an unexpected redirect. Restart this connection request.');
      }
      location.assign(callback.href);
    } catch (problem) {
      busy = false;
      buttons.forEach((button) => { button.disabled = false; });
      updateConnectionChoice();
      failure(problem);
    }
  });
  load();
})();
