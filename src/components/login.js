// SaLogin — the login page (doc 10 §7, doc 03 §2.1). A plain username/password form that calls
// authProvider.login({username, password}); success navigates to the login result's redirectTo
// (default '#/'), failure shows an inline error. Reads the active authProvider from the registry
// (core/registry.js) rather than requiring a prop, since <sa-admin> mounts it standalone (outside
// the shell) once authenticated redirect logic decides #/login is the active route.

import { getAuthProvider } from '../core/registry.js';
import { navigate } from '../core/router.js';

export class SaLogin extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-login');
    this.setAttribute('data-sa-part', 'login');
    this._render();
  }

  _render() {
    this.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'sa-login__card';

    const title = document.createElement('div');
    title.className = 'sa-login__title';
    title.textContent = 'Sign in';
    card.appendChild(title);

    const form = document.createElement('form');
    form.className = 'sa-login__form';

    const username = this._field('username', 'text', 'Username');
    const password = this._field('password', 'password', 'Password');
    form.appendChild(username.wrapper);
    form.appendChild(password.wrapper);

    const error = document.createElement('div');
    error.className = 'sa-input__error';
    error.setAttribute('data-sa-part', 'login-error');
    error.style.display = 'none';
    form.appendChild(error);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'sa-btn sa-btn--primary sa-login__submit';
    submit.textContent = 'Login';
    form.appendChild(submit);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._submit({ username: username.input.value, password: password.input.value }, error, submit);
    });

    card.appendChild(form);
    this.appendChild(card);
  }

  async _submit(credentials, errorEl, submitBtn) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    const authProvider = getAuthProvider();
    if (!authProvider || typeof authProvider.login !== 'function') {
      errorEl.textContent = 'No authProvider configured.';
      errorEl.style.display = '';
      return;
    }

    submitBtn.disabled = true;
    try {
      const result = await authProvider.login(credentials);
      const redirectTo = result && result.redirectTo;
      if (redirectTo === false) return;
      navigate(typeof redirectTo === 'string' ? redirectTo : '#/');
    } catch (err) {
      errorEl.textContent = (err && err.message) || 'Login failed.';
      errorEl.style.display = '';
    } finally {
      submitBtn.disabled = false;
    }
  }

  _field(name, type, label) {
    const wrapper = document.createElement('label');
    wrapper.className = 'sa-input';
    wrapper.setAttribute('data-sa-part', 'login-field');

    const labelEl = document.createElement('span');
    labelEl.className = 'sa-input__label';
    labelEl.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.autocomplete = name === 'password' ? 'current-password' : 'username';
    input.required = true;

    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    return { wrapper, input };
  }
}

if (!customElements.get('sa-login')) customElements.define('sa-login', SaLogin);

export default SaLogin;
