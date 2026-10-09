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
  let consent;
  let busy = false;

  function selectedConnection() {
    return consent?.agents.find((agent) => agent.id === (consent.targetAgentId || $('agent-id').value));
  }

  function updateConnectionChoice() {
    const agent = selectedConnection();
    const fixed = !!consent?.targetAgentId;
    $('agent-id').disabled = busy || fixed || !consent?.agents.length;
    $('agent-id').required = !fixed && !!consent?.agents.length;
    $('consent-allow').disabled = busy || !agent;
    $('consent-allow').textContent = agent ? 'Connect ' + agent.name : 'Connect';
    $('connection-selection').textContent = agent
      ? 'This app will act as ' + agent.name + ' (' + agent.id + ') on Hitchhike.'
      : 'This app used the general Hitchhike address. Choose its connection to continue.';
    $('connection-id').textContent = agent ? agent.name + ' · ' + agent.id : 'Choose a connection to see its ID';
    $('connection-purpose').textContent = agent ? 'Allow this app to use your ' + agent.name + ' connection on Hitchhike.' : '';
  }
  $('agent-id').addEventListener('change', updateConnectionChoice);

  function failure(problem) {
    status.hidden = true;
    error.hidden = false;
    error.textContent = problem.message || 'This connection could not be confirmed. Reload to try again.';
    $('auth-retry').hidden = false;
  }

  async function request(method, body) {
    const token = await window.AgentConnectAuth.getToken(true);
    if (!token) {
      location.replace(signInUrl);
      throw new Error('Sign in again to continue.');
    }
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['X-CSRF-Token'] = consent.csrfToken;
    }
    const response = await fetch(window.AgentConnectAuth.apiUrl + '/oauth/authorize' + (method === 'GET' ? '?' + params.toString() : ''), {
      method, credentials: 'omit', redirect: 'error', headers, body,
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) location.replace(signInUrl);
      throw new Error(payload.error?.message || payload.error_description || 'The connection request could not be verified.');
    }
    return payload;
  }

  const scopeLabels = {
    'relay:read': 'Read shared tasks, replies, and available assistants',
    'relay:send': 'Send work to your permitted assistants',
    'relay:work': 'Pick up requests and send results back',
    offline_access: 'Stay connected between visits',
  };

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
      $('signed-in').textContent = 'Signed in as ' + consent.email;
      $('redirect-origin').textContent = consent.redirectOrigin;
      $('scope-list').replaceChildren(...consent.scopes.map((scope) => {
        const item = document.createElement('li');
        item.textContent = scopeLabels[scope] || scope;
        return item;
      }));
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a connection…';
      placeholder.disabled = true;
      placeholder.selected = true;
      $('agent-id').replaceChildren(placeholder, ...consent.agents.map((agent) => {
        const option = document.createElement('option');
        option.value = agent.id;
        const role = [agent.can_request ? 'send' : '', agent.can_work ? 'work' : ''].filter(Boolean).join(' and ');
        option.textContent = agent.name + ' — ' + (role || 'read only') + ' (' + agent.id + ')';
        return option;
      }));
      $('agent-id').value = '';
      const noAgents = consent.agents.length === 0;
      $('agent-picker').hidden = noAgents || fixed;
      $('fixed-connection').hidden = !fixed;
      $('agent-id').disabled = noAgents;
      $('consent-allow').hidden = noAgents;
      $('no-agents').hidden = !noAgents;
      updateConnectionChoice();
      status.hidden = true;
      $('consent-details').hidden = false;
    } catch (problem) { failure(problem); }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!consent || busy) return;
    const decision = event.submitter?.value || 'allow';
    if (!['allow', 'deny'].includes(decision)) return;
    if (decision === 'allow' && !selectedConnection()) {
      error.hidden = false;
      error.textContent = 'Choose which Hitchhike connection this app should use.';
      $('agent-id').focus();
      updateConnectionChoice();
      return;
    }
    busy = true;
    buttons.forEach((button) => { button.disabled = true; });
    updateConnectionChoice();
    error.hidden = true;
    status.hidden = false;
    status.textContent = 'Confirming your choice…';
    try {
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
