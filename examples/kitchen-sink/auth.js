// auth.js — fake AuthProvider for the kitchen-sink example's "Private" menu section
// (resources/audit-log.js). Credentials are test/test, on purpose: this whole app is a demo, and
// unlike src/auth/localAuthProvider.js (used by the html-only/js-config/mixed examples, and
// persisted via localStorage), the session here is held in memory only — reloading the page
// always logs you back out, which makes the "most of the admin is public, one section isn't"
// split obvious rather than something a stale localStorage entry papers over between visits.
//
// Same resolve=allow/reject=deny convention as every other AuthProvider in this repo
// (auth/authGuard.js).

const CREDENTIALS = { username: 'test', password: 'test' };

export const createFakeAuthProvider = () => {
  let session = null;

  return {
    async login({ username, password } = {}) {
      if (username !== CREDENTIALS.username || password !== CREDENTIALS.password) {
        throw new Error('Invalid username or password. Use test / test.');
      }
      session = { id: username, fullName: 'Test User' };
    },

    async logout() {
      session = null;
    },

    async checkAuth() {
      if (!session) throw new Error('Not authenticated');
    },

    async checkError(error) {
      const status = error && error.status;
      if (status === 401 || status === 403) {
        session = null;
        throw new Error('Session expired');
      }
      // any other status: not an auth error, resolve so the UI shows it normally
    },

    async getIdentity() {
      if (!session) throw new Error('Not authenticated');
      return session;
    },

    async getPermissions() {
      return [];
    },
  };
};

export default createFakeAuthProvider;
